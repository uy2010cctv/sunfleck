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

Enterprise-only prompt context for approved enterprise memories. The plugin resolves a Session cwd through enterprise workspace grants and injects approved summaries from the shared organization and department compartments, the anchored session's private agent and pair compartments, and the project compartment when the project service confirms the session actor's membership. It never loads raw conversation bodies, proposed/rejected entries, or memory outside these compartments.

When automatic business-memory capture is enabled, writes belong to the authenticated request principal, then the durable enterprise Session owner. An unbound background run must configure an existing `backgroundServiceUserId` beginning with `service:`; it never falls back to a bootstrap administrator. Automatic capture creates a proposal by default. Activation requires a matching `enterprise-memory-autonomy` organization resource policy for `<orgId>:organization` or `<orgId>:department:<departmentId>`, with organization visibility, the actor listed, and an enabled administrator as policy creator. Personal Workspace preferences remain personal and are never promoted by this mechanism.

Memory values are rendered as quoted factual context with stable ids and an explicit privacy/access policy. Repository review and privacy screening remain the authority; this package does not extract or approve memory. Employee learning is a separate versioned asset workflow that records its source and audit result without changing business-memory review policy.

## Model Experience

### Approved enterprise memory

#### What the model sees

Only approved summaries from the compartments the session's authorization resolves (organization, department, own agent and pair, member-gated project). Each injected item carries its stable `memoryId` and scope; personal preferences and raw conversation content are excluded.

#### Token effect

Injected summaries consume prompt tokens within the configured entry and character limits.

#### KV Cache effect

Stable approved memory may improve reuse when its ordered summaries remain unchanged; the provider owns actual cache behavior.

### Employee self-learning

#### What the model sees

The enterprise profile mounts the `./learning` plugin by default, independently of business-memory review policy. After completing reusable work, an employee calls `learn_employee_capability` with `kind`, `name`, and a workspace-relative Markdown `sourcePath`. The tool derives the current employee from the Session preset projection and the organization from the workspace grant. It registers the source snapshot, binds its version and publishes a release without administrator confirmation. It preserves existing bindings and unsubmitted human draft changes. Current and future sessions receive learned SOP/skill content only for their current employee and source workspace. Learning does not grant tools, credentials or workspace access. `maxLearningBytes` bounds each source (default 64000 UTF-8 bytes); `maxChars` bounds learned context, and large procedures expose their source reference for on-demand reading.

#### Token effect

Injected learned instructions consume at most the configured `maxChars`; larger procedures contribute a short source reference for on-demand reading.

#### KV Cache effect

Version-pinned learned content stays stable until the employee publishes another capability release, which can preserve provider prefix reuse.

## Known Limitations and Deferred Work

- This package does not extract, embed, or approve source material; repository review and organization policy remain required.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The Enterprise profile intentionally leaves automatic approval unconfigured. Configure and govern the resource policy through the authenticated enterprise control plane before allowing any scope to activate automatically.

</details>

## Memory activation

Confirmed routine knowledge activates automatically through remember_business_knowledge. needsConfirmation=true preserves uncertain or conflicting knowledge as proposed. Workspace and actor isolation, privacy checks, source digest, audit and retired-memory protections remain enforced. No administrator policy grant is required per memory.

## Completed-turn writeback

When `autoSave` and `writebackEnabled` are true, the plugin captures the direct user text and final assistant answer at `agent/turn-stopping`. It durably enqueues the bounded snapshot before the turn closes, then runs a separate model call in the background. The main Agent does not need to call the memory tool and the extractor never adds a synthetic conversation message.

Each extracted candidate names a `target` compartment: `private` by default, `pair` for a stated user-specific collaboration preference, and `organization` or `department` only for explicitly company-wide or department-wide reusable facts. Private and pair candidates write straight into the session actor's compartments without review; the actor resolves at processing time through `ctx.employeeAccounts`, and the candidates skip when it cannot. Shared candidates keep the reviewed path: exact normalized duplicates are skipped, high-confidence non-conflicting statements become active, and uncertainty, lower confidence, or contradictions stay pending. Prompt injection and overlong summaries drop in every compartment, and a `personal-preference` finding downgrades the candidate into the actor's own agent compartment instead of entering shared memory. Every write rechecks the current workspace grant and Session owner.

The queue retries failures after 5, 15, 60, and 180 seconds, stops automatic retry after five attempts, and retains an actionable failure record. Successful jobs remove their copied conversation snapshot and retain only counts, memory ids, timing, and provenance.

The Enterprise Memory page shows active processing, failures, the latest outcome, and a retry action. `writebackMaxInputChars` defaults to 12000 and `writebackMaxTokens` defaults to 1024. This feature owns concise governed business statements; general Markdown documents, notes, arbitrary files, and remote knowledge clients remain the separate document-knowledge domain.
