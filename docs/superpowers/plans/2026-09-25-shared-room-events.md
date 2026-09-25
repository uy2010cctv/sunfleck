# Shared Group and Channel Rooms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Give humans and published digital employees one durable room timeline for groups and channels, with bot handoffs, channel threads, reactions, signed authorship, search, and governed workflow triggers.

**Architecture:** `dsh_enterprise_collaboration_sessions` remains an execution binding for each employee and TeamRun. A new organization-scoped room event log is the conversation read model; it records every human and Bot contribution with a verifiable NIP-01 event and NIP-29 room tag. Native Session events remain the source for model inputs and execution replay. The room is the shared user-facing conversation, and the Host copies a bounded, source-tagged room context into each employee's native prompt before a turn. The room append path owns membership checks, signatures, idempotency, and delivery receipts.

**Tech Stack:** Cordis, PostgreSQL, NIP-01 Schnorr signing through maintained `nostr-tools`, typed HTTP, React client slots, Vitest, source-profile Web integration.

**Current scope:** SUNFLECK stores valid NIP-01 events for its internal rooms. External relay interoperability remains unverified and is not claimed.

**User references:** The supplied screenshots were named `codex-clipboard-d0f73ee3-6cd0-48cb-8206-cb13c8276f24.png` (Buzz-style shared channel timeline) and `codex-clipboard-84eb0abd-00f1-4340-aec1-ef41a03efb04.png` (Bot handoff and human approval conversation). The required journey has one or more humans with multiple digital employees in one group, direct Bot conversation and task ownership transfer, and a channel whose threads, reactions, Git/review facts, and workflow steps share the signed history.

## Task 1: Signed room event persistence

**Files:** `packages/enterprise/enterprise-postgres/src/collaboration.ts`, new `collaboration-events.ts`, package README pair and integration tests.

- [x] Add collaboration schema version 2 under the existing advisory transaction. Preserve v1 tables and rows. Create `dsh_enterprise_collaboration_events` with `sequence BIGINT GENERATED ALWAYS AS IDENTITY`, `(org_id,surface_id,event_id)` uniqueness, raw event JSONB, author kind/id, thread root, request id and source Session/event cursor. Index `(surface_id,sequence)` and `search_vector` for bounded PostgreSQL full-text search.
- [x] Add a shared `RoomEvent` interface with an exact NIP-01 event (`id`, `pubkey`, `created_at`, `kind`, `tags`, `content`, `sig`) and trusted persistence metadata (`sequence`, `authorKind`, `authorId`). Validate durable values on read. Make `append` idempotent for a matching authenticated `(surface,author,requestId)` and reject changed payloads.
- [x] Test concurrent identical append, changed retry conflict, ordered pagination, cross-org and cross-surface lookup, and search membership enforcement at the API caller. Run the focused PostgreSQL integration file with `DSH_TEST_POSTGRES_URL`.

## Task 2: Human and employee signing identities

**Files:** new `packages/api/enterprise-controller/src/collaboration-identity.ts`, `packages/api/enterprise-controller/package.json`, enterprise README pair, signer tests.

- [x] Add `nostr-tools` as a direct package dependency and use its `generateSecretKey`, `getPublicKey`, `finalizeEvent`, and `verifyEvent` from `nostr-tools/pure`. Store each server-custodied signing key through `ctx.credentials` under a separate organization/actor address. Store the public key and actor binding in PostgreSQL; never return a private key to the browser or put it in Session events.
- [x] Require `(orgId, actorKind, actorId)` to match an authenticated member or a bound employee before signing. Use kind 9 and an `h` tag for room text, kind 7 plus an `e` tag for a reaction, and a tagged custom kind for workflow and handoff facts. Include a room thread reference and verify the event before committing.
- [x] Test different human/Bot public keys, signature verification, replay, actor substitution rejection, key loss fail-closed, and restart readback. Document that human signatures are custodial until a user-key signing flow exists.

## Task 3: One room delivery API and execution bridge

**Files:** `packages/api/enterprise-controller/src/collaboration-service.ts`, `collaboration-runtime.ts`, `collaboration-http.ts`, new `collaboration-room-delivery.ts`, focused tests.

