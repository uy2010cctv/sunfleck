# Agent Note: Authenticated enterprise request context

Status: implemented

English | [中文](2026-08-27-authenticated-enterprise-request-context.zh.md)

## Problem

Host RPC handlers need the authenticated enterprise identity, but an RPC payload is client-controlled. Accepting a payload field as an `EnterprisePrincipal` lets a caller claim another user, organization, or role even when the transport authenticated a different session. Passing principals explicitly through every Host API also couples transport identity to unrelated business contracts and makes omission easy.

WebSocket downlinks create asynchronous stream work after the HTTP upgrade. Their source must observe the same authenticated identity without leaving it visible to work outside that upgrade.

## Decision

`@deepseek-ai/dsh-enterprise-auth-web` provides `EnterpriseRequestContext`, backed by Node `AsyncLocalStorage`. Its `run(principal, callback)` establishes the server-authenticated `EnterprisePrincipal`; `current()` observes it when optional behavior is appropriate, and `requirePrincipal()` fails closed outside an authenticated request.

The Connection transport enters this context only after cookie authentication, endpoint authorization, and audit complete. HTTP wraps the selected Fetch handler. An authorized WebSocket upgrade wraps the handler that creates the downlink source and its asynchronous resources. A composition without `enterpriseSecurity` follows the ordinary transport path and creates no principal context.

The top-level HTTP RPC payload key `principal` is reserved while enterprise security is active. After session authentication, Connection returns HTTP 400 before authorization, audit, or dispatch, rather than forwarding, deleting, or interpreting the value. An invalid payload therefore cannot produce an allowed audit record. Ordinary profiles retain the unrestricted payload contract.

Auth plugin disposal calls `EnterpriseRequestContext.dispose()`, which marks the instance disposed, advances its generation, and disables the underlying asynchronous storage. Each store captures the generation established by `run()`; `current()` returns a principal only while that generation still matches and the context is not disposed. Initialization failures after context construction dispose it as well. Auth closes the identity repository only when it constructed the SQLite fallback; an injected `identityStore` or `enterprisePostgres.identity` remains owned and usable by the deployment. Pending continuations lose the inherited principal, and a later plugin load publishes a fresh context instance.

The enterprise overlay injects `enterpriseSecurity` and `enterpriseRequestContext` into Connection. Loader therefore holds Connection until `enterprisePostgres` activates auth and auth publishes both services, while the base Web profile continues to inject only `webRuntime`.

Enterprise ApiProxy handlers read identity only through `requirePrincipal()`. Employee and asset handlers inject `orgId`, `ownerUserId`, `createdBy`, or `publishedBy` into PostgreSQL catalog calls after explicit asynchronous authorization and audit. In PostgreSQL mode, an identity-policy miss delegates employee resource resolution to the catalog draft; its owner and visibility become the authorization resource, while an absent draft or a restricted draft without an identity-policy allowlist fails closed. Team, work-record, approval, and schedule handlers delegate to `EnterpriseOperationsService`, which injects organization scope and actor identity before its driver call. Enterprise request schemas are strict and contain neither principal nor organization fields.

Collection authorization does not substitute for resource authorization. Employee lists authorize and audit each draft before returning it. Draft creation uses the current actor as owner, while updates read and retain the persisted owner; the repository update also preserves its stored owner column.

Successful enterprise writes emit organization-tagged invalidation events after the repository promise resolves. A host event stream captures the opening request's `current()` principal and forwards an enterprise frame only when the event organization matches it; a stream without enterprise request context subscribes to no enterprise events.

## Alternatives considered

**Trust a payload principal after comparing selected fields.** Rejected because the payload remains a second identity authority, field additions can escape the comparison, and downstream handlers can accidentally read the unvalidated object.

**Delete `payload.principal` silently.** Rejected because mutation hides a client contract error and can make requests appear successful with different semantics. HTTP 400 makes the reserved-key boundary observable.

**Pass the principal as another argument through every RPC handler.** Rejected because it changes the generic RPC contract for ordinary profiles and requires every intermediary to preserve a security value it does not own.

## Consequences

Enterprise Host code has one request-scoped identity authority that propagates across promises and concurrent requests without cross-request leakage. Payloads cannot impersonate it, and calls outside authenticated work fail closed.

The enterprise management RPC contract remains importable by browser clients without importing Node request-context or PostgreSQL types. Ordinary profiles keep their existing APIs and receive an explicit unavailable business response only when they invoke an enterprise domain.

The enterprise overlay has a deliberate startup dependency from PostgreSQL through auth to Connection. Ordinary profiles do not acquire enterprise dependencies or reserved payload keys. `AsyncLocalStorage` makes this service Node Host-only; browser and transport-independent business contracts do not import it.

Focused tests pin anonymous rejection, callback lifetime, concurrent isolation, HTTP reserved-key rejection, WebSocket propagation, ordinary-profile compatibility, and Loader activation order.

A real Loader integration test mounts the shipped WebServer, Enterprise Postgres, enterprise auth, Connection, and ApiProxy implementation. With `DSH_TEST_POSTGRES_URL`, it logs in through HTTP, carries the cookie through the real `/api` fetch wire, and observes ALS-derived organization and owner fields on a PostgreSQL employee write. It also pins anonymous 401, forged-principal 400, member mutation 403, private-list filtering, auth reload with a fresh request-context generation, and continued shared-pool health; its always-on ordinary-profile case observes an unknown `/api` method returning 404 without enterprise services. The enterprise PostgreSQL workflow runs this test and the direct four-domain ApiProxy PostgreSQL test, and watches every package and overlay path that owns the chain. Enterprise Postgres pool close is idempotent because Loader disposal may revisit the same asynchronous close boundary while dependents unload.
