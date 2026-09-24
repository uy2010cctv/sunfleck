# Extensions

English | [中文](extensions.zh.md)

The extensions subsystem lets an agent define versioned Cordis packages, run their host and browser halves, and query approved runtime metadata before writing code. Package lifecycle and sandbox behavior belong to the [`packages/extensions`](../../packages/extensions/README.md) package group.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxcordisgovernancecontroller--cordisgovernancecontroller"></a>

### `ctx.cordisGovernanceController` — `CordisGovernanceController`

Enterprise Cordis manager grants and emergency controls.

```ts cordis-catalog
/**
 * Read the configured managers for a department.
 * @param request - Department identity.
 * @returns manager set or null.
 */
@Remote('departmentManagers') async departmentManagers( request: CordisDepartmentManagersRequest, ): Promise<DepartmentManagerSet | null>

/**
 * Replace the configured managers for a department.
 * @param request - Members and CAS revision.
 * @returns updated manager set.
 */
@Remote('setDepartmentManagers') async setDepartmentManagers( request: CordisDepartmentManagersSaveRequest, ): Promise<DepartmentManagerSet>

/**
 * Emergency-disable an enterprise extension.
 * @param request - Binding, reason, and CAS data.
 * @returns disabled binding.
 */
@Remote('disable') async disable(request: CordisGovernanceDisableRequest): Promise<CordisScopeBinding>

/**
 * Roll an enterprise extension back to an immutable version.
 * @param request - Target version and CAS data.
 * @returns updated binding.
 */
@Remote('rollback') async rollback(request: CordisWorkspaceRollbackRequest): Promise<CordisScopeBinding>

/**
 * Change the execution trust of an organization extension.
 * @param request - Trust level, reason, and CAS data.
 * @returns updated binding.
 */
@Remote('setTrust') async setTrust(request: CordisGovernanceSetTrustRequest): Promise<CordisScopeBinding>
```

Source: [`packages/api/enterprise-controller/src/index.ts`](../../packages/api/enterprise-controller/src/index.ts)

<a id="ctxcordisinspect--cordisinspectregistryservice"></a>

### `ctx.cordisInspect` — `CordisInspectRegistryService`

Registry and cross-page router behind the two model-facing inspect tools.

```ts cordis-catalog
/**
 * Register one Host provider.
 * @param registration - manifest and local query handler.
 * @returns idempotent disposer.
 */
register(registration: HostCordisInspectProviderRegistration): () => void

/**
 * Replace the mirrored Client provider directory.
 * @param providers - complete Client manifest snapshot.
 */
syncClientManifest(providers: readonly CordisInspectProviderManifest[]): void

/**
 * Return the complete known Host and Client provider directory.
 * @returns Host providers followed by the Client providers.
 */
list(): CordisInspectProviderView[]

/**
 * Execute one provider query on its owning platform.
 * @param platform - Host or Client runtime.
 * @param providerId - provider selected from {@link list}.
 * @param methodName - declared method name.
 * @param input - optional lossless JSON input.
 * @param agent - requesting Agent and scope.
 * @param signal - tool-call cancellation.
 * @returns provider JSON data.
 */
async query( platform: CordisInspectPlatform, providerId: string, methodName: string, input: JsonValue | undefined, agent: Agent, signal: AbortSignal, ): Promise<JsonValue>

/**
 * Accept the first valid Client response for a pending query.
 * @param agent - Agent whose Session owns the query.
 * @param requestId - Pending Client query identity.
 * @param resolution - Client provider result or failure.
 * @returns whether this response settled the still-pending query.
 */
resolveClientQuery( agent: Agent, requestId: CordisInspectRequestId, resolution: CordisInspectQueryResolution, ): CordisInspectResolveAck
```

Types: [Agent](core.md)

Source: [`packages/extensions/cordis-host-runner/src/inspect-registry.ts`](../../packages/extensions/cordis-host-runner/src/inspect-registry.ts)

<a id="ctxcordisreviewcontroller--cordisreviewcontroller"></a>

### `ctx.cordisReviewController` — `CordisReviewController`

Department review, derived modification, and organization publication Remote service.

