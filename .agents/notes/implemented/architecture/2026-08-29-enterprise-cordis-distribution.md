# Agent Note: Enterprise Cordis distribution

Status: implemented

English | [中文](2026-08-29-enterprise-cordis-distribution.zh.md)

## Problem

Dynamic Cordis Packages were native to DSH but process- and Session-local. Enterprise users could create and run a capability through conversation, yet they could not retain it for a personal Workspace, submit it to department governance, publish it organization-wide, or prove which immutable version a Session used.

## Decision

The native `cordis_inspect -> cordis_define -> cordis_run -> repair` path remains authoritative. An enterprise layer adds immutable Package versions, scoped activation bindings, department-manager reviews, audit records, and Session Generation snapshots in PostgreSQL. It does not introduce a low-code authoring engine.

In an enterprise Workspace, each successful `cordis_define` stores an immutable version in the creator's private scope. The Session id qualifies the durable Plugin id so process-local ids cannot collide after a restart. A personal or department Workspace member may activate, stop, and roll back a private version for that Workspace. Department sharing requires an explicit submission; any configured manager of that department may derive a new immutable version, approve or return it, and publish it organization-wide. A pending submission's source is visible to its author through the Workspace list and to managers through review, not to other members. Administrators retain emergency disable, rollback, manager-grant, and trust-level controls. User-authored Packages remain isolated by default and cannot provide protected identity, authorization, audit, credential, persistence, repository, or artifact-store contracts.

Each Session captures visible active bindings once. Restoration uses the ordinary Cordis isolated Realm, Host lifecycle, browser loader, and diagnostics by default. Only an organization-scoped version explicitly promoted by an administrator to `trusted-in-process` receives the in-process Cordis Context executor. Later Workspace upgrades affect new Sessions only.

Package source is stored by SHA-256 content address in the controlled Artifact Store; PostgreSQL retains only its reference, digest, size, and governance metadata, and every read verifies the digest again. Publication gates check malicious construction signatures, embedded secrets, Host APIs, license allowlists, exact dependency versions, and SHA-512 integrity. The scanner contract can append enterprise antivirus and SCA implementations, and any failed check leaves the active pointer unchanged.

The enterprise workbench exposes Workspace extensions as operational rows: running, personal, department, organization, pending-review, and recycle-bin views. It opens on the creator's saved versions across authorized Workspaces, labels private versions with their source Workspace, and offers a Workspace filter. The client deduplicates organization versions returned by several Workspace reads and retains reachable records if one Workspace read fails. A creator can archive a private Plugin and restore its immutable versions; archive and binding stop commit together, and restore does not silently reactivate the binding. Department and organization tabs derive visibility and management actions from approved scope bindings, while pending sources remain in review. The page shows real versions, scope, capabilities, isolation, source, lifecycle actions, and review actions without exposing Cordis implementation choices as a separate builder.

## Verification

Domain, PostgreSQL, authentication classification, Host controller, dynamic runner, runtime restoration, controller-store, and browser component tests cover the new chain. The root build validates Typert generation, Host/Client packages, and the production Web bundle.

## Alternatives considered

**Separate enterprise low-code builder.** Rejected because it would create a second authoring, execution, and audit model beside native Cordis Packages.

**Immediate in-process execution for every published Package.** Rejected because user- and department-authored code must remain isolated until an administrator explicitly promotes an organization-scoped release.

**Permanent deletion of a private Package.** Rejected because recovery and pinned Session generations rely on immutable source; a scope archive removes the Plugin from new-Session selection without erasing evidence.

## Consequences

- Enterprise Workspace definitions retain their source even if the Session-local Plugin is removed. Definitions created outside an enterprise Workspace remain temporary.
- Package history is append-only; rollback moves a binding pointer and never deletes source history.
- Governed department and organization bindings resume their selected approved Package only; selecting a private or pending Package requires the ordinary review and publication path.
- Restored Client Packages skip duplicate approval only because a durable scope binding already records the prior approval.
- Formal plugins installed from a private npm registry, tgz, Git source, or protected Profile are projected beside user Cordis extensions in the enterprise plugin center; private package specs and local paths never reach the browser.
- A department manager must first be a department member. Multiple managers are supported and maintained from the organization tree with revision-conflict protection.
