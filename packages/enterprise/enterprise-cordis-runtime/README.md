---
description: "Enterprise Cordis runtime composition and Agent-facing persistence tools."
kind: "package-reference"
---

# @deepseek-ai/dsh-enterprise-cordis-runtime

English | [中文](README.zh.md)

## Summary

`dsh-enterprise-cordis-runtime` restores approved enterprise Cordis generations into a Workspace and exposes governed persistence actions to an authorized Agent.

## Table of Contents

- [Package Details](#package-details)
- [Dev Note](#dev-note)

-----

## Package Details

The runtime resolves the Session owner and enterprise Workspace grant, pins the Session generation, and restores approved dynamic Packages. A successful `cordis_define` in an enterprise Workspace saves a private version for that owner; activation and department submission remain explicit actions. Removing the Session-local Plugin does not delete its saved version. It never treats a browser request as authority to expand a Package scope.

## Model Experience

### Approved dynamic capabilities

#### What the model sees

The runtime can make only the selected approved dynamic `CordisPackageVersion` capabilities available to the current Agent. Review and storage metadata remain Host-only.

#### Token effect

Capability instructions and schemas consume tokens only when an approved Package contributes them to the Agent composition.

#### KV Cache effect

Pinned Package generations keep their stable composition order; cache reuse remains provider-dependent.

## Known Limitations and Deferred Work

- Dynamic Package execution is limited to the sandbox and capability policy supplied by the Host composition.

<a id="dev-note"></a>
### Dev Note

None.