```ts cordis-catalog
/**
 * List Cordis reviews visible to the caller.
 * @param request - Optional review-status filter.
 * @returns visible review requests.
 */
@Remote('list') async list(request: CordisReviewListRequest): Promise<readonly CordisReviewRequest[]>

/**
 * Submit a department Package for manager review.
 * @param request - Draft, Workspace, and source Session data.
 * @returns created review.
 */
@Remote('submit') async submit(request: CordisReviewSubmitRequest): Promise<CordisReviewRequest>

/** Submit an owned saved version from a department Workspace for review.
 * @param request - saved Package and Workspace identity.
 * @returns pending review.
 */
@Remote('submitSaved') async submitSaved(request: CordisReviewSubmitSavedRequest): Promise<CordisReviewRequest>

/**
 * Derive a manager-edited immutable Package.
 * @param request - Review, draft, and CAS data.
 * @returns derived Package and review revision.
 */
@Remote('derive') async derive(request: CordisReviewDeriveRequest): Promise<DerivedCordisPackage>

/**
 * Approve a Package for department activation.
 * @param request - Review transition and reason.
 * @returns updated review.
 */
@Remote('approveDepartment') async approveDepartment( request: CordisReviewTransitionRequest, ): Promise<CordisReviewRequest>

/**
 * Return a review to its author.
 * @param request - Review transition and reason.
 * @returns updated review.
 */
@Remote('return') async returnToAuthor(request: CordisReviewTransitionRequest): Promise<CordisReviewRequest>

/**
 * Publish an approved department Package organization-wide.
 * @param request - Review Package and CAS data.
 * @returns publication result.
 */
@Remote('publishOrganization') async publishOrganization( request: CordisReviewPublishRequest, ): Promise<PublishedCordisReview>
```

Source: [`packages/api/enterprise-controller/src/index.ts`](../../packages/api/enterprise-controller/src/index.ts)

<a id="ctxcordisworkspacecontroller--cordisworkspacecontroller"></a>

### `ctx.cordisWorkspaceController` — `CordisWorkspaceController`

Personal and department Workspace Cordis extension Remote service.

```ts cordis-catalog
/**
 * List Cordis Packages and active bindings visible to a Workspace.
 * @param request - Workspace identity.
 * @returns visible extension projection.
 */
@Remote('list') async list(request: CordisWorkspaceListRequest): Promise<CordisWorkspaceProjection>

/**
 * Persist a personal Workspace Package version.
 * @param request - Package draft and idempotency data.
 * @returns immutable Package version.
 */
@Remote('save') async save(request: CordisWorkspaceSaveRequest): Promise<CordisPackageVersion>

/** Archive one owner-private Plugin while retaining its immutable versions.
 * @param request - Workspace, Plugin, and idempotency key.
 * @returns archived Plugin state.
 */
@Remote('archive') async archive(request: CordisWorkspaceArchiveRequest): Promise<CordisPluginArchive>

/** Restore one archived owner-private Plugin without activating it.
 * @param request - Workspace, Plugin, and idempotency key.
 * @returns restored Plugin state.
 */
@Remote('restore') async restore(request: CordisWorkspaceArchiveRequest): Promise<CordisPluginArchive>

/**
 * Activate a personal Workspace Package.
 * @param request - Package, Workspace, and CAS data.
 * @returns updated scope binding.
 */
@Remote('activate') async activate(request: CordisWorkspaceActivateRequest): Promise<CordisScopeBinding>

/**
 * Stop an active Workspace extension.
 * @param request - Binding, reason, and CAS data.
 * @returns disabled binding.
 */
@Remote('stop') async stop(request: CordisWorkspaceStopRequest): Promise<CordisScopeBinding>

/**
 * Roll a Workspace extension back to an immutable version.
 * @param request - Target version and CAS data.
 * @returns updated binding.
 */
@Remote('rollback') async rollback(request: CordisWorkspaceRollbackRequest): Promise<CordisScopeBinding>

/**
 * Pin the visible extension Generation for a Session.
 * @param request - Workspace and Session identity.
 * @returns immutable Session Generation.
 */
@Remote('pinGeneration') async pinGeneration( request: CordisWorkspacePinGenerationRequest, ): Promise<CordisSessionGeneration>
```

