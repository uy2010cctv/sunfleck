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

The service persists immutable Package versions, binds approved versions to organization, department, or creator-private Workspace scopes, and records revision-checked review and audit actions. A private version in a shared department Workspace is visible only to its creator. The creator can archive the Plugin into a recoverable recycle bin; archiving stops its binding for new Sessions, while restoring keeps that binding stopped until explicitly activated. A pending department submission is not listed for other members before approval; an organization publication is listed to members even when its source version was created in a department. List projections mark bindings manageable only for the private owner, a department manager, or an organization administrator according to scope. Private bindings can roll back to an older version in the same scope; department and organization bindings can resume only their selected approved version. A Host supplies durable PostgreSQL composition and enforces the authenticated principal before calling it.

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
