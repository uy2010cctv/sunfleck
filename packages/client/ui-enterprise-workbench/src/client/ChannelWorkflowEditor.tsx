/** Read and edit versioned channel YAML through authenticated enterprise policy. */
import { useEffect, useRef, useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import css from './ChannelWorkflowEditor.module.css'

type Copy = TranslateNS<'enterprise.collaboration'>
interface WorkflowRevision { readonly id: string; readonly revision: number; readonly yaml: string }
interface WorkflowList { readonly items: readonly WorkflowRevision[]; readonly canManage: boolean }
type WorkflowFetch = (url: string, init?: RequestInit) => Promise<Response>

function revision(value: unknown): WorkflowRevision {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid-response')
  const row = value as Record<string, unknown>
  if (typeof row['id'] !== 'string' || typeof row['revision'] !== 'number' || !Number.isSafeInteger(row['revision'])
    || typeof row['yaml'] !== 'string') throw new Error('invalid-response')
  return { id: row['id'], revision: row['revision'], yaml: row['yaml'] }
}
function list(value: unknown): WorkflowList {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid-response')
  const row = value as Record<string, unknown>
  if (!Array.isArray(row['items']) || typeof row['canManage'] !== 'boolean') throw new Error('invalid-response')
  return { items: row['items'].map(revision), canManage: row['canManage'] }
}

/** Manager-only YAML editor with explicit revisions; member views remain read-only. */
export function ChannelWorkflowEditor({ channelId, t, transport = fetch }: {
  readonly channelId: string
  readonly t: Copy
  readonly transport?: WorkflowFetch
}) {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const loaded = useRef(false)
  const [data, setData] = useState<WorkflowList>({ items: [], canManage: false })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [newId, setNewId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<'save' | 'conflict' | 'invalid' | 'forbidden' | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    const request = new AbortController()
    if (!loaded.current) setPhase('loading')
    void transport(`/enterprise/channel-workflows/${encodeURIComponent(channelId)}`, {
      credentials: 'same-origin', signal: request.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error('request-failed')
      return list(await response.json())
    }).then((value) => {
      if (request.signal.aborted) return
      loaded.current = true
      setData(value)
      setSelectedId(current => current !== null && value.items.some(item => item.id === current) ? current : value.items[0]?.id ?? current)
      setPhase('ready')
    }).catch(() => { if (!request.signal.aborted) setPhase('error') })
    return () => { request.abort() }
  }, [channelId, transport, reload])

  const current = data.items.find(item => item.id === selectedId)
  const draft = selectedId === null ? '' : drafts[selectedId] ?? current?.yaml ?? ''
  const dirty = current === undefined ? draft.trim() !== '' : draft !== current.yaml
  const startNew = (): void => {
    const id = newId.trim()
    if (!/^[a-z][a-z0-9-]{0,79}$/u.test(id) || data.items.some(item => item.id === id)) return
    setSelectedId(id)
    setDrafts(value => ({ ...value, [id]: value[id] ?? '' }))
    setNewId('')
    setError(null)
  }
  const save = async (): Promise<void> => {
    if (!data.canManage || selectedId === null || !dirty || busy) return
    setBusy(true)
    setError(null)
    try {
      const response = await transport(`/enterprise/channel-workflows/${encodeURIComponent(channelId)}/${encodeURIComponent(selectedId)}`, {
        credentials: 'same-origin', method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ yaml: draft, expectedRevision: current?.revision ?? 0 }),
      })
      if (response.status === 409) { setError('conflict'); return }
      if (response.status === 400) { setError('invalid'); return }
      if (response.status === 403) { setData(value => ({ ...value, canManage: false })); setError('forbidden'); return }
      if (!response.ok) { setError('save'); return }
      const saved = revision(await response.json())
      setData(value => ({ ...value, items: [...value.items.filter(item => item.id !== saved.id), saved] }))
      setDrafts(value => ({ ...value, [saved.id]: saved.yaml }))
    } catch (_error) { setError('save') }
    finally { setBusy(false) }
  }

  return <section className={css.root} aria-label={t('workflowDefinitions')}>
    <h3>{t('workflowDefinitions')}</h3>
    <p className={css.help}>{t('workflowHelp')}</p>
    {phase === 'loading' && !loaded.current && <p role="status">{t('workflowLoading')}</p>}
    {phase === 'error' && <p role="alert">{t('workflowLoadFailed')} <button type="button" onClick={() => { setReload(value => value + 1) }}>{t('retry')}</button></p>}
    {loaded.current && <>
      {data.items.length === 0 && <p>{t('workflowEmpty')}</p>}
      {data.items.length > 0 && <label className={css.field}>{t('workflowSelect')}
        <select value={selectedId ?? ''} onChange={(event) => { setSelectedId(event.target.value); setError(null) }}>
          {current === undefined && selectedId !== null && <option value={selectedId}>{selectedId} · {t('workflowNew')}</option>}
          {data.items.map(item => <option key={item.id} value={item.id}>{item.id} · {t('workflowRevision')} {item.revision}</option>)}
        </select>
      </label>}
      {data.canManage && <div className={css.create}><label className={css.field}>{t('workflowNewId')}
        <input value={newId} onChange={(event) => { setNewId(event.target.value) }} placeholder="release-notes" maxLength={80}/>
      </label><button type="button" disabled={!/^[a-z][a-z0-9-]{0,79}$/u.test(newId.trim()) || data.items.some(item => item.id === newId.trim())} onClick={startNew}>{t('workflowNew')}</button></div>}
      {selectedId !== null && <>
        <p className={css.revision}>{current === undefined ? t('workflowNew') : `${t('workflowRevision')} ${current.revision}`}</p>
        {data.canManage ? <><label className={css.field}>{t('workflowYaml')}
          <textarea value={draft} spellCheck={false} rows={10} disabled={busy}
            onChange={(event) => { setDrafts(value => ({ ...value, [selectedId]: event.target.value })) }}/>
        </label><div className={css.actions}><button type="button" disabled={!dirty || busy || draft.trim() === ''} onClick={() => { void save() }}>{busy ? t('workflowSaving') : t('workflowSave')}</button></div></>
          : <pre className={css.readOnly}>{current?.yaml}</pre>}
      </>}
      {error !== null && <div className={css.error} role="alert"><p>{t(error === 'conflict' ? 'workflowConflict' : error === 'invalid' ? 'workflowInvalid' : error === 'forbidden' ? 'workflowForbidden' : 'workflowSaveFailed')}</p>
        {error === 'conflict' && <button type="button" onClick={() => { setReload(value => value + 1) }}>{t('workflowReloadCurrent')}</button>}
      </div>}
      <details className={css.syntax}><summary>{t('workflowSyntax')}</summary><p>{t('workflowTriggers')}</p><p>{t('workflowActions')}</p></details>
    </>}
  </section>
}