Source: [`packages/api/enterprise-controller/src/index.ts`](../../packages/api/enterprise-controller/src/index.ts)

<a id="ctxdynamiccordisrunner--dynamiccordisrunnerservice"></a>

### `ctx.dynamicCordisRunner` — `DynamicCordisRunnerService`

Dynamic Plugin registry and Host-half lifecycle.

```ts cordis-catalog
/**
 * Define a new Plugin's first Package or append a Package to an existing Plugin.
 * @param request - Session ownership, Plugin selection, metadata, and source code.
 * @returns Host-minted Plugin and Package identities with declared-half metadata.
 */
define(request: DynamicCordisDefineRequest): DynamicCordisDefineReceipt

/**
 * Restore one Package whose enterprise scope binding already records user or
 * governance approval. This suppresses duplicate Client approval and selects
 * either the isolated Realm or the explicitly trusted in-process executor.
 * @param request - immutable source, Session identity, and approved execution mode.
 * @returns restored dynamic Plugin and Package identities.
 */
restoreApproved(request: DynamicCordisRestoreRequest): DynamicCordisDefineReceipt

/**
 * Remove a Plugin, its active run, and all immutable Packages.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - Stable Plugin identity to remove.
 * @returns Whether removal succeeded and whether it stopped an active run.
 */
async undefine(agent: Agent, pluginId: CordisDynamicPluginId): Promise<DynamicCordisUndefineReceipt>

/**
 * Remove a Plugin from the user panel and queue the resulting state change for the model's next step.
 * @param agent - Agent whose Session owns the Plugin and receives the context.
 * @param pluginId - Stable Plugin identity to remove.
 * @returns Whether removal succeeded and whether it stopped an active run.
 */
@Remote('undefineFromPanel') async undefineFromPanel(agent: Agent, pluginId: CordisDynamicPluginId): Promise<DynamicCordisUndefineReceipt>

/**
 * Start or update one Package for a model tool call. An unauthorized Client
 * Package waits for approval; Plugin-wide authorization covers later versions.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - Stable Plugin identity to activate.
 * @param packageId - Immutable Package version to activate.
 * @param mode - Whether to run the current version or switch versions.
 * @param signal - Tool-call cancellation signal while the activation request is being created.
 * @returns The successful activation identity or an actionable refusal.
 */
async run( agent: Agent, pluginId: CordisDynamicPluginId, packageId: CordisDynamicPackageId, mode: CordisDynamicRunMode, signal?: AbortSignal, ): Promise<DynamicCordisRunResponse>

/**
 * Start Host code for an approved request or a direct panel gesture.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - Stable Plugin identity to activate.
 * @param packageId - Immutable Package version to activate.
 * @param mode - Whether to run the current version or switch versions.
 * @param requestId - Model-driven request identity, or null for a direct user gesture.
 * @param approveFutureVersions - Whether this approval covers later Packages of the same Plugin.
 * @returns The exact Host activation or a failure message.
 */
@Remote('runHostHalf') async runHostHalf( agent: Agent, pluginId: CordisDynamicPluginId, packageId: CordisDynamicPackageId, mode: CordisDynamicRunMode, requestId: ApprovalRequestId | null, approveFutureVersions: boolean, ): Promise<DynamicCordisHostHalfResult>

/**
 * Fetch Client code for the exact active run.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - Stable Plugin identity to read.
 * @param pluginRunId - Exact active run authorized to receive source.
 * @returns Client source and its Plugin, Package, and run identities.
 */
@Remote('getClientCode') getClientCode( agent: Agent, pluginId: CordisDynamicPluginId, pluginRunId: CordisDynamicPluginRunId, ): DynamicCordisClientSource

/**
 * Resolve one model-driven Client activation request.
 * @param requestId - Request identity to settle once.
 * @param resolution - Browser refusal or exact Client activation result.
 * @returns Whether the still-pending request accepted this resolution.
 */
@Remote('resolveRequestRun') async resolveRequestRun( requestId: ApprovalRequestId, resolution: DynamicCordisRunResolution, ): Promise<DynamicCordisResolveAck>

/**
 * Settle a direct panel run after this page loaded or failed its Client half.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - Stable Plugin identity being settled.
 * @param resolution - Exact Client activation result from the acting page.
 * @returns The committed activation or its failure.
 */
@Remote('settleUserRun') async settleUserRun( agent: Agent, pluginId: CordisDynamicPluginId, resolution: DynamicCordisRunResolution, ): Promise<DynamicCordisRunResponse>

/**
 * Stop the active run while retaining every Package version.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - Stable Plugin identity to stop.
 * @returns Success or the reason no run was stopped.
 */
async stop(agent: Agent, pluginId: CordisDynamicPluginId): Promise<DynamicCordisStopResponse>

/**
 * Stop a Plugin from the user panel and queue the resulting state change for the model's next step.
 * @param agent - Agent whose Session owns the Plugin and receives the context.
 * @param pluginId - Stable Plugin identity to stop.
 * @returns Success or the reason no run was stopped.
 */
@Remote('stopFromPanel') async stopFromPanel(agent: Agent, pluginId: CordisDynamicPluginId): Promise<DynamicCordisStopResponse>

/**
 * Replace the Host mirror of the Client inspect provider directory.
 * @param providers - complete Client provider manifest.
 * @returns null after accepting the manifest.
 */
@Remote('syncInspectManifest') syncInspectManifest(providers: readonly CordisInspectProviderManifest[]): null

/**
 * Claim one pending Client inspect query with its live result.
 * @param agent - Session that owns the query.
 * @param requestId - exact pending query identity.
 * @param resolution - provider result or structured refusal.
 * @returns whether this answer won the query.
 */
@Remote('resolveInspectQuery') resolveInspectQuery( agent: Agent, requestId: CordisInspectRequestId, resolution: CordisInspectQueryResolution, ): CordisInspectResolveAck

/**
 * Frame-wide inventory, grouped as one row per stable Plugin.
 * @returns Source-free metadata for every process-local Plugin.
 */
@Remote('inventory') inventory(): DynamicCordisInventoryRow[]

/**
 * Read one Session's Host-rich state for inspection and result rendering.
 * @param agent - Agent whose Session selects visible Plugins.
 * @returns Plugin versions, active runs, Host fibers, and render failures.
 */
snapshot(agent: Agent): DynamicCordisSnapshotRow[]

/**
 * Read source-free context for an explicit `@pluginId` user gesture.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - Stable Plugin identity referenced by the user.
 * @returns The preferred modification base, or undefined when unavailable.
 */
reference(agent: Agent, pluginId: CordisDynamicPluginId): DynamicCordisReference | undefined

/**
 * List source-free Plugin summaries owned by one Session.
 * @param agent - Agent whose Session selects visible Plugins.
 * @returns one summary per Plugin in creation order.
 */
listPlugins(agent: Agent): DynamicCordisPluginInspection[]

/**
 * Inspect one Plugin without returning Package source.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - stable Plugin identity.
 * @returns version pointers, latest run, and all Package summaries.
 */
inspectPlugin(agent: Agent, pluginId: CordisDynamicPluginId): DynamicCordisPluginInspection

/**
 * Read one exact immutable Package and its Host and Client source.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - Stable Plugin identity that owns the Package.
 * @param packageId - Exact immutable Package identity to inspect.
 * @returns Package metadata, source, and the Plugin's lifecycle pointers.
 */
inspectPackage( agent: Agent, pluginId: CordisDynamicPluginId, packageId: CordisDynamicPackageId, ): DynamicCordisPackageInspection

/**
 * Record a post-load render failure for the exact active run.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - Stable Plugin identity that rendered.
 * @param pluginRunId - Exact active run that produced the failure.
 * @param failure - Slot, message, and entry-retirement result.
 * @returns Null after recording or ignoring a stale report.
 */
@Remote('reportRenderFailure') async reportRenderFailure( agent: Agent, pluginId: CordisDynamicPluginId, pluginRunId: CordisDynamicPluginRunId, failure: DynamicCordisRenderFailure, ): Promise<null>

/**
 * Report a Client guard rejection that happened after the Package completed activation.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - Stable Plugin identity whose Client code was rejected.
 * @param pluginRunId - Exact active run that produced the rejection.
 * @param failure - Original guard message and stack.
 * @returns Null after reporting or ignoring a stale/startup failure.
 */
@Remote('reportClientGuardFailure') async reportClientGuardFailure( agent: Agent, pluginId: CordisDynamicPluginId, pluginRunId: CordisDynamicPluginRunId, failure: CordisErrorDetails, ): Promise<null>

/**
 * Invoke an active Host method while rejecting stale Client runs.
 * @param pluginId - Stable Plugin identity that owns the method.
 * @param pluginRunId - Exact active run authorizing the call.
 * @param method - Registered Host handler name.
 * @param args - JSON argument delivered to the handler.
 * @returns The JSON result or a typed invocation failure.
 */
@Remote('invoke') async invoke( pluginId: CordisDynamicPluginId, pluginRunId: CordisDynamicPluginRunId, method: string, args: JsonValue, ): Promise<DynamicCordisInvokeResult>
```

