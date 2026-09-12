---
description: "Reviewed organization and department memory context for DSH Enterprise."
kind: "package-reference"
---
# @deepseek-ai/dsh-enterprise-memory-context

English | [中文](README.zh.md)

## Summary

Reviewed organization and department memory context for DSH Enterprise.

The enterprise profile mounts the `./learning` plugin by default, independently of business-memory review policy. After completing reusable work, an employee calls `learn_employee_capability` with `kind`, `name`, and a workspace-relative Markdown `sourcePath`. The tool derives the current employee from the Session preset projection and the organization from the workspace grant. It registers the source snapshot, binds its version and publishes a release without administrator confirmation. It preserves existing bindings and unsubmitted human draft changes. `maxLearningBytes` bounds each source (default 64000 UTF-8 bytes); `maxChars` bounds learned context. Large procedures expose their source reference for on-demand reading.

Current and future sessions receive learned SOP/skill content only for their current employee and source workspace. Learning does not grant tools, credentials or workspace access. Generated files are registered through the tool rather than a filesystem watcher. Archived assets are not injected.

## Table of Contents

- [Package Details](#package-details)
- [Dev Note](#dev-note)

-----

<a id="package-details"></a>
## Package Details

Enterprise-only prompt context for approved organization and department memories. The plugin resolves a Session cwd through enterprise workspace grants and injects only approved summaries. It never loads raw conversation bodies, proposed/rejected entries, or memory outside the workspace compartment.

Memory values are rendered as quoted factual context with stable ids and an explicit privacy/access policy. With `autoSave` enabled, stable business memory is evaluated and activated by the existing automatic-memory tool. Employee learning is a separate versioned asset workflow, and records its source and audit result.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
