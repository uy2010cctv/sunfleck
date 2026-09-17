# Agent Note: Knowledge HTTP routes require enterprise authorization

Status: implemented

English | [中文](2026-09-17-knowledge-http-enterprise-auth.zh.md)

## Problem

The Host Web server dispatches named routes and intentionally has no application authentication policy. A knowledge plugin registered `/knowledge` directly and performed service reads, body parsing, imports, and deletion without first establishing an enterprise principal. A reverse proxy that exposed the DSH Web port therefore exposed the route even though the SPA fallback and Host APIs required login.

## Decision

DSH classifies `enterpriseKnowledge.read` as `capability.read` and `enterpriseKnowledge.manage` as `capability.manage`, with an optional knowledge-base resource id. The knowledge plugin authenticates the enterprise Session cookie, requests that central decision, records it in the existing audit sink, and runs allowed work inside `EnterpriseRequestContext` before touching the knowledge service or request body.

The route returns 401 without a principal, 403 for a denied action, and 503 if enterprise authorization fails. A profile with neither enterprise security service remains local and retains its previous behavior. A profile exposing only one of the two enterprise services fails closed as a composition error.

The reverse proxy may block `/knowledge` as defense in depth during rollout. That rule is not the authorization owner and can be removed after the authenticated route is deployed and verified.

## Verification

The auth package test pins the two endpoint classifications. The knowledge package tests cover anonymous reads, denied writes before body parsing, allowed reads inside the principal context, audit calls, authorization failure, local-profile compatibility, and the mounted service route.

## Alternatives considered

**Protect only the Nginx path.** This leaves loopback, alternate proxies, and future deployments exposed, and it prevents authenticated browser access unless proxy configuration duplicates application policy.

**Add authentication to the generic Web server.** The server is a routing primitive shared by enterprise and non-enterprise profiles. Making it infer application identity would couple every route to one authentication system.

**Trust same-origin browser access.** Same-origin routing identifies a network origin, not a user, role, organization, or auditable principal.

## Consequences

Knowledge HTTP access now shares the enterprise identity and audit path used by the workbench. Raw route owners remain responsible for declaring and invoking their application authorization before domain work. Non-enterprise local profiles do not gain an enterprise login dependency.
