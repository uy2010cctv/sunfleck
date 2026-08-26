# `@deepseek-ai/dsh-enterprise-operations`

[English](README.md) | 中文

基于 DSH 原生执行的持久化运营投影：

- 仅在注入的解析器确认原生 Session ID 和员工发布版均属于同一组织后，工作记录才引用它们；工作记录不复制事件正文。
- 审批请求使用乐观 revision 和可审计状态迁移。
- 员工和固定团队调度每次 occurrence 只创建一条幂等的启动 Session Outbox 命令；即使重试使用另一个请求幂等键，也会返回原命令。
- 固定团队绑定负责人、成员、Workflow 模板和审批策略。
- PostgreSQL 事务和组织范围查询保持边界。

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
