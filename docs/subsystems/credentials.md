# User Credentials

English | [中文](credentials.zh.md)

The credential seam of [dsh-credentials](../../packages/credentials/credentials) keeps secrets out of configuration: settings sections and `cordis.yml` entries carry *references* (environment-variable names), providers such as [dsh-credentials-local](../../packages/credentials/credentials-local) own the values, and consumers resolve a reference once per operation — the LLM adapters resolve once per model request, so a rotated credential reaches the very next request without any restart. One seam-wide rule binds every provider: an empty stored value is absent everywhere.

Source: [`packages/credentials/credentials/src/index.ts`](../../packages/credentials/credentials/src/index.ts)

## Identity

A reference names one credential as a POSIX-style environment-variable name. The brand prevents callers from mixing credential references with other strings passed between packages or processes; construction validates the shell-identifier syntax.

```ts type-equiv
/** Nominal reference to one credential: a POSIX-style environment-variable name. */
type CredentialRef = Branded<'CredentialRef'>
```

## Resolution

`resolve(ref)` returns the value with the provider-defined source layer that supplied it, or `undefined` while unconfigured. Consumers re-resolve at each operation and never cache across operations — that per-operation read is the hot-update mechanism.

```ts type-equiv
/** One resolved credential value and the source layer that supplied it. */
interface ResolvedCredential {
  /** The non-empty secret value. */
  value: string
  /** Provider-defined source layer id (the local provider uses `env`, `file`, `project-env`, and `user-env`). */
  source: string
}
```

## Description

`describe(ref)` answers configuration surfaces without ever exposing a value: whether the reference resolves, from which layer, and whether `set` would currently succeed. The local provider reports a reference supplied by the live process environment as `writable: false` — a write would appear to succeed while resolution kept returning the shadowing value, so the seam rejects it and the UI can render the reference read-only up front.

```ts type-equiv
/**
 * Source and writability facts for one reference, safe for configuration UIs —
 * never the value. The view has no slot a value could ride in, which is what
 * lets the whole read half cross the Remote wire.
 */
interface CredentialInfo {
  /** Whether resolving the reference would currently return a value. */
  configured: boolean
  /** Source layer currently supplying the value; absent while unconfigured. */
  source?: string
  /** Whether the active provider can write this reference. */
  writable: boolean
}
```

## Change commits

`credentials/reference-updated (ref)` fires after a committed change to a provider-managed source — a `set`, an `unset`, or an external edit observed in storage. Ambient process-environment changes are not observable and never emit. Consumers do not need the event (they re-resolve per operation); it exists for configuration surfaces refreshing a "configured" badge.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxauthorization--authorizationservice"></a>

### `ctx.authorization` — `AuthorizationService`

`ctx.authorization`: a registry of credential-obtaining flows, one attempt at a time per key.

```ts cordis-catalog
/**
 * Offer a way to obtain one credential. One flow per key: two plugins
 * claiming the same key would each write a record in their own format, and
 * whichever ran last would leave the other reading a payload it cannot parse.
 *
 * @param flow - the key it writes, its label, its methods, and its runner.
 * @returns Disposer that withdraws this flow.
 * @throws {AuthorizationError} code `DUPLICATE_FLOW` when the key is already claimed.
 */
registerFlow(flow: AuthorizationFlow): () => void

/**
 * Every registered flow, for a surface listing what can be authorized.
 * @returns one entry per flow, in registration order.
 */
list(): readonly AuthorizationEntry[]

/**
 * One registered flow.
 * @param key - the credential record to ask about.
 * @returns the entry, or undefined when no flow claims that key.
 */
describe(key: CredentialKey): AuthorizationEntry | undefined

/**
 * Withdraw the attempt running for a key, if any. Separate from the
 * request's own signal because a request/response transport answers a Cancel
 * button on a second call, with no handle on the first one's signal.
 * @param key - the credential record whose attempt should stop.
 */
cancel(key: CredentialKey): void

/**
 * Run one attempt to authorize a key, and report how it ended.
 *
 * One attempt per key at a time. A second caller is refused rather than
 * joined: the two would be prompting different humans through the same flow,
 * and the second would answer questions the first was asked.
 *
 * @param request - the key, the method, the surface, and the cancel signal.
 * @returns `authorized` once the flow's record is committed during this
 *   attempt and observed, or `cancelled` when the human declined or the
 *   caller withdrew.
 * @throws {AuthorizationError} code `NO_FLOW` when nothing claims the key,
 *   `UNKNOWN_METHOD` when the named method is not one the flow offers,
 *   `ALREADY_IN_FLIGHT` when an attempt is already running for the key, or
 *   `NOT_COMMITTED` when the flow resolved without committing a record
 *   during the attempt.
 */
async begin(request: AuthorizationRequest): Promise<AuthorizationOutcome>
```

