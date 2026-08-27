# `@deepseek-ai/dsh-enterprise-auth-web`

[English](README.md) | 中文

持久 Web 认证与授权：

- `/auth` 状态、本地/SSO 登录、Callback、退出和管理端点。
- 使用哈希持久会话的 HttpOnly SameSite Session Cookie。
- 组合后，在每个 HTTP RPC、Typert 端点、独立 Channel 和 WebSocket 下行之前进行中央认证/RBAC/审计。
- `EnterpriseRequestContext` 是基于 `AsyncLocalStorage` 的服务，仅在已授权的 Host HTTP 与 WebSocket 工作期间暴露认证后的 `EnterprisePrincipal`。
- 组织、用户、角色、停用、资源策略和审计管理 API。
- 未知 Host 端点失败关闭。

企业 HTTP RPC payload 保留顶层 `principal` 键。传输层在授权和审计后以 HTTP 400 拒绝该键，因此下游代码只从 `ctx.enterpriseRequestContext.requirePrincipal()` 读取身份。未启用企业安全的 Profile 保持普通传输契约，仍可把该键作为应用数据使用。

Web 插件接受部署方提供的 `EnterpriseIdentityStore` 实现。`databasePath`
仍可作为本地部署的可选 SQLite 后备；PostgreSQL 组合应通过该注入边界提供
仓库，Web 包本身不会再强制打开 SQLite。

## Model Experience

### Host 安全边界

#### What the model sees

无。`EnterpriseSecurity.authorizeApi` 在任何 Agent 可见操作执行前保护 Host 传输。

#### Token effect

无。允许后的下游能力自行承担之后的模型 Token 成本。

#### KV Cache effect

无；被拒绝调用不会到达模型请求，允许调用保持其所属能力的请求。

## Known Limitations and Deferred Work

- Public 部署仍需要 TLS 终止和 Secure Cookie 配置。
- 在真实端点和证书通过受控登录测试前，外部 SSO 就绪性仍属于部署环境事实。
- PostgreSQL 仓库是异步实现；部署方将其组合到当前同步 Host 包时，必须提供文档约定的同步 Store Bridge（或使用启用后的异步 Host 组合）。Web 包不会自行实例化数据库驱动。
