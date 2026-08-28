# Agent Note: Enterprise directory, workspace compartments, and reviewed memory

Status: implemented

English | [中文](2026-08-28-enterprise-directory-workspace-memory.zh.md)

## Problem

The enterprise overlay authenticates users and persists roles, but its organization is flat. A user has no department assignment, every DSH Workspace remains globally listed after authentication, and the deployment has no durable distinction between a personal workspace and a department workspace. The sandbox enforces a Session cwd correctly, but governance does not yet decide which user may select that cwd.

Long-term organizational memory is also absent. Copying raw conversations into a shared store would leak personal data, preserve prompt injection, and make removal or correction impossible to audit. At the other extreme, keeping every useful fact inside one user's Session prevents the enterprise from retaining process, terminology, and company knowledge.

## Decision

The enterprise identity store owns a department tree, user-to-department membership, Workspace grants, and Session-to-Workspace bindings. DSH Workspace stays the runtime identity and Session cwd stays the sandbox boundary. Every user receives one managed personal Workspace; users may create more personal Workspaces below their managed root. A department receives a managed shared Workspace whose current visibility is derived from active department membership.

Memory follows the same compartments as access. A memory candidate contains a short business summary, kind, scope, immutable source digest, and privacy findings, but no raw conversation body. Deterministic screening rejects common personal identifiers and credential-shaped content. An authorized reviewer approves or rejects each candidate. Only approved organization memories and the current workspace's approved department memories enter model context.

The injected context explicitly forbids using shared memory to infer personal preferences or reveal source identities. It treats memories as factual context rather than executable instructions and includes stable memory ids for correction and audit. Enterprise-wide Agent awareness is therefore one curated stream of approved company facts, not omniscient access to employee conversations.

## Alternatives considered

**Share every user's conversation memory across the department.** Rejected because it turns access membership into consent for secondary use, exposes personal material, and allows unreviewed prompt injection to persist.

**Give the Agent each initiating user's credentials.** Rejected because multiplayer work needs an independently governed Agent identity and auditable service credentials; user credentials would make shared work depend on whichever person happened to start it.

**Create a second enterprise workspace and sandbox engine.** Rejected because DSH already owns Workspace, Session cwd, and sandbox enforcement. A parallel engine would split filesystem identity, replay, and authorization evidence.

**Use organization-wide memory only.** Rejected because department-specific operational detail should not automatically become company-wide context. Explicit promotion is the only path from department scope to organization scope.

## Verification

- Administrators can edit a cycle-free department tree and assign users, including one primary department.
- A new user has a private managed DSH Workspace; department members can see their shared Workspace but unrelated users cannot.
- Sandbox policy resolves from the selected DSH Session cwd and cannot escape the granted managed root.
- Shared memory stores no raw conversation body, rejects sensitive candidates, requires review, and supports correction/removal with audit.
- Model context contains only approved organization and applicable department memories, with privacy instructions and stable ids.
- The governance UI supports keyboard use and 320/768/1440px layouts without page-level horizontal scrolling.

## Consequences

Directory membership changes must update workspace policies atomically or access may lag. Deterministic privacy detection produces both false positives and false negatives, so it is a gate before human review rather than a claim of complete data-loss prevention. Organization memory can still spread incorrect business facts; versioned review, provenance digests, and removal remain mandatory.