Source: [`packages/credentials/authorization/src/index.ts`](../../packages/credentials/authorization/src/index.ts)

<a id="ctxcredentials--credentialprovider-abstract-seam"></a>

### `ctx.credentials` — `CredentialProvider` (abstract seam)

Abstract credential service over two key spaces that answer two questions.

A CredentialRef answers "what is behind this environment-variable name", layered over the process environment, the provider-managed store, and `.env` files. One seam-wide rule binds that half: an empty stored value is absent everywhere — `resolve` skips it, `describe` reports it unconfigured — so a blank never masquerades as a configured secret.

A CredentialKey answers "what credential does this plugin hold for this id". Nothing can layer here — an authorization grant has no environment to be read from — so presence of the record is the whole fact, and modifyRecord is the only write path because a correct write depends on the current value (a token refresh is read-decide-replace under one lock).

```ts cordis-catalog
/**
 * Resolve one reference to its current value. Resolution is per call:
 * consumers re-resolve at each operation and must not cache across
 * operations — that per-operation read is what makes a changed credential
 * reach the next operation without a restart.
 * @param ref - the reference to resolve.
 * @returns the value and its source, or `undefined` while unconfigured.
 */
abstract resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined>

/**
 * Describe one reference for configuration surfaces without exposing the
 * value.
 * @param ref - the reference to describe.
 * @returns configured state, supplying source, and writability.
 */
abstract describe(ref: CredentialRef): Promise<CredentialInfo>

/**
 * Durably store one value in the provider-managed writable source. Rejects
 * while a read-only source shadows the reference — the write would appear
 * to succeed while resolution keeps returning the shadowing value — and
 * rejects an empty value (use {@link unset}).
 * @param ref - the reference to store.
 * @param value - the non-empty secret value.
 */
abstract set(ref: CredentialRef, value: string): Promise<void>

/**
 * Remove one reference from the provider-managed writable source; removing
 * an absent reference is a no-op. Rejects while a read-only source shadows
 * the reference, like {@link set}.
 * @param ref - the reference to remove.
 */
abstract unset(ref: CredentialRef): Promise<void>

/**
 * Read one stored record. The value is returned as its owner wrote it; a
 * {@link GrantRecord} payload is not interpreted on the way out.
 * @param key - the record to read.
 * @returns the record, or `undefined` while none is stored.
 */
abstract readRecord(key: CredentialKey): Promise<CredentialRecord | undefined>

/**
 * Describe one record for configuration surfaces without exposing its value.
 * @param key - the record to describe.
 * @returns presence, discriminant, and writability.
 */
abstract describeRecord(key: CredentialKey): Promise<CredentialRecordInfo>

/**
 * Enumerate every stored record's address and tag. Unlike the reference
 * half, which has no enumeration because configuration surfaces learn which
 * references exist from settings schemas, records have no such discovery
 * path: a surface that cannot list them cannot show what a user is
 * authorized for, nor find an orphan left by an uninstalled plugin.
 * @returns every stored record, values excluded.
 */
abstract listRecords(): Promise<readonly CredentialRecordEntry[]>

/**
 * Serialized read-modify-write over one record — the only write path.
 * `mutate` sees the record as it stands at the moment the write is
 * exclusive, and returning `undefined` leaves the entry untouched. Exclusion
 * holds across processes where the backing store supports it, which is what
 * makes a token refresh safe: two processes rotating one refresh token
 * concurrently would otherwise lose whichever wrote first.
 * @param key - the record to modify.
 * @param mutate - receives the current record and returns its replacement, or `undefined` to leave it.
 * @returns the record after the write, or the current one when `mutate` declined.
 */
abstract modifyRecord( key: CredentialKey, mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>, ): Promise<CredentialRecord | undefined>

/**
 * Remove one record; removing an absent record is a no-op.
 * @param key - the record to remove.
 */
abstract deleteRecord(key: CredentialKey): Promise<void>
```

