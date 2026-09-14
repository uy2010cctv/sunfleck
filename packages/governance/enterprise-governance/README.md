---
description: "Enterprise organization, role, visibility, deployment, and audit policy contracts."
kind: "package-reference"
---
# `@deepseek-ai/dsh-enterprise-governance`

English | [中文](README.zh.md)

## Summary

Enterprise organization, role, visibility, deployment, and audit policy contracts.

## Table of Contents

- [Package Details](#package-details)
- [Dev Note](#dev-note)

-----

<a id="package-details"></a>
## Package Details

Pure enterprise policy contracts:

- Organization-first authorization.
- Administrator, creator, operator, auditor, and member roles.
- Organization, department, employee, and personal resource scopes, with private and restricted visibility inside the selected scope.
- Human department membership, department management, and least-privileged employee service identities.
- Explicit user, employee, memory, capability, model, credential, audit, Session, and channel actions.
- Desktop, LAN, and Public deployment readiness evidence.
- Attributable governance audit records without arbitrary payload fields.

The package decides policy. Identity providers, user storage, SSO, encrypted credential providers, and durable audit sinks remain deployment adapters.

Department members may read department resources that their role and visibility admit. Department managers may update employees, memory, and channels only in departments they manage. A background employee principal has no human roles and may execute only the channel, employee, or memory resource that names its immutable employee release.

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

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
