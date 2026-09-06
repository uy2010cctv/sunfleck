# Agent Note: Web authenticated recovery page

Status: implemented

English | [中文](2026-09-06-web-authenticated-recovery-page.zh.md)

## Problem

A missing or expired browser cookie received a plain-text 401 before the Web client could mount, and a client boot failure displayed its reason without a recovery action. A terminal Host transport failure could leave the application visible without a recovery control at the root level.

## Decision

`BrowserAuth` returns a self-contained 401 HTML document for unauthenticated index requests. The document identifies the authentication failure, tells the operator to reopen the URL printed by `dsh web`, and retries only the current document. It contains no launch token and cannot mint one. The process-scoped launch token remains short-lived; the authority-bound signed cookie remains the only restart recovery credential.

The framework-free boot page adds an explicit retry that reloads the exact document URL. Once the application mounts, `AppWebEntry` observes terminal `ctx.connection.state === 'disconnected'` and places a reconnect notice outside the React renderer. Reconnect invokes the existing `ctx.connection.reconnect()` command without unmounting the selected route, Workspace, Session, or application-owned draft state.

## Alternatives considered

**Persist the launch token.** Rejected because a startup capability must not become a reusable browser credential. The existing signed cookie preserves a valid session across a Host restart without extending the token lifetime.

**Serve the normal application to an unauthenticated request.** Rejected because bundles and RPC would become reachable before BrowserAuth established a session. The static recovery document performs no authenticated operation.

**Reload the page for a transport outage.** Rejected because a reload discards in-memory route and selection state. The reconnect control preserves the mounted application and delegates carrier recovery to the established Connection controller.

## Consequences

An expired browser session still requires the operator to obtain the current startup URL from `dsh web`; the recovery page cannot complete authentication alone. A Host restart with a valid signed cookie reloads normally, while a terminal transport loss exposes a reconnect action without weakening Host or Origin checks.

## Testing

BrowserAuth tests verify token-free 401 recovery output and retain cookie, token-rotation, tamper, expiry, and authority checks. Client-web tests verify boot retry behavior and a disconnected transport notice that leaves existing mounted content in place before reconnecting. The frontend-static composition test verifies the served 401 document.
