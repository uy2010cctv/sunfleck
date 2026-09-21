/** Pure enterprise projection over existing DSH Preset, Session, and Workspace facts. */

import type { ClientRemote, PluginInventorySnapshot, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  EnterpriseApproval, EnterpriseAsset, EnterpriseAssetKind,
  EnterpriseBusinessState, EnterpriseEmployeeAssetRef, EnterpriseEmployeeDraft,
  EnterpriseChannelBindingSession, EnterpriseChannelBotInstallResult, EnterpriseChannelConfiguration, EnterpriseChannelPollBotInstallResult,
  EnterpriseEmployeeRelease, EnterpriseSchedule,
  EnterpriseScheduleTarget, EnterpriseTeam, EnterpriseTeamMember,
  EnterpriseTeamAutonomyGrant, EnterpriseTeamDecision, EnterpriseTeamDefinition, EnterpriseTeamRun,
  EnterpriseVisibility, EnterpriseWorkRecord as EnterpriseOperationWorkRecord,
  CordisPackageVersion, CordisReviewRequest, CordisScopeBinding, EnterpriseWorkPreparation, EnterpriseWorkPrepareRequest,
  EnterpriseWorkStartRequest, EnterpriseWorkStartValue,
  EnterpriseComputerUseRun, EnterpriseDeviceActionView, EnterpriseDeviceListRequest, EnterpriseDevicePairRequest, EnterpriseDeviceView,
  EnterpriseRecorderDeviceView,
} from '@deepseek-ai/dsh-api-enterprise-controller/types'
import type { AgentPresetRow } from '@deepseek-ai/dsh-agent-presets/types'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type {
  ISessions, SessionListState, SessionSummary,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces, WorkspaceSnapshot as WorkspaceListState } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** Operational state shown for one digital employee. */
export type EmployeeOperationalState = 'active' | 'attention' | 'ready' | 'unavailable'

/** Operational state shown for one work record. */
export type WorkRecordState = 'running' | 'attention' | 'completed' | 'ready'

/** Digital employee projected from one Agent Preset. */
export interface EnterpriseEmployeeView {
  readonly id: string
  readonly employeeCode: string
  readonly name: string
  readonly description?: string
  readonly position?: string
  readonly department?: string
  readonly capabilities: readonly string[]
  readonly status: EmployeeOperationalState
  readonly activeWork: number
  readonly recentWork: number
  readonly custom: boolean
  readonly isDefault: boolean
  readonly unavailableReason?: string
}

/** Session summary presented as an enterprise work record. */
export interface EnterpriseWorkRecord {
  readonly sessionId: SessionId
  readonly title: string
  readonly employeeId?: string
  readonly employeeName?: string
  readonly workspaceTitle?: string
  readonly state: WorkRecordState
  readonly updatedAt: number
}

/** Summary metrics derived without inventing business outcomes. */
export interface EnterpriseMetrics {
  readonly employees: number
  readonly active: number
  readonly attention: number
  readonly workRecords: number
  readonly workspaces: number
}

/** Complete read model for the enterprise workbench. */
export interface EnterpriseView {
  readonly employees: readonly EnterpriseEmployeeView[]
  readonly records: readonly EnterpriseWorkRecord[]
  readonly metrics: EnterpriseMetrics
}

/** Overlay-local route. Governance deliberately remains in Settings. */
export type EnterpriseWorkbenchPage =
  | 'employees' | 'devices' | 'work-records' | 'approvals' | 'attention'
  | 'schedules' | 'assets' | 'teams' | 'channels' | 'extensions'

/** Shared asynchronous page state for enterprise PostgreSQL read models. */
export interface EnterprisePageState<T> {
  readonly phase: 'idle' | 'loading' | 'ready' | 'error' | 'permission'
  readonly items: readonly T[]
  readonly nextCursor?: string
  readonly error: string | null
}

/** Server-owned roster filters. Empty fields are omitted from the request. */
export interface EnterpriseEmployeeFilters {
  readonly search?: string
  readonly status?: EnterpriseEmployeeDraft['status']
  readonly visibility?: EnterpriseVisibility
  readonly ownerUserId?: string
}

/** Editable fields projected from an employee draft profile. */
export interface EnterpriseEmployeeDraftFields {
  readonly presetId: string
  readonly avatarSeed?: string
  readonly name: string
  readonly description: string
  readonly position: string
  readonly department: string
  readonly prompt: string
  readonly modelRef: string
  readonly capabilities: readonly string[]
  readonly visibility: EnterpriseVisibility
  readonly bindings: readonly EnterpriseEmployeeAssetRef[]
}

/** Data used by `EnterpriseModelOption`. */
export interface EnterpriseModelOption {
  readonly value: string
  readonly provider: string
  readonly model: string
}

/** Explicit-save employee editor state. */
export interface EnterpriseEmployeeEditorState {
  readonly phase: 'loading' | 'ready' | 'error'
  readonly fields?: EnterpriseEmployeeDraftFields
  readonly revision?: number
  readonly releases: readonly EnterpriseEmployeeRelease[]
  readonly dirty: boolean
  readonly saving: boolean
  readonly conflict: boolean
  readonly errors: readonly string[]
  readonly error: string | null
  readonly conflictServerFields?: EnterpriseEmployeeDraftFields
  readonly conflictServerRevision?: number
  /** Native Agent Preset copied on the first save of a newly created managed employee. */
  readonly creatingFromPresetId?: string
  readonly presetCreated?: boolean
  readonly optimizingPrompt?: boolean
}

/** Browser lifecycle for the enterprise workbench. */
export interface EnterpriseWorkbenchState {
  readonly open: boolean
  readonly phase: 'idle' | 'loading' | 'ready' | 'error'
  readonly mode: 'enterprise' | 'fallback' | null
  readonly page: EnterpriseWorkbenchPage
  readonly view?: EnterpriseView
  readonly error: string | null
  readonly busyEmployee: string | null
  readonly employeeFilters: EnterpriseEmployeeFilters
  readonly employees: EnterprisePageState<EnterpriseEmployeeDraft>
  readonly workRecords: EnterprisePageState<EnterpriseOperationWorkRecord>
  readonly approvals: EnterprisePageState<EnterpriseApproval>
  readonly schedules: EnterprisePageState<EnterpriseSchedule>
  readonly assets: EnterprisePageState<EnterpriseAsset>
  readonly teams: EnterprisePageState<EnterpriseTeam>
  readonly channels: EnterprisePageState<EnterpriseChannelConfiguration>
  readonly devices: EnterprisePageState<EnterpriseDeviceView>
  readonly teamDefinitions: EnterprisePageState<EnterpriseTeamDefinition>
  readonly teamRuns: EnterprisePageState<EnterpriseTeamRun>
  readonly teamDecisions: EnterprisePageState<EnterpriseTeamDecision>
  readonly teamAutonomy: EnterprisePageState<EnterpriseTeamAutonomyGrant>
  readonly extensions: EnterprisePageState<CordisPackageVersion>
  readonly extensionBindings: readonly CordisScopeBinding[]
  readonly extensionReviews: EnterprisePageState<CordisReviewRequest>
  readonly formalPlugins: EnterprisePageState<PluginInventorySnapshot['entries'][number]>
  readonly modelOptions: readonly EnterpriseModelOption[]
  readonly extensionWorkspaceId?: string
  readonly employeeEditor?: EnterpriseEmployeeEditorState
  readonly releases: readonly EnterpriseEmployeeRelease[]
  readonly mutationPhase: 'idle' | 'running' | 'error' | 'conflict'
  readonly mutationError: string | null
  readonly retryAction: string | null
}

