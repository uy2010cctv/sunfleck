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

The service persists immutable Package versions, binds approved versions to organization, department, or personal scopes, and records revision-checked review and audit actions. A Host supplies durable PostgreSQL composition and enforces the authenticated principal before calling it.

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
