/** Persistent employee directory with one direct-message entry, rendered with the workbench row primitives. */
import { useEffect, useState } from 'react'
import { IconUserOutline16, IconWarningOutline16, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { EnterpriseWorkbenchKey } from './locales.ts'
import type {
  EmployeeSendError, EmployeeSummary, EmployeeSummaryState, EnterpriseStaffState,
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

function EmployeeDetail({ employee, sendMessage, selectEmployee, sending, sendError, t }: {
  employee: EmployeeSummary
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
      <div className={css.assetStats} aria-label={t('staff.memoryAria')}>
        <span>{t('staff.memory', { count: t('staff.memoryPlaceholder') })}</span>
      </div>
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
  readonly loadEmployees: () => Promise<boolean>
  readonly sendMessage: (employeeId: string, text: string) => Promise<boolean>
  readonly selectEmployee: (employeeId?: string) => void
  readonly t: Translate
}

/** Persistent employee list where one selected row opens the detail pane with the dm entry. */
export function EmployeeDirectory({ staff, loadEmployees, sendMessage, selectEmployee, t }: EmployeeDirectoryProps) {
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
