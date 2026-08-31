# Agent Note：企业团队控制面

Status: implemented

[English](2026-09-01-enterprise-team-control-plane.md) | 中文

## Problem

企业团队定义可以授权固定名册，但直接针对实验性 Agent Teams API 启动工作，会把稳定企业策略、浏览器请求与 PostgreSQL 绑定到一种私有 runtime。若把 HTTP 请求内的数据库更新和 root Session event log 伪装成原子提交，还会创建两个竞争的 runtime 权威。

## Decision

`EnterpriseTeamControlService` 负责 TeamRun、TeamDecision 和显式自主权授权的稳定 Host 流程。浏览器请求不包含组织、actor、root Session、runtime revision 或 event sequence 字段。Host request context 提供 principal，中央 RBAC 检查 `team.execute`、`team.decision.respond` 和 `team.autonomy.manage`，Workspace admission 复用 Session 创建授权。

`EnterpriseTeamRuntimeDriver` 是唯一 runtime 依赖。Start、cancel、decision response 和 reconciliation 都接收稳定 operation ID。Driver 负责将权威事实追加到 root Session event log。PostgreSQL `team_runs` 和 `team_decisions` 记录只以 runtime revision 和 source event sequence 作为查询投影；driver 未知结果保持可 reconcile，不对外宣称原子提交。

Start 固定 active 定义 revision 和不可变名册。后续定义修改不改变已有 run。Runtime 产生的 decision 只能通过 Host 投影方法进入 PostgreSQL；browser 不能创建。只有被指派人类、团队 owner、管理员或显式授权角色可回答，且 driver 先追加答案，投影再进入 `answered`。

自主权授权是人类创建的记录，以 team、不可变 employee release、task type 和 capability scope 为键。只有已入名册的 Agent release 可获授权。Evidence reference 会 canonicalize，撤销为终态，runtime 代码不存在 grant write 方法，因此不能根据成功记录自动提升自主权。

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
