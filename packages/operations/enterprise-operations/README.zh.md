# `@deepseek-ai/dsh-enterprise-operations`

[English](README.md) | 中文

基于 DSH 原生执行的持久化运营投影：

- 工作记录引用原生 Session ID 和员工发布版，但不复制事件正文。部署可注入 Session 和发布版解析器；配置后，每个解析器都必须在写入前确认引用属于同一组织。
- 审批请求使用乐观 revision 和可审计状态迁移。
- 员工和固定团队调度每次 occurrence 只创建一条幂等的启动 Session Outbox 命令；即使重试使用另一个请求幂等键，也会返回原命令。
- 固定团队绑定负责人、成员、Workflow 模板和审批策略。
- PostgreSQL 事务和组织范围查询保持边界。
- 原生引用在缺失解析器时会快速失败。生产环境可设置 `requireNativeReferences`；测试和本地开发必须显式设置 `allowUnverifiedReferences` 才能跳过解析。两项设置互斥。
- 幂等键会绑定 SHA-256 请求摘要，使用不同输入重复该键会被拒绝。只有 active 调度可执行；Outbox 命令负责创建新的调度 Session。
- `EnterpriseOperationsWorker` 每次领取一条 Outbox 命令，调用注入的原生 Session 创建器，然后完成或标记该任务失败。重试时间由调用方通过 `nextAttemptAt` 提供。

## Host API 服务合同

`EnterpriseOperationsService` 是 Host/API 层的 driver-neutral 门面。它接收
`EnterprisePrincipal`，并在调用底层 driver 前强制执行组织范围检查、`authorize`
回调和 `audit` 回调；未授权请求不会触达数据库 driver。所有方法使用
`enterpriseOperation.*` 类型化端点，且将组织 ID 从 principal 注入 driver，调用方不能
借由请求体切换组织。生产组合应将 `authorize` 连接到统一的
`EnterpriseSecurity.authorizeApi`，将 `audit` 连接到统一审计仓储。

```ts
const service = new EnterpriseOperationsService(repository, {
  authorize: (principal, endpoint, input) => security.authorizeApi(principal, endpoint, input),
  audit: event => auditRepository.append(event),
})
const records = await service.listWorkRecords(principal, { businessState: 'waiting-approval' })
```

Service 只负责 Host 边界与委派，不改变原生 DSH Session/Workflow 的执行循环；真实
PostgreSQL driver、Session 创建器和 Outbox worker 由产品组合层注入。

## Model Experience

### 运营投影

#### What the model sees

无。本包持久化运营控制数据，不增加 Prompt、Message、Tool Schema、Result 或模型调用。

#### Token effect

零 Token。投影写入不会进入模型历史。

#### KV Cache effect

无；运营状态不组装提供方请求。

## Known Limitations and Deferred Work

- 本包不实现浏览器管理页面和真实调度 Worker。
- 固定团队有意排除 StaffDeck 的竞标、黑板和市场化唤醒。
