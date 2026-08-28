# Agent Note: Enterprise Cordis distribution

Status: implemented

English | [中文](2026-08-29-enterprise-cordis-distribution.zh.md)

## Problem

Dynamic Cordis Packages were native to DSH but process- and Session-local. Enterprise users could create and run a capability through conversation, yet they could not retain it for a personal Workspace, submit it to department governance, publish it organization-wide, or prove which immutable version a Session used.

## Decision

The native `cordis_inspect -> cordis_define -> cordis_run -> repair` path remains authoritative. An enterprise layer adds immutable Package versions, scoped activation bindings, department-manager reviews, audit records, and Session Generation snapshots in PostgreSQL. It does not introduce a low-code authoring engine.

Personal Workspace owners may save, activate, stop, and roll back their own extensions. Department members may submit a Package; any configured manager of that department may derive a new immutable version, approve or return it, and publish it organization-wide. Administrators retain emergency disable, rollback, manager-grant, and trust-level controls. User-authored Packages remain isolated by default and cannot provide protected identity, authorization, audit, credential, persistence, repository, or artifact-store contracts.

Each Session captures visible active bindings once. Restoration redefines those immutable sources under a process-local runtime identity, marks previously approved Client code as approved, and still uses the ordinary Cordis sandbox, Host lifecycle, browser loader, and diagnostics. Later Workspace upgrades affect new Sessions only.

The enterprise workbench exposes Workspace extensions as operational rows: running, personal, department, organization, and pending-review views. It shows real versions, scope, capabilities, isolation, source, lifecycle actions, and review actions without exposing Cordis implementation choices as a separate builder.

## Verification

Domain, PostgreSQL, authentication classification, Host controller, dynamic runner, runtime restoration, controller-store, and browser component tests cover the new chain. The root build validates Typert generation, Host/Client packages, and the production Web bundle.

## Consequences

- Session-temporary Packages remain temporary until an explicit save or department submission.
- Package history is append-only; rollback moves a binding pointer and never deletes source history.
- Restored Client Packages skip duplicate approval only because a durable scope binding already records the prior approval.
- A future formal enterprise installer may consume private npm registries or tgz artifacts, but it must project into the same Package, validation, binding, health, and audit model.