/** Generated Remote namespaces consumed by the enterprise projection. */
export interface EnterpriseWorkbenchRemote {
  readonly agentPresets: ClientRemote['agentPresets']
  readonly session: Pick<ClientRemote['session'], 'modelCatalog'>
  readonly enterpriseEmployees: ClientRemote['enterpriseEmployee']
  readonly enterpriseAssets: ClientRemote['enterpriseAsset']
  readonly enterpriseTeams: ClientRemote['enterpriseTeam']
  readonly enterpriseChannels: ClientRemote['enterpriseChannel']
  readonly enterpriseDevices?: {
    list(request: EnterpriseDeviceListRequest): Promise<EnterpriseApiResult<EnterpriseDeviceView[]> | {
      readonly result: EnterpriseApiResult<EnterpriseDeviceView[]>
    }>
    listRuns?(request: { limit?: number }): Promise<EnterpriseApiResult<EnterpriseComputerUseRun[]> | {
      readonly result: EnterpriseApiResult<EnterpriseComputerUseRun[]>
    }>
    listActions?(request: { limit?: number }): Promise<EnterpriseApiResult<EnterpriseDeviceActionView[]> | {
      readonly result: EnterpriseApiResult<EnterpriseDeviceActionView[]>
    }>
    pair(request: EnterpriseDevicePairRequest): Promise<EnterpriseApiResult<{ deviceId: string }> | {
      readonly result: EnterpriseApiResult<{ deviceId: string }>
    }>
    createRecorderPairing(request: Record<string, never>): Promise<EnterpriseApiResult<{
      pairingId: string
      code: string
      expiresAt: number
    }> | { readonly result: EnterpriseApiResult<{ pairingId: string; code: string; expiresAt: number }> }>
    listRecorders?(request: { includeRevoked?: boolean }): Promise<EnterpriseApiResult<EnterpriseRecorderDeviceView[]> | {
      readonly result: EnterpriseApiResult<EnterpriseRecorderDeviceView[]>
    }>
    startRun(request: {
      deviceId: string
      workspaceId: string
      sessionId: string
      mode: 'observe' | 'confirm-each' | 'delegated'
    }): Promise<EnterpriseApiResult<{ runId: string }> | { readonly result: EnterpriseApiResult<{ runId: string }> }>
    issuePermit(request: {
      deviceId: string
      runId: string
      operationId: string
      capability: 'desktop.observe'
      adapter: 'cua'
      operation: { kind: 'desktop.screen-size' }
    }): Promise<EnterpriseApiResult<{ permitId: string; actionId: string }> | {
      readonly result: EnterpriseApiResult<{ permitId: string; actionId: string }>
    }>
    getAction(request: { operationId: string }): Promise<EnterpriseApiResult<EnterpriseDeviceActionView> | {
      readonly result: EnterpriseApiResult<EnterpriseDeviceActionView>
    }>
    transitionRun?(request: { runId: string; state: 'active' | 'paused' | 'stopped'; expectedRevision: number }):
    Promise<EnterpriseApiResult<EnterpriseComputerUseRun> | { readonly result: EnterpriseApiResult<EnterpriseComputerUseRun> }>
  }
  readonly enterpriseTeamDefinitions: ClientRemote['enterpriseTeamDefinition']
  readonly enterpriseTeamRuns: ClientRemote['enterpriseTeamRun']
  readonly enterpriseTeamDecisions: ClientRemote['enterpriseTeamDecision']
  readonly enterpriseTeamAutonomy: ClientRemote['enterpriseTeamAutonomy']
  readonly enterpriseOperations: ClientRemote['enterpriseOperation']
  readonly enterpriseWork: ClientRemote['enterpriseWork']
  readonly pluginInventory: ClientRemote['pluginInventory']
  readonly cordisWorkspace: ClientRemote['cordisWorkspace']
  readonly cordisReview: ClientRemote['cordisReview']
  readonly cordisGovernance: ClientRemote['cordisGovernance']
}

/** Allowed values for `EnterpriseHostEventName`. */
export type EnterpriseHostEventName =
  | 'enterprise/employee-updated'
  | 'enterprise/asset-updated'
  | 'enterprise/team-updated'
  | 'enterprise/channel-updated'
  | 'enterprise/approval-requested'
  | 'enterprise/operation-updated'

/** Data used by `EnterpriseHostFrame`. */
export interface EnterpriseHostFrame {
  readonly type: 'enterprise/event'
  readonly event: EnterpriseHostEventName
  readonly eventId: string
  readonly resourceType: string
  readonly orgId?: string
  readonly resourceId?: string
}

/** True when a session has a user decision pending.
 * @param _session - Input value used by this API.
 * @returns Result produced by this API.
*/
function needsAttention(_session: SessionSummary): boolean {
  return (_session as SessionSummary & { readonly pendingInteraction?: unknown }).pendingInteraction !== undefined
}

/** Work-record status projected from existing session facts.
 * @param session - Input value used by this API.
 * @returns Result produced by this API.
*/
function recordState(session: SessionSummary): WorkRecordState {
  if (needsAttention(session)) return 'attention'
  if (session.running) return 'running'
  if (session.completed === true) return 'completed'
  return 'ready'
}

/**
 * Build the enterprise workbench read model from existing DSH runtime facts.
 * @param roster - Agent Preset roster in Host order.
 * @param sessions - client Session list mirror.
 * @param workspaces - client Workspace list mirror.
 * @returns deterministic employee, work-record, and metric projections.
 */
export function deriveEnterpriseView(
  roster: readonly AgentPresetRow[],
  sessions: SessionListState,
  workspaces: WorkspaceListState,
): EnterpriseView {
  const workByPreset = new Map<string, SessionSummary[]>()
  const visibleSessions = sessions.ids
    .map(id => sessions.byId[id])
    .filter((session): session is SessionSummary => session !== undefined && !session.blank)
  for (const session of visibleSessions) {
    const agentPreset = session.projectionValues?.agentPreset
      ?? (session as SessionSummary & { readonly agentPreset?: string }).agentPreset
    if (agentPreset === undefined) continue
    const rows = workByPreset.get(agentPreset) ?? []
    rows.push(session)
    workByPreset.set(agentPreset, rows)
  }

  const employees = roster.map((preset): EnterpriseEmployeeView => {
    const work = workByPreset.get(preset.id) ?? []
    const activeWork = work.filter(session => session.running).length
    const attention = work.some(needsAttention)
    const status: EmployeeOperationalState = preset.broken !== undefined
      ? 'unavailable'
      : attention ? 'attention' : activeWork > 0 ? 'active' : 'ready'
    return {
      id: preset.id,
      employeeCode: preset.id,
      name: preset.name ?? preset.id,
      ...preset.description === undefined ? {} : { description: preset.description },
      ...preset.employee?.position === undefined ? {} : { position: preset.employee.position },
      ...preset.employee?.department === undefined ? {} : { department: preset.employee.department },
      capabilities: preset.employee?.capabilities ?? [],
      status,
      activeWork,
      recentWork: work.length,
      custom: preset.trust === 'user',
      isDefault: preset.isDefault,
      ...preset.broken === undefined ? {} : { unavailableReason: preset.broken },
    }
  })
  const employeesById = new Map(employees.map(employee => [employee.id, employee]))

  const workspaceBySession = new Map<SessionId, string>()
  for (const workspace of workspaces.items) {
    for (const sessionId of workspace.sessionIds) workspaceBySession.set(sessionId, workspace.title)
  }
  const records = visibleSessions
    .toSorted((left, right) => right.updatedAt - left.updatedAt || String(left.id).localeCompare(String(right.id)))
    .map((session): EnterpriseWorkRecord => {
      const agentPreset = session.projectionValues?.agentPreset
        ?? (session as SessionSummary & { readonly agentPreset?: string }).agentPreset
      const employee = agentPreset === undefined ? undefined : employeesById.get(agentPreset)
      const workspaceTitle = workspaceBySession.get(session.id)
      return {
        sessionId: session.id,
        title: session.displayTitle,
        ...employee === undefined ? {} : { employeeId: employee.id, employeeName: employee.name },
        ...workspaceTitle === undefined ? {} : { workspaceTitle },
        state: recordState(session),
        updatedAt: session.updatedAt,
      }
    })

  return {
    employees,
    records,
    metrics: {
      employees: employees.length,
      active: records.filter(record => record.state === 'running').length,
      attention: records.filter(record => record.state === 'attention').length,
      workRecords: records.length,
      workspaces: workspaces.items.length,
    },
  }
}

const emptyPage = <T>(): EnterprisePageState<T> => ({ phase: 'idle', items: [], error: null })

const INITIAL_STATE: EnterpriseWorkbenchState = {
  open: false,
  phase: 'idle',
  mode: null,
  page: 'employees',
  error: null,
  busyEmployee: null,
  employeeFilters: {},
  employees: emptyPage(),
  workRecords: emptyPage(),
  approvals: emptyPage(),
  schedules: emptyPage(),
  assets: emptyPage(),
  teams: emptyPage(),
  channels: emptyPage(),
  devices: emptyPage(),
  teamDefinitions: emptyPage(),
  teamRuns: emptyPage(),
  teamDecisions: emptyPage(),
  teamAutonomy: emptyPage(),
  extensions: emptyPage(),
  extensionBindings: [],
  extensionReviews: emptyPage(),
  formalPlugins: emptyPage(),
  modelOptions: [],
  releases: [],
  mutationPhase: 'idle',
  mutationError: null,
  retryAction: null,
}

class EnterpriseApiError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
  }
}

type EnterpriseApiResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

function valueOf<T>(response: EnterpriseApiResult<T> | { readonly result: EnterpriseApiResult<T> }): T {
  const candidate = 'result' in response ? response.result : response
  if (!candidate.ok) throw new EnterpriseApiError(candidate.error.code, candidate.error.message)
  return candidate.value
}

function isUnavailable(error: unknown): boolean {
  return error instanceof EnterpriseApiError
    && error.code === 'internal'
    && /enterprise api is unavailable/iu.test(error.message)
}

function isMutationConflict(error: unknown): boolean {
  return error instanceof EnterpriseApiError
    && (error.code === 'enterprise-conflict' || error.code === 'version-conflict')
}

function pageFailure<T>(before: EnterprisePageState<T>, error: unknown): EnterprisePageState<T> {
  const message = error instanceof Error ? error.message : String(error)
  const permission = error instanceof EnterpriseApiError && error.code === 'enterprise-forbidden'
  return { ...before, phase: permission ? 'permission' : 'error', error: message }
}

function profileString(profile: Readonly<Record<string, unknown>>, key: string): string {
  return typeof profile[key] === 'string' ? profile[key] : ''
}

function profileStrings(profile: Readonly<Record<string, unknown>>, key: string): readonly string[] {
  return Array.isArray(profile[key]) && profile[key].every(item => typeof item === 'string')
    ? profile[key]
    : []
}

