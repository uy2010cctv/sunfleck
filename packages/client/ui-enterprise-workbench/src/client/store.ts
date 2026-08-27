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
  readonly conflictServerFields?: EnterpriseEmployeeDraftFields
  readonly conflictServerRevision?: number
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
    this.editorGeneration++
    const state = this.store.getSnapshot()
    this.store.set({ ...state, open: false, busyEmployee: null })
  }

  /** Change the overlay-local page. Dirty-editor confirmation stays in the view layer. */
  setPage(page: EnterpriseWorkbenchPage): void {
    if (page !== this.store.getSnapshot().page) this.editorGeneration++
    this.store.set({ ...this.store.getSnapshot(), page })
  }

  /** Replace server-side roster filters; the next refresh starts from the first cursor. */
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
  async refreshEmployees(): Promise<boolean> {
    const generation = ++this.employeeRequestGeneration
    const state = this.store.getSnapshot()
    const filters = state.employeeFilters
    this.store.set({ ...state, employees: { ...state.employees, phase: 'loading', error: null } })
    try {
      const page = valueOf(await this.api.enterpriseEmployees.list({ limit: 24, ...filters }))
      if (generation !== this.employeeRequestGeneration) return false
      this.store.set({ ...this.store.getSnapshot(), employees: {
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

  /** Append the next roster page using the current filters. */
  async loadMoreEmployees(): Promise<boolean> {
    const before = this.store.getSnapshot()
    if (before.employees.nextCursor === undefined || before.employees.phase === 'loading') return false
    const generation = ++this.employeeRequestGeneration
    this.store.set({ ...before, employees: { ...before.employees, phase: 'loading', error: null } })
    try {
      const page = valueOf(await this.api.enterpriseEmployees.list({
        limit: 24, cursor: before.employees.nextCursor, ...before.employeeFilters,
      }))
      if (generation !== this.employeeRequestGeneration) return false
      this.store.set({ ...this.store.getSnapshot(), employees: {
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

  private async loadPage<K extends 'workRecords' | 'approvals' | 'schedules' | 'assets' | 'teams'>(
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

  /** Refresh one PostgreSQL operations page. */
  refreshWorkRecords(): Promise<boolean> {
    return this.loadPage('workRecords', async () => valueOf(await this.api.enterpriseOperations.listWorkRecords({ limit: 50 })))
  }

  /** Refresh approvals. */
  refreshApprovals(): Promise<boolean> {
    return this.loadPage('approvals', async () => valueOf(await this.api.enterpriseOperations.listApprovals({ limit: 50 })))
  }

  /** Refresh schedules. */
  refreshSchedules(): Promise<boolean> {
    return this.loadPage('schedules', async () => valueOf(await this.api.enterpriseOperations.listSchedules({ limit: 50 })))
  }

  /** Refresh capability assets. */
  refreshAssets(): Promise<boolean> {
    return this.loadPage('assets', async () => valueOf(await this.api.enterpriseAssets.list({ limit: 50 })))
  }

  /** Refresh fixed teams. */
  refreshTeams(): Promise<boolean> {
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
    const generation = ++this.editorGeneration
    this.store.set({ ...this.store.getSnapshot(), employeeEditor: {
      phase: 'loading', releases: [], dirty: false, saving: false, conflict: false, errors: [], error: null,
    } })
    try {
      const [draft, releases] = await Promise.all([
        this.api.enterpriseEmployees.getDraft({ presetId }).then(valueOf),
        this.api.enterpriseEmployees.listReleases({ presetId }).then(valueOf),
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

  /** Patch local fields only; no write occurs until saveEmployeeDraft. */
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
    await this.runMutation('employee-save', async () => valueOf(await this.api.enterpriseEmployees.saveDraft({
      presetId, expectedRevision, idempotencyKey, visibility,
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
    }, async () => {
      const current = this.store.getSnapshot()
      const currentEditor = current.employeeEditor
      if (currentEditor?.fields === undefined) return
      const [serverDraft, releases] = await Promise.all([
        this.api.enterpriseEmployees.getDraft({ presetId }).then(valueOf),
        this.api.enterpriseEmployees.listReleases({ presetId }).then(valueOf),
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

  /** Roll back by publishing a historical release as a new release. */
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

  /** Update the real business state of one work record. */
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

  /** Approve or reject a pending enterprise approval. */
  async transitionApproval(approval: EnterpriseApproval, state: 'approved' | 'rejected', reason?: string): Promise<void> {
    const idempotencyKey = mutationKey('approval-transition')
    await this.runMutation('approval-transition', async () => valueOf(await this.api.enterpriseOperations.transitionApproval({
      approvalId: approval.approvalId, state, ...(reason === undefined ? {} : { reason }),
      expectedRevision: approval.revision, idempotencyKey,
    })), () => this.refreshApprovals(), undefined,
    () => this.reloadPageConflict('approvals', () => this.refreshApprovals()))
  }

  /** Cancel an approval request. */
  async cancelApproval(approval: EnterpriseApproval, reason?: string): Promise<void> {
    const idempotencyKey = mutationKey('approval-cancel')
    await this.runMutation('approval-cancel', async () => valueOf(await this.api.enterpriseOperations.cancelApproval({
      approvalId: approval.approvalId, ...(reason === undefined ? {} : { reason }),
      expectedRevision: approval.revision, idempotencyKey,
    })), () => this.refreshApprovals(), undefined,
    () => this.reloadPageConflict('approvals', () => this.refreshApprovals()))
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
  }): Promise<boolean> {
    const idempotencyKey = mutationKey('schedule-save')
    return this.runMutation('schedule-save', async () => valueOf(await this.api.enterpriseOperations.saveSchedule({
      ...input, idempotencyKey,
    })), () => this.refreshSchedules(), undefined,
    () => this.reloadPageConflict('schedules', () => this.refreshSchedules()))
  }

  /** Pause, resume, or archive a schedule. */
  async transitionSchedule(schedule: EnterpriseSchedule, state: EnterpriseSchedule['state']): Promise<void> {
    const idempotencyKey = mutationKey('schedule-transition')
    await this.runMutation('schedule-transition', async () => valueOf(await this.api.enterpriseOperations.transitionSchedule({
      scheduleId: schedule.scheduleId, state, expectedRevision: schedule.revision,
      idempotencyKey,
    })), () => this.refreshSchedules(), undefined,
    () => this.reloadPageConflict('schedules', () => this.refreshSchedules()))
  }

  /** Save a versioned capability asset. */
  async saveAssetVersion(input: {
    assetId: string
    kind: EnterpriseAssetKind
    name: string
    content: Readonly<Record<string, unknown>>
    expectedRevision: number
  }): Promise<boolean> {
    const idempotencyKey = mutationKey('asset-save')
    return this.runMutation('asset-save', async () => valueOf(await this.api.enterpriseAssets.saveVersion({
      ...input, idempotencyKey,
    })), () => this.refreshAssets(), undefined,
    () => this.reloadPageConflict('assets', () => this.refreshAssets()))
  }

  /** Archive a capability asset. */
  async archiveAsset(asset: EnterpriseAsset): Promise<void> {
    const idempotencyKey = mutationKey('asset-archive')
    await this.runMutation('asset-archive', async () => valueOf(await this.api.enterpriseAssets.archive({
      assetId: asset.assetId, expectedRevision: asset.revision, idempotencyKey,
    })), () => this.refreshAssets(), undefined,
    () => this.reloadPageConflict('assets', () => this.refreshAssets()))
  }

  /** Save a fixed employee team. */
  async saveTeam(input: {
    teamId: string
    leaderEmployeeReleaseId: string
    members: readonly EnterpriseTeamMember[]
    workflowTemplate: Readonly<Record<string, unknown>>
    approvalPolicy: Readonly<Record<string, unknown>>
    expectedRevision: number
  }): Promise<boolean> {
    const idempotencyKey = mutationKey('team-save')
    return this.runMutation('team-save', async () => valueOf(await this.api.enterpriseTeams.save({
      ...input, idempotencyKey,
    })), () => this.refreshTeams(), undefined,
    () => this.reloadPageConflict('teams', () => this.refreshTeams()))
  }

  private async reloadPageConflict(
    key: 'workRecords' | 'approvals' | 'schedules' | 'assets' | 'teams',
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

  /** Fold one HostFrame once and refresh only the owning enterprise read model. */
  async handleHostFrame(frame: HostFrame): Promise<void> {
    if (frame.type !== 'enterprise/event' || this.seenEventIds.has(frame.eventId)) return
    const refreshByEvent: Record<Exclude<EnterpriseHostEventName, 'enterprise/operation-updated'>, () => Promise<boolean>> = {
      'enterprise/employee-updated': () => this.refreshEmployees(),
      'enterprise/asset-updated': () => this.refreshAssets(),
      'enterprise/team-updated': () => this.refreshTeams(),
      'enterprise/approval-requested': () => this.refreshApprovals(),
    }
    let refreshed: boolean
    if (frame.event !== 'enterprise/operation-updated') {
      refreshed = await refreshByEvent[frame.event]()
    } else if (frame.resourceType === 'approval') refreshed = await this.refreshApprovals()
    else if (frame.resourceType === 'schedule') refreshed = await this.refreshSchedules()
    else refreshed = await this.refreshWorkRecords()
    if (!refreshed) return
    this.seenEventIds.add(frame.eventId)
    if (this.seenEventIds.size > 256) this.seenEventIds.delete(this.seenEventIds.values().next().value as string)
  }

  /** Create and open work under one Agent Preset. */
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
