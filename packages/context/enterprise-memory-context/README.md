---
description: "Reviewed organization and department memory context for DSH Enterprise."
kind: "package-reference"
---
# @deepseek-ai/dsh-enterprise-memory-context

English | [中文](README.zh.md)

## Summary

Reviewed organization and department memory context for DSH Enterprise.

## Table of Contents

- [Package Details](#package-details)
- [Dev Note](#dev-note)

-----

<a id="package-details"></a>
## Package Details

Enterprise-only prompt context for approved organization and department memories. The plugin resolves a Session cwd through enterprise workspace grants and injects only approved summaries. It never loads raw conversation bodies, proposed/rejected entries, or memory outside the workspace compartment.

When automatic business-memory capture is enabled, writes belong to the authenticated request principal, then the durable enterprise Session owner. An unbound background run must configure an existing `backgroundServiceUserId` beginning with `service:`; it never falls back to a bootstrap administrator. Automatic capture creates a proposal by default. Activation requires a matching `enterprise-memory-autonomy` organization resource policy for `<orgId>:organization` or `<orgId>:department:<departmentId>`, with organization visibility, the actor listed, and an enabled administrator as policy creator. Personal Workspace preferences remain personal and are never promoted by this mechanism.

Memory values are rendered as quoted factual context with stable ids and an explicit privacy/access policy. Repository review and privacy screening remain the authority; this package does not extract or approve memory.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The Enterprise profile intentionally leaves automatic approval unconfigured. Configure and govern the resource policy through the authenticated enterprise control plane before allowing any scope to activate automatically.

</details>