function draftFields(draft: EnterpriseEmployeeDraft): EnterpriseEmployeeDraftFields {
  return {
    presetId: draft.presetId,
    avatarSeed: profileString(draft.profile, 'avatarSeed') || draft.presetId,
    name: profileString(draft.profile, 'name'),
    description: profileString(draft.profile, 'description'),
    position: profileString(draft.profile, 'position'),
    department: profileString(draft.profile, 'department'),
    prompt: profileString(draft.profile, 'prompt'),
    modelRef: profileString(draft.profile, 'modelRef'),
    capabilities: profileStrings(draft.profile, 'capabilities'),
    visibility: draft.visibility,
    bindings: draft.bindings,
  }
}

/** Pure editor validation; strings are stable keys rendered by the UI dictionaries.
 * @param fields - Input value used by this API.
 * @returns Result produced by this API.
 */
export function validateEmployeeDraft(fields: EnterpriseEmployeeDraftFields): readonly string[] {
  const errors: string[] = []
  if (fields.name.trim() === '') errors.push('name-required')
  if (fields.prompt.trim() === '') errors.push('prompt-required')
  if (fields.modelRef.trim() === '') errors.push('model-required')
  return errors
}

function mutationKey(prefix: string): string {
  return `${prefix}:${randomUUID()}`
}

/** Stateful adapter around the pure enterprise projection. */
export class EnterpriseWorkbenchController {
  /** Observable state consumed by both the sidebar trigger and overlay. */
  readonly store: SnapshotStore<EnterpriseWorkbenchState> = createSnapshotStore(INITIAL_STATE)
  private roster: readonly AgentPresetRow[] = []
  private readonly seenEventIds = new Set<string>()
  private retryMutationAction: (() => Promise<boolean>) | undefined
  private conflictMutationAction: (() => Promise<void>) | undefined
  private saveGeneration = 0
  private employeeRequestGeneration = 0
  private readonly pageRequestGeneration = new Map<string, number>()
  private mutationAttemptId = 0
  private editorGeneration = 0
  private readonly employeeStarts = new Map<string, Promise<void>>()

  /**
   * @param api - existing Host API; only the Agent Preset roster is read.
   * @param sessions - existing Session list and creation service.
   * @param workspaces - existing Workspace list service.
   */
  constructor(
    private readonly api: EnterpriseWorkbenchRemote,
    private readonly sessions: ISessions,
    private readonly workspaces: IWorkspaces,
  ) {}

  /** Open the workbench, loading its roster on first use. */
  open(): void {
    const state = this.store.getSnapshot()
    this.store.set({ ...state, open: true })
    if (state.phase === 'idle') void this.refresh()
    else this.recompute()
  }

  /** Close the workbench without discarding its loaded read model. */
  close(): void {
    this.editorGeneration++
    const state = this.store.getSnapshot()
    this.store.set({ ...state, open: false, busyEmployee: null })
  }

  /** Change the overlay-local page. Dirty-editor confirmation stays in the view layer.
   * @param page - Input value used by this API.
   */
  setPage(page: EnterpriseWorkbenchPage): void {
    if (page !== this.store.getSnapshot().page) this.editorGeneration++
    this.store.set({ ...this.store.getSnapshot(), page })
  }

  /** Replace server-side roster filters; the next refresh starts from the first cursor.
   * @param filters - Input value used by this API.
   */
  setEmployeeFilters(filters: EnterpriseEmployeeFilters): void {
    this.employeeRequestGeneration++
    this.store.set({ ...this.store.getSnapshot(), employeeFilters: filters })
  }

  /** Toggle workbench visibility. */
  toggle(): void {
    if (this.store.getSnapshot().open) this.close()
    else this.open()
  }