Types: [Agent](core.md)

Source: [`packages/extensions/cordis-host-runner/src/index.ts`](../../packages/extensions/cordis-host-runner/src/index.ts)

<a id="ctxenterprisecordis--enterprisecordisservice"></a>

### `ctx.enterpriseCordis` — `EnterpriseCordisService`

Governs immutable enterprise Cordis Packages, bindings, reviews, and Session Generations.

```ts cordis-catalog
/**
 * Load one Package and hydrate its verified source artifact.
 * @param packageId - immutable Package identity.
 * @returns hydrated Package when it exists.
 */
async packageSource(packageId: string): Promise<CordisPackageVersion | undefined>

/**
 * Persist an immutable Package owned by a personal Workspace.
 * @param input - authenticated principal, Workspace, draft, and idempotency key.
 * @returns saved Package version.
 */
async savePersonal(input: { principal: EnterpriseCordisPrincipal workspaceId: string draft: CordisPackageDraft idempotencyKey: string }): Promise<CordisPackageVersion>

/**
 * Activate a personal Workspace Package using revision compare-and-swap.
 * @param input - principal, Workspace, Package, revision, and idempotency data.
 * @returns updated personal binding.
 */
async activatePersonal(input: { principal: EnterpriseCordisPrincipal workspaceId: string pluginId: string packageId: string expectedRevision: number idempotencyKey: string }): Promise<CordisScopeBinding>

/** Hide a private Plugin and stop its binding while retaining every immutable version.
 * @param input - authenticated owner, Workspace, Plugin, and idempotency key.
 * @returns the archived Plugin state.
 */
async archivePersonal(input: { principal: EnterpriseCordisPrincipal workspaceId: string pluginId: string idempotencyKey: string }): Promise<CordisPluginArchive>

/** Restore a previously archived private Plugin without reactivating its binding.
 * @param input - authenticated owner, Workspace, Plugin, and idempotency key.
 * @returns restored Plugin state.
 */
async restorePersonal(input: { principal: EnterpriseCordisPrincipal workspaceId: string pluginId: string idempotencyKey: string }): Promise<CordisPluginArchive>

/**
 * Submit a department Workspace Package for manager review.
 * @param input - principal, Workspace, source Session, draft, and idempotency data.
 * @returns created review request.
 */
async submitDepartment(input: { principal: EnterpriseCordisPrincipal workspaceId: string draft: CordisPackageDraft sourceSessionId: string idempotencyKey: string }): Promise<CordisReviewRequest>

/** Submit an existing owner-private version in a department Workspace without activating it for members.
 * @param input - owner, Workspace, saved version, and idempotency key.
 * @returns pending department review.
 */
async submitSavedDepartment(input: { principal: EnterpriseCordisPrincipal workspaceId: string packageId: string idempotencyKey: string }): Promise<CordisReviewRequest>

/**
 * Create an immutable manager-derived Package for an existing review.
 * @param input - principal, review, revised draft, CAS revision, and idempotency data.
 * @returns derived Package and new review revision.
 */
async deriveReview(input: { principal: EnterpriseCordisPrincipal reviewId: string expectedRevision: number draft: CordisPackageDraft idempotencyKey: string }): Promise<DerivedCordisPackage>

/**
 * Approve a Package for department use or return it to its author.
 * @param input - principal, review transition, reason, CAS revision, and idempotency data.
 * @returns updated review request.
 */
async reviewDepartment(input: { principal: EnterpriseCordisPrincipal reviewId: string packageId: string action: 'approve_department' | 'return_to_author' reason: string expectedRevision: number idempotencyKey: string }): Promise<CordisReviewRequest>

/**
 * Publish a validated department Package as the organization binding.
 * @param input - principal, review Package, CAS revision, and idempotency data.
 * @returns publication result and organization binding.
 */
async publishOrganization(input: { principal: EnterpriseCordisPrincipal reviewId: string packageId: string expectedRevision: number idempotencyKey: string }): Promise<PublishedCordisReview>

/**
 * Emergency-disable a binding as an enterprise administrator.
 * @param input - principal, binding, reason, CAS revision, and idempotency data.
 * @returns disabled binding.
 */
async emergencyDisable(input: { principal: EnterpriseCordisPrincipal bindingId: string expectedRevision: number reason: string idempotencyKey: string }): Promise<CordisScopeBinding>

/**
 * Stop a binding within the caller's governed scope.
 * @param input - principal, binding, reason, CAS revision, and idempotency data.
 * @returns disabled binding.
 */
async stopBinding(input: { principal: EnterpriseCordisPrincipal bindingId: string expectedRevision: number reason: string idempotencyKey: string }): Promise<CordisScopeBinding>

/**
 * Roll a private binding to an older Package or resume a governed binding's approved Package.
 * @param input - principal, binding, Package, reason, CAS revision, and idempotency data.
 * @returns updated binding.
 */
async rollbackBinding(input: { principal: EnterpriseCordisPrincipal bindingId: string packageId: string expectedRevision: number reason: string idempotencyKey: string }): Promise<CordisScopeBinding>

/**
 * Set isolated or trusted in-process execution for an organization binding.
 * @param input - administrator principal, binding, trust level, reason, and CAS data.
 * @returns updated organization binding.
 */
async setTrust(input: { principal: EnterpriseCordisPrincipal bindingId: string trustLevel: CordisScopeBinding['trustLevel'] expectedRevision: number reason: string idempotencyKey: string }): Promise<CordisScopeBinding>

/**
 * Capture the visible active bindings for one Session exactly once.
 * @param input - principal, Workspace, and Session identity.
 * @returns immutable Session Generation.
 */
async pinSessionGeneration(input: { principal: EnterpriseCordisPrincipal workspaceId: string sessionId: string }): Promise<CordisSessionGeneration>

/**
 * Replace a department's manager set after membership validation.
 * @param input - administrator principal, department members, CAS revision, and idempotency data.
 * @returns updated department manager set.
 */
async setDepartmentManagers(input: { principal: EnterpriseCordisPrincipal departmentId: string managerUserIds: readonly string[] expectedRevision: number idempotencyKey: string }): Promise<DepartmentManagerSet>

/**
 * Read a department's manager set.
 * @param orgId - owning organization.
 * @param departmentId - department identity.
 * @returns manager set when configured.
 */
async departmentManagers(orgId: string, departmentId: string): Promise<DepartmentManagerSet | undefined>

/**
 * List Packages and bindings visible to a governed Workspace.
 * @param input - principal and Workspace identity.
 * @returns visible extension projection.
 */
async listWorkspace(input: { principal: EnterpriseCordisPrincipal workspaceId: string }): Promise<CordisWorkspaceProjection>

/**
 * List reviews authored by or governed by the caller.
 * @param input - authenticated principal.
 * @returns visible review requests.
 */
async listReviews(input: { principal: EnterpriseCordisPrincipal }): Promise<readonly CordisReviewRequest[]>

/**
 * Append an explicit Cordis governance audit event.
 * @param event - immutable audit record.
 * @returns when the event has been persisted.
 */
async audit(event: EnterpriseCordisAuditEvent): Promise<void>
```