Source: [`packages/credentials/credentials/src/index.ts`](../../packages/credentials/credentials/src/index.ts)

<a id="ctxcredentialscontroller--credentialscontroller"></a>

### `ctx.credentialsController` — `CredentialsController`

Host service backing the generated `ctx.remote.credentials` namespace. It carries every wire obligation the credential seam itself does not: the batch fan-out bound, the field-by-field view projection, the reference-grammar guard, and the refusal mapping. Secret values cross in one direction only — no method here returns one.

```ts cordis-catalog
/**
 * Describe several references for one configuration surface. Batched because
 * a settings page describes every reference its rows name at once, and one
 * round trip keeps those rows from settling separately.
 * @param refs - reference names, at most {@link MAX_DESCRIBE_REFS}; a name outside the grammar
 *   rejects the whole call as `gateway/bad-request`.
 * @returns one view per requested name, keyed by that name.
 * @throws RemoteError when the request is invalid or no credential provider is mounted.
 */
@Remote async describe(refs: string[]): Promise<Record<string, CredentialInfo>>

/**
 * Store one value from a configuration surface. The value crosses the wire in
 * this direction only: no read path returns it.
 * @param ref - reference name to store under.
 * @param value - the non-empty secret value.
 * @throws RemoteError when the request is invalid, no provider is mounted, or the provider refuses the write.
 */
@Remote async set(ref: string, value: string): Promise<void>

/**
 * Remove one reference from a configuration surface.
 * @param ref - reference name to remove.
 * @throws RemoteError when the request is invalid, no provider is mounted, or the provider refuses the write.
 */
@Remote async unset(ref: string): Promise<void>
```

Source: [`packages/api/settings-controller/src/credentials.ts`](../../packages/api/settings-controller/src/credentials.ts)

<a id="ctxenterpriserequestcontext--enterpriserequestcontext"></a>

### `ctx.enterpriseRequestContext` — `EnterpriseRequestContext`

Carries the server-authenticated principal through asynchronous Host work. Callers cannot establish a principal through an RPC payload; only the authenticated transport boundary invokes run.

```ts cordis-catalog
/**
 * Run one request callback with its authenticated principal.
 * @param principal - Principal established by the authenticated transport.
 * @param callback - Host work that may read the principal.
 * @returns the callback result.
 */
run<T>(principal: EnterprisePrincipal, callback: () => T): T

/**
 * Run Agent-owned work without inheriting the active authenticated Human.
 * @param callback - Work whose asynchronous descendants must carry no request principal.
 * @returns the callback result while the surrounding request store is restored afterwards.
 */
withoutPrincipal<T>(callback: () => T): T

/**
 * Return the principal for the active request, if any.
 * @returns the active principal, or `undefined` outside a live request.
 */
current(): EnterprisePrincipal | undefined

/**
 * Return the active principal or fail closed outside an authenticated request.
 * @returns the active authenticated principal.
 */
requirePrincipal(): EnterprisePrincipal

/** Clear every context store inherited by outstanding asynchronous work. */
disable(): void

/** Release this request-context instance during plugin disposal. */
dispose(): void
```

Source: [`packages/identity/enterprise-auth-web/src/request-context.ts`](../../packages/identity/enterprise-auth-web/src/request-context.ts)

