---
description: "Enterprise Web authentication, session cookies, central API RBAC, and audit."
kind: "package-reference"
---
# `@deepseek-ai/dsh-enterprise-auth-web`

English | [中文](README.zh.md)

## Summary

Enterprise Web authentication, session cookies, central API RBAC, and audit.

## Table of Contents

- [Package Details](#package-details)
- [Dev Note](#dev-note)

-----

<a id="package-details"></a>
## Package Details

Persistent Web authentication and authorization:

- `/auth` status, local/SSO login, callbacks, logout, and administrator endpoints.
- HttpOnly SameSite session cookies with hashed durable sessions.
- Central authentication/RBAC/audit before every HTTP RPC, Typert endpoint, dedicated channel, and WebSocket downlink when composed.
- `EnterpriseRequestContext`, an `AsyncLocalStorage` service exposing the authenticated `EnterprisePrincipal` only while authorized Host HTTP and WebSocket work is active.
- Organization, department tree, user membership, managed Workspace/sandbox, reviewed memory, role, disable, resource-policy, and audit administration APIs.
- A default managed personal DSH Workspace on bootstrap/login, department shared Workspaces, and member-created personal Workspaces below the deployment-owned root.
- Unknown Host endpoints fail closed.

Enterprise HTTP RPC payloads reserve the top-level `principal` key. After session authentication, the transport rejects it with HTTP 400 before authorization, audit, or dispatch, so no invalid request is recorded as allowed and downstream code reads identity only from `ctx.enterpriseRequestContext.requirePrincipal()`. Profiles without enterprise security keep the ordinary transport contract and may use that payload key as application data. Plugin disposal disables the request context so outstanding asynchronous work cannot retain a principal across unload or reload.

The Web plugin accepts a deployment-owned `identityStore` implementing the `EnterpriseIdentityStore` contract. `databasePath` remains an optional SQLite fallback for local deployments; PostgreSQL composition must provide the repository through this seam rather than making the Web package open SQLite. The plugin closes only the SQLite repository it constructs itself. A supplied `identityStore` or `enterprisePostgres.identity` remains deployment-owned across auth unload and failed initialization.

`EnterpriseSecurity` hydrates human principals with department membership and managed departments before applying the shared hierarchy policy. Employee definitions resolve through their owner's directory assignment; employee-bound channels resolve through the immutable release to that definition. Unbound channels remain private to their creator, while administrators may create new channel records. Memory administration lists organization memory plus authorized departments, permits department managers to maintain their department, and reserves organization memory changes for administrators.

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
- The Web package does not instantiate a database driver; production receives the asynchronous PostgreSQL identity store from the enterprise composition.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
