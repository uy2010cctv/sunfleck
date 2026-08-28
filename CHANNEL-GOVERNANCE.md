# Channel and Governance Architecture

This document refines the Channel Plane and Enterprise Governance Plane for DeepSeek Harness Enterprise. The two kernels are deliberately independent: a channel decides where a message goes; governance decides whether the authenticated actor may perform the resulting action.

## Channel Kernel boundary

```text
WeChat / WeCom provider adapter
  -> normalized inbound envelope
  -> idempotency admission
  -> canonical channel actor
  -> command / sticky / intent / default routing
  -> governance authorization
  -> native DSH Session create or resume
  -> durable outbox
  -> provider adapter send + acknowledgement
```

Provider adapters own login, token refresh, webhooks or desktop automation, provider acknowledgements, attachment download, and rate-limit headers. The kernel owns no SDK session and stores no provider token.

Routing precedence is explicit command, Sticky Employee, recognized intent, then channel default. Every chosen employee must be present in the channel binding. A command that names an unbound employee fails closed.

Identity has two levels. The channel alias is `(channelId, channelUserId)`; an authenticated account-binding workflow may attach it to a canonical enterprise `userId`. Multiple aliases then resolve to the same actor without erasing their source-channel evidence.

Inbound admission uses a provider-scoped idempotency key. Production adapters must persist that key before creating or steering a Session. Outbound delivery must persist intent before sending, record attempt number and provider response, and retry only retryable failures with a bounded schedule.

Message audit deliberately excludes raw content. It records provider identifiers, actor, employee, direction, timestamp, content length, and SHA-256 content hash. A separately authorized evidence store may retain content when business policy requires it.

## Session recovery

- Healthy: continue the mapped Session.
- Disconnected: reopen/resume the same Session.
- Missing: create a replacement Session and retain the predecessor mapping in audit.
- Corrupt: quarantine and request operator intervention; never silently replace history.

Token expiry and missing heartbeats are channel-health facts, not Session failures. They generate operator-visible warnings and adapter reconnect work without changing employee identity.

## Governance Kernel boundary

Authorization input is a canonical enterprise principal, an action, and an optional protected resource. Every protected resource carries `orgId`, creator identity, and a visibility rule. Organization mismatch is evaluated first and cannot be overridden by an administrator role from another organization.

The initial role model is intentionally small:

| Role | Primary authority |
|---|---|
| Administrator | Users, models, credentials, channels, organization resources, audit |
| Creator | Create employees and update employee definitions they own |
| Operator | Operate visible employees and work records |
| Auditor | Read employees, work records, and audit; no mutations |
| Member | Start and inspect work allowed by resource visibility |

Visibility is organization-wide, private to the creator, or restricted to named canonical users. Capability assets, model settings, credentials, channels, and audit each use named actions so a future policy engine can refine them without changing UI wording.

## Deployment evidence

| Mode | Required evidence |
|---|---|
| Desktop | Protected credentials, audit sink, single-port packaging |
| LAN | Authenticated identity, RBAC, protected credentials, audit sink, single-port packaging |
| Public | All LAN evidence plus TLS |

The current local credential provider enforces owner-only file permissions but is not encrypted-at-rest. Therefore it does not satisfy the enterprise encrypted-credential readiness flag by itself. OIDC/SAML/LDAP login, user and organization persistence, encrypted secret storage, and durable governance/channel audit sinks remain separate adapters that must be installed before claiming a production multi-user deployment.

## Implemented source contracts

- `packages/channel/channel-kernel`: commands, routing, identity merge key, inbound idempotency, retry delay, channel health, Session recovery, and redacted message audit.
- `packages/governance/enterprise-governance`: organization/role/visibility authorization, deployment readiness, and attributable governance audit.
- `packages/identity/enterprise-identity`: SQLite organizations, users, roles, external identities, hashed sessions, resource policies, and audit.
- `packages/identity/enterprise-sso`: local scrypt, OIDC PKCE, signed SAML, and TLS-only LDAP adapters.
- `packages/identity/enterprise-auth-web`: `/auth` routes plus central HTTP/RPC/WebSocket authentication, RBAC, and audit.
- `packages/credentials/credentials-encrypted`: AES-256-GCM credential provider and online key rotation.
- `packages/client/ui-enterprise-governance`: login gate and organization/user/role/asset-policy/audit administration.

`apps/cli/config/enterprise.cordis.patch.yml` composes these pieces on the same Web server and port. It requires deployment-provided master-key and bootstrap-password environment values. OIDC/SAML/LDAP implementations are complete adapters, but real enterprise-provider validation cannot be claimed until that deployment supplies and tests its own endpoints, metadata, certificates, directory, and attribute mapping.
