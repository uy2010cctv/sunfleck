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

Auth plugin disposal calls `EnterpriseRequestContext.dispose()`, which disables the underlying asynchronous storage. Initialization failures after context construction dispose it before closing the identity repository. Pending continuations lose the inherited principal, and a later plugin load publishes a fresh context instance.

The enterprise overlay injects `enterpriseSecurity` and `enterpriseRequestContext` into Connection. Loader therefore holds Connection until `enterprisePostgres` activates auth and auth publishes both services, while the base Web profile continues to inject only `webRuntime`.

## Alternatives considered

**Trust a payload principal after comparing selected fields.** Rejected because the payload remains a second identity authority, field additions can escape the comparison, and downstream handlers can accidentally read the unvalidated object.

**Delete `payload.principal` silently.** Rejected because mutation hides a client contract error and can make requests appear successful with different semantics. HTTP 400 makes the reserved-key boundary observable.

**Pass the principal as another argument through every RPC handler.** Rejected because it changes the generic RPC contract for ordinary profiles and requires every intermediary to preserve a security value it does not own.

## Consequences

Enterprise Host code has one request-scoped identity authority that propagates across promises and concurrent requests without cross-request leakage. Payloads cannot impersonate it, and calls outside authenticated work fail closed.

The enterprise overlay has a deliberate startup dependency from PostgreSQL through auth to Connection. Ordinary profiles do not acquire enterprise dependencies or reserved payload keys. `AsyncLocalStorage` makes this service Node Host-only; browser and transport-independent business contracts do not import it.

Focused tests pin anonymous rejection, callback lifetime, concurrent isolation, HTTP reserved-key rejection, WebSocket propagation, ordinary-profile compatibility, and Loader activation order.

A real Loader integration test mounts the shipped WebServer, Enterprise Postgres, enterprise auth, and Connection packages. With `DSH_TEST_POSTGRES_URL`, it observes `/auth/status` returning 200 and anonymous `/api` returning 401 after the enterprise dependency chain settles; its always-on ordinary-profile case observes `/api` returning the original 404 without enterprise services. Enterprise Postgres pool close is idempotent because Loader disposal may revisit the same asynchronous close boundary while dependents unload.
