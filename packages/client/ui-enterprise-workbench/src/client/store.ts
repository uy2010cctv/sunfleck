/** Pure enterprise projection over existing DSH Preset, Session, and Workspace facts. */

import type { IApiClient, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { AgentPresetEntry } from '@deepseek-ai/dsh-host-apiproxy/api'
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

/** Browser lifecycle for the enterprise workbench. */
export interface EnterpriseWorkbenchState {
  readonly open: boolean
  readonly phase: 'idle' | 'loading' | 'ready' | 'error'
  readonly view?: EnterpriseView
  readonly error: string | null
  readonly busyEmployee: string | null
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

const INITIAL_STATE: EnterpriseWorkbenchState = {
  open: false,
  phase: 'idle',
  error: null,
  busyEmployee: null,
}

/** Stateful adapter around the pure enterprise projection. */
export class EnterpriseWorkbenchController {
  /** Observable state consumed by both the sidebar trigger and overlay. */
  readonly store: SnapshotStore<EnterpriseWorkbenchState> = createSnapshotStore(INITIAL_STATE)
  private roster: readonly AgentPresetEntry[] = []

  /**
   * @param api - existing Host API; only the Agent Preset roster is read.
   * @param sessions - existing Session list and creation service.
   * @param workspaces - existing Workspace list service.
   */
  constructor(
    private readonly api: Pick<IApiClient, 'agentPresets'>,
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

  /** Toggle workbench visibility. */
  toggle(): void {
    if (this.store.getSnapshot().open) this.close()
    else this.open()
  }

  /** Reload the Agent Preset roster, then fold current Session and Workspace state. */
  async refresh(): Promise<void> {
    const before = this.store.getSnapshot()
    this.store.set({ ...before, phase: 'loading', error: null })
    try {
      const response = await this.api.agentPresets.list({})
      if (!response.result.ok) throw new Error(response.result.error.message)
      this.roster = response.result.value.presets
      this.store.set({
        ...this.store.getSnapshot(),
        phase: 'ready',
        error: null,
        view: deriveEnterpriseView(
          this.roster,
          this.sessions.list.getSnapshot(),
          this.workspaces.list.getSnapshot(),
        ),
      })
    } catch (error) {
      this.store.set({
        ...this.store.getSnapshot(),
        phase: 'error',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /** Re-fold volatile operations state while retaining the loaded roster. */
  recompute(): void {
    const state = this.store.getSnapshot()
    if (state.phase !== 'ready') return
    this.store.set({
      ...state,
      view: deriveEnterpriseView(
        this.roster,
        this.sessions.list.getSnapshot(),
        this.workspaces.list.getSnapshot(),
      ),
    })
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
