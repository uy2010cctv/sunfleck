# `@deepseek-ai/dsh-enterprise-auth-web`

English | [中文](README.zh.md)

Persistent Web authentication and authorization:

- `/auth` status, local/SSO login, callbacks, logout, and administrator endpoints.
- HttpOnly SameSite session cookies with hashed durable sessions.
- Central authentication/RBAC/audit before every HTTP RPC, Typert endpoint, dedicated channel, and WebSocket downlink when composed.
- `EnterpriseRequestContext`, an `AsyncLocalStorage` service exposing the authenticated `EnterprisePrincipal` only while authorized Host HTTP and WebSocket work is active.
- Organization, user, role, disable, resource-policy, and audit administration APIs.
- Unknown Host endpoints fail closed.

Enterprise HTTP RPC payloads reserve the top-level `principal` key. After session authentication, the transport rejects it with HTTP 400 before authorization, audit, or dispatch, so no invalid request is recorded as allowed and downstream code reads identity only from `ctx.enterpriseRequestContext.requirePrincipal()`. Profiles without enterprise security keep the ordinary transport contract and may use that payload key as application data. Plugin disposal disables the request context so outstanding asynchronous work cannot retain a principal across unload or reload.

The Web plugin accepts a deployment-owned `identityStore` implementing the
`EnterpriseIdentityStore` contract. `databasePath` remains an optional SQLite
fallback for local deployments; PostgreSQL composition must provide the
repository through this seam rather than making the Web package open SQLite.
The plugin closes only the SQLite repository it constructs itself. A supplied `identityStore` or `enterprisePostgres.identity` remains deployment-owned across auth unload and failed initialization.

## Model Experience

### Host security boundary

#### What the model sees

Nothing. `EnterpriseSecurity.authorizeApi` protects Host transports before any Agent-visible operation executes.

#### Token effect

None. An allowed downstream capability owns any later model-token cost.

#### KV Cache effect

None; rejected calls never reach a model request and allowed calls preserve their owning capability's request.

## Known Limitations and Deferred Work

- Public deployment still requires TLS termination and secure-cookie configuration.
- External SSO readiness remains deployment-specific until real endpoints and certificates pass controlled login tests.
- The PostgreSQL repository is asynchronous; a deployment composing it with this
  synchronous Host package must provide the documented synchronous store bridge
  (or use the async Host composition when enabled). The Web package does not
  instantiate a database driver itself.
