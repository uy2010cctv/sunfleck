---
description: "Authenticated Typert Remote APIs for enterprise employees, assets, teams, approvals, schedules, and work records."
kind: "package-reference"
---
# Enterprise Controller

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-api-enterprise-controller` owns the authenticated Typert Remote namespaces for enterprise employees, capability assets, fixed teams, typed team definitions, work records, approvals, and schedules. Every operation resolves an `EnterprisePrincipal`, applies organization and role policy, records an audit decision, and delegates to the PostgreSQL control plane.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the controller only in the enterprise profile after `enterprisePostgres`, `enterpriseSecurity`, and `enterpriseRequestContext`. Clients consume its generated `enterpriseEmployee`, `enterpriseAsset`, `enterpriseTeam`, `enterpriseTeamDefinition`, and `enterpriseOperation` namespaces through API Gateway. `enterpriseTeamDefinition` exposes list, get, revision-fenced save, and archive; Host code injects the authenticated organization, while browser requests carry neither organization nor actor identity. The package replaces the deleted monolithic ApiProxy but does not replace DSH Workspace, Session, Workflow, Sandbox, Subagent, or Agent Loop identities.

<a id="model-experience"></a>
## Model Experience

### Enterprise control APIs

#### What the model sees

None. These APIs manage control-plane metadata and do not directly assemble model prompts or execute an Agent turn.

#### Token effect

Zero tokens. `enterpriseTeamDefinition` Remote calls do not enter model history.

#### KV Cache effect

None until a released employee starts an ordinary DSH Session.

## Known Limitations and Deferred Work

- The first enterprise profile targets one organization and one PostgreSQL deployment.
- Live enterprise invalidation events are not a substitute for reading the authoritative repository after reconnect.
- Team-definition Remote methods do not start TeamRun or coordinate Agent runtime work.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Keep all Remote payloads JSON-safe and preserve authorization and audit calls when adding methods.

</details>