<a id="ctxenterprisesecurity--enterprisesecurity"></a>

### `ctx.enterpriseSecurity` — `EnterpriseSecurity`

Central single-enterprise security service shared by HTTP, WebSocket, and admin APIs.

```ts cordis-catalog
/**
 * Authenticate one local account through a synchronous identity adapter.
 * @param orgId - Organization boundary named by the login form.
 * @param username - Organization-local username.
 * @param password - Plaintext presented only to the password verifier.
 * @returns the issued login result, or `undefined` for invalid credentials.
 */
loginLocal(orgId: string, username: string, password: string): LoginResult | undefined

/**
 * Issue one synchronous persistent login Session for an enabled user.
 * @param userId - Canonical enterprise user id.
 * @returns the issued token, cookie, and principal.
 */
issueSession(userId: string): LoginResult

/**
 * Resolve or provision one synchronous external identity and issue its login Session.
 * @param identity - Validated and mapped external identity.
 * @returns the issued token, cookie, and principal.
 */
loginExternal(identity: SsoMappedIdentity): LoginResult

/**
 * Authenticate one cookie through a synchronous identity adapter.
 * @param cookieHeader - Incoming Cookie header.
 * @returns the active principal, or `undefined` when unavailable.
 */
authenticateCookie(cookieHeader: string): EnterprisePrincipalView | undefined

/**
 * Revoke the synchronous login Session named by a cookie header.
 * @param cookieHeader - Incoming Cookie header.
 */
logout(cookieHeader: string): void

/**
 * Authenticate one local account through the production asynchronous adapter.
 * @param orgId - Organization boundary named by the login form.
 * @param username - Organization-local username.
 * @param password - Plaintext presented only to the password verifier.
 * @returns the issued login result, or `undefined` for invalid credentials.
 */
async loginLocalAsync(orgId: string, username: string, password: string): Promise<LoginResult | undefined>

/**
 * Issue one persistent login Session through the asynchronous identity adapter.
 * @param userId - Canonical enterprise user id.
 * @returns the issued token, cookie, and principal.
 */
async issueSessionAsync(userId: string): Promise<LoginResult>

/**
 * Resolve or provision an external identity through the asynchronous adapter.
 * @param identity - Validated and mapped external identity.
 * @returns the issued token, cookie, and principal.
 */
async loginExternalAsync(identity: SsoMappedIdentity): Promise<LoginResult>

/** Whether this principal may administer Host-level organization tenancy.
 * @param principal - authenticated enterprise principal.
 * @returns whether the principal has administrator authority in this Host organization.
 */
isPlatformAdministrator(principal: EnterprisePrincipal): boolean

/**
 * Authenticate one cookie through the asynchronous identity adapter.
 * @param cookieHeader - Incoming Cookie header.
 * @returns the active principal, or `undefined` when unavailable.
 */
async authenticateCookieAsync(cookieHeader: string): Promise<EnterprisePrincipalView | undefined>

/**
 * Revoke the asynchronous login Session named by a cookie header.
 * @param cookieHeader - Incoming Cookie header.
 */
async logoutAsync(cookieHeader: string): Promise<void>

/**
 * Resolve resource scope and authorize one asynchronous Host API operation.
 * @param principal - Authenticated caller.
 * @param endpoint - Closed Host API endpoint name.
 * @param input - Parsed request payload used only for resource addressing.
 * @returns the authorization decision and stable reason.
 */
async authorizeApiAsync(principal: EnterprisePrincipal, endpoint: string, input: unknown): Promise<EnterpriseAuthorizationDecision>

/** Authorize an already resolved enterprise resource through the shared hierarchy policy.
 * @param principal - Authenticated human or employee service principal.
 * @param action - Classified enterprise action.
 * @param resource - Resource organization, hierarchy scope, and visibility.
 * @returns The stable authorization decision.
 */
async authorizeResourceAsync( principal: EnterprisePrincipal, action: EnterpriseAction, resource?: EnterpriseResource, ): Promise<EnterpriseAuthorizationDecision>

/**
 * Project the native Workspace stream to the caller's personal and department grants.
 * Protected default and shared Workspaces explicitly carry `deletable: false`.
 * @param principal - authenticated stream owner.
 * @param frames - native Workspace baseline and increment stream.
 * @returns a principal-scoped Workspace stream.
 */
async *filterWorkspaceFollow( principal: EnterprisePrincipal, frames: AsyncIterable<unknown>, ): AsyncIterable<unknown>

/**
 * Project a Session list to rows created by the authenticated user.
 * @param principal - authenticated user whose Session ownership is enforced.
 * @param value - untrusted Session-list projection returned by the Host.
 * @returns the projection with non-owned Session rows removed.
 */
async filterSessionList(principal: EnterprisePrincipal, value: unknown): Promise<unknown>

/**
 * Project Host-wide queue, job, and projection frames to the current user's Sessions.
 * @param principal - authenticated user whose Session ownership is enforced.
 * @param frames - unfiltered Host control-frame stream.
 * @returns a stream containing only frames and Session slices the user owns.
 */
async *filterSessionControl( principal: EnterprisePrincipal, frames: AsyncIterable<unknown>, ): AsyncIterable<unknown>

/**
 * Decide whether one ordinary Session belongs to the authenticated user.
 * @param principal - authenticated user to compare with the Session owner.
 * @param sessionId - canonical Session identity.
 * @returns whether the Session is owned by that user.
 */
async sessionOwnedBy(principal: EnterprisePrincipal, sessionId: string): Promise<boolean>

/**
 * Persist the ownership grant for a Workspace created through the native API.
 * @param principal - authenticated creator.
 * @param result - native Workspace create result.
 */
async recordWorkspaceCreated(principal: EnterprisePrincipal, result: unknown): Promise<void>

/**
 * Bind a Session to a workspace only after the principal can create work in that compartment.
 * @param principal - Authenticated Session creator.
 * @param sessionId - Newly created DSH Session id.
 * @param workspaceId - Authorized DSH Workspace id.
 */
async bindSessionWorkspaceAsync( principal: EnterprisePrincipal, sessionId: string, workspaceId: string, ): Promise<void>

/**
 * Resolve the durable sandbox mode a newly bound Session must snapshot.
 * @param principal - Authenticated Session creator.
 * @param workspaceId - Authorized DSH Workspace id.
 * @returns the grant's bounded sandbox mode.
 */
async workspaceSandboxModeAsync( principal: EnterprisePrincipal, workspaceId: string, ): Promise<'read-only' | 'workspace-write'>

/**
 * Append one asynchronous Host API authorization decision to the audit sink.
 * @param principal - Authenticated caller.
 * @param endpoint - Closed Host API endpoint name.
 * @param input - Parsed request payload used only for resource addressing.
 * @param decision - Previously computed authorization decision.
 * @param correlationId - Request-scoped correlation identity.
 */
async auditApiAsync( principal: EnterprisePrincipal, endpoint: string, input: unknown, decision: EnterpriseApiAuditDecision, correlationId: string, ): Promise<void>

/**
 * Append an API audit decision with a Host-resolved resource address.
 * @param principal - Authenticated caller.
 * @param endpoint - Closed Host API endpoint name used to classify the action.
 * @param input - Parsed request fields used only for action classification.
 * @param decision - Previously computed authorization decision.
 * @param correlationId - Request or operation correlation identity.
 * @param resource - Explicit resource type, identity, and safe details.
 */
async auditApiResourceAsync( principal: EnterprisePrincipal, endpoint: string, input: unknown, decision: EnterpriseApiAuditDecision, correlationId: string, resource: EnterpriseApiAuditResource, ): Promise<void>

/**
 * Resolve resource scope and authorize one synchronous Host API operation.
 * @param principal - Authenticated caller.
 * @param endpoint - Closed Host API endpoint name.
 * @param input - Parsed request payload used only for resource addressing.
 * @returns the authorization decision and stable reason.
 */
authorizeApi(principal: EnterprisePrincipal, endpoint: string, input: unknown): EnterpriseAuthorizationDecision

/**
 * Append one synchronous Host API authorization decision to the audit sink.
 * @param principal - Authenticated caller.
 * @param endpoint - Closed Host API endpoint name.
 * @param input - Parsed request payload used only for resource addressing.
 * @param decision - Previously computed authorization decision.
 * @param correlationId - Request-scoped correlation identity.
 */
auditApi( principal: EnterprisePrincipal, endpoint: string, input: unknown, decision: EnterpriseAuthorizationDecision, correlationId: string, ): void
```

