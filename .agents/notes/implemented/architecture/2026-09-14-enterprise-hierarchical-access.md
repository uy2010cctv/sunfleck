# Agent Note: Enterprise hierarchy controls employee resources

Status: implemented

English | [中文](2026-09-14-enterprise-hierarchical-access.zh.md)

## Problem

Channels, enterprise memory, and digital employees previously relied on separate combinations of organization roles, owner ids, workspace paths, and visibility fields. A channel background Session could also lack an authenticated human principal. These differences allowed a resource to appear in a catalog even when the caller's department should not see it, and they encouraged background execution to borrow a human identity.

## Decision

`enterprise-governance` owns one hierarchy with organization, department, employee, and personal scopes. Authentication projects a human's department memberships into the principal and resolves managed departments from the enterprise directory. The authorization service evaluates the hierarchy before resource visibility and records stable reasons for department membership, department management, employee service execution, personal ownership, and scope mismatch.

Employee definitions resolve to the owner's authoritative department assignment. A channel bound to an immutable employee release resolves through that release and employee definition to the same department. Catalog controllers apply the resolved decision to every employee and channel row before returning it.

Background execution uses `employeeServicePrincipal`. This principal names one immutable employee release, has no human roles or managed departments, and can execute only resources that name the same release. A working directory, recently authenticated browser user, or display name does not establish background authority.

## Verification

Governance tests cover cross-organization denial, department membership, department manager limits, personal ownership, and exact employee-release execution. Authentication tests cover department projection and managed-department decisions. Plugin and controller tests cover employee/channel hierarchy resolution and list filtering.

## Alternatives considered

**Keep resource-specific permission checks.** Separate checks drift when a role or organization assignment changes and cannot produce one consistent audit reason.

**Use workspace paths as identity.** Paths identify storage locations. They do not prove which employee release or human principal is acting, and release-directory paths are outside the managed enterprise workspace registry.

**Run channels as the employee owner.** This gives a background transport every permission held by a human and makes audit records attribute autonomous work to the wrong actor.

## Consequences

Channels, memory, and employees can share one authorization vocabulary and audit path. Department moves change future authorization from the organization directory instead of copied display text. Channel adapters must supply an exact employee release for employee-scoped execution, and unbound channel configuration remains organization-administered until that binding exists.