Source: [`packages/enterprise/enterprise-cordis/src/service.ts`](../../packages/enterprise/enterprise-cordis/src/service.ts)

<a id="ctxinspector--inspectorservice"></a>

### `ctx.inspector` — `InspectorService`

Shared Host/Client service façade over the realm's source publisher.

```ts cordis-catalog
/**
 * Publish one JSON observation without waiting for Worker delivery.
 * @param topic - Domain-owned topic name.
 * @param payload - JSON value validated before it reaches the carrier.
 * @param monotonicMs - Source-clock timestamp; defaults to `performance.now()`.
 */
publish(topic: string, payload: InspectorJsonValue, monotonicMs?: number): void
```

Source: [`packages/experimental/inspector/src/index.ts`](../../packages/experimental/inspector/src/index.ts)

<a id="cordis-events"></a>

### `cordis/*` events

<a id="cordisdynamic-package--emit"></a>

#### `cordis/dynamic-package` — emit

One exact Plugin/Package activation is now live in the Host.

```ts cordis-catalog
/**
 * One exact Plugin/Package activation is now live in the Host.
 * @param pkg - stable plugin, immutable package, run identity, and label.
 * @mode emit
 */
'cordis/dynamic-package'(pkg: DynamicCordisPackage): void
```

Source: [`packages/extensions/cordis-host-runner/src/types.ts`](../../packages/extensions/cordis-host-runner/src/types.ts)

