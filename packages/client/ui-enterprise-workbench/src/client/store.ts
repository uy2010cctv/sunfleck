/** Pure enterprise projection over existing DSH Preset, Session, and Workspace facts. */

import type { IApiClient, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  AgentPresetEntry, EnterpriseApproval, EnterpriseAsset, EnterpriseAssetKind,
  EnterpriseBusinessState, EnterpriseEmployeeAssetRef, EnterpriseEmployeeDraft,
  EnterpriseEmployeeRelease, EnterpriseHostEventName, EnterpriseSchedule,
  EnterpriseScheduleTarget, EnterpriseTeam, EnterpriseTeamMember,
  EnterpriseVisibility, EnterpriseWorkRecord as EnterpriseOperationWorkRecord, HostFrame,
} from '@deepseek-ai/dsh-host-apiproxy/api'
import type {
  ISessions, IWorkspaces, SessionListState, SessionSummary, SnapshotStore, WorkspaceListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

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
export type EnterpriseWorkbenchPage = 'employees' | 'work-records' | 'approvals' | 'schedules' | 'assets' | 'teams'

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
  readonly employeeEditor?: EnterpriseEmployeeEditorState
  readonly mutationPhase: 'idle' | 'running' | 'error' | 'conflict'
  readonly mutationError: string | null
  readonly retryAction: string | null
}

/** True when a session has a user decision pending. */
function needsAttention(session: SessionSummary): boolean {
  return session.pendingInteraction !== undefined
}

/** Work-record status projected from existing session facts. */
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
  roster: readonly AgentPresetEntry[],
  sessions: SessionListState,
  workspaces: WorkspaceListState,
): EnterpriseView {
  const workByPreset = new Map<string, SessionSummary[]>()
  const visibleSessions = sessions.ids
    .map(id => sessions.byId[id])
    .filter((session): session is SessionSummary => session !== undefined && !session.blank)
  for (const session of visibleSessions) {
    if (session.agentPreset === undefined) continue
    const rows = workByPreset.get(session.agentPreset) ?? []
    rows.push(session)
    workByPreset.set(session.agentPreset, rows)
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
      const employee = session.agentPreset === undefined ? undefined : employeesById.get(session.agentPreset)
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
  mutationPhase: 'idle',
  mutationError: null,
  retryAction: null,
}

class EnterpriseApiError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
  }
}

