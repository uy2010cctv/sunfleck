# PostgreSQL 生产组合实施计划

[English](2026-08-27-postgresql-production-composition.md) | 中文

> **面向 Agent 工作者：** 按任务逐项执行，并在每项任务后运行验证。

**目标：** 让企业 Overlay 使用 PostgreSQL 统一承载身份、DSH Session、员工目录、运营和 pgvector 知识服务，并具备启动检查与可恢复生命周期。

**架构：** 增加一个部署所有的 PostgreSQL 连接池和事务封装。企业认证通过可等待的身份 Store 运行，启动时先初始化所有企业 schema；SQLite 只作为显式 Desktop 开发后备，生产模式没有 PostgreSQL 就失败关闭。

**技术栈：** Node 24、TypeScript、Cordis、`pg`、PostgreSQL 17 + pgvector、现有 DSH 持久化/目录/运营/知识适配器。

---

### 任务 1：PostgreSQL 连接与 schema 组合

**文件：**
- 新建 `packages/enterprise/enterprise-postgres/src/index.ts`
- 新建 `packages/enterprise/enterprise-postgres/src/invariant.ts`
- 新建 `packages/enterprise/enterprise-postgres/package.json`
- 新建 `packages/enterprise/enterprise-postgres/tsconfig.json`
- 新建 `packages/enterprise/enterprise-postgres/tests/composition.spec.ts`
- 修改 `tsconfig.host.json`
- 修改 `packages/bundle/web-app/package.json`

- [ ] 使用 `pg.Pool` 提供 query、事务提交/回滚、健康检查和幂等关闭。
- [ ] 启动时初始化身份、Session、目录、运营和知识 schema。
- [ ] 验证 schema 可重复初始化，事务失败会回滚。

### 任务 2：异步身份安全边界

**文件：**
- 修改 `packages/identity/enterprise-auth-web/src/security.ts`
- 修改 `packages/identity/enterprise-auth-web/src/http.ts`
- 修改 `packages/client/connection/src/rpc-host.ts`
- 修改 `packages/client/connection/src/index.ts`
- 修改 `packages/identity/enterprise-auth-web/tests/*.spec.ts`

- [ ] 统一可等待身份 Store，同时保持 SQLite 同步适配器兼容。
- [ ] HTTP RPC、WebSocket 和管理端点在派发前等待认证、授权与审计。
- [ ] 用异步身份 fake 验证拒绝请求不会触达下游处理器。

### 任务 3：生产 Overlay 配置

**文件：** `apps/cli/config/enterprise.cordis.patch.yml`、企业部署文档。

- 修改 `apps/cli/config/enterprise.cordis.patch.yml`
- 修改 `docs/enterprise-deployment.zh.md`
- 修改 `docs/enterprise-deployment.md`
- 新建 `docs/enterprise-postgres-recovery.zh.md`

- [ ] 增加 `DSH_ENTERPRISE_DATABASE_URL` 与 `DSH_ENTERPRISE_DATABASE_MODE`。
- [ ] 生产模式注入 PostgreSQL 身份、Session、目录、运营和知识服务。
- [ ] 缺少 PostgreSQL 或 pgvector 时生产启动失败；Desktop 显式使用 SQLite 后备。
- [ ] 记录连接池权限、备份恢复和迁移回滚流程。

### 任务 4：恢复与验证

- 修改 `.github/workflows/enterprise-postgres.yml`
- 新建 `apps/web/tests/enterprise-postgres-composition.e2e.ts`
- 修改 `packages/bundle/web-app/tests/enterprise-workbench-composition.spec.ts`

- [ ] 增加重启后 Session/Event 和 Outbox 保留的测试。
- [ ] 增加 PostgreSQL + pgvector CI 组合测试。
- [ ] 完成构建、单测、invariant、服务健康和登录验证。
- [ ] 记录生产组合的连接池、schema 与恢复证据。
