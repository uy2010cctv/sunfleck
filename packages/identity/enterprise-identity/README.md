# `@deepseek-ai/dsh-enterprise-identity`

English | [中文](README.zh.md)

SQLite persistence for organizations, users, roles, external identities, hashed login sessions, resource policies, and attributable audit records. Bearer tokens and passwords are never stored directly.

`EnterpriseIdentityStore` is the Host-facing persistence contract. The SQLite
`EnterpriseIdentityRepository` is one implementation; deployments may inject a
transactional PostgreSQL-backed implementation without coupling authentication
to SQLite file paths.

## Model Experience

### Identity persistence

#### What the model sees

Nothing. `EnterpriseIdentityRepository` is Host-only persistence and contributes no prompt, message, tool schema, result, or model call.

#### Token effect

Zero tokens. Repository reads and writes never enter model history.

#### KV Cache effect

None; identity persistence does not assemble provider requests.

## Known Limitations and Deferred Work

- SQLite is the local implementation; enterprise PostgreSQL deployments use the
  separate `@deepseek-ai/dsh-enterprise-identity-postgres` adapter through the
  `EnterpriseIdentityStore` composition seam. Clustered deployments require a
  shared transactional backend.
- External IdP and LDAP live validation requires deployment-owned endpoints and certificates.
