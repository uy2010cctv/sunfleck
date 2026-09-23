/** Persistent employee directory with one direct-message entry, rendered with the workbench row primitives. */
import { useEffect, useState } from 'react'
import { IconUserOutline16, IconWarningOutline16, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { EnterpriseWorkbenchKey } from './locales.ts'
import type {
  EmployeeMemoryEntryView, EmployeeSendError, EmployeeSummary, EmployeeSummaryState,
  EnterpriseStaffMemoriesState, EnterpriseStaffState,
} from './store.ts'
import css from './EnterpriseWorkbench.module.css'

type Translate = (key: EnterpriseWorkbenchKey, params?: Record<string, string | number>) => string

const STAFF_STATE_KEYS = {
  active: 'staff.state.active',
  suspended: 'staff.state.suspended',
  archived: 'staff.state.archived',
} as const satisfies Record<EmployeeSummaryState, EnterpriseWorkbenchKey>

/** Green for an active employee, amber while suspended, grey once archived. */
function staffDot(state: EmployeeSummaryState): 'ongoing' | 'warning' | 'idle' {
  if (state === 'active') return 'ongoing'
  return state === 'suspended' ? 'warning' : 'idle'
}

/** Compartments the governance view counts as dots, in display order. */
const MEMORY_SCOPES = ['organization', 'department', 'agent'] as const
type MemoryDotScope = (typeof MEMORY_SCOPES)[number]

const MEMORY_SCOPE_DOTS: Record<MemoryDotScope, StateDotState> = {
  organization: 'ongoing',
  department: 'done',
  agent: 'idle',
}

const MEMORY_SCOPE_KEYS: Record<MemoryDotScope, EnterpriseWorkbenchKey> = {
  organization: 'staff.memoryScope.organization',
  department: 'staff.memoryScope.department',
  agent: 'staff.memoryScope.agent',
}

const MEMORY_STATUS_KEYS: Record<EmployeeMemoryEntryView['status'], EnterpriseWorkbenchKey> = {
  proposed: 'staff.memoryStatus.proposed',
  approved: 'staff.memoryStatus.approved',
  rejected: 'staff.memoryStatus.rejected',
  retired: 'staff.memoryStatus.retired',
}

function EmployeeStatus({ state, className, t }: {
  state: EmployeeSummaryState
  className: string | undefined
  t: Translate
}) {
  const label = t(STAFF_STATE_KEYS[state])
  // StateDot renders aria-hidden, so the wrapper carries the accessible state name.
  return <span className={className} role="img" aria-label={label}>
    <StateDot state={staffDot(state)}/><span>{label}</span>
  </span>
}

function memoryDays(createdAt: number): number {
  return Math.max(0, Math.floor((Date.now() - createdAt) / 86_400_000))
}

/** Compartment dots: approved entries per scope, plus the proposed-review queue count. */
function MemoryDots({ entries, t }: {
  entries: readonly EmployeeMemoryEntryView[]
  t: Translate
}) {
  const counts: Record<MemoryDotScope, number> = { organization: 0, department: 0, agent: 0 }
  let proposed = 0
  for (const entry of entries) {
    if (entry.status === 'proposed') proposed += 1
    else if (entry.status === 'approved' && entry.scope !== 'pair' && entry.scope !== 'project') {
      counts[entry.scope] += 1
    }
  }
  return <div className={css.memoryDots} aria-label={t('staff.memoryAria')}>
    {MEMORY_SCOPES.map(scope => <span key={scope} role="img"
      aria-label={t(MEMORY_SCOPE_KEYS[scope], { count: counts[scope] })}>
      <StateDot state={MEMORY_SCOPE_DOTS[scope]}/><span>{counts[scope]}</span>
    </span>)}
    <span role="img" aria-label={t('staff.memoryQueue', { count: proposed })}>
      <StateDot state="warning"/><span>{proposed}</span>
    </span>
  </div>
}

function MemoryRow({ employeeId, entry, reviewEmployeeMemory, retireEmployeeMemory, t }: {
  employeeId: string
  entry: EmployeeMemoryEntryView
  reviewEmployeeMemory: (
    employeeId: string, memoryId: string, decision: 'approved' | 'rejected', revision: number,
  ) => Promise<boolean>
  retireEmployeeMemory: (employeeId: string, memoryId: string, revision: number) => Promise<boolean>
  t: Translate
}) {
  const shared = entry.scope === 'organization' || entry.scope === 'department' || entry.scope === 'agent'
  const dot = shared ? MEMORY_SCOPE_DOTS[entry.scope] : 'idle'
  // The row dot is decorative; the dots row and the summary text carry the accessible names.
  return <li className={css.memoryRow}>
    <span aria-hidden="true"><StateDot state={dot}/></span>
    <span className={css.memorySummary}>{entry.summary}</span>
    <span className={css.memoryStatus} data-status={entry.status}>{t(MEMORY_STATUS_KEYS[entry.status])}</span>
    <span className={css.memoryAge}>{t('staff.memoryAge', { count: memoryDays(entry.createdAt) })}</span>
    {entry.status === 'proposed' && <>
      <button type="button" className={css.secondaryButton}
        aria-label={t('staff.memoryApproveAria', { summary: entry.summary })}
        onClick={() => { void reviewEmployeeMemory(employeeId, entry.id, 'approved', entry.revision) }}>
        {t('staff.memoryApprove')}
      </button>
      <button type="button" className={css.secondaryButton}
        aria-label={t('staff.memoryRejectAria', { summary: entry.summary })}
        onClick={() => { void reviewEmployeeMemory(employeeId, entry.id, 'rejected', entry.revision) }}>
        {t('staff.memoryReject')}
      </button>
    </>}
    {entry.status === 'approved' && entry.scope === 'agent' && <button type="button" className={css.secondaryButton}
      aria-label={t('staff.memoryRetireAria', { summary: entry.summary })}
      onClick={() => { void retireEmployeeMemory(employeeId, entry.id, entry.revision) }}>
      {t('staff.memoryRetire')}
    </button>}
  </li>
}

function EmployeeMemorySection({ employee, memories, loadEmployeeMemories, reviewEmployeeMemory, retireEmployeeMemory, t }: {
  employee: EmployeeSummary
  memories: EnterpriseStaffMemoriesState
  loadEmployeeMemories: (employeeId: string) => Promise<boolean>
  reviewEmployeeMemory: (
    employeeId: string, memoryId: string, decision: 'approved' | 'rejected', revision: number,
  ) => Promise<boolean>
  retireEmployeeMemory: (employeeId: string, memoryId: string, revision: number) => Promise<boolean>
  t: Translate
}) {
  useEffect(() => {
    void loadEmployeeMemories(employee.id)
  }, [employee.id, loadEmployeeMemories])
  return <>
    <MemoryDots entries={memories.entries} t={t}/>
    {memories.phase === 'error'
      ? <div className={css.inlineError} role="alert">
        <strong>{t('staff.memoryLoadError')}</strong><span>{memories.error}</span>
        <button type="button" className={css.secondaryButton}
          onClick={() => { void loadEmployeeMemories(employee.id) }}>{t('retry')}</button>
      </div>
      : memories.phase === 'idle' || memories.phase === 'loading'
        ? <p className={css.description}>{t('staff.memoryLoading')}</p>
        : memories.entries.length === 0
          ? <p className={css.description}>{t('staff.memoryEmpty')}</p>
          : <ul className={css.memoryList}>
            {memories.entries.map(entry => <MemoryRow key={entry.id} employeeId={employee.id} entry={entry}
              reviewEmployeeMemory={reviewEmployeeMemory} retireEmployeeMemory={retireEmployeeMemory} t={t}/>)}
          </ul>}
  </>
}

function EmployeeDetail({
  employee, memories, loadEmployeeMemories, reviewEmployeeMemory, retireEmployeeMemory,
  sendMessage, selectEmployee, sending, sendError, t,
}: {
  employee: EmployeeSummary
  memories: EnterpriseStaffMemoriesState
  loadEmployeeMemories: (employeeId: string) => Promise<boolean>
  reviewEmployeeMemory: (
    employeeId: string, memoryId: string, decision: 'approved' | 'rejected', revision: number,
  ) => Promise<boolean>
  retireEmployeeMemory: (employeeId: string, memoryId: string, revision: number) => Promise<boolean>
  sendMessage: (employeeId: string, text: string) => Promise<boolean>
  selectEmployee: (employeeId?: string) => void
  sending: boolean
  sendError: EmployeeSendError | null
  t: Translate
}) {
  const [draft, setDraft] = useState('')
  const send = (): void => {
    const text = draft.trim()
    if (text === '') return
    void sendMessage(employee.id, text).then((delivered) => { if (delivered) setDraft('') })
  }
  return <>
    <div className={css.employeeActions}>
      <button type="button" className={css.secondaryButton} onClick={() => { selectEmployee() }}>{t('staff.back')}</button>
    </div>
    <article className={css.employeeCard} aria-label={t('staff.detailAria', { name: employee.displayName })}>
      <div className={css.employeeHead}>
        <span className={css.badge} aria-hidden="true">{employee.displayName.slice(0, 1)}</span>
        <div className={css.employeeIdentity}>
          <div className={css.employeeNameRow}><h3>{employee.displayName}</h3></div>
        </div>
        <EmployeeStatus state={employee.state} className={css.status} t={t}/>
      </div>
      <p className={css.description}>{t('staff.roleCardValue', { value: employee.roleCard })}</p>
      <EmployeeMemorySection
        employee={employee}
        memories={memories}
        loadEmployeeMemories={loadEmployeeMemories}
        reviewEmployeeMemory={reviewEmployeeMemory}
        retireEmployeeMemory={retireEmployeeMemory}
        t={t}
      />
      {sendError !== null && <div className={css.inlineError} role="alert">
        {t(`staff.sendError.${sendError}`, { name: employee.displayName })}
      </div>}
      <div className={css.employeeFoot}>
        <form className={css.startWorkActions} onSubmit={(event) => { event.preventDefault(); send() }}>
          <label className={css.searchField}>
            <span className={css.visuallyHidden}>{t('staff.sendLabel', { name: employee.displayName })}</span>
            <input
              value={draft}
              placeholder={t('staff.sendPlaceholder', { name: employee.displayName })}
              disabled={sending}
              onChange={(event) => { setDraft(event.target.value) }}
            />
          </label>
          <button type="submit" className={css.primaryButton} disabled={sending || draft.trim() === ''}>
            {sending ? t('staff.sending') : t('staff.send')}
          </button>
        </form>
      </div>
    </article>
  </>
}

export interface EmployeeDirectoryProps {
  readonly staff: EnterpriseStaffState
  readonly memories: EnterpriseStaffMemoriesState
  readonly loadEmployees: () => Promise<boolean>
  readonly loadEmployeeMemories: (employeeId: string) => Promise<boolean>
  readonly reviewEmployeeMemory: (
    employeeId: string, memoryId: string, decision: 'approved' | 'rejected', revision: number,
  ) => Promise<boolean>
  readonly retireEmployeeMemory: (employeeId: string, memoryId: string, revision: number) => Promise<boolean>
  readonly sendMessage: (employeeId: string, text: string) => Promise<boolean>
  readonly selectEmployee: (employeeId?: string) => void
  readonly t: Translate
}

/** Persistent employee list where one selected row opens the detail pane with the dm entry. */
export function EmployeeDirectory(props: EmployeeDirectoryProps) {
  const {
    staff, memories, loadEmployees, loadEmployeeMemories, reviewEmployeeMemory,
    retireEmployeeMemory, sendMessage, selectEmployee, t,
  } = props
  useEffect(() => {
    if (staff.phase === 'idle') void loadEmployees()
  }, [staff.phase, loadEmployees])
  const selected = staff.selected
  return <section aria-labelledby="employee-directory-title">
    <div className={css.sectionHead}>
      <h2 id="employee-directory-title">{t('staff.heading')}</h2>
      <span aria-live="polite">{staff.list.length}</span>
    </div>
    {staff.phase === 'error' ? <div className={css.empty} role="alert">
      <IconWarningOutline16 size={20}/><strong>{t('staff.loadError')}</strong><span>{staff.error}</span>
      <button type="button" className={css.secondaryButton} onClick={() => { void loadEmployees() }}>{t('retry')}</button>
    </div>
      : selected !== undefined ? <EmployeeDetail
        employee={selected}
        memories={memories}
        loadEmployeeMemories={loadEmployeeMemories}
        reviewEmployeeMemory={reviewEmployeeMemory}
        retireEmployeeMemory={retireEmployeeMemory}
        sendMessage={sendMessage}
        selectEmployee={selectEmployee}
        sending={staff.sending}
        sendError={staff.sendError}
        t={t}
      />
        : staff.phase === 'idle' ? null
          : staff.list.length === 0 ? (staff.phase === 'loading'
            ? <div className={css.loading} role="status"><span className={css.skeleton}/>{t('loading')}</div>
            : <div className={css.empty}><IconUserOutline16 size={20}/><span>{t('staff.empty')}</span></div>)
            : <div className={css.rows}>{staff.list.map(employee => <button
              type="button"
              key={employee.id}
              className={css.record}
              aria-label={t('staff.select', { name: employee.displayName })}
              onClick={() => { selectEmployee(employee.id) }}
            >
              <EmployeeStatus state={employee.state} className={css.recordStatus} t={t}/>
              <span className={css.recordMain}>
                <span className={css.employeeNameRow}>
                  <span className={css.badge} aria-hidden="true">{employee.displayName.slice(0, 1)}</span>
                  <strong>{employee.displayName}</strong>
                </span>
                <span>{employee.roleCard}</span>
              </span>
            </button>)}</div>}
  </section>
}
