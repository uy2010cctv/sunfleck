---
description: "持久化 DSH 企业工作记录、审批、调度、团队定义、Outbox 和固定团队。"
kind: "package-reference"
---
# `@deepseek-ai/dsh-enterprise-operations`

[English](README.md) | 中文

## 概述

持久化 DSH 企业工作记录、审批、调度、团队定义、TeamRun 查询投影、显式自主权授权、Outbox 和固定团队。

## 目录

- [包详情](#package-details)
- [开发备注](#dev-note)

-----

<a id="package-details"></a>
## 包详情

基于 DSH 原生执行的持久化运营投影：

- 工作记录引用原生 Session ID 和员工发布版，但不复制事件正文。部署可注入 Session 和发布版解析器；配置后，每个解析器都必须在写入前确认引用属于同一组织。
- 审批请求使用乐观 revision 和可审计状态迁移。
- 员工和固定团队调度每次 occurrence 只创建一条幂等的启动 Session Outbox 命令；即使重试使用另一个请求幂等键，也会返回原命令。
- 固定团队绑定负责人、成员、Workflow 模板和审批策略。
- 固定团队与定义写入共用同一个全局 team-id advisory lock。旧 save 会同步 `needs-charter` 定义的 leader 和 Agent 名册。进入 active 后，兼容判定只比较 request 与已持久 FixedTeam 的 leader、members 和 approval policy；typed role ID 与 formal definition policy 不反向投影到旧记录。Active 定义允许精确 no-op 和仅 Workflow 更新，archived 定义只允许精确 no-op。
- 团队定义增加类型化的人类与 Agent 名册、角色职责、验证策略、集中决策队列、可见性、所有权和章程生命周期，但不存储 TeamRun 状态。
- `EnterpriseTeamControlService` 通过注入的 `EnterpriseTeamRuntimeDriver` 启动和取消以 runtime 为权威的 TeamRun。PostgreSQL 仅存储带 revision fence 的 TeamRun 和 TeamDecision 查询投影；driver 将权威事件追加到 root Session log，并用同一稳定 operation identity 对未知结果做 reconcile。
- Browser 启动请求只包含 team revision fence、Workspace、prompt、source 和幂等键。Host principal 注入组织与创建人，固定定义 revision 和 roster snapshot，检查当前可见性与 Workspace 授权，并写审计。
- TeamDecision 只能由 Host runtime ingest 创建。仅被指派人类、团队 owner 或管理员可响应；driver 先追加答案，PostgreSQL 再投影 `answered`。自主权授权仅允许团队 owner 或管理员保存和撤销。
- 自主权授权是人类针对 team、不可变 employee release、task type 与 capability scope 的显式写入。撤销为终态，evidence reference 会 canonicalize，runtime 路径不能创建、恢复或提升授权。
- Active 定义必须有完整章程、已入队的人类 owner、已入队的 Agent leader、唯一 actor 与 role、有效角色引用，以及完整的验证与注意力策略。Restricted 可见性要求非空且每项已 trim、唯一的用户 ID 列表；organization 和 private 可见性要求空列表。
- Schema 迁移与固定团队创建会在定义不存在时建立一条 `needs-charter` 定义，保留发布版成员、角色标签、leader、审批策略和组织可见性，并使用显式的 `system:legacy-fixed-team-migration` owner 占位。它们不推断名称、north star、职责或策略。`needs-charter` 定义不能支撑团队工作记录、调度或调度触发。
- PostgreSQL 事务和组织范围查询保持边界。
- 工作记录、审批、调度、固定团队和团队定义提供稳定的 keyset 分页。Cursor 是 canonical base64url 载荷加 scope-bound HMAC-SHA256 签名；更换组织或过滤条件会使 cursor 失效。Limit 只允许 1 至 100 的整数。
- 定义 cursor 还绑定 Host 派生的 viewer id 和管理员标志。PostgreSQL 在 limit 前执行组织、owner、private 和 restricted 可见性，隐藏定义既不进入 cursor，也不产生空中间页。
- Cursor v2 使用不可变的 `created_at` 和稳定 ID 进行 seek；`updatedAt` 仅作展示元数据。因此，分页之间更新记录不会把它移到 cursor 前方并导致遗漏。
- 工作记录可按业务状态、来源和固定团队过滤；审批可按类型、状态和申请人过滤；调度可按状态过滤。
- 固定团队和调度支持 compare-and-swap 更新。团队更新会在校验所有发布版的组织归属后整体替换成员集合。已归档调度为终态，不可编辑或恢复。
- 团队定义写入使用 compare-and-swap revision 和绑定请求的幂等键。只有 archive 操作可进入 `archived`；之后的所有 save 都被拒绝，而完全相同的 archive 重试返回已记录的幂等结果。
- Restricted allowlist 在校验、摘要和存储前统一 trim、去重并排序。Active save 会在同一组织内解析 owner、所有人类名册成员、所有 allowlist 用户和可选部门。
- Active save 会将 Definition leader、非 leader Agent 名册成员及 role ID、approval policy 投影到 FixedTeam，同时保留其 Workflow template。新 team work 只接受当前名册中的 Agent release；调度命令记录 Definition revision，仅当 revision 和 leader 仍匹配时才能 admit。
- WorkRecord 每次进入 `active` 都复验当前 Definition 与 Agent 名册；已运行工作仍可更新为终态或 waiting。确定性 admission 失败进入 `dead-letter` 且不再被 claim，可重试失败返回正常 claim 路径。迁移会将没有已记录 Definition revision 的旧 team command 转为 dead-letter。
- Pending 审批可取消。Repository 记录 actor 和 reason；`EnterpriseOperationsService` 仅允许申请人本人或管理员取消。
- 原生引用在缺失解析器时会快速失败。测试和本地开发可显式设置 `allowUnverifiedReferences`；生产组合必须省略该开关。
- 幂等键会绑定 SHA-256 请求摘要，使用不同输入重复该键会被拒绝。只有 active 调度可执行；Outbox 命令负责创建新的调度 Session。
- `EnterpriseOperationsWorker` 在调用外部 Session 创建器前 admit 已领取的 Outbox 命令。Admission 在短事务与共享团队锁中复验 active 状态、processing owner 和未过期 lease，持久化 `startAdmittedAt` 后释放连接。Owner 丢失、lease 过期和 admission update race 返回 `fencing-lost`；旧 worker 立即停止，不调用 fail 或 complete，把命令留给当前 owner 或过期 lease reclaim。非 active 或过期章程数据返回确定性 `admission-rejected` 或 team-definition `invalid-state`，并进入 dead-letter。Definition save/archive 拒绝活跃 admitted lease；pending 或过期命令不阻塞。

## Host API 服务合同

`EnterpriseOperationsService` 是 Host/API 层的 driver-neutral 门面。它接收 `EnterprisePrincipal`，并在调用底层 driver 前强制执行组织范围检查、`authorize` 回调和 `audit` 回调；未授权请求不会触达数据库 driver。所有方法使用 `enterpriseOperation.*` 类型化端点，且将组织 ID 从 principal 注入 driver，调用方不能借由请求体切换组织。团队定义读取只向 repository 传递 Host 派生的 user id 和管理员标志；PostgreSQL 在分页前执行已存储的可见性，repository 不持有包含角色的 principal。生产组合应将 `authorize` 连接到统一的 `EnterpriseSecurity.authorizeApi`，将 `audit` 连接到统一审计仓储。生产 PostgreSQL 组合会从部署密钥派生相互隔离的 Catalog 和 Operations cursor key，并直接在源表中解析员工发布版、用户、部门和原生 Session header。Session 解析还必须找到 `resource_type = 'session'` 且组织匹配的 `resource_policies` 记录；缺失 policy 或跨组织 policy 都失败关闭。取消审批先执行中央授权决策，中央允许后才读取 driver 并检查申请人关系，最终只写一条 allowed 或 denied 审计。带过滤条件的调度列表返回 cursor page；无过滤的 Service 重载保留旧的数组结果。原生引用 resolver 接收 Repository 当前的事务连接并必须通过它查询；这避免了 `poolMax = 1` 时重新进入连接池导致的死锁。

```ts
const service = new EnterpriseOperationsService(repository, {
  authorize: (principal, endpoint, input) => security.authorizeApi(principal, endpoint, input),
  audit: event => auditRepository.append(event),
})
const records = await service.listWorkRecords(principal, { businessState: 'waiting-approval' })
```

Service 只负责 Host 边界与委派，不改变原生 DSH Session/Workflow 的执行循环；真实 PostgreSQL driver、Session 创建器和 Outbox worker 由产品组合层注入。

## Model Experience

### 运营投影

#### What the model sees

无。本包持久化 `EnterpriseTeamDefinition` 和其他运营控制数据，不增加 Prompt、Message、Tool Schema、Result 或模型调用。

#### Token effect

零 Token。投影写入不会进入模型历史。

#### KV Cache effect

无；运营状态不组装提供方请求。

## Known Limitations and Deferred Work

- 本包不实现具体 Agent Teams runtime adapter、TeamRun UI、渠道 adapter、团队定义浏览器编辑器或真实调度 Worker。
- 固定团队有意排除 StaffDeck 的竞标、黑板和市场化唤醒。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