function valueOf<T>(response: { result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } } }): T {
  if (!response.result.ok) throw new EnterpriseApiError(response.result.error.code, response.result.error.message)
  return response.result.value
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

/** Pure editor validation; strings are stable keys rendered by the UI dictionaries. */
export function validateEmployeeDraft(fields: EnterpriseEmployeeDraftFields): readonly string[] {
  const errors: string[] = []
  if (fields.name.trim() === '') errors.push('name-required')
  if (fields.prompt.trim() === '') errors.push('prompt-required')
  if (fields.modelRef.trim() === '') errors.push('model-required')
  return errors
}

function mutationKey(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`
}

/** Stateful adapter around the pure enterprise projection. */
export class EnterpriseWorkbenchController {
  /** Observable state consumed by both the sidebar trigger and overlay. */
  readonly store: SnapshotStore<EnterpriseWorkbenchState> = createSnapshotStore(INITIAL_STATE)
  private roster: readonly AgentPresetEntry[] = []
  private readonly seenEventIds = new Set<string>()
  private retryMutationAction: (() => Promise<void>) | undefined
  private saveGeneration = 0

  /**
   * @param api - existing Host API; only the Agent Preset roster is read.
   * @param sessions - existing Session list and creation service.
   * @param workspaces - existing Workspace list service.
   */
  constructor(
    private readonly api: Pick<IApiClient,
      'agentPresets' | 'enterpriseEmployees' | 'enterpriseAssets' | 'enterpriseTeams' | 'enterpriseOperations'>,
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
    const state = this.store.getSnapshot()
    this.store.set({ ...state, open: false, busyEmployee: null })
  }

  /** Change the overlay-local page. Dirty-editor confirmation stays in the view layer. */
  setPage(page: EnterpriseWorkbenchPage): void {
    this.store.set({ ...this.store.getSnapshot(), page })
  }

  /** Replace server-side roster filters; the next refresh starts from the first cursor. */
  setEmployeeFilters(filters: EnterpriseEmployeeFilters): void {
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
        this.refreshAssets(), this.refreshTeams(),
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

  private async refreshFallback(): Promise<void> {
    try {
      const response = await this.api.agentPresets.list({})
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

  /** Load the first filtered employee page. */
  async refreshEmployees(): Promise<void> {
    const state = this.store.getSnapshot()
    this.store.set({ ...state, employees: { ...state.employees, phase: 'loading', error: null } })
    try {
      const filters = this.store.getSnapshot().employeeFilters
      const page = valueOf(await this.api.enterpriseEmployees.list({ limit: 24, ...filters }))
      this.store.set({ ...this.store.getSnapshot(), employees: {
        phase: 'ready', items: page.items, error: null,
        ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
      } })
    } catch (error) {
      if (isUnavailable(error)) throw error
      const current = this.store.getSnapshot()
      this.store.set({ ...current, employees: pageFailure(current.employees, error) })
    }
  }

  /** Append the next roster page using the current filters. */
  async loadMoreEmployees(): Promise<void> {
    const before = this.store.getSnapshot()
    if (before.employees.nextCursor === undefined || before.employees.phase === 'loading') return
    this.store.set({ ...before, employees: { ...before.employees, phase: 'loading', error: null } })
    try {
      const page = valueOf(await this.api.enterpriseEmployees.list({
        limit: 24, cursor: before.employees.nextCursor, ...before.employeeFilters,
      }))
      this.store.set({ ...this.store.getSnapshot(), employees: {
        phase: 'ready', items: [...before.employees.items, ...page.items], error: null,
        ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
      } })
    } catch (error) {
      const current = this.store.getSnapshot()
      this.store.set({ ...current, employees: pageFailure(before.employees, error) })
    }
  }

  private async loadPage<K extends 'workRecords' | 'approvals' | 'schedules' | 'assets' | 'teams'>(
    key: K,
    load: () => Promise<{ items: EnterpriseWorkbenchState[K]['items']; nextCursor?: string }>,
  ): Promise<void> {
    const before = this.store.getSnapshot()
    const previous = before[key]
    this.store.set({ ...before, [key]: { ...previous, phase: 'loading', error: null } })
    try {
      const page = await load()
      this.store.set({ ...this.store.getSnapshot(), [key]: {
        phase: 'ready', items: page.items, error: null,
        ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
      } })
    } catch (error) {
      const current = this.store.getSnapshot()
      const permission = error instanceof EnterpriseApiError && error.code === 'enterprise-forbidden'
      this.store.set({ ...current, [key]: {
        ...previous,
        phase: permission ? 'permission' : 'error',
        error: error instanceof Error ? error.message : String(error),
      } })
    }
  }

  /** Refresh one PostgreSQL operations page. */
  refreshWorkRecords(): Promise<void> {
    return this.loadPage('workRecords', async () => valueOf(await this.api.enterpriseOperations.listWorkRecords({ limit: 50 })))
  }

  /** Refresh approvals. */
  refreshApprovals(): Promise<void> {
    return this.loadPage('approvals', async () => valueOf(await this.api.enterpriseOperations.listApprovals({ limit: 50 })))
  }

  /** Refresh schedules. */
  refreshSchedules(): Promise<void> {
    return this.loadPage('schedules', async () => valueOf(await this.api.enterpriseOperations.listSchedules({ limit: 50 })))
  }

  /** Refresh capability assets. */
  refreshAssets(): Promise<void> {
    return this.loadPage('assets', async () => valueOf(await this.api.enterpriseAssets.list({ limit: 50 })))
  }

  /** Refresh fixed teams. */
  refreshTeams(): Promise<void> {
    return this.loadPage('teams', async () => valueOf(await this.api.enterpriseTeams.list({ limit: 50 })))
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

  /** Load an employee draft and its immutable release history into the single-page editor. */
  async openEmployeeDraft(presetId: string): Promise<void> {
    this.store.set({ ...this.store.getSnapshot(), employeeEditor: {
      phase: 'loading', releases: [], dirty: false, saving: false, conflict: false, errors: [], error: null,
    } })
    try {
      const [draft, releases] = await Promise.all([
        this.api.enterpriseEmployees.getDraft({ presetId }).then(valueOf),
        this.api.enterpriseEmployees.listReleases({ presetId }).then(valueOf),
      ])
      const fields = draftFields(draft)
      this.store.set({ ...this.store.getSnapshot(), employeeEditor: {
        phase: 'ready', fields, revision: draft.revision, releases,
        dirty: false, saving: false, conflict: false, errors: [], error: null,
      } })
    } catch (error) {
      this.store.set({ ...this.store.getSnapshot(), employeeEditor: {
        phase: 'error', releases: [], dirty: false, saving: false, conflict: false, errors: [],
        error: error instanceof Error ? error.message : String(error),
      } })
    }
  }

  /** Patch local fields only; no write occurs until saveEmployeeDraft. */
  patchEmployeeDraft(patch: Partial<EnterpriseEmployeeDraftFields>): void {
    const state = this.store.getSnapshot()
    const editor = state.employeeEditor
    if (editor?.fields === undefined || editor.saving) return
    const fields = { ...editor.fields, ...patch }
    this.store.set({ ...state, employeeEditor: {
      ...editor, fields, dirty: true, conflict: false, errors: validateEmployeeDraft(fields), error: null,
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
    this.store.set({ ...before, employeeEditor: { ...editor, saving: true, conflict: false, error: null } })
    const { presetId, visibility, bindings, name, description, position, department, prompt, modelRef, capabilities } = editor.fields
    await this.runMutation('employee-save', async () => valueOf(await this.api.enterpriseEmployees.saveDraft({
      presetId, expectedRevision, idempotencyKey: mutationKey('employee-save'), visibility,
      profile: { name, description, position, department, prompt, modelRef, capabilities }, bindings,
    })), async (saved) => {
      const current = this.store.getSnapshot()
      const currentEditor = current.employeeEditor
      if (generation !== this.saveGeneration || currentEditor === undefined
        || currentEditor.revision !== expectedRevision) return
      this.store.set({ ...current, employeeEditor: {
        ...currentEditor, fields: draftFields(saved), revision: saved.revision,
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
    })
  }

  /** Publish the saved draft and refresh its release history. */
  async publishEmployee(): Promise<void> {
    const editor = this.store.getSnapshot().employeeEditor
    if (editor?.fields === undefined || editor.revision === undefined || editor.dirty) return
    const presetId = editor.fields.presetId
    const expectedRevision = editor.revision
    await this.runMutation('employee-publish', async () => valueOf(await this.api.enterpriseEmployees.publish({
      presetId, expectedRevision,
      idempotencyKey: mutationKey('employee-publish'),
    })), async () => {
      await this.openEmployeeDraft(presetId)
      await this.refreshEmployees()
    }, (error) => { this.setEditorFailure(error) })
  }

  /** Roll back by publishing a historical release as a new release. */
  async rollbackEmployee(releaseId: string): Promise<void> {
    const editor = this.store.getSnapshot().employeeEditor
    if (editor?.fields === undefined || editor.revision === undefined) return
    const presetId = editor.fields.presetId
    const expectedRevision = editor.revision
    await this.runMutation('employee-rollback', async () => valueOf(await this.api.enterpriseEmployees.rollback({
      presetId, releaseId, expectedRevision,
      idempotencyKey: mutationKey('employee-rollback'),
    })), async () => {
      await this.openEmployeeDraft(presetId)
      await this.refreshEmployees()
    }, (error) => { this.setEditorFailure(error) })
  }

  /** Close the editor after the view has handled dirty confirmation. */
  closeEmployeeEditor(): void {
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

  /** Update the real business state of one work record. */
  async updateWorkRecord(record: EnterpriseOperationWorkRecord, businessState: EnterpriseBusinessState): Promise<void> {
    await this.runMutation('work-record-update', async () => valueOf(await this.api.enterpriseOperations.updateWorkRecord({
      sessionId: record.sessionId, employeeReleaseId: record.employeeReleaseId,
      ...(record.teamId === undefined ? {} : { teamId: record.teamId }),
      source: record.source, businessState, sourceReferences: record.sourceReferences,
      expectedRevision: record.revision, idempotencyKey: mutationKey('work-record'),
    })), () => this.refreshWorkRecords())
  }

  /** Approve or reject a pending enterprise approval. */
  async transitionApproval(approval: EnterpriseApproval, state: 'approved' | 'rejected', reason?: string): Promise<void> {
    await this.runMutation('approval-transition', async () => valueOf(await this.api.enterpriseOperations.transitionApproval({
      approvalId: approval.approvalId, state, ...(reason === undefined ? {} : { reason }),
      expectedRevision: approval.revision, idempotencyKey: mutationKey('approval-transition'),
    })), () => this.refreshApprovals())
  }

  /** Cancel an approval request. */
  async cancelApproval(approval: EnterpriseApproval, reason?: string): Promise<void> {
    await this.runMutation('approval-cancel', async () => valueOf(await this.api.enterpriseOperations.cancelApproval({
      approvalId: approval.approvalId, ...(reason === undefined ? {} : { reason }),
      expectedRevision: approval.revision, idempotencyKey: mutationKey('approval-cancel'),
    })), () => this.refreshApprovals())
  }

  /** Create or edit a schedule. */
  async saveSchedule(input: {
    scheduleId: string
    target: EnterpriseScheduleTarget
    timezone: string
    rule: string
    input: Readonly<Record<string, unknown>>
    nextRunAt: number | null
    expectedRevision: number
  }): Promise<void> {
    await this.runMutation('schedule-save', async () => valueOf(await this.api.enterpriseOperations.saveSchedule({
      ...input, idempotencyKey: mutationKey('schedule-save'),
    })), () => this.refreshSchedules())
  }

  /** Pause, resume, or archive a schedule. */
  async transitionSchedule(schedule: EnterpriseSchedule, state: EnterpriseSchedule['state']): Promise<void> {
    await this.runMutation('schedule-transition', async () => valueOf(await this.api.enterpriseOperations.transitionSchedule({
      scheduleId: schedule.scheduleId, state, expectedRevision: schedule.revision,
      idempotencyKey: mutationKey('schedule-transition'),
    })), () => this.refreshSchedules())
  }

  /** Save a versioned capability asset. */
  async saveAssetVersion(input: {
    assetId: string
    kind: EnterpriseAssetKind
    name: string
    content: Readonly<Record<string, unknown>>
    expectedRevision: number
  }): Promise<void> {
    await this.runMutation('asset-save', async () => valueOf(await this.api.enterpriseAssets.saveVersion({
      ...input, idempotencyKey: mutationKey('asset-save'),
    })), () => this.refreshAssets())
  }

  /** Archive a capability asset. */
  async archiveAsset(asset: EnterpriseAsset): Promise<void> {
    await this.runMutation('asset-archive', async () => valueOf(await this.api.enterpriseAssets.archive({
      assetId: asset.assetId, expectedRevision: asset.revision, idempotencyKey: mutationKey('asset-archive'),
    })), () => this.refreshAssets())
  }

  /** Save a fixed employee team. */
  async saveTeam(input: {
    teamId: string
    leaderEmployeeReleaseId: string
    members: readonly EnterpriseTeamMember[]
    workflowTemplate: Readonly<Record<string, unknown>>
    approvalPolicy: Readonly<Record<string, unknown>>
    expectedRevision: number
  }): Promise<void> {
    await this.runMutation('team-save', async () => valueOf(await this.api.enterpriseTeams.save({
      ...input, idempotencyKey: mutationKey('team-save'),
    })), () => this.refreshTeams())
  }

  private async runMutation<T>(
    action: string,
    operation: () => Promise<T>,
    onSuccess: (value: T) => Promise<void> | void = () => {},
    onFailure: (error: unknown) => void = () => {},
  ): Promise<void> {
    const execute = async (): Promise<void> => {
      const before = this.store.getSnapshot()
      this.store.set({ ...before, mutationPhase: 'running', mutationError: null, retryAction: action })
      try {
        const value = await operation()
        await onSuccess(value)
        this.retryMutationAction = undefined
        this.store.set({
          ...this.store.getSnapshot(), mutationPhase: 'idle', mutationError: null, retryAction: null,
        })
      } catch (error) {
        onFailure(error)
        this.store.set({
          ...this.store.getSnapshot(),
          mutationPhase: isMutationConflict(error) ? 'conflict' : 'error',
          mutationError: error instanceof Error ? error.message : String(error),
          retryAction: action,
        })
      }
    }
    this.retryMutationAction = execute
    await execute()
  }

  /** Retry the most recent contained mutation failure. */
  async retryMutation(): Promise<void> {
    await this.retryMutationAction?.()
  }

  /** Dismiss the persistent mutation error and discard its retry closure. */
  dismissMutationError(): void {
    this.retryMutationAction = undefined
    this.store.set({
      ...this.store.getSnapshot(), mutationPhase: 'idle', mutationError: null, retryAction: null,
    })
  }

  /** Fold one HostFrame once and refresh only the owning enterprise read model. */
  async handleHostFrame(frame: HostFrame): Promise<void> {
    if (frame.type !== 'enterprise/event' || this.seenEventIds.has(frame.eventId)) return
    this.seenEventIds.add(frame.eventId)
    if (this.seenEventIds.size > 256) this.seenEventIds.delete(this.seenEventIds.values().next().value as string)
    const refreshByEvent: Record<Exclude<EnterpriseHostEventName, 'enterprise/operation-updated'>, () => Promise<void>> = {
      'enterprise/employee-updated': () => this.refreshEmployees(),
      'enterprise/asset-updated': () => this.refreshAssets(),
      'enterprise/team-updated': () => this.refreshTeams(),
      'enterprise/approval-requested': () => this.refreshApprovals(),
    }
    if (frame.event !== 'enterprise/operation-updated') {
      await refreshByEvent[frame.event]()
      return
    }
    if (frame.resourceType === 'approval') await this.refreshApprovals()
    else if (frame.resourceType === 'schedule') await this.refreshSchedules()
    else await this.refreshWorkRecords()
  }

  /** Create and open work under one Agent Preset. */
  async startEmployee(employeeId: string): Promise<void> {
    const state = this.store.getSnapshot()
    this.store.set({ ...state, busyEmployee: employeeId, error: null })
    try {
      const workspaceId = this.workspaces.list.getSnapshot().recentWorkspaceId
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

  /** Open an existing work record in the native DSH conversation surface. */
  openRecord(sessionId: SessionId): void {
    this.sessions.open(sessionId)
    this.close()
  }
}
