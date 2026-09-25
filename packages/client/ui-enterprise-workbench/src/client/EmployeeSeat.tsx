/** Separate new-session picker for published digital employees. */
import { useEffect, useState } from 'react'
import { Menu, Toast, IconWarningOutlineRegular, IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AgentPresetRow } from '@deepseek-ai/dsh-agent-preset-registry/types'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './EmployeeSeat.module.css'

/** Host actions for the current blank Session. */
export interface EmployeeSeatInjected {
  load: (sessionId: string) => Promise<{ employees: readonly AgentPresetRow[]; selectedId?: string; unavailable: boolean }>
  select: (sessionId: string, employeeId: string) => Promise<void>
  currentPreset: (sessionId: string) => string | undefined
  subscribe: (listener: () => void) => () => void
}

/** Render an authorized employee choice beside the work-mode picker. */
export function EmployeeSeat({ sessionId, load, select, currentPreset, subscribe, t }: PropsRuntime<'conversation.hero.employee'>
  & PropsLocale<'enterprise.workbench'> & InjectFace<EmployeeSeatInjected>) {
  const [rows, setRows] = useState<readonly AgentPresetRow[]>([])
  const [selected, setSelected] = useState<string>()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string>()
  useEffect(() => {
    if (sessionId === undefined) return
    const refresh = () => {
      const preset = currentPreset(sessionId)
      setSelected(rows.some(row => row.id === preset) ? preset : undefined)
    }
    return subscribe(refresh)
  }, [sessionId, rows, currentPreset, subscribe])
  useEffect(() => {
    if (sessionId === undefined) return
    let live = true
    void load(sessionId).then((result) => {
      if (!live) return
      setRows(result.employees)
      setSelected(result.selectedId)
      if (result.unavailable) setNotice(t('employeeSeat.unavailable'))
    }).catch(() => { if (live) setNotice(t('employeeSeat.loadFailed')) })
    return () => { live = false }
  }, [sessionId, load, t])
  if (sessionId === undefined || rows.length === 0) return notice === undefined ? null : <p role="alert">{notice}</p>
  const selectedRow = rows.find(row => row.id === selected)
  return <>
    <Menu open={open} onClose={() => { setOpen(false) }} selectedId={selected}
      items={rows.map(row => ({
        id: row.id,
        label: <span className={css.option}><strong>{row.name ?? row.id}</strong><small>{[
          row.employee?.position ?? row.description,
          row.employee?.releaseVersion === undefined ? undefined : t('employeeSeat.version', { version: row.employee.releaseVersion }),
        ].filter(Boolean).join(' · ')}</small></span>,
      }))}
      onSelect={(id) => {
        setOpen(false)
        setBusy(true)
        setNotice(undefined)
        void select(sessionId, id).then(() => { setSelected(id) })
          .catch(() => { setNotice(t('employeeSeat.selectFailed')) })
          .finally(() => { setBusy(false) })
      }} align="start" portal className={css.anchor}
      anchor={<button type="button" className={css.seat} disabled={busy} aria-haspopup="menu" aria-expanded={open}
        onClick={() => { setOpen(value => !value) }}>
        <span>{selectedRow?.name ?? t('employeeSeat.choose')}</span><IconChevronDownOutlineRegular size={14}/>
      </button>}/>
    {notice !== undefined && <Toast text={notice} icon={<IconWarningOutlineRegular/>}
      holdMs={8000} onDone={() => { setNotice(undefined) }}/>}
  </>
}
