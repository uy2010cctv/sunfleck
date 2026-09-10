# Agent Note: Enterprise Session owner isolation

Status: implemented

English | [中文](2026-08-31-enterprise-session-owner-isolation.zh.md)

## Problem

Enterprise Workspace visibility and Session visibility were conflated. Department members correctly shared a department Workspace, but the native Workspace projection returned every `sessionId` recorded under that Workspace. As a result, one member could discover another member's conversations in the ordinary Sidebar.

## Decision

Workspace sharing does not imply conversation sharing. Each enterprise Session binding persists the authenticated creator user id alongside the organization and Workspace id. The Workspace follow projection filters active and archived Session ids to the current principal before they reach the browser. The Session list, live control stream, and forwarded Session-added/removed events apply the same owner fence so a hidden row cannot reappear under **Ungrouped** or through a live update. Direct Session authorization resolves the same creator as a private resource; administrator investigation remains a governance/audit path rather than ordinary Sidebar discovery.

Personal Workspace bindings are backfilled from the Workspace owner during the schema v4 to v5 migration. Legacy department bindings have no trustworthy creator fact, so migration leaves them unowned and therefore hidden instead of guessing and leaking a conversation. New department Sessions always receive an owner at `session.create` commit time.

## Alternatives considered

**Filter only the Sidebar.** Rejected because direct Session APIs and live events could still expose another member's conversation.

**Infer legacy department owners.** Rejected because an unverified owner assignment would create a privacy leak; legacy rows remain hidden until trustworthy ownership exists.

## Consequences

- Users see their own Sessions in personal and department Workspaces.
- Department files and approved department memory remain shared.
- Other members' conversations and archived Session ids do not enter the Sidebar stream.
- Session ownership is enforced by the Host projection and resource resolver, not by client-side hiding.