<a id="cordisdynamic-retract--emit"></a>

#### `cordis/dynamic-retract` — emit

One exact activation was withdrawn.

```ts cordis-catalog
/**
 * One exact activation was withdrawn.
 * @param retracted - plugin, package, and run identity.
 * @mode emit
 */
'cordis/dynamic-retract'(retracted: DynamicCordisRetracted): void
```

Source: [`packages/extensions/cordis-host-runner/src/types.ts`](../../packages/extensions/cordis-host-runner/src/types.ts)

<a id="cordisinspect-query--emit"></a>

#### `cordis/inspect-query` — emit

Request a live read-only query from the Client inspect registry.

```ts cordis-catalog
/**
 * Request a live read-only query from the Client inspect registry.
 * @param request - correlation, Session, provider, method, and JSON input.
 * @mode emit
 */
'cordis/inspect-query'(request: CordisInspectQueryRequest): void
```

Source: [`packages/extensions/cordis-host-runner/src/types.ts`](../../packages/extensions/cordis-host-runner/src/types.ts)

<a id="cordisinspect-query-resolved--emit"></a>

#### `cordis/inspect-query-resolved` — emit

Notify every Client that an inspect query has settled or been cancelled.

```ts cordis-catalog
/**
 * Notify every Client that an inspect query has settled or been cancelled.
 * @param resolved - exact query identity that is no longer answerable.
 * @mode emit
 */
'cordis/inspect-query-resolved'(resolved: CordisInspectQueryResolved): void
```

