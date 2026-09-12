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

Memory values are rendered as quoted factual context with stable ids and an explicit privacy/access policy. Repository review and privacy screening remain the authority; this package does not extract or approve memory. Employee learning is a separate versioned asset workflow that records its source and audit result without changing business-memory review policy.

## Model Experience

### Approved enterprise memory

#### What the model sees

Only approved organization or department summaries that match the current Workspace authorization. Each injected item carries its stable `memoryId` and scope; personal preferences and raw conversation content are excluded.

#### Token effect

Injected summaries consume prompt tokens within the configured entry and character limits.

#### KV Cache effect

Stable approved memory may improve reuse when its ordered summaries remain unchanged; the provider owns actual cache behavior.

## Known Limitations and Deferred Work

- This package does not extract, embed, or approve source material; repository review and organization policy remain required.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The Enterprise profile intentionally leaves automatic approval unconfigured. Configure and govern the resource policy through the authenticated enterprise control plane before allowing any scope to activate automatically.

</details>

## Employee self-learning

The enterprise profile mounts the `./learning` plugin by default, independently of business-memory review policy. After completing reusable work, an employee calls `learn_employee_capability` with `kind`, `name`, and a workspace-relative Markdown `sourcePath`. The tool derives the current employee from the Session preset projection and the organization from the workspace grant. It registers the source snapshot, binds its version and publishes a release without administrator confirmation. It preserves existing bindings and unsubmitted human draft changes. Current and future sessions receive learned SOP/skill content only for their current employee and source workspace. Learning does not grant tools, credentials or workspace access. `maxLearningBytes` bounds each source (default 64000 UTF-8 bytes); `maxChars` bounds learned context, and large procedures expose their source reference for on-demand reading.
