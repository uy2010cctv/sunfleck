# Unified Room Details Management Plan

English | [中文](2026-09-29-room-details-management.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task.

**Goal:** Give groups and channels consistent, usable rename/member/leave/archive controls with current membership and administrator checks.

**Architecture:** One shared room details component uses existing primitives and controller operations for both kinds. One protected member-options endpoint supplies eligible workspace-visible humans and authorized released employees. Room administrators edit name/announcement, add/remove members and archive; other members can leave. Confirmations and selection use shared Modal primitives with async state and retained selections. Workflows/decisions remain channel-specific sections.

## Server

- [ ] Red/green group+channel lifecycle and permission tests, including successful leave without reading now-forbidden detail.
- [ ] Generalize rename/announcement/member/archive authorization to current room admin; leave removes only self; preserve admin ownership and archived data.
- [ ] Protect member options and channel duty updates; keep duty roster consistent when employees are removed.
- [ ] Real source-profile HTTP lifecycle roundtrip tests for synthetic group/channel, revocation and non-admin denial; owning docs updated.

## Client

- [ ] Replace duplicate group-specific forms with shared details: information, humans, employees, end actions.
- [ ] One searchable multi-select member modal filters existing members and uses eligible member options; loading/empty/error/retry remain distinct.
- [ ] Name/announcement editing preserves draft on failure; remove/leave/archive confirmations use shared Modal with disabled pending controls.
- [ ] Channel gets same name/member/end controls and explicit duty selection; existing workflow/decision sections remain.
- [ ] Locale-owned labels and scoped token CSS; tests for both room kinds, permissions, confirmations, retry and modal dismissal.

## Delivery

- [ ] Spec then quality review, focused tests/types/lint/docs and clean build.
- [ ] Deploy verified artifact with rollback; read-only real browser desktop/narrow inspection of controls, do not mutate real membership or archive real rooms.
