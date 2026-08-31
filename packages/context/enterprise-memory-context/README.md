---
description: "Reviewed organization, department, and private user memory context for DSH Enterprise."
kind: "package-reference"
---
# @deepseek-ai/dsh-enterprise-memory-context

English | [中文](README.zh.md)

## Summary

Reviewed organization, department, and private user memory context for DSH Enterprise.

## Table of Contents

- [Package Details](#package-details)
- [Dev Note](#dev-note)

-----

<a id="package-details"></a>
## Package Details

Enterprise-only prompt context for approved organization, department, and private user memories. The plugin resolves a Session cwd and durable Session owner through enterprise grants, then injects only approved summaries. Organization memory is shared enterprise-wide, department memory follows department membership, and user memory is visible only to its owner. It never loads raw conversation bodies, proposed/rejected entries, or memory outside the current scope.

Memory values are rendered as quoted factual context with stable ids and an explicit privacy/access policy. When `autoSave` is enabled, `remember_business_knowledge` attributes creation to the Session owner and automated review to the configured governance actor. Repository scope, privacy, deduplication, and lifecycle checks remain authoritative.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
