---
description: "Persistent enterprise organizations, users, sessions, resource policies, and audit records."
kind: "package-reference"
---
# `@deepseek-ai/dsh-enterprise-identity`

English | [中文](README.zh.md)

## Summary

Persistent enterprise organizations, users, sessions, resource policies, and audit records.

## Table of Contents

- [Package Details](#package-details)
- [Dev Note](#dev-note)

-----

<a id="package-details"></a>
## Package Details

SQLite persistence for organizations, nested departments, users and memberships, roles, external identities, hashed login sessions, managed Workspace grants, Session-to-Workspace bindings, reviewed organizational memory plus private agent and pair compartments written without review, resource policies, and attributable audit records. Bearer tokens, passwords, and raw memory source conversations are never stored directly.

`EnterpriseIdentityStore` is the Host-facing persistence contract. The SQLite `EnterpriseIdentityRepository` is one implementation; deployments may inject a transactional PostgreSQL-backed implementation without coupling authentication to SQLite file paths.

Authenticated principal projections include current department memberships and the primary department. Authorization services add managed departments from the organization directory; callers do not infer them from display names or Workspace paths.

## Model Experience

### Identity persistence

#### What the model sees

Nothing. `EnterpriseIdentityRepository` is Host-only persistence and contributes no prompt, message, tool schema, result, or model call.

#### Token effect

Zero tokens. Repository reads and writes never enter model history.

#### KV Cache effect

None; identity persistence does not assemble provider requests.

## Known Limitations and Deferred Work

- SQLite is the local implementation; enterprise PostgreSQL deployments use the separate `@deepseek-ai/dsh-enterprise-identity-postgres` adapter through the `EnterpriseIdentityStore` composition seam. Clustered deployments require a shared transactional backend.
- External IdP and LDAP live validation requires deployment-owned endpoints and certificates.
- Memory privacy screening is a deterministic gate classified per target compartment: prompt injection and overlong summaries block every compartment, and a personal preference never enters shared memory. It is not a complete DLP product; a human reviewer remains required before shared use.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
