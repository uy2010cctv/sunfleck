# `@deepseek-ai/dsh-enterprise-governance`

English | [中文](README.zh.md)

Pure enterprise policy contracts:

- Organization-first authorization.
- Administrator, creator, operator, auditor, and member roles.
- Organization, private, and restricted resource visibility.
- Explicit user, employee, capability, model, credential, audit, Session, and channel actions.
- Desktop, LAN, and Public deployment readiness evidence.
- Attributable governance audit records without arbitrary payload fields.

The package decides policy. Identity providers, user storage, SSO, encrypted credential providers, and durable audit sinks remain deployment adapters.

## Model Experience

### Host authorization policy

#### What the model sees

Nothing. `authorizeEnterprise` runs before privileged Host actions and contributes no prompt section, message, tool schema, tool result, or model call.

#### Token effect

None. An allowed action continues through its owning DSH capability, which documents any later model-visible cost.

#### KV Cache effect

None. Authorization decisions do not assemble or mutate provider requests.

## Known Limitations and Deferred Work

- No OIDC, SAML, LDAP, or login UI provider ships in this package.
- No durable user, organization, role, or audit repository ships in this package.
- The existing owner-only local credential file does not by itself prove encrypted-at-rest storage.
