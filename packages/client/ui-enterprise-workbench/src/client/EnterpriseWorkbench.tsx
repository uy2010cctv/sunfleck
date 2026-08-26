/** Enterprise digital-employee roster and operations overlay. */

import { useEffect, useRef } from 'react'
import {
  IconCheckOutline16, IconCloseOutline16, IconPlayOutline16, IconRefreshOutline16,
  IconUserOutline16, IconWarningOutline16, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { NS, type EnterpriseWorkbenchKey } from './locales.ts'
import type {
  EmployeeOperationalState, EnterpriseEmployeeView, EnterpriseWorkbenchState,
  EnterpriseWorkRecord, WorkRecordState,
} from './store.ts'
import css from './EnterpriseWorkbench.module.css'

/** Registration-side business face shared by the trigger and overlay. */
export interface EnterpriseWorkbenchInjected {
  hooks: { enterprise: SnapshotStore<EnterpriseWorkbenchState> }
  close: () => void
  refresh: () => Promise<void>
  startEmployee: (employeeId: string) => Promise<void>
  openRecord: (sessionId: SessionId) => void
}

/** Full workbench slot props. */
export type EnterpriseWorkbenchProps =
  PropsRuntime<'shell.overlay'>
  & PropsLocale<typeof NS>
  & InjectFace<EnterpriseWorkbenchInjected>

type Translate = (key: EnterpriseWorkbenchKey, params?: Record<string, string | number>) => string

/** Human and visual status pairing for one employee. */
function employeeStatus(status: EmployeeOperationalState, t: Translate) {
  switch (status) {
    case 'active': return { label: t('status.active'), dot: 'ongoing' as const }
    case 'attention': return { label: t('status.attention'), dot: 'warning' as const }
    case 'ready': return { label: t('status.ready'), dot: 'done' as const }
    case 'unavailable': return { label: t('status.unavailable'), dot: 'error' as const }
  }
}

/** Human and visual status pairing for one work record. */
function recordStatus(status: WorkRecordState, t: Translate) {
  switch (status) {
    case 'running': return { label: t('record.running'), dot: 'ongoing' as const }
    case 'attention': return { label: t('record.attention'), dot: 'warning' as const }
    case 'completed': return { label: t('record.completed'), dot: 'done' as const }
    case 'ready': return { label: t('record.ready'), dot: 'done' as const }
  }
}

/** One Agent Preset rendered as a digital employee. */
function EmployeeCard({ employee, busy, start, t }: {
  employee: EnterpriseEmployeeView
  busy: boolean
  start: (employeeId: string) => Promise<void>
  t: Translate
}) {
  const status = employeeStatus(employee.status, t)
  const unavailable = employee.status === 'unavailable'
  const actionLabel = unavailable
    ? t('employee.unavailable', { name: employee.name })
    : t('employee.start', { name: employee.name })
  return (
    <article className={css.employeeCard} data-status={employee.status}>
      <div className={css.employeeHead}>
        <div className={css.avatar} aria-hidden="true">{employee.name.slice(0, 2)}</div>
        <div className={css.employeeIdentity}>
          <div className={css.employeeNameRow}>
            <h3>{employee.name}</h3>
            {employee.isDefault && <span className={css.badge}>{t('employee.default')}</span>}
            {employee.custom && <span className={css.badge}>{t('employee.custom')}</span>}
          </div>
          <div className={css.employeeMeta}>
            <span>{employee.position ?? employee.description ?? employee.employeeCode}</span>
            {employee.department !== undefined && <span>{employee.department}</span>}
          </div>
        </div>
        <div className={css.status}>
          <StateDot state={status.dot} />
          <span>{status.label}</span>
        </div>
      </div>
      {employee.description !== undefined && employee.position !== undefined
        ? <p className={css.description}>{employee.description}</p>
        : null}
      <div className={css.capabilities} aria-label={employee.capabilities.join(', ')}>
        {employee.capabilities.map(capability => <span key={capability}>{capability}</span>)}
      </div>
      <div className={css.employeeFoot}>
        <span className={css.workCount}>{t('employee.work', { count: employee.recentWork })}</span>
        <button
          type="button"
          className={css.startButton}
          aria-label={actionLabel}
          disabled={unavailable || busy}
          onClick={() => { void start(employee.id) }}
        >
          {busy ? <IconRefreshOutline16 className={css.spin} size={16} /> : <IconPlayOutline16 size={16} />}
          <span>{busy ? t('employee.busy') : unavailable ? status.label : t('employee.action')}</span>
        </button>
      </div>
      {employee.unavailableReason !== undefined
        ? <p className={css.unavailableReason}><IconWarningOutline16 size={14} />{employee.unavailableReason}</p>
        : null}
    </article>
  )
}

/** One Session summary rendered as a work record. */
function WorkRecord({ record, open, t }: {
  record: EnterpriseWorkRecord
  open: (sessionId: SessionId) => void
  t: Translate
}) {
  const status = recordStatus(record.state, t)
  const updated = new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(record.updatedAt)
  return (
    <button
      type="button"
      className={css.record}
      aria-label={t('record.open', { title: record.title })}
      onClick={() => { open(record.sessionId) }}
    >
      <span className={css.recordStatus}><StateDot state={status.dot} />{status.label}</span>
      <span className={css.recordMain}>
        <strong>{record.title}</strong>
        <span>
          {record.employeeName ?? t('record.unassigned')}
          {record.workspaceTitle === undefined ? '' : ` · ${record.workspaceTitle}`}
        </span>
      </span>
      <time className={css.recordTime} dateTime={new Date(record.updatedAt).toISOString()}>{updated}</time>
    </button>
  )
}

/** Full enterprise workbench overlay. */
export function EnterpriseWorkbench({
  useEnterprise, close, refresh, startEmployee, openRecord, t,
}: EnterpriseWorkbenchProps) {
  const state = useEnterprise(snapshot => snapshot)
  const dialogRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!state.open) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    return () => { previous?.focus() }
  }, [state.open])
  if (!state.open) return null

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape') {
      close()
      return
    }
    if (event.key !== 'Tab') return
    const controls = [...dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ) ?? []]
    const first = controls[0]
    const last = controls.at(-1)
    if (first === undefined || last === undefined) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const view = state.view
  return (
    <section
      ref={dialogRef}
      className={css.workbench}
      role="dialog"
      aria-modal="true"
      aria-label={t('title')}
      onKeyDown={handleDialogKeyDown}
    >
      <header className={css.header}>
        <div>
          <h1>{t('title')}</h1>
          <p>{t('subtitle')}</p>
        </div>
        <div className={css.headerActions}>
          <button type="button" className={css.iconButton} aria-label={t('refresh')} onClick={() => { void refresh() }}>
            <IconRefreshOutline16 size={16} />
          </button>
          <button ref={closeRef} type="button" className={css.iconButton} aria-label={t('close')} onClick={close}>
            <IconCloseOutline16 size={16} />
          </button>
        </div>
      </header>

      {state.phase === 'loading' && view === undefined
        ? <div className={css.loading} role="status"><span className={css.skeleton} />{t('loading')}</div>
        : null}
      {state.phase === 'error'
        ? (
          <div className={css.error} role="alert">
            <IconWarningOutline16 size={18} />
            <span>{state.error}</span>
            <button type="button" onClick={() => { void refresh() }}>{t('retry')}</button>
          </div>
        )
        : null}

      {view !== undefined && (
        <div className={css.body}>
          <dl className={css.metrics} aria-label={t('metrics.aria')}>
            {([
              ['metrics.employees', view.metrics.employees],
              ['metrics.active', view.metrics.active],
              ['metrics.attention', view.metrics.attention],
              ['metrics.records', view.metrics.workRecords],
            ] as const).map(([label, value]) => (
              <div key={label}><dt>{t(label)}</dt><dd>{value}</dd></div>
            ))}
          </dl>

          {state.error !== null && state.phase !== 'error'
            ? <div className={css.inlineError} role="alert"><IconWarningOutline16 size={14} />{state.error}</div>
            : null}

          <div className={css.content}>
            <section className={css.employees} aria-labelledby="enterprise-employees-title">
              <div className={css.sectionHead}>
                <h2 id="enterprise-employees-title">{t('employees.title')}</h2>
                <span>{view.metrics.employees}</span>
              </div>
              {view.employees.length === 0
                ? (
                  <div className={css.empty}>
                    <IconUserOutline16 size={20} />
                    <strong>{t('employees.empty.title')}</strong>
                    <span>{t('employees.empty.body')}</span>
                  </div>
                )
                : (
                  <div className={css.employeeGrid}>
                    {view.employees.map(employee => (
                      <EmployeeCard
                        key={employee.id}
                        employee={employee}
                        busy={state.busyEmployee === employee.id}
                        start={startEmployee}
                        t={t}
                      />
                    ))}
                  </div>
                )}
            </section>

            <section className={css.records} aria-labelledby="enterprise-records-title">
              <div className={css.sectionHead}>
                <h2 id="enterprise-records-title">{t('records.title')}</h2>
                <span>{view.metrics.workRecords}</span>
              </div>
              {view.records.length === 0
                ? <div className={css.empty}><IconCheckOutline16 size={20} /><span>{t('records.empty')}</span></div>
                : (
                  <div className={css.recordList}>
                    {view.records.map(record => (
                      <WorkRecord key={record.sessionId} record={record} open={openRecord} t={t} />
                    ))}
                  </div>
                )}
            </section>
          </div>
        </div>
      )}
    </section>
  )
}