Source: [`packages/identity/enterprise-auth-web/src/security.ts`](../../packages/identity/enterprise-auth-web/src/security.ts)

<a id="authorization-events"></a>

### `authorization/*` events

<a id="authorizationsettled--emit"></a>

#### `authorization/settled` — emit

One authorization attempt has finished and released its key. Fires for every terminal outcome, failures included, so a surface watching a key it did not start (a second browser tab) learns the attempt is over.

```ts cordis-catalog
/**
 * One authorization attempt has finished and released its key. Fires for
 * every terminal outcome, failures included, so a surface watching a key it
 * did not start (a second browser tab) learns the attempt is over.
 * @mode emit
 * @param key - the credential record the finished attempt was authorizing.
 * @param settlement - how it ended, including the `failed` case its caller sees as a thrown error.
 */
'authorization/settled'(key: CredentialKey, settlement: AuthorizationSettlement): void
```

Source: [`packages/credentials/authorization/src/index.ts`](../../packages/credentials/authorization/src/index.ts)

<a id="credentials-events"></a>

### `credentials/*` events

<a id="credentialsrecord-updated--emit"></a>

#### `credentials/record-updated` — emit

Committed change to a stored credential record: a `modifyRecord` that wrote, a `deleteRecord` that removed, or an external edit observed in storage. Separate from `credentials/reference-updated` because the two key grammars are disjoint — a listener that received both on one event could not tell which space a subject belongs to. Listener failures are contained on the same terms as `credentials/reference-updated`.

