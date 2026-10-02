/** Group-local Host reminders in the room detail panel. */
import { useEffect, useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { Button, IconLoadingOutlineRegular, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './CollaborationGroupSchedules.module.css'

type Copy = TranslateNS<'enterprise.collaboration'>
type ScheduleFetch = (url: string, init?: RequestInit) => Promise<Response>

interface GroupSchedule {
  readonly id: string
  readonly kind: 'after' | 'at' | 'every' | 'daily' | 'weekly' | 'cron'
  readonly title: string
  readonly prompt: string
  readonly scheduledAt: string
  readonly employeeName: string
  readonly timeZone?: string
}

function parseScheduleList(value: unknown): GroupSchedule[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid-response')
  const items = (value as Record<string, unknown>)['items']
  if (!Array.isArray(items)) throw new Error('invalid-response')
  return items.map((item: unknown) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) throw new Error('invalid-response')
    const row = item as Record<string, unknown>
    const kind = row['kind']
    if (kind !== 'after' && kind !== 'at' && kind !== 'every' && kind !== 'daily'
      && kind !== 'weekly' && kind !== 'cron') throw new Error('invalid-response')
    for (const field of ['id', 'title', 'prompt', 'scheduledAt', 'employeeName']) {
      if (typeof row[field] !== 'string') throw new Error('invalid-response')
    }
    if (row['timeZone'] !== undefined && typeof row['timeZone'] !== 'string') throw new Error('invalid-response')
    return {
      id: row['id'] as string, kind, title: row['title'] as string, prompt: row['prompt'] as string,
      scheduledAt: row['scheduledAt'] as string, employeeName: row['employeeName'] as string,
      ...(row['timeZone'] === undefined ? {} : { timeZone: row['timeZone'] as string }),
    }
  })
}

/** Show active group tasks and let the group administrator remove one explicitly.
 * @param props - Authorized group id, management right, translated copy and transport.
 * @returns The group-only task section.
 */
export function CollaborationGroupSchedules({ groupId, canManage, t, transport = fetch }: {
  readonly groupId: string
  readonly canManage: boolean
  readonly t: Copy
  readonly transport?: ScheduleFetch
}) {
  const [items, setItems] = useState<readonly GroupSchedule[]>([])
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [version, setVersion] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [deleteError, setDeleteError] = useState(false)
  const selected = items.find(item => item.id === selectedId)

  useEffect(() => { setSelectedId(null); setConfirmId(null); setDeleteError(false) }, [groupId])

  useEffect(() => {
    const request = new AbortController()
    const load = async (): Promise<void> => {
      try {
        const response = await transport(`/enterprise/surfaces/${encodeURIComponent(groupId)}/schedules`, {
          credentials: 'same-origin', signal: request.signal,
        })
        if (!response.ok) throw new Error('request-failed')
        const next = parseScheduleList(await response.json())
        if (!request.signal.aborted) { setItems(next); setPhase('ready') }
      } catch (_error) { if (!request.signal.aborted) setPhase('error') }
    }
    void load()
    const timer = setInterval(() => { void load() }, 10_000)
    return () => { request.abort(); clearInterval(timer) }
  }, [groupId, transport, version])

  const remove = async (id: string): Promise<void> => {
    if (!canManage || busy) return
    setBusy(true); setDeleteError(false)
    try {
      const response = await transport(`/enterprise/surfaces/${encodeURIComponent(groupId)}/schedules/delete`, {
        credentials: 'same-origin', method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (!response.ok) throw new Error('request-failed')
      setConfirmId(null)
      setSelectedId(null)
      setItems(current => current.filter(item => item.id !== id))
      setVersion(value => value + 1)
    } catch (_error) { setDeleteError(true) }
    finally { setBusy(false) }
  }
  const close = (): void => {
    if (busy) return
    setSelectedId(null); setConfirmId(null); setDeleteError(false)
  }
  const kindLabel = selected === undefined ? '' : t(selected.kind === 'after' ? 'groupScheduleAfter'
    : selected.kind === 'at' ? 'groupScheduleAt' : selected.kind === 'every' ? 'groupScheduleEvery'
      : selected.kind === 'daily' ? 'groupScheduleDaily' : selected.kind === 'weekly'
        ? 'groupScheduleWeekly' : 'groupScheduleCron')
  return <section className={css.root} aria-label={t('groupSchedules')}>
    <div className={css.heading}><h3>{t('groupSchedules')}</h3><Button size="sm" variant="outline"
      onClick={() => { setVersion(value => value + 1) }}>{t('refresh')}</Button></div>
    <p className={css.help}>{t('groupScheduleHelp')}</p>
    {phase === 'loading' && <div className={css.loading}><IconLoadingOutlineRegular size={18}/></div>}
    {phase === 'error' && <p role="alert" className={css.error}>{t('groupScheduleLoadFailed')}</p>}
    {phase === 'ready' && items.length === 0 && <p className={css.empty}>{t('groupScheduleEmpty')}</p>}
    {phase === 'ready' && items.length > 0 && <ul className={css.list}>{items.map(item => <li key={item.id}>
      <button type="button" className={css.taskTitle} aria-label={t('groupScheduleOpen', { name: item.title })}
        onClick={() => { setSelectedId(item.id); setConfirmId(null); setDeleteError(false) }}>{item.title}</button>
    </li>)}</ul>}
    <Modal open={selected !== undefined} title={selected?.title ?? ''} closeLabel={t('closeDetails')} onClose={close}
      {...(css.dialog === undefined ? {} : { className: css.dialog })}
      {...(css.dialogContent === undefined ? {} : { contentClassName: css.dialogContent })}
      footer={selected !== undefined && canManage && (confirmId === selected.id
        ? <div className={css.actions}><span>{t('groupScheduleDeleteQuestion')}</span>
          <Button size="sm" disabled={busy} onClick={() => { setConfirmId(null) }}>{t('cancel')}</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => { void remove(selected.id) }}>{t('groupScheduleDeleteConfirm')}</Button>
        </div>
        : <Button size="sm" variant="outline" aria-label={t('groupScheduleDelete', { name: selected.title })}
          onClick={() => { setConfirmId(selected.id); setDeleteError(false) }}>{t('remove')}</Button>)}>
      {selected !== undefined && <div className={css.detail}>
        <dl>
          <div><dt>{t('groupScheduleEmployee')}</dt><dd>{selected.employeeName}</dd></div>
          <div><dt>{t('groupScheduleRule')}</dt><dd>{kindLabel}</dd></div>
          <div><dt>{t('groupScheduleNextLabel')}</dt><dd><time dateTime={selected.scheduledAt}>
            {new Date(selected.scheduledAt).toLocaleString(t('groupScheduleLocale'), { timeZone: selected.timeZone })}
          </time></dd></div>
          {selected.timeZone !== undefined && <div><dt>{t('groupScheduleTimeZone')}</dt><dd>{selected.timeZone}</dd></div>}
          <div><dt>{t('groupScheduleId')}</dt><dd className={css.id}>{selected.id}</dd></div>
        </dl>
        <h3>{t('groupScheduleInstruction')}</h3>
        <p className={css.prompt}>{selected.prompt}</p>
        {deleteError && <p role="alert" className={css.error}>{t('groupScheduleDeleteFailed')}</p>}
      </div>}
    </Modal>
  </section>
}