  /** Reload enterprise read models, falling back only when the enterprise profile is absent. */
  async refresh(): Promise<void> {
    const before = this.store.getSnapshot()
    this.store.set({ ...before, phase: 'loading', error: null })
    try {
      await this.refreshEmployees()
      await Promise.all([
        this.refreshWorkRecords(), this.refreshApprovals(), this.refreshSchedules(),
        this.refreshAssets(), this.refreshTeams(), this.refreshTeamDefinitions(),
        this.refreshChannels(), this.refreshDevices(),
        this.refreshTeamRuns(), this.refreshTeamDecisions(), this.refreshTeamAutonomy(),
        this.refreshExtensions(), this.refreshFormalPlugins(), this.refreshModelOptions(),
      ])
      this.store.set({
        ...this.store.getSnapshot(),
        phase: 'ready',
        mode: 'enterprise',
        error: null,
      })
    } catch (error) {
      if (isUnavailable(error)) {
        await this.refreshFallback()
        return
      }
      this.store.set({
        ...this.store.getSnapshot(),
        phase: 'error',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /** Read the active provider/model catalog already used by the native conversation selector. */
  async refreshModelOptions(): Promise<void> {
    try {
      const catalog = valueOf(await this.api.session.modelCatalog())
      const modelOptions = catalog.groups.flatMap(group => group.models.map(model => ({
        value: `${group.id}/${model.id}`,
        provider: group.name,
        model: model.name,
      })))
      this.store.set({ ...this.store.getSnapshot(), modelOptions })
    } catch {
      this.store.set({ ...this.store.getSnapshot(), modelOptions: [] })
    }
  }

  private async refreshFallback(): Promise<void> {
    try {
      const response = await this.api.agentPresets.list()
      this.roster = valueOf(response).presets
      this.store.set({
        ...this.store.getSnapshot(), phase: 'ready', mode: 'fallback', error: null,
        view: deriveEnterpriseView(this.roster, this.sessions.list.getSnapshot(), this.workspaces.list.getSnapshot()),
      })
    } catch (error) {
      this.store.set({
        ...this.store.getSnapshot(), phase: 'error', mode: 'fallback',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /** Load the first filtered employee page.
   * @returns Result produced by this API.
   */
  async refreshEmployees(): Promise<boolean> {
    const generation = ++this.employeeRequestGeneration
    const state = this.store.getSnapshot()
    const filters = state.employeeFilters
    this.store.set({ ...state, employees: { ...state.employees, phase: 'loading', error: null } })
    try {
      const page = valueOf(await this.api.enterpriseEmployees.list({ limit: 24, ...filters }))
      const releases = (await Promise.all(page.items.map(async (item) => {
        try { return valueOf(await this.api.enterpriseEmployees.listReleases({ presetId: item.presetId })) }
        catch { return [] }
      }))).flat()
      if (generation !== this.employeeRequestGeneration) return false
      this.store.set({ ...this.store.getSnapshot(), releases, employees: {
        phase: 'ready', items: page.items, error: null,
        ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
      } })
      return true
    } catch (error) {
      if (isUnavailable(error)) throw error
      if (generation !== this.employeeRequestGeneration) return false
      const current = this.store.getSnapshot()
      this.store.set({ ...current, employees: pageFailure(current.employees, error) })
      return false
    }
  }

  /** Append the next roster page using the current filters.
   * @returns Result produced by this API.
   */
  async loadMoreEmployees(): Promise<boolean> {
    const before = this.store.getSnapshot()
    if (before.employees.nextCursor === undefined || before.employees.phase === 'loading') return false
    const generation = ++this.employeeRequestGeneration
    this.store.set({ ...before, employees: { ...before.employees, phase: 'loading', error: null } })
    try {
      const page = valueOf(await this.api.enterpriseEmployees.list({
        limit: 24, cursor: before.employees.nextCursor, ...before.employeeFilters,
      }))
      const releases = (await Promise.all(page.items.map(async (item) => {
        try { return valueOf(await this.api.enterpriseEmployees.listReleases({ presetId: item.presetId })) }
        catch { return [] }
      }))).flat()
      if (generation !== this.employeeRequestGeneration) return false
      this.store.set({ ...this.store.getSnapshot(), releases: [...before.releases, ...releases], employees: {
        phase: 'ready', items: [...before.employees.items, ...page.items], error: null,
        ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
      } })
      return true
    } catch (error) {
      if (generation !== this.employeeRequestGeneration) return false
      const current = this.store.getSnapshot()
      this.store.set({ ...current, employees: pageFailure(before.employees, error) })
      return false
    }
  }

  private async loadPage<K extends 'workRecords' | 'approvals' | 'schedules' | 'assets' | 'teams' | 'channels' | 'devices' | 'teamDefinitions' | 'teamRuns' | 'teamDecisions' | 'teamAutonomy' | 'formalPlugins'>(
    key: K,
    load: () => Promise<{ items: EnterpriseWorkbenchState[K]['items']; nextCursor?: string }>,
  ): Promise<boolean> {
    const generation = (this.pageRequestGeneration.get(key) ?? 0) + 1
    this.pageRequestGeneration.set(key, generation)
    const before = this.store.getSnapshot()
    const previous = before[key]
    this.store.set({ ...before, [key]: { ...previous, phase: 'loading', error: null } })
    try {
      const page = await load()
      if (this.pageRequestGeneration.get(key) !== generation) return false
      this.store.set({ ...this.store.getSnapshot(), [key]: {
        phase: 'ready', items: page.items, error: null,
        ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
      } })
      return true
    } catch (error) {
      if (this.pageRequestGeneration.get(key) !== generation) return false
      const current = this.store.getSnapshot()
      const permission = error instanceof EnterpriseApiError && error.code === 'enterprise-forbidden'
      this.store.set({ ...current, [key]: {
        ...previous,
        phase: permission ? 'permission' : 'error',
        error: error instanceof Error ? error.message : String(error),
      } })
      return false
    }
  }

  /** Refresh one PostgreSQL operations page.
   * @returns Result produced by this API.
   */
  refreshWorkRecords(): Promise<boolean> {
    return this.loadPage('workRecords', async () => valueOf(await this.api.enterpriseOperations.listWorkRecords({ limit: 50 })))
  }

  /** Refresh approvals.
   * @returns Result produced by this API.
   */
  refreshApprovals(): Promise<boolean> {
    return this.loadPage('approvals', async () => valueOf(await this.api.enterpriseOperations.listApprovals({ limit: 50 })))
  }

  /** Refresh schedules.
   * @returns Result produced by this API.
   */
  refreshSchedules(): Promise<boolean> {
    return this.loadPage('schedules', async () => valueOf(await this.api.enterpriseOperations.listSchedules({ limit: 50 })))
  }

  /** Refresh capability assets.
   * @returns Result produced by this API.
   */
  refreshAssets(): Promise<boolean> {
    return this.loadPage('assets', async () => valueOf(await this.api.enterpriseAssets.list({ limit: 50 })))
  }

  /** Refresh fixed teams.
   * @returns Result produced by this API.
   */
  refreshTeams(): Promise<boolean> {
    return this.loadPage('teams', async () => valueOf(await this.api.enterpriseTeams.list({ limit: 50 })))
  }

  /**
   * Refresh administrator-visible channel configurations.
   * @returns whether the latest page replaced the previous projection.
   */
  refreshChannels(): Promise<boolean> {
    return this.loadPage('channels', async () => valueOf(await this.api.enterpriseChannels.list({})))
  }

  /** Refresh devices paired to the authenticated user.
   * @returns whether the page projection was replaced.
   */
  refreshDevices(): Promise<boolean> {
    const enterpriseDevices = this.api.enterpriseDevices
    if (enterpriseDevices === undefined) {
      this.store.set({ ...this.store.getSnapshot(), devices: { phase: 'ready', items: [], error: null } })
      return Promise.resolve(true)
    }
    return this.loadPage('devices', async () => {
      const [computers, recorders] = await Promise.all([
        enterpriseDevices.list({}).then(valueOf),
        enterpriseDevices.listRecorders?.({}).then(valueOf) ?? Promise.resolve([]),
      ])
      return {
        items: [
          ...computers.map(device => ({ ...device, kind: 'computer' as const })),
          ...recorders.map(recorder => ({
            deviceId: recorder.recorderId, deviceName: recorder.deviceName,
            kind: 'recorder' as const, platform: 'recorder' as const,
            status: recorder.status === 'active' ? 'online' as const : 'revoked' as const,
            ...(recorder.lastSeenAt === undefined ? {} : { lastHeartbeatAt: recorder.lastSeenAt }),
          })),
        ],
      }
    })
  }

  /** Pair the loopback Device Agent without exposing identifiers or keys to manual entry.
   * @param dshOrigin - Public DSH origin saved by the local Agent.
   * @param localBase - Loopback pairing endpoint.
   * @param fetcher - Browser fetch implementation.
   * @returns whether pairing and projection refresh succeeded.
   */
  async pairLocalDevice(
    dshOrigin: string,
    localBase = 'http://127.0.0.1:47631',
    fetcher: typeof globalThis.fetch = globalThis.fetch,
  ): Promise<boolean> {
    const enterpriseDevices = this.api.enterpriseDevices
    if (enterpriseDevices === undefined) throw new Error('Device Plane is unavailable')
    return this.runMutation('device-pair', async () => {
      const identityResponse = await fetcher(`${localBase}/v1/identity`, { headers: { accept: 'application/json' } })
      if (!identityResponse.ok) throw new Error('本机 Device Agent 未运行')
      const identity = await identityResponse.json() as Record<string, unknown>
      if (typeof identity['publicKey'] !== 'string' || typeof identity['deviceName'] !== 'string'
        || typeof identity['challenge'] !== 'string'
        || !['macos', 'windows', 'linux'].includes(String(identity['platform']))) {
        throw new Error('本机 Device Agent 身份无效')
      }
      const paired = valueOf(await enterpriseDevices.pair({
        publicKey: identity['publicKey'], deviceName: identity['deviceName'],
        platform: identity['platform'] as EnterpriseDevicePairRequest['platform'],
      }))
      const completion = await fetcher(`${localBase}/v1/complete`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ challenge: identity['challenge'], deviceId: paired.deviceId, dshOrigin }),
      })
      if (!completion.ok) throw new Error('本机 Device Agent 未确认配对')
      return paired
    }, () => this.refreshDevices())
  }

  /** Create one owner-scoped, short-lived recorder binding code. */
  async createRecorderPairing(): Promise<{ pairingId: string; code: string; expiresAt: number }> {
    const enterpriseDevices = this.api.enterpriseDevices
    if (enterpriseDevices === undefined) throw new Error('Device Plane is unavailable')
    return valueOf(await enterpriseDevices.createRecorderPairing({}))
  }

  /** Queue a harmless desktop observation and wait for persisted local evidence.
   * @param deviceId - Owned online device selected by the user.
   * @returns terminal or timed-out action projection.
   */
  async testLocalDevice(deviceId: string): Promise<EnterpriseDeviceActionView> {
    const enterpriseDevices = this.api.enterpriseDevices
    if (enterpriseDevices === undefined) throw new Error('Device Plane is unavailable')
    const sessionId = this.sessions.list.getSnapshot().current
    const workspaceId = this.currentSessionWorkspaceId()
    if (sessionId === undefined || workspaceId === undefined) {
      throw new Error('Open a work record before testing this computer')
    }
    const started = valueOf(await enterpriseDevices.startRun({
      deviceId, workspaceId, sessionId, mode: 'observe',
    }))
    const operationId = `device-test:${randomUUID()}`
    await enterpriseDevices.issuePermit({
      deviceId, runId: started.runId, operationId, capability: 'desktop.observe',
      adapter: 'cua', operation: { kind: 'desktop.screen-size' },
    }).then(valueOf)
    let action = valueOf(await enterpriseDevices.getAction({ operationId }))
    for (let attempt = 0; attempt < 20 && (action.state === 'pending' || action.state === 'claimed'); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 500))
      action = valueOf(await enterpriseDevices.getAction({ operationId }))
    }
    return action
  }

  /** Load recent run and action projections for the Device Plane control surface.
   * @returns recent user-owned runs and actions.
   */
  async loadDeviceActivity(): Promise<{
    runs: readonly EnterpriseComputerUseRun[]
    actions: readonly EnterpriseDeviceActionView[]
  }> {
    const enterpriseDevices = this.api.enterpriseDevices
    if (enterpriseDevices?.listRuns === undefined || enterpriseDevices.listActions === undefined) return { runs: [], actions: [] }
    const [runs, actions] = await Promise.all([
      enterpriseDevices.listRuns({ limit: 20 }).then(valueOf),
      enterpriseDevices.listActions({ limit: 50 }).then(valueOf),
    ])
    return { runs, actions }
  }

  /** Pause, resume, or stop one user-owned Computer Use run.
   * @param run - Current run snapshot carrying its revision.
   * @param state - Requested next lifecycle state.
   * @returns transitioned server snapshot.
   */
  async transitionDeviceRun(
    run: EnterpriseComputerUseRun,
    state: 'active' | 'paused' | 'stopped',
  ): Promise<EnterpriseComputerUseRun> {
    const enterpriseDevices = this.api.enterpriseDevices
    if (enterpriseDevices?.transitionRun === undefined) throw new Error('Device Plane run control is unavailable')
    return valueOf(await enterpriseDevices.transitionRun({
      runId: run.runId, state, expectedRevision: run.revision ?? 1,
    }))
  }

  /** Begin provider-owned authorization for one persisted channel revision.
   * @param channel - Input value used by this API.
   * @param redirectUri - Input value used by this API.
   * @returns Result produced by this API.
   */
  async beginChannelBinding(
    channel: EnterpriseChannelConfiguration,
    redirectUri: string,
  ): Promise<EnterpriseChannelBindingSession> {
    return valueOf(await this.api.enterpriseChannels.beginBinding({
      channelId: channel.channelId,
      expectedRevision: channel.revision,
      redirectUri,
    }))
  }

  /** Start provider-app installation before a channel configuration exists.
   * @param provider - Input value used by this API.
   * @param redirectUri - Input value used by this API.
   * @returns Result produced by this API.
   */
  async beginChannelBotInstall(
    provider: EnterpriseChannelConfiguration['provider'],
    redirectUri: string,
  ): Promise<EnterpriseChannelBotInstallResult> {
    return valueOf(await this.api.enterpriseChannels.beginBotInstall({ provider, redirectUri }))
  }

  /** Poll a provider Device Grant and return only secret-free progress.
   * @param installId - Input value used by this API.
   * @param verificationCode - Input value used by this API.
   * @returns Result produced by this API.
   */
  async pollChannelBotInstall(installId: string, verificationCode?: string): Promise<EnterpriseChannelPollBotInstallResult> {
    return valueOf(await this.api.enterpriseChannels.pollBotInstall({
      installId, ...(verificationCode === undefined ? {} : { verificationCode }),
      idempotencyKey: `channel-bot-install:${installId}`,
    }))
  }

  /** Refresh typed Team Definitions.
   * @returns Result produced by this API.
   */
  refreshTeamDefinitions(): Promise<boolean> {
    return this.loadPage('teamDefinitions', async () => valueOf(await this.api.enterpriseTeamDefinitions.list({ limit: 50 })))
  }

  /** Refresh visible TeamRun projections.
   * @returns Result produced by this API.
   */
  refreshTeamRuns(): Promise<boolean> {
    return this.loadPage('teamRuns', async () => valueOf(await this.api.enterpriseTeamRuns.list({ limit: 50 })))
  }

  /** Refresh the current Human decision queue.
   * @returns Result produced by this API.
   */
  refreshTeamDecisions(): Promise<boolean> {
    return this.loadPage('teamDecisions', async () => valueOf(await this.api.enterpriseTeamDecisions.list({ limit: 50 })))
  }

  /** Refresh explicit scoped autonomy grants.
   * @returns Result produced by this API.
   */
  refreshTeamAutonomy(): Promise<boolean> {
    return this.loadPage('teamAutonomy', async () => valueOf(await this.api.enterpriseTeamAutonomy.list({ limit: 50 })))
  }

  /** Read formally installed Registry/tgz/Profile plugins from the live Loader inventory.
   * @returns Result produced by this API.
   */
  refreshFormalPlugins(): Promise<boolean> {
    return this.loadPage('formalPlugins', async () => ({
      items: valueOf(await this.api.pluginInventory.list()).entries,
    }))
  }

  /** Select the Workspace whose personal or department extensions are projected.
   * @param workspaceId - Input value used by this API.
   */
  setExtensionWorkspace(workspaceId: string): void {
    this.store.set({ ...this.store.getSnapshot(), extensionWorkspaceId: workspaceId })
    void this.refreshExtensions()
  }

  /** Load visible personal, department, organization, and review projections.
   * @returns Result produced by this API.
   */
  async refreshExtensions(): Promise<boolean> {
    const before = this.store.getSnapshot()
    const workspaceId = before.extensionWorkspaceId
      ?? this.currentWorkspaceId()
    if (workspaceId === undefined) {
      this.store.set({ ...before, extensions: { phase: 'ready', items: [], error: null },
        extensionBindings: [], extensionReviews: { phase: 'ready', items: [], error: null } })
      return true
    }
    this.store.set({ ...before, extensionWorkspaceId: workspaceId,
      extensions: { ...before.extensions, phase: 'loading', error: null },
      extensionReviews: { ...before.extensionReviews, phase: 'loading', error: null } })
    try {
      const [projection, reviews] = await Promise.all([
        this.api.cordisWorkspace.list({ workspaceId }).then(response => valueOf(response)),
        this.api.cordisReview.list({}).then(response => valueOf(response)),
      ])
      this.store.set({ ...this.store.getSnapshot(), extensionWorkspaceId: workspaceId,
        extensions: { phase: 'ready', items: projection.packages, error: null },
        extensionBindings: projection.bindings,
        extensionReviews: { phase: 'ready', items: reviews, error: null } })
      return true
    } catch (error) {
      const current = this.store.getSnapshot()
      this.store.set({ ...current,
        extensions: pageFailure(current.extensions, error),
        extensionReviews: pageFailure(current.extensionReviews, error) })
      return false
    }
  }

  private currentWorkspaceId(): string | undefined {
    return this.currentSessionWorkspaceId() ?? this.workspaces.list.getSnapshot().items[0]?.workspaceId
  }

  /** Resolve only the Workspace actually containing the currently open native Session.
   * @returns Result produced by this API.
  */
  private currentSessionWorkspaceId(): string | undefined {
    const currentSessionId = this.sessions.list.getSnapshot().current
    if (currentSessionId === undefined) return undefined
    return this.workspaces.list.getSnapshot().items.find(workspace => workspace.sessionIds.includes(currentSessionId))?.workspaceId
  }

  /** Prepare a goal-first work request using the current native Session when one is open.
   * @param input - Input value used by this API.
   * @returns Result produced by this API.
   */
  async prepareWork(input: Pick<EnterpriseWorkPrepareRequest, 'objective' | 'deadline' | 'workspaceId' | 'preferredEmployeeReleaseId'>): Promise<EnterpriseWorkPreparation> {
    const currentSessionId = this.sessions.list.getSnapshot().current
    return valueOf(await this.api.enterpriseWork.prepare({
      ...input,
      ...(currentSessionId === undefined ? {} : { currentSessionId }),
    }))
  }

  /** Start one previously prepared goal-first work request.
   * @param input - Input value used by this API.
   * @returns Result produced by this API.
   */
  async startPreparedWork(input: EnterpriseWorkStartRequest): Promise<EnterpriseWorkStartValue> {
    return valueOf(await this.api.enterpriseWork.start(input))
  }

  /** Stop one durable scope binding without removing immutable versions.
   * @param binding - Input value used by this API.
   * @param reason - Input value used by this API.
   */
  async stopExtension(binding: CordisScopeBinding, reason: string): Promise<void> {
    await this.runMutation('cordis-stop', async () => valueOf(await this.api.cordisWorkspace.stop({
      bindingId: binding.bindingId, pluginId: binding.pluginId, expectedRevision: binding.revision,
      reason, idempotencyKey: mutationKey('cordis-stop'),
    })), async () => { await this.refreshExtensions() })
  }

  /** Roll a binding back by atomically moving its active pointer.
   * @param binding - Input value used by this API.
   * @param packageId - Input value used by this API.
   * @param reason - Input value used by this API.
   */
  async rollbackExtension(binding: CordisScopeBinding, packageId: string, reason: string): Promise<void> {
    await this.runMutation('cordis-rollback', async () => valueOf(await this.api.cordisWorkspace.rollback({
      bindingId: binding.bindingId, pluginId: binding.pluginId, packageId,
      expectedRevision: binding.revision, reason, idempotencyKey: mutationKey('cordis-rollback'),
    })), async () => { await this.refreshExtensions() })
  }

  /** Apply one department-manager review action.
   * @param action - Input value used by this API.
   * @param reason - Input value used by this API.
   * @param review - Input value used by this API.
   */
  async reviewExtension(review: CordisReviewRequest, action: 'approve' | 'return' | 'publish', reason: string): Promise<void> {
    const request = {
      reviewId: review.reviewId, pluginId: review.pluginId, packageId: review.packageId,
      expectedRevision: review.revision, reason, idempotencyKey: mutationKey(`cordis-${action}`),
    }
    await this.runMutation(`cordis-${action}`, async () => {
      if (action === 'approve') return valueOf(await this.api.cordisReview.approveDepartment(request))
      if (action === 'return') return valueOf(await this.api.cordisReview.return(request))
      return valueOf(await this.api.cordisReview.publishOrganization(request))
    }, async () => { await this.refreshExtensions() })
  }

  /** Re-fold volatile operations state while retaining the loaded roster. */
  recompute(): void {
    const state = this.store.getSnapshot()
    if (state.phase !== 'ready' || state.mode !== 'fallback') return
    this.store.set({
      ...state,
      view: deriveEnterpriseView(
        this.roster,
        this.sessions.list.getSnapshot(),
        this.workspaces.list.getSnapshot(),
      ),
    })
  }

  /** Load an employee draft and its immutable release history into the single-page editor.
   * @param presetId - Input value used by this API.
   */
  async openEmployeeDraft(presetId: string): Promise<void> {
    const generation = ++this.editorGeneration
    this.store.set({ ...this.store.getSnapshot(), employeeEditor: {
      phase: 'loading', releases: [], dirty: false, saving: false, conflict: false, errors: [], error: null,
    } })
    try {
      const [draft, releases] = await Promise.all([
        this.api.enterpriseEmployees.getDraft({ presetId }).then(response => valueOf(response)),
        this.api.enterpriseEmployees.listReleases({ presetId }).then(response => valueOf(response)),
      ])
      const fields = draftFields(draft)
      if (generation !== this.editorGeneration) return
      this.store.set({ ...this.store.getSnapshot(), employeeEditor: {
        phase: 'ready', fields, revision: draft.revision, releases,
        dirty: false, saving: false, conflict: false, errors: [], error: null,
      } })
    } catch (error) {
      if (generation !== this.editorGeneration) return
      this.store.set({ ...this.store.getSnapshot(), employeeEditor: {
        phase: 'error', releases: [], dirty: false, saving: false, conflict: false, errors: [],
        error: error instanceof Error ? error.message : String(error),
      } })
    }
  }

  /** Start one unsaved managed employee backed by a copy of the deployment's default Agent Preset. */
  createEmployeeDraft(): void {
    this.editorGeneration++
    const source = this.roster.find(preset => preset.isDefault)?.id ?? this.roster[0]?.id ?? 'standard'
    const fields: EnterpriseEmployeeDraftFields = {
      presetId: `employee-${randomUUID()}`,
      avatarSeed: randomUUID(),
      name: '', description: '', position: '', department: '', prompt: '', modelRef: '',
      capabilities: [], visibility: 'organization', bindings: [],
    }
    this.store.set({ ...this.store.getSnapshot(), employeeEditor: {
      phase: 'ready', fields, revision: 0, releases: [], dirty: false, saving: false,
      conflict: false, errors: validateEmployeeDraft(fields), error: null,
      creatingFromPresetId: source, presetCreated: false,
    } })
  }

  /** Patch local fields only; no write occurs until saveEmployeeDraft.
   * @param patch - Input value used by this API.
   */
  patchEmployeeDraft(patch: Partial<EnterpriseEmployeeDraftFields>): void {
    const state = this.store.getSnapshot()
    const editor = state.employeeEditor
    if (editor?.fields === undefined || editor.saving) return
    const fields = { ...editor.fields, ...patch }
    this.store.set({ ...state, employeeEditor: {
      ...editor, fields, dirty: true, conflict: editor.conflict, errors: validateEmployeeDraft(fields), error: null,
    } })
  }

  /** Replace the local conflict copy with the authoritative server draft. */
  adoptServerEmployeeConflict(): void {
    const state = this.store.getSnapshot()
    const editor = state.employeeEditor
    if (editor?.conflictServerFields === undefined || editor.conflictServerRevision === undefined) return
    const { conflictServerFields, conflictServerRevision, ...rest } = editor
    this.store.set({ ...state, employeeEditor: {
      ...rest,
      fields: conflictServerFields,
      revision: conflictServerRevision,
      dirty: false,
      conflict: false,
      errors: validateEmployeeDraft(conflictServerFields),
      error: null,
    } })
  }

  /** Keep local fields but advance their revision fence to the reloaded server revision. */
  keepLocalEmployeeConflict(): void {
    const state = this.store.getSnapshot()
    const editor = state.employeeEditor
    if (editor?.fields === undefined || editor.conflictServerRevision === undefined) return
    const { conflictServerFields: _serverFields, conflictServerRevision, ...rest } = editor
    this.store.set({ ...state, employeeEditor: {
      ...rest,
      fields: editor.fields,
      revision: conflictServerRevision,
      dirty: true,
      conflict: false,
      errors: validateEmployeeDraft(editor.fields),
      error: null,
    } })
  }

  /** Explicitly persist the current employee draft with a revision fence. */
  async saveEmployeeDraft(): Promise<void> {
    const before = this.store.getSnapshot()
    const editor = before.employeeEditor
    if (editor?.fields === undefined || editor.revision === undefined) return
    const errors = validateEmployeeDraft(editor.fields)
    if (errors.length > 0) {
      this.store.set({ ...before, employeeEditor: { ...editor, errors } })
      return
    }
    const generation = ++this.saveGeneration
    const expectedRevision = editor.revision
    const idempotencyKey = mutationKey('employee-save')
    this.store.set({ ...before, employeeEditor: { ...editor, saving: true, conflict: false, error: null } })
    const { presetId, visibility, bindings, name, description, position, department, prompt, modelRef, capabilities } = editor.fields
    const avatarSeed = editor.fields.avatarSeed || presetId
    await this.runMutation('employee-save', async () => {
      if (editor.creatingFromPresetId !== undefined && editor.presetCreated !== true) {
        valueOf(await this.api.agentPresets.copy(editor.creatingFromPresetId, presetId, name))
        const copied = this.store.getSnapshot()
        if (copied.employeeEditor !== undefined) {
          this.store.set({ ...copied, employeeEditor: { ...copied.employeeEditor, presetCreated: true } })
        }
      }
      return valueOf(await this.api.enterpriseEmployees.saveDraft({
        presetId, expectedRevision, idempotencyKey, visibility,
        profile: { name, avatarSeed, description, position, department, prompt, modelRef, capabilities: [...capabilities] }, bindings,
      }))
    }, async (saved) => {
      const current = this.store.getSnapshot()
      const currentEditor = current.employeeEditor
      if (generation !== this.saveGeneration || currentEditor === undefined
        || currentEditor.revision !== expectedRevision) return
      const { creatingFromPresetId: _source, presetCreated: _presetCreated, ...settledEditor } = currentEditor
      this.store.set({ ...current, employeeEditor: {
        ...settledEditor, fields: draftFields(saved), revision: saved.revision,
        saving: false, dirty: false, conflict: false, errors: [], error: null,
      } })
      await this.refreshEmployees()
    }, (error) => {
      const current = this.store.getSnapshot()
      const currentEditor = current.employeeEditor
      if (generation !== this.saveGeneration || currentEditor === undefined) return
      const conflict = isMutationConflict(error)
      this.store.set({ ...current, employeeEditor: {
        ...currentEditor, saving: false, dirty: true, conflict,
        error: error instanceof Error ? error.message : String(error),
      } })
    }, async () => {
      const current = this.store.getSnapshot()
      const currentEditor = current.employeeEditor
      if (currentEditor?.fields === undefined) return
      const [serverDraft, releases] = await Promise.all([
        this.api.enterpriseEmployees.getDraft({ presetId }).then(response => valueOf(response)),
        this.api.enterpriseEmployees.listReleases({ presetId }).then(response => valueOf(response)),
      ])
      const latest = this.store.getSnapshot()
      const latestEditor = latest.employeeEditor
      if (latestEditor?.fields === undefined) return
      this.store.set({ ...latest, employeeEditor: {
        ...latestEditor,
        fields: latestEditor.fields,
        releases,
        saving: false,
        dirty: true,
        conflict: true,
        conflictServerFields: draftFields(serverDraft),
        conflictServerRevision: serverDraft.revision,
        error: null,
      } })
    })
  }

  /** Publish the saved draft and refresh its release history. */
  async publishEmployee(): Promise<void> {
    const editor = this.store.getSnapshot().employeeEditor
    if (editor?.fields === undefined || editor.revision === undefined || editor.dirty) return
    const presetId = editor.fields.presetId
    const expectedRevision = editor.revision
    const idempotencyKey = mutationKey('employee-publish')
    const editorGeneration = this.editorGeneration
    await this.runMutation('employee-publish', async () => valueOf(await this.api.enterpriseEmployees.publish({
      presetId, expectedRevision,
      idempotencyKey,
    })), async () => {
      if (this.editorGeneration === editorGeneration && this.store.getSnapshot().open
        && this.store.getSnapshot().page === 'employees') await this.openEmployeeDraft(presetId)
      await this.refreshEmployees()
    }, (error) => { this.setEditorFailure(error) }, () => this.reloadEmployeeConflict(presetId))
  }

  /** Replace the local responsibility prompt with a model-generated improved draft. */
  async optimizeEmployeePrompt(): Promise<void> {
    const state = this.store.getSnapshot()
    const editor = state.employeeEditor
    if (editor?.fields === undefined || editor.optimizingPrompt === true) return
    const route = state.modelOptions.find(option => option.value === editor.fields?.modelRef)
    if (route === undefined || editor.fields.prompt.trim() === '') return
    const separator = route.value.indexOf('/')
    if (separator <= 0) return
    this.store.set({ ...state, employeeEditor: { ...editor, optimizingPrompt: true, error: null } })
    try {
      const optimized = valueOf(await this.api.enterpriseEmployees.optimizePrompt({
        provider: route.value.slice(0, separator),
        model: route.value.slice(separator + 1),
        prompt: editor.fields.prompt,
      }))
      const current = this.store.getSnapshot()
      if (current.employeeEditor?.fields === undefined) return
      this.store.set({ ...current, employeeEditor: {
        ...current.employeeEditor,
        fields: { ...current.employeeEditor.fields, prompt: optimized.prompt },
        optimizingPrompt: false, dirty: true, error: null,
      } })
    } catch (error) {
      const current = this.store.getSnapshot()
      if (current.employeeEditor === undefined) return
      this.store.set({ ...current, employeeEditor: {
        ...current.employeeEditor, optimizingPrompt: false,
        error: error instanceof Error ? error.message : String(error),
      } })
    }
  }

  /** Roll back by publishing a historical release as a new release.
   * @param releaseId - Input value used by this API.
   */
  async rollbackEmployee(releaseId: string): Promise<void> {
    const editor = this.store.getSnapshot().employeeEditor
    if (editor?.fields === undefined || editor.revision === undefined) return
    const presetId = editor.fields.presetId
    const expectedRevision = editor.revision
    const idempotencyKey = mutationKey('employee-rollback')
    const editorGeneration = this.editorGeneration
    await this.runMutation('employee-rollback', async () => valueOf(await this.api.enterpriseEmployees.rollback({
      presetId, releaseId, expectedRevision,
      idempotencyKey,
    })), async () => {
      if (this.editorGeneration === editorGeneration && this.store.getSnapshot().open
        && this.store.getSnapshot().page === 'employees') await this.openEmployeeDraft(presetId)
      await this.refreshEmployees()
    }, (error) => { this.setEditorFailure(error) }, () => this.reloadEmployeeConflict(presetId))
  }

  /** Close the editor after the view has handled dirty confirmation. */
  closeEmployeeEditor(): void {
    this.editorGeneration++
    const state = this.store.getSnapshot()
    const { employeeEditor: _employeeEditor, ...next } = state
    this.store.set(next)
  }

  private setEditorFailure(error: unknown): void {
    const state = this.store.getSnapshot()
    if (state.employeeEditor === undefined) return
    this.store.set({ ...state, employeeEditor: {
      ...state.employeeEditor, saving: false,
      conflict: isMutationConflict(error),
      error: error instanceof Error ? error.message : String(error),
    } })
  }

  /** Update the real business state of one work record.
   * @param businessState - Input value used by this API.
   * @param record - Input value used by this API.
   */
  async updateWorkRecord(record: EnterpriseOperationWorkRecord, businessState: EnterpriseBusinessState): Promise<void> {
    const idempotencyKey = mutationKey('work-record')
    await this.runMutation('work-record-update', async () => valueOf(await this.api.enterpriseOperations.updateWorkRecord({
      sessionId: record.sessionId, employeeReleaseId: record.employeeReleaseId,
      ...(record.teamId === undefined ? {} : { teamId: record.teamId }),
      source: record.source, businessState, sourceReferences: record.sourceReferences,
      expectedRevision: record.revision, idempotencyKey,
    })), () => this.refreshWorkRecords(), undefined,
    () => this.reloadPageConflict('workRecords', () => this.refreshWorkRecords()))
  }

  /** Approve or reject a pending enterprise approval.
   * @param approval - Input value used by this API.
   * @param reason - Input value used by this API.
   * @param state - Input value used by this API.
   */
  async transitionApproval(approval: EnterpriseApproval, state: 'approved' | 'rejected', reason?: string): Promise<void> {
    const idempotencyKey = mutationKey('approval-transition')
    await this.runMutation('approval-transition', async () => valueOf(await this.api.enterpriseOperations.transitionApproval({
      approvalId: approval.approvalId, state, ...(reason === undefined ? {} : { reason }),
      expectedRevision: approval.revision, idempotencyKey,
    })), () => this.refreshApprovals(), undefined,
    () => this.reloadPageConflict('approvals', () => this.refreshApprovals()))
  }

  /** Cancel an approval request.
   * @param approval - Input value used by this API.
   * @param reason - Input value used by this API.
   */
  async cancelApproval(approval: EnterpriseApproval, reason?: string): Promise<void> {
    const idempotencyKey = mutationKey('approval-cancel')
    await this.runMutation('approval-cancel', async () => valueOf(await this.api.enterpriseOperations.cancelApproval({
      approvalId: approval.approvalId, ...(reason === undefined ? {} : { reason }),
      expectedRevision: approval.revision, idempotencyKey,
    })), () => this.refreshApprovals(), undefined,
    () => this.reloadPageConflict('approvals', () => this.refreshApprovals()))
  }

  /** Create or edit a schedule.
   * @param input - Input value used by this API.
   * @returns Result produced by this API.
   */
  async saveSchedule(input: {
    scheduleId: string
    target: EnterpriseScheduleTarget
    timezone: string
    rule: string
    input: Readonly<Record<string, JsonValue>>
    nextRunAt: number | null
    expectedRevision: number
  }): Promise<boolean> {
    const idempotencyKey = mutationKey('schedule-save')
    return this.runMutation('schedule-save', async () => valueOf(await this.api.enterpriseOperations.saveSchedule({
      ...input, idempotencyKey,
    })), () => this.refreshSchedules(), undefined,
    () => this.reloadPageConflict('schedules', () => this.refreshSchedules()))
  }

  /** Pause, resume, or archive a schedule.
   * @param schedule - Input value used by this API.
   * @param state - Input value used by this API.
   */
  async transitionSchedule(schedule: EnterpriseSchedule, state: EnterpriseSchedule['state']): Promise<void> {
    const idempotencyKey = mutationKey('schedule-transition')
    await this.runMutation('schedule-transition', async () => valueOf(await this.api.enterpriseOperations.transitionSchedule({
      scheduleId: schedule.scheduleId, state, expectedRevision: schedule.revision,
      idempotencyKey,
    })), () => this.refreshSchedules(), undefined,
    () => this.reloadPageConflict('schedules', () => this.refreshSchedules()))
  }

  /** Save a versioned capability asset.
   * @param input - Input value used by this API.
   * @returns Result produced by this API.
   */
  async saveAssetVersion(input: {
    assetId: string
    kind: EnterpriseAssetKind
    name: string
    content: Readonly<Record<string, JsonValue>>
    expectedRevision: number
  }): Promise<boolean> {
    const idempotencyKey = mutationKey('asset-save')
    return this.runMutation('asset-save', async () => valueOf(await this.api.enterpriseAssets.saveVersion({
      ...input, idempotencyKey,
    })), () => this.refreshAssets(), undefined,
    () => this.reloadPageConflict('assets', () => this.refreshAssets()))
  }

  /** Archive a capability asset.
   * @param asset - Input value used by this API.
   */
  async archiveAsset(asset: EnterpriseAsset): Promise<void> {
    const idempotencyKey = mutationKey('asset-archive')
    await this.runMutation('asset-archive', async () => valueOf(await this.api.enterpriseAssets.archive({
      assetId: asset.assetId, expectedRevision: asset.revision, idempotencyKey,
    })), () => this.refreshAssets(), undefined,
    () => this.reloadPageConflict('assets', () => this.refreshAssets()))
  }

  /** Save a fixed employee team.
   * @param input - Input value used by this API.
   * @returns Result produced by this API.
   */
  async saveTeam(input: {
    teamId: string
    leaderEmployeeReleaseId: string
    members: readonly EnterpriseTeamMember[]
    workflowTemplate: Readonly<Record<string, JsonValue>>
    approvalPolicy: Readonly<Record<string, JsonValue>>
    expectedRevision: number
  }): Promise<boolean> {
    const idempotencyKey = mutationKey('team-save')
    return this.runMutation('team-save', async () => valueOf(await this.api.enterpriseTeams.save({
      ...input, idempotencyKey,
    })), () => this.refreshTeams(), undefined,
    () => this.reloadPageConflict('teams', () => this.refreshTeams()))
  }

  /** Save a versioned Human-Agent team charter.
   * @param input - Input value used by this API.
   * @returns Result produced by this API.
   */
  async saveTeamDefinition(input: Omit<EnterpriseTeamDefinition, 'orgId' | 'revision' | 'createdAt' | 'updatedAt'> & {
    expectedRevision: number
  }): Promise<boolean> {
    const idempotencyKey = mutationKey('team-definition-save')
    return this.runMutation('team-definition-save', async () => valueOf(await this.api.enterpriseTeamDefinitions.save({
      ...input, idempotencyKey,
    })), () => this.refreshTeamDefinitions(), undefined,
    () => this.reloadPageConflict('teamDefinitions', () => this.refreshTeamDefinitions()))
  }

  /** Append a charter draft and retain its immutable revision for an explicit publish.
   * @param input - Input value used by this API.
   * @returns Result produced by this API.
   */
  async saveTeamDefinitionDraft(input: Omit<EnterpriseTeamDefinition, 'orgId' | 'revision' | 'createdAt' | 'updatedAt' | 'state'> & {
    state?: 'needs-charter' | 'draft'
    expectedRevision: number
  }): Promise<EnterpriseTeamDefinition | undefined> {
    let saved: EnterpriseTeamDefinition | undefined
    const success = await this.runMutation('team-definition-draft', async () => {
      saved = valueOf(await this.api.enterpriseTeamDefinitions.draft({
        ...input, idempotencyKey: mutationKey('team-definition-draft'),
      }))
      return saved
    }, () => this.refreshTeamDefinitions(), undefined,
    () => this.reloadPageConflict('teamDefinitions', () => this.refreshTeamDefinitions()))
    return success ? saved : undefined
  }

  /** Promote a previously saved charter draft for future TeamRuns.
   * @param input - Input value used by this API.
   * @returns Result produced by this API.
   */
  async publishTeamDefinitionDraft(input: { teamId: string; expectedRevision: number }): Promise<EnterpriseTeamDefinition | undefined> {
    let published: EnterpriseTeamDefinition | undefined
    const success = await this.runMutation('team-definition-publish', async () => {
      published = valueOf(await this.api.enterpriseTeamDefinitions.publish({
        ...input, idempotencyKey: mutationKey('team-definition-publish'),
      }))
      return published
    }, () => this.refreshTeamDefinitions(), undefined,
    () => this.reloadPageConflict('teamDefinitions', () => this.refreshTeamDefinitions()))
    return success ? published : undefined
  }

  /** Retrieve an owner-visible draft without replacing the active team catalog.
   * @param teamId - Input value used by this API.
   * @returns Result produced by this API.
   */
  async getTeamDefinitionDraft(teamId: string): Promise<EnterpriseTeamDefinition | undefined> {
    try { return valueOf(await this.api.enterpriseTeamDefinitions.getDraft({ teamId })) }
    catch { return undefined }
  }

  /**
   * Save one channel configuration; secret values are never accepted here.
   * @param input - provider account, Credential reference, DSH route, and write guards.
   * @returns whether the mutation and refresh completed successfully.
   */
  async saveChannelConfiguration(input: {
    channelId: string
    name: string
    provider: EnterpriseChannelConfiguration['provider']
    tenantId?: string
    accountId: string
    credentialRef?: string
    defaultEmployeeReleaseId?: string
    inboundEnabled: boolean
    state: 'draft' | 'active' | 'paused'
    expectedRevision: number
  }): Promise<boolean> {
    return this.runMutation('channel-save', async () => valueOf(await this.api.enterpriseChannels.save({
      ...input, idempotencyKey: mutationKey('channel-save'),
    })), () => this.refreshChannels(), undefined,
    () => this.reloadPageConflict('channels', () => this.refreshChannels()))
  }

  /**
   * Terminally archive one channel configuration.
   * @param channel - current revision of the channel configuration.
   */
  async archiveChannelConfiguration(channel: EnterpriseChannelConfiguration): Promise<void> {
    await this.runMutation('channel-archive', async () => valueOf(await this.api.enterpriseChannels.archive({
      channelId: channel.channelId, expectedRevision: channel.revision,
      idempotencyKey: mutationKey('channel-archive'),
    })), () => this.refreshChannels(), undefined,
    () => this.reloadPageConflict('channels', () => this.refreshChannels()))
  }

  /** Start one immutable Team Definition revision in an explicit Workspace.
   * @param input - Input value used by this API.
   * @returns Result produced by this API.
   */
  async startTeamRun(input: {
    teamId: string
    expectedTeamRevision: number
    workspaceId: string
    prompt: string
  }): Promise<boolean> {
    const idempotencyKey = mutationKey('team-run-start')
    return this.runMutation('team-run-start', async () => valueOf(await this.api.enterpriseTeamRuns.start({
      ...input, source: 'console', idempotencyKey,
    })), async () => {
      await Promise.all([this.refreshTeamRuns(), this.refreshTeamDecisions()])
    })
  }

  /** Cancel one non-terminal TeamRun.
   * @param run - Input value used by this API.
   */
  async cancelTeamRun(run: EnterpriseTeamRun): Promise<void> {
    await this.runMutation('team-run-cancel', async () => valueOf(await this.api.enterpriseTeamRuns.cancel({
      runId: run.runId, expectedRevision: run.revision, idempotencyKey: mutationKey('team-run-cancel'),
    })), () => this.refreshTeamRuns())
  }

  /** Answer one assigned Human decision.
   * @param answer - Input value used by this API.
   * @param decision - Input value used by this API.
   */
  async respondTeamDecision(decision: EnterpriseTeamDecision, answer: string): Promise<void> {
    await this.runMutation('team-decision-respond', async () => valueOf(await this.api.enterpriseTeamDecisions.respond({
      decisionId: decision.decisionId, answer, expectedRevision: decision.revision,
      idempotencyKey: mutationKey('team-decision-respond'),
    })), async () => {
      await Promise.all([this.refreshTeamDecisions(), this.refreshTeamRuns()])
    })
  }

  private async reloadPageConflict(
    key: 'workRecords' | 'approvals' | 'schedules' | 'assets' | 'teams' | 'channels' | 'teamDefinitions' | 'teamRuns' | 'teamDecisions' | 'teamAutonomy',
    refresh: () => Promise<boolean>,
  ): Promise<void> {
    await refresh()
    const page = this.store.getSnapshot()[key]
    if (page.phase === 'error' || page.phase === 'permission') {
      throw new Error(page.error ?? 'server reload failed')
    }
  }

  private async reloadEmployeeConflict(presetId: string): Promise<void> {
    await this.openEmployeeDraft(presetId)
    const editor = this.store.getSnapshot().employeeEditor
    if (editor?.phase === 'error') throw new Error(editor.error ?? 'server reload failed')
  }

  private async runMutation<T>(
    action: string,
    operation: () => Promise<T>,
    onSuccess: (value: T) => Promise<unknown> | void = () => {},
    onFailure: (error: unknown) => void = () => {},
    onConflict: () => Promise<unknown> | void = () => {},
  ): Promise<boolean> {
    const execute = async (): Promise<boolean> => {
      const attemptId = ++this.mutationAttemptId
      const before = this.store.getSnapshot()
      this.retryMutationAction = execute
      this.store.set({ ...before, mutationPhase: 'running', mutationError: null, retryAction: action })
      try {
        const value = await operation()
        if (attemptId !== this.mutationAttemptId) return false
        await onSuccess(value)
        if (attemptId !== this.mutationAttemptId) return false
        this.retryMutationAction = undefined
        this.conflictMutationAction = undefined
        this.store.set({
          ...this.store.getSnapshot(), mutationPhase: 'idle', mutationError: null, retryAction: null,
        })
        return true
      } catch (error) {
        if (attemptId !== this.mutationAttemptId) return false
        onFailure(error)
        const conflict = isMutationConflict(error)
        if (conflict) {
          this.retryMutationAction = undefined
          this.conflictMutationAction = async () => { await onConflict() }
        }
        this.store.set({
          ...this.store.getSnapshot(),
          mutationPhase: conflict ? 'conflict' : 'error',
          mutationError: error instanceof Error ? error.message : String(error),
          retryAction: conflict ? null : action,
        })
        return false
      }
    }
    return execute()
  }

  /** Retry the most recent contained mutation failure. */
  async retryMutation(): Promise<void> {
    if (this.store.getSnapshot().mutationPhase === 'conflict') return
    await this.retryMutationAction?.()
  }

  /** Reload authoritative state after a conflict without resubmitting the stale mutation. */
  async resolveMutationConflict(): Promise<void> {
    const resolve = this.conflictMutationAction
    if (resolve === undefined) return
    const attemptId = ++this.mutationAttemptId
    this.store.set({
      ...this.store.getSnapshot(), mutationPhase: 'running', mutationError: null, retryAction: 'conflict-reload',
    })
    try {
      await resolve()
      if (attemptId !== this.mutationAttemptId) return
      this.conflictMutationAction = undefined
      this.store.set({
        ...this.store.getSnapshot(), mutationPhase: 'idle', mutationError: null, retryAction: null,
      })
    } catch (error) {
      if (attemptId !== this.mutationAttemptId) return
      this.retryMutationAction = async () => {
        await this.resolveMutationConflict()
        return this.store.getSnapshot().mutationPhase === 'idle'
      }
      this.store.set({
        ...this.store.getSnapshot(), mutationPhase: 'error',
        mutationError: error instanceof Error ? error.message : String(error),
        retryAction: 'conflict-reload',
      })
    }
  }

  /** Dismiss the persistent mutation error and discard its retry closure. */
  dismissMutationError(): void {
    this.retryMutationAction = undefined
    this.conflictMutationAction = undefined
    this.store.set({
      ...this.store.getSnapshot(), mutationPhase: 'idle', mutationError: null, retryAction: null,
    })
  }

  /** Fold one legacy enterprise event while transports migrate to typed Remote events.
   * @param frame - Input value used by this API.
   */
  async handleHostFrame(frame: EnterpriseHostFrame): Promise<void> {
    if (this.seenEventIds.has(frame.eventId)) return
    const refreshByEvent: Record<Exclude<EnterpriseHostEventName, 'enterprise/operation-updated'>, () => Promise<boolean>> = {
      'enterprise/employee-updated': () => this.refreshEmployees(),
      'enterprise/asset-updated': () => this.refreshAssets(),
      'enterprise/team-updated': () => this.refreshTeams(),
      'enterprise/channel-updated': () => this.refreshChannels(),
      'enterprise/approval-requested': () => this.refreshApprovals(),
    }
    const refreshed = frame.event !== 'enterprise/operation-updated'
      ? await refreshByEvent[frame.event]()
      : frame.resourceType === 'approval' ? await this.refreshApprovals()
        : frame.resourceType === 'schedule' ? await this.refreshSchedules()
          : await this.refreshWorkRecords()
    if (!refreshed) return
    this.seenEventIds.add(frame.eventId)
    if (this.seenEventIds.size > 256) this.seenEventIds.delete(this.seenEventIds.values().next().value as string)
  }

  /** Create and open work under one Agent Preset.
   * @param employeeId - Input value used by this API.
   */
  async startEmployee(employeeId: string): Promise<void> {
    const existing = this.employeeStarts.get(employeeId)
    if (existing !== undefined) return existing
    const start = this.startEmployeeOnce(employeeId)
    this.employeeStarts.set(employeeId, start)
    try {
      await start
    } finally {
      if (this.employeeStarts.get(employeeId) === start) this.employeeStarts.delete(employeeId)
    }
  }

  private async startEmployeeOnce(employeeId: string): Promise<void> {
    const state = this.store.getSnapshot()
    this.store.set({ ...state, busyEmployee: employeeId, error: null })
    try {
      const workspaceId = this.workspaces.list.getSnapshot().items[0]?.workspaceId
      const sessionId = await this.sessions.create({
        ...(workspaceId === undefined ? {} : { workspaceId }),
        agentPreset: employeeId,
      })
      this.sessions.open(sessionId)
      this.close()
    } catch (error) {
      this.store.set({
        ...this.store.getSnapshot(),
        busyEmployee: null,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /** Open an existing work record in the native DSH conversation surface.
   * @param sessionId - Input value used by this API.
   */
  openRecord(sessionId: SessionId): void {
    this.sessions.open(sessionId)
    this.close()
  }
}