```ts cordis-catalog
/**
 * Committed change to a stored credential record: a `modifyRecord` that
 * wrote, a `deleteRecord` that removed, or an external edit observed in
 * storage. Separate from `credentials/reference-updated` because the two key
 * grammars are disjoint — a listener that received both on one event could
 * not tell which space a subject belongs to. Listener failures are
 * contained on the same terms as `credentials/reference-updated`.
 * @param key - the record whose stored value changed.
 * @mode emit
 */
'credentials/record-updated'(key: CredentialKey): void
```

Source: [`packages/credentials/credentials/src/types.ts`](../../packages/credentials/credentials/src/types.ts)

<a id="credentialsreference-updated--emit"></a>

#### `credentials/reference-updated` — emit

Committed change to a provider-managed credential source: a `set`, an `unset`, or an external edit observed in storage. Ambient process-environment changes are not observable and never emit. Listener failures are contained and logged — a sync throw and an async rejection alike — without changing the committed operation's outcome, except `INVARIANT`-coded failures, which rethrow after every listener ran; that rethrow reaches the emitter only from synchronous listeners, so invariant checks on this event must not be async functions.

```ts cordis-catalog
/**
 * Committed change to a provider-managed credential source: a `set`, an
 * `unset`, or an external edit observed in storage. Ambient
 * process-environment changes are not observable and never emit. Listener
 * failures are contained and logged — a sync throw and an async rejection
 * alike — without changing the committed operation's outcome, except
 * `INVARIANT`-coded failures, which rethrow after every listener ran;
 * that rethrow reaches the emitter only from synchronous listeners, so
 * invariant checks on this event must not be async functions.
 * @param ref - the reference whose stored value changed.
 * @mode emit
 */
'credentials/reference-updated'(ref: CredentialRef): void
```

Source: [`packages/credentials/credentials/src/types.ts`](../../packages/credentials/credentials/src/types.ts)
<!-- END GENERATED cordis-surface -->
