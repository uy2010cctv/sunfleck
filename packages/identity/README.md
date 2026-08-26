# identity/ — shared identity

English | [中文](README.zh.md)

Anonymous and authenticated identity values shared across product domains.

| Package | Role | ctx key |
|---|---|---|
| [`anonymous-user-id/`](anonymous-user-id/README.md) | Persists one anonymous Harness-home correlation id for telemetry, feedback, and DeepSeek requests | — |
| [`enterprise-identity/`](enterprise-identity/README.md) | Persists organizations, users, roles, external identities, sessions, resource policies, and audit | — |
| [`enterprise-sso/`](enterprise-sso/README.md) | Normalizes local, OIDC, SAML, and LDAP authentication into one enterprise identity | — |
| [`enterprise-auth-web/`](enterprise-auth-web/README.md) | Mounts login routes, session cookies, central Host API RBAC, and administration endpoints | `ctx.enterpriseSecurity` |
