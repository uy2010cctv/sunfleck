# Agent Note: Enterprise Workspace Visibility and Deletion

Status: implemented

English | [中文](2026-08-30-enterprise-workspace-visibility.zh.md)

## Problem

The enterprise HTTP Workspace list was principal-scoped, but the conversation sidebar consumed the native `workspace.follow` stream. That stream exposed the complete process Workspace Registry, including other users' personal Workspaces. The native delete Remote also reached the Registry without applying enterprise ownership policy, so UI hiding alone could not protect default, department, or another user's Workspace.

## Decision

The native DSH Workspace Registry remains authoritative, while the authenticated Gateway projects `workspace.follow` per principal. The projection contains only personal Workspaces owned by the caller and department Workspaces for the caller's current memberships. Baselines, live upserts, removals, order frames, and archived Session ids use the same grant boundary.

The oldest personal Workspace owned by a user is the system-provisioned default and is not deletable. Department Workspaces and another user's personal Workspaces are not deletable. Only a later personal Workspace owned by the caller is deletable. The Gateway enforces this before invoking the native delete command, and the Client removes the delete action when the projected Workspace carries `deletable: false`.

Native Workspace creation remains available to enterprise members. After the Registry creates a Workspace, the authenticated Gateway records its personal ownership grant before returning the result. An ungranted Registry row is never projected to an enterprise client.

## Alternatives considered

**Filter only in React.** Rejected because direct Remote calls and another client implementation could still enumerate or delete protected Workspaces.

**Show every Workspace to administrators in the conversation sidebar.** Rejected because governance inspection and ordinary Agent work have different purposes. Administrators retain organization-wide governance views, while the conversation sidebar follows the same personal and department privacy boundary.

**Add a second enterprise Workspace registry.** Rejected because Workspace, Session accounting, and stream ordering already belong to the native Registry. The enterprise layer projects and authorizes that source instead of forking it.

## Consequences

- Host enforcement, not menu visibility, is the authorization boundary.
- A protected Workspace can still be renamed when policy allows; only its destructive menu action is removed.
- Deleting an allowed Workspace registration retains its directory and Session history, preserving the native DSH deletion contract.
- Existing ungranted Registry rows disappear from enterprise sidebars instead of being treated as organization-wide Workspaces.

## Authenticated stream and recovery follow-up

The authenticated principal must remain active for every lazy iterator step of the multiplexed Workspace WebSocket stream. Scoping only the HTTP upgrade is insufficient because the socket already existed before the authentication context and later `message` callbacks can run outside it. The Gateway therefore binds a principal-specific opener to each accepted connection and re-enters the request context for stream creation, `next()`, and iterator cleanup.

Enterprise grants also outlive an accidentally removed native Workspace registration. On startup, provisioning reconciles every user and department, and the native Registry can restore the missing row with the grant's original Workspace id. This preserves session/grant references and makes personal and department Workspaces visible again without creating duplicate identities.
