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
- Platform administrators can atomically create another organization with its first administrator and rename any organization without changing its durable id. A tenant administrator may rename only its own organization. Local and mapped SSO login issue Sessions inside the selected organization. Anonymous auth status exposes only organization ids and display names for the login selector; after authentication, tenant administrators receive only their own organization while platform administrators receive the complete selector directory.
- A default managed personal DSH Workspace on bootstrap/login, department shared Workspaces, and member-created personal Workspaces below the deployment-owned root.
- New managed Workspaces are stored below an organization-specific filesystem compartment. Existing grants retain their persisted paths.
- Unknown Host endpoints fail closed.

Enterprise HTTP RPC payloads reserve the top-level `principal` key. After session authentication, the transport rejects it with HTTP 400 before authorization, audit, or dispatch, so no invalid request is recorded as allowed and downstream code reads identity only from `ctx.enterpriseRequestContext.requirePrincipal()`. Profiles without enterprise security keep the ordinary transport contract and may use that payload key as application data. Plugin disposal disables the request context so outstanding asynchronous work cannot retain a principal across unload or reload.

The Web plugin accepts a deployment-owned `identityStore` implementing the `EnterpriseIdentityStore` contract. `databasePath` remains an optional SQLite fallback for local deployments; PostgreSQL composition must provide the repository through this seam rather than making the Web package open SQLite. The plugin closes only the SQLite repository it constructs itself. A supplied `identityStore` or `enterprisePostgres.identity` remains deployment-owned across auth unload and failed initialization.

`EnterpriseSecurity` hydrates human principals with department membership and managed departments before applying the shared hierarchy policy. Employee definitions resolve through their owner's directory assignment; employee-bound channels resolve through the immutable release to that definition. Unbound channels remain private to their creator, while administrators may create new channel records. Memory administration lists organization memory plus authorized departments, permits department managers to maintain their department, and reserves organization memory changes for administrators.

Plugins that register raw `WebRoute` handlers must authenticate their browser requests before reading bodies or domain data. The `enterpriseKnowledge.read` and `enterpriseKnowledge.manage` classifications let the knowledge plugin reuse the enterprise Session, capability RBAC, request principal, and audit sink instead of treating same-origin routing as authorization.

The configured organization remains the platform organization. Its administrators may manage Host-global model settings, Credentials, and developer inspection; administrators authenticated to another organization receive `organization-mismatch` for those operations. Organization-local employees, capability assets, teams, memory, channels, Workspaces, Sessions, and audit use the authenticated principal's `orgId`.

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
- Out-of-tree document-knowledge plugins require their own organization namespace before they can be treated as tenant-isolated; this package cannot scope storage it does not own.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
