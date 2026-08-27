# Agent Note: 已认证的企业请求上下文

Status: implemented

[English](2026-08-27-authenticated-enterprise-request-context.md) | 中文

## Problem

Host RPC handler 需要认证后的企业身份，但 RPC payload 由客户端控制。把 payload 字段当作 `EnterprisePrincipal` 会让调用方声称其他用户、组织或角色，即使传输层认证的是另一个会话。在每个 Host API 中显式逐层传递 principal 也会把传输身份耦合到无关的业务契约，并容易遗漏。

WebSocket 下行会在 HTTP upgrade 后创建异步流工作。其数据源必须看到同一个认证身份，又不能让该身份在 upgrade 之外的工作中可见。

## Decision

`@deepseek-ai/dsh-enterprise-auth-web` 提供基于 Node `AsyncLocalStorage` 的 `EnterpriseRequestContext`。`run(principal, callback)` 建立由服务端认证的 `EnterprisePrincipal`；`current()` 用于可选行为中观测它，`requirePrincipal()` 在认证请求之外失败关闭。

Connection 传输只在 Cookie 认证、端点授权和审计完成后进入该上下文。HTTP 包裹选中的 Fetch handler。已授权的 WebSocket upgrade 包裹创建下行数据源及其异步资源的 handler。未组合 `enterpriseSecurity` 的部署继续走普通传输路径，不创建 principal 上下文。

启用企业安全时，HTTP RPC payload 的顶层 `principal` 键为保留键。会话认证后，Connection 在授权、审计或 dispatch 之前返回 HTTP 400，不转发、删除或解释该值。因此无效 payload 不会产生 allowed 审计记录。普通 Profile 保留不受限制的 payload 契约。

Auth plugin 卸载时会调用 `EnterpriseRequestContext.dispose()`，禁用底层异步存储。上下文构建后发生的初始化失败也会 dispose 它。Auth 只在自己创建 SQLite 后备仓库时关闭身份仓库；注入的 `identityStore` 或 `enterprisePostgres.identity` 仍由部署方所有并可继续使用。未完成的 continuation 会失去继承的 principal，之后的 plugin 加载会发布新的上下文实例。

企业 overlay 为 Connection 注入 `enterpriseSecurity` 和 `enterpriseRequestContext`。因此 Loader 会等待 `enterprisePostgres` 激活 auth，再等 auth 发布两个服务后才激活 Connection；基础 Web Profile 仍只注入 `webRuntime`。

## Alternatives considered

**比较若干字段后信任 payload principal。** 不采用，因为 payload 仍是第二个身份权威，新增字段可能逃过比较，下游 handler 也可能意外读取未验证对象。

**静默删除 `payload.principal`。** 不采用，因为这会隐藏客户端契约错误，还可能让请求在语义改变后看似成功。HTTP 400 使保留键边界明确可见。

**在每个 RPC handler 参数中传递 principal。** 不采用，因为它会改变普通 Profile 的通用 RPC 契约，并要求每个中间层保留一个它并不拥有的安全值。

## Consequences

企业 Host 代码只有一个请求作用域的身份权威，它可跨 Promise 和并发请求传播，不会在请求间泄漏。Payload 无法冒充该身份，认证工作之外的调用失败关闭。

企业 overlay 具有从 PostgreSQL 经 auth 到 Connection 的明确启动依赖。普通 Profile 不获得企业依赖，也不增加保留 payload 键。`AsyncLocalStorage` 使该服务仅属于 Node Host；浏览器和与传输无关的业务契约不导入它。

定向测试固定匿名拒绝、回调生命期、并发隔离、HTTP 保留键拒绝、WebSocket 传播、普通 Profile 兼容性和 Loader 激活顺序。

真实 Loader 集成测试会挂载已交付的 WebServer、Enterprise Postgres、企业 auth 和 Connection 包。提供 `DSH_TEST_POSTGRES_URL` 时，它会在企业依赖链稳定后观测到 `/auth/status` 返回 200，匿名 `/api` 返回 401；始终运行的普通 Profile case 则观测到没有企业服务时 `/api` 保留原有 404。企业 PostgreSQL workflow 会运行该测试，并监视拥有这条链路的每个包与 overlay 路径。Enterprise Postgres pool close 是幂等的，因为 Loader 在卸载依赖方时可能再次访问同一个异步关闭边界。