- [x] Add `GET /enterprise/surfaces/:id/events?after=&limit=&threadRoot=`, `GET .../search?q=`, `POST .../messages`, and `POST .../reactions` through the existing authenticated handler. Every read and write checks current explicit room membership and Workspace access before event lookup. Human text is committed once to the room before dispatch; a message with no Bot target remains a valid room message.
- [x] Address all tagged Bots from one human event, or the charter Lead when its policy triggers. Create/reuse each Bot's native Session solely for execution. Its model-visible prompt includes bounded room history, actor names, source event ids, task ownership, and current thread; the exact prompt is logged as the native `user/message`. Preserve the human event id as the native request id for retry recovery.
- [x] At `agent/turn-stopping`, project the final assistant message or failure into the same room with its employee author key, source Session id and event cursor. Persist a unique source cursor before publishing so a resumed process never repeats a Bot post. A Bot-triggered mention starts another member's execution only after its post lands; configurable hop and loop guards stop cycles.
- [x] Route TeamRun charter assignment, verification, handoff and human decision events into the room as signed workflow facts, retaining the native TeamRun log and decision approval authority. A team member may post a signed handoff referencing a task and target employee; a durable compare-and-swap owner transfer makes two competing transfers deterministic.
- [x] Cover two humans plus two Bots in one timeline, no-target human message, multi-Bot parallel response order, replay after crash, member revocation, unrelated org, and failed Bot turn. Run the existing source-profile Web fixture with a deterministic model.

## Task 4: Native SUNFLECK room UI

**Files:** `packages/client/ui-enterprise-workbench/src/client/{collaboration.ts,collaboration-store.ts,CollaborationNavigation.tsx,CollaborationNavigation.module.css,collaboration-locales.ts}`, new `CollaborationRoom.tsx` and CSS, native sidebar context registration, focused Client tests.

- [x] Clicking a group or channel opens one room main panel. Header names the room and shows members; the scroll area renders all authorized human/Bot messages in event sequence with distinct authors, signed state, source links and thread affordances. The composer sends from the room, supports member mention selection and preserves the draft across errors. Keep existing Workspace/Session sidebar sections and the right context pane.
- [x] Channel rows open the room directly. Threads nest under one parent event and can be opened in the right pane. Reactions update within the room and show author counts. Search queries the same authorized room events. The room shows work cards and approval status in the same timeline; no sample messages or invented success state.
- [x] Poll or subscribe to an authenticated incremental cursor so a second human sees the new event without reloading. Stop streams and erase a revoked room immediately. Test desktop and narrow layouts, empty/loading/error states, keyboard and focus behavior, duplicate retry and an actual multi-speaker transcript.

## Task 5: Channel workflow triggers

**Files:** new `packages/api/enterprise-controller/src/collaboration-workflows.ts`, PostgreSQL migration/repository, handler routes, Client channel details, tests.

- [x] Parse versioned YAML with a bounded typed schema: message, reaction, schedule, authenticated webhook and Git event triggers; actions limited to signed room post, member Bot request, and an existing Enterprise approval request. Store immutable revisions and last cursor; configure only room managers through current authorization.
- [x] Every trigger has a stable delivery key and durable receipt. Webhook authentication is configured per route. Schedule catch-up is bounded. Git events enter through an authenticated existing webhook adapter; external provider bytes and signature verdict are retained by that adapter. A workflow action that requires human approval stays pending until the existing decision service confirms it.
- [x] Test duplicate trigger delivery, malformed YAML, unauthorized save, missed schedule tick, webhook replay, Git tag release-note draft, human approve/reject, and restart. Show workflow steps as signed room events with the real actor key and source reference.

## Task 6: Documentation and real-world checks

**Files:** `PRODUCT.md`, `DESIGN.md`, affected package README pairs, source-profile fixture, recorded Session snapshot where model-visible content changes.

- [x] Update product language from separate employee destination views to shared rooms while keeping native execution Sessions. Describe custodial human keys and outside-relay interoperability accurately.
- [ ] Run focused tests, affected Host/Client type checks, i18n, lint, docs pairing and source-profile integration. Verify two browser users, multiple Bots, thread/reaction/search, handoff, approval and workflow readback in rendered SUNFLECK. The remote port 5173 requires a separate deployment and release check.

## Acceptance

Two humans and multiple Bots appear in the same group transcript with independent author identities. A Bot can hand work to another Bot, which answers in that room; the resulting draft returns to the humans for a recorded decision. A channel has one searchable signed event timeline for messages, reactions, Bot actions, workflow steps and authenticated Git events; thread replies stay attached to their parent. A revoked member cannot read, post or receive updates. Native Sessions still replay every model-visible input and execution step.

## Verification record

The keyless source-profile Web integration uses real PostgreSQL, authentication, Workspace grants, native Sessions and WebSocket streams with a deterministic external model adapter. It verified two humans and two Bots in one room, distinct verifiable signing keys, direct Bot handoff and resumed owner, thread/reaction/search, receipt retries, revocation, YAML approval and original-revision continuation, signed GitHub tag ingress and replay, and a due schedule. Host/Client type checks and bundles plus the Web build passed on the local branch. The external 47 deployment is unchanged. Final rendered Chrome inspection remains pending while the Mac is locked; the committed Session snapshot corpus has not been extended by this plan.
