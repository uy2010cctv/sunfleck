---
description: "Governed enterprise Cordis Package, review, binding, and artifact services."
kind: "package-reference"
---

# @deepseek-ai/dsh-enterprise-cordis

English | [中文](README.zh.md)

## Summary

`dsh-enterprise-cordis` stores governed Cordis Packages, reviews, scope bindings, artifact metadata, and audit records for one enterprise organization.

## Table of Contents

- [Package Details](#package-details)
- [Dev Note](#dev-note)

-----

## Package Details

The service persists immutable Package versions, binds approved versions to organization, department, or creator-private Workspace scopes, and records revision-checked review and audit actions. A private version in a shared department Workspace is visible only to its creator, who may submit that saved version for department review without changing or publishing the private original. The same saved version has one review even when submitted with another request key; a returned version needs a new immutable version before review can continue. Department review acts only on pending requests, and organization publication requires department approval. Activating an already selected version, stopping an already disabled binding, or resuming an already active selected version leaves its revision unchanged. The creator can archive the Plugin into a recoverable recycle bin; archiving stops its binding for new Sessions, while restoring keeps that binding stopped until explicitly activated. A pending department submission is listed only for its author and department managers before approval; organization publication is listed to members even when its source version was created in a department. A pinned Session generation containing a private binding is unreadable by another user of the shared Workspace. When several active scopes name one Plugin, a new Session pins one version: session, private Workspace, department, then organization in precedence order. List projections mark bindings manageable only for the private owner, a department manager, or an organization administrator according to scope. Private bindings can roll back to an older version in the same scope; department and organization bindings can resume only their selected approved version. A Host supplies durable PostgreSQL composition and enforces the authenticated principal before calling it.

## Model Experience

### Governed extension metadata

#### What the model sees

Only a composed Agent tool or system policy may expose approved `CordisPackageVersion` metadata. This package itself adds no prompt section, tool schema, or provider request.

#### Token effect

Zero direct tokens; model-visible extension descriptions are owned by the composing runtime.

#### KV Cache effect

None at this repository layer.

## Known Limitations and Deferred Work

- Artifact storage is abstracted; deployment-owned storage and malware scanning remain separate integrations.

<a id="dev-note"></a>
### Dev Note

None.
