# Agent Note：企业团队控制面

Status: implemented

[English](2026-09-01-enterprise-team-control-plane.md) | 中文

## Problem

企业团队定义可以授权固定名册，但直接针对实验性 Agent Teams API 启动工作，会把稳定企业策略、浏览器请求与 PostgreSQL 绑定到一种私有 runtime。若把 HTTP 请求内的数据库更新和 root Session event log 伪装成原子提交，还会创建两个竞争的 runtime 权威。

## Decision

`EnterpriseTeamControlService` 负责 TeamRun、TeamDecision 和显式自主权授权的稳定 Host 流程。浏览器请求不包含组织、actor、root Session、runtime revision 或 event sequence 字段。Host request context 提供 principal，中央 RBAC 检查 `team.execute`、`team.decision.respond` 和 `team.autonomy.manage`，Workspace admission 复用 Session 创建授权。

`EnterpriseTeamRuntimeDriver` 是唯一 runtime 依赖。Start、cancel、decision response 和 reconciliation 都接收稳定 operation ID。Driver 负责将权威事实追加到 root Session event log。PostgreSQL `team_runs` 和 `team_decisions` 记录只以 runtime revision 和 source event sequence 作为查询投影；driver 未知结果保持可 reconcile，不对外宣称原子提交。Start 幂等在审计和 run id 分配前解析；repository lock 只为胜出的 insert 调用 allocator，成功或重复请求的审计都记录已持久化 run id。重复的 `starting` reservation 先对稳定 start operation 执行 reconcile；若权威事件仍不存在，再重放幂等 driver 调用，从而同时恢复 driver 调用前崩溃和 driver 已提交但投影前崩溃。

每次 start attempt 只结算一条审计事件。Reservation 前的拒绝以 team definition 为资源，并与稳定 start 幂等 operation 相关联；reservation 后的结果以已持久化 TeamRun 为资源，同时将 team id 和 definition revision 保留为安全 details。Audit decision 只表示授权：RBAC、可见性、Workspace、幂等与 definition admission 拒绝记录为 denied，已授权的 active、pending、确定性失败或未知 runtime 结果仍记录为 allowed。Runtime 状态单独记录于 `details.outcome`：`starting`、`waiting-human` 与 `verifying` 映射为 `runtime-pending`，`failed` 映射为 `runtime-failed`，active、completed 与 cancelled 保留原状态名。未知 driver 结果记录 `runtime-unknown`，并保留 run 为 `starting` 以供 reconciliation。TeamDecision 与自主权审计 adapter 保留各自的 resource type、id 与 admission reason，不会从 Remote endpoint 重新归类所有事件。

Start reservation 使用与 definition save/archive 相同的全局 team lock，重读 active 且 revision 匹配的定义，并从该加锁行固定完整 definition 和 roster。后续定义修改不改变已有 run。Runtime 产生的 decision 只能通过 Host 投影方法进入 PostgreSQL；browser 不能创建。只有被指派人类、团队 owner 或管理员可回答。一个短 per-decision 事务在释放连接并调用 driver 前预留 operation id、request digest 和幂等键；重试重放该 operation，不同键无法到达 driver。Run 投影将相同 runtime revision 与相同 payload 视为 no-op，拒绝同 revision 的不同 payload，且绝不更换已绑定的 root Session id。自主权写入仅允许团队 owner 和管理员；composite grant lock 会串行化不同请求键，save/revoke 以相同方式 canonicalize task 和 capability 键。

自主权授权是人类创建的记录，以 team、不可变 employee release、task type 和 capability scope 为键。只有已入名册的 Agent release 可获授权。Evidence reference 会 canonicalize，撤销为终态，runtime 代码不存在 grant write 方法，因此不能根据成功记录自动提升自主权。Run、decision 与 grant 查询会 join 当前 definition，并在 limit 前应用最小 viewer/admin 可见性 scope；签名 cursor 将该 scope 与组织、filter 绑定。

具体 Agent Teams adapter、UI 与渠道集成不属于该控制面。

## Alternatives considered

**让 PostgreSQL 成为 TeamRun 引擎。** 拒绝，因为 root Session log 已负责 runtime 事实和 replay；另一个生命周期引擎会在部分失败时发生分歧。

**从企业 controller 直接调用实验性 Agent Teams 包。** 拒绝，因为稳定企业约定必须支持更换 runtime，且不应依赖私有 UI 或实验性包类型。

**根据成功 run 推断自主权。** 拒绝，因为执行权限是人类治理决定，必须有可归责的授权或撤销记录。

## Consequences

- 企业策略、幂等、审计、可见性与查询分页保持稳定，runtime 实现可在单一 driver 后更换。
- 未知网络结果需要 reconciliation，并可能暂时保留可见 `starting` 或取消前投影。
- 交付控制面不代表具体 Agent Teams adapter、TeamRun UI 或渠道路径已存在。

## Verification

聚焦测试覆盖 start 成功、幂等与 operation ID 复用、过期与非 active 定义、可见性、Workspace 拒绝、driver 确定性与未知结果、reconciliation、不可变 roster snapshot、取消、decision ingest 与响应权限、自主权校验与终态撤销、组织 scope、签名分页、Remote principal 注入、审计调用、schema 迁移与可选真实 PostgreSQL 路径。
