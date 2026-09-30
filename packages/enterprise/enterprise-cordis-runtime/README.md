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

The runtime resolves the Session owner and enterprise Workspace grant, pins the Session generation, and restores approved dynamic Packages. Historical generations with overlapping bindings select one version per Plugin without changing the stored generation. Restoration removes all definitions it created if any later Package fails; disposing an Agent clears its runtime definitions so a resumed Agent can restore them again. It provides `cordis_define`, `cordis_run`, `cordis_inspect_self`, `cordis_stop`, and `cordis_undefine` for Session-local Plugins alongside the governed save and review tools; the upstream `tool-cordis` package keeps its separate read-only API inspection tools. A successful `cordis_define` in a personal Workspace saves a private version; in a department Workspace it submits an immutable version for manager review without activating a shared binding. Removing the Session-local Plugin does not delete its saved or pending version. The Session plugin panel reports the current Session's running Plugins, while the enterprise extensions page reports saved versions, reviews, and governed bindings. Browser requests cannot expand a Package scope.

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