Source: [`packages/extensions/cordis-host-runner/src/types.ts`](../../packages/extensions/cordis-host-runner/src/types.ts)

<a id="cordisrequest-run--emit"></a>

#### `cordis/request-run` — emit

A Client-bearing activation needs a browser page, and may require a user decision.

```ts cordis-catalog
/**
 * A Client-bearing activation needs a browser page, and may require a user decision.
 * @param request - correlation identity, owner, target version, mode, and approval requirement.
 * @mode emit
 */
'cordis/request-run'(request: DynamicCordisRunRequest): void
```

Source: [`packages/extensions/cordis-host-runner/src/types.ts`](../../packages/extensions/cordis-host-runner/src/types.ts)

<a id="cordisrequest-run-resolved--emit"></a>

#### `cordis/request-run-resolved` — emit

A pending Client activation request left the answerable state.

```ts cordis-catalog
/**
 * A pending Client activation request left the answerable state.
 * @param resolved - request identity and outcome.
 * @mode emit
 */
'cordis/request-run-resolved'(resolved: DynamicCordisRequestResolved): void
```

Source: [`packages/extensions/cordis-host-runner/src/types.ts`](../../packages/extensions/cordis-host-runner/src/types.ts)

<a id="enterprise-events"></a>

### `enterprise/*` events

