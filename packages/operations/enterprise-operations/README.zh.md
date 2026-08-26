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
