# Agent Note: Cua-primary Computer Use routing

Status: implemented

English | [中文](2026-09-12-cua-primary-routing.zh.md)

## Problem

DSH advertised Cua Driver as its desktop executor but exposed only screen-size observation. Browser tasks were forced through Agent Browser or Playwright, so an authenticated banking SPA could navigate while its DOM snapshot remained claimed indefinitely. The model had no Cua window-state or control operations to use instead.

## Decision

The model-facing `computer_use` tool now presents Cua operations first: visible-window discovery, exact-window accessibility snapshot, locally confirmed token/coordinate click, and locally confirmed token-based text entry. Agent Browser remains the isolated-browser bootstrap and DOM fallback; Playwright remains compatibility fallback. Cua window snapshots omit screenshot bytes from the server result and return a bounded accessibility tree.

## Alternatives considered

**Route every browser operation directly through Cua's browser adapter.** The installed Cua runtime correctly refuses isolated launch without its vendor-signed Chromium, and existing-profile attachment requires a separate host authorization integration. Pretending this path is available would recreate the same opaque failure.

**Upload full desktop screenshots to DSH.** That would expose unrelated screen content and login QR pixels. Native accessibility snapshots solve the current grounding problem without broadening the privacy boundary.

## Consequences

Visible user-PC work can recover from DOM-inaccessible applications through Cua without asking the user to describe every menu. Each target is an exact process/window pair, control remains permit-gated and locally confirmed, and stale element tokens fail closed. Browser startup remains a separate adapter responsibility.