<a id="enterprisecordis-department-activated--emit"></a>

#### `enterprise/cordis-department-activated` — emit

A validated Package became the active department binding.

```ts cordis-catalog
/**
 * A validated Package became the active department binding.
 * @param event - Activated Package, scope, actor, and organization correlation data.
 * @mode emit
 */
'enterprise/cordis-department-activated'(event: EnterpriseCordisEvent): void
```

Source: [`packages/enterprise/enterprise-cordis/src/service.ts`](../../packages/enterprise/enterprise-cordis/src/service.ts)

<a id="enterprisecordis-organization-published--emit"></a>

#### `enterprise/cordis-organization-published` — emit

A validated Package became the active organization binding.

```ts cordis-catalog
/**
 * A validated Package became the active organization binding.
 * @param event - Published Package, scope, actor, and organization correlation data.
 * @mode emit
 */
'enterprise/cordis-organization-published'(event: EnterpriseCordisEvent): void
```

Source: [`packages/enterprise/enterprise-cordis/src/service.ts`](../../packages/enterprise/enterprise-cordis/src/service.ts)

<a id="enterprisecordis-package-saved--emit"></a>

#### `enterprise/cordis-package-saved` — emit

An immutable enterprise Cordis Package version was persisted.

```ts cordis-catalog
/**
 * An immutable enterprise Cordis Package version was persisted.
 * @param event - Package, scope, actor, and organization correlation data.
 * @mode emit
 */
'enterprise/cordis-package-saved'(event: EnterpriseCordisEvent): void
```

Source: [`packages/enterprise/enterprise-cordis/src/service.ts`](../../packages/enterprise/enterprise-cordis/src/service.ts)

<a id="enterprisecordis-plugin-disabled--emit"></a>

#### `enterprise/cordis-plugin-disabled` — emit

An enterprise Cordis binding was stopped by governance.

```ts cordis-catalog
/**
 * An enterprise Cordis binding was stopped by governance.
 * @param event - Disabled Package, scope, actor, and organization correlation data.
 * @mode emit
 */
'enterprise/cordis-plugin-disabled'(event: EnterpriseCordisEvent): void
```

Source: [`packages/enterprise/enterprise-cordis/src/service.ts`](../../packages/enterprise/enterprise-cordis/src/service.ts)

<a id="enterprisecordis-review-requested--emit"></a>

#### `enterprise/cordis-review-requested` — emit

A department Cordis Package entered manager review.

```ts cordis-catalog
/**
 * A department Cordis Package entered manager review.
 * @param event - Review target, actor, and organization correlation data.
 * @mode emit
 */
'enterprise/cordis-review-requested'(event: EnterpriseCordisEvent): void
```

Source: [`packages/enterprise/enterprise-cordis/src/service.ts`](../../packages/enterprise/enterprise-cordis/src/service.ts)

<a id="enterprisecordis-review-updated--emit"></a>

#### `enterprise/cordis-review-updated` — emit

A Cordis review changed status or selected a derived Package.

```ts cordis-catalog
/**
 * A Cordis review changed status or selected a derived Package.
 * @param event - Review target, actor, and organization correlation data.
 * @mode emit
 */
'enterprise/cordis-review-updated'(event: EnterpriseCordisEvent): void
```

Source: [`packages/enterprise/enterprise-cordis/src/service.ts`](../../packages/enterprise/enterprise-cordis/src/service.ts)

<a id="enterprisecordis-run-health-updated--emit"></a>

#### `enterprise/cordis-run-health-updated` — emit

The observed health of an enterprise Cordis run changed.

```ts cordis-catalog
/**
 * The observed health of an enterprise Cordis run changed.
 * @param event - Run health, Package, scope, and organization correlation data.
 * @mode emit
 */
'enterprise/cordis-run-health-updated'(event: EnterpriseCordisEvent): void
```

Source: [`packages/enterprise/enterprise-cordis/src/service.ts`](../../packages/enterprise/enterprise-cordis/src/service.ts)
<!-- END GENERATED cordis-surface -->
