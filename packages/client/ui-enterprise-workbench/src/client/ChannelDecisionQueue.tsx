/** Pending human decisions attached to one authorized channel. */
import { useEffect, useRef, useState } from 'react'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import css from './ChannelDecisionQueue.module.css'

type Copy = TranslateNS<'enterprise.collaboration'>
type DecisionFetch = (url: string, init?: RequestInit) => Promise<Response>
interface Decision { readonly approvalId: string; readonly summary: string; readonly state: 'pending'; readonly revision: number }
interface DecisionList { readonly items: readonly Decision[]; readonly canDecide: boolean }
interface Intent {
  readonly approvalId: string
  readonly approved: boolean
  readonly revision: number
  readonly idempotencyKey: string
  readonly phase: 'sending' | 'uncertain' | 'conflict' | 'accepted' | 'forbidden'
}

function parseList(value: unknown): DecisionList {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid-response')
  const row = value as Record<string, unknown>
  if (!Array.isArray(row['items']) || typeof row['canDecide'] !== 'boolean') throw new Error('invalid-response')
  return { canDecide: row['canDecide'], items: row['items'].map((entry: unknown) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('invalid-response')
    const item = entry as Record<string, unknown>
    if (typeof item['approvalId'] !== 'string' || typeof item['summary'] !== 'string' || item['state'] !== 'pending'
      || typeof item['revision'] !== 'number' || !Number.isSafeInteger(item['revision'])) throw new Error('invalid-response')
    return { approvalId: item['approvalId'], summary: item['summary'], state: 'pending' as const, revision: item['revision'] }
  }) }
}

/** Read and decide existing approval requests without inferring authorization from roles. */
export function ChannelDecisionQueue({ channelId, t, transport = fetch }: {
  readonly channelId: string
  readonly t: Copy
  readonly transport?: DecisionFetch
}) {
  const [data, setData] = useState<DecisionList>({ items: [], canDecide: false })
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [refresh, setRefresh] = useState(0)
  const [intent, setIntent] = useState<Intent | null>(null)
  const [readback, setReadback] = useState<'recorded' | 'changed' | null>(null)
  const loaded = useRef(false)
  const currentIntent = useRef<Intent | null>(null)
  currentIntent.current = intent

  useEffect(() => {
    const request = new AbortController()
    let reading = false
    if (!loaded.current) setPhase('loading')
    const load = async (): Promise<void> => {
      if (reading) return
      reading = true
      try {
        const response = await transport(`/enterprise/channel-workflows/${encodeURIComponent(channelId)}/decisions`, {
          credentials: 'same-origin', signal: request.signal,
        })
        if (response.status === 403) setData(value => ({ ...value, canDecide: false }))
        if (!response.ok) throw new Error('request-failed')
        const next = parseList(await response.json())
        if (request.signal.aborted) return
        loaded.current = true
        setData(next)
        setPhase('ready')
        const pending = currentIntent.current
        if (pending !== null && !next.items.some(item => item.approvalId === pending.approvalId)) {
          setIntent(null)
          setReadback(pending.phase === 'accepted' ? 'recorded' : 'changed')
        } else if (pending?.phase === 'conflict') {
          setIntent(null)
        }
      } catch (_error) { if (!request.signal.aborted) setPhase('error') }
      finally { reading = false }
    }
    void load()
    const timer = setInterval(() => { void load() }, 10_000)
    return () => { request.abort(); clearInterval(timer) }
  }, [channelId, transport, refresh])

  const decide = async (pending: Intent): Promise<void> => {
    setIntent({ ...pending, phase: 'sending' })
    setReadback(null)
    try {
      const response = await transport(`/enterprise/channel-workflows/${encodeURIComponent(channelId)}/decisions/${encodeURIComponent(pending.approvalId)}`, {
        credentials: 'same-origin', method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ approved: pending.approved, expectedRevision: pending.revision, idempotencyKey: pending.idempotencyKey }),
      })
      if (response.status === 409) { setIntent({ ...pending, phase: 'conflict' }); return }
      if (response.status === 403) { setIntent({ ...pending, phase: 'forbidden' }); setData(value => ({ ...value, canDecide: false })); return }
      if (!response.ok) { setIntent({ ...pending, phase: 'uncertain' }); return }
      setIntent({ ...pending, phase: 'accepted' })
      setRefresh(value => value + 1)
    } catch (_error) { setIntent({ ...pending, phase: 'uncertain' }) }
  }
  const start = (decision: Decision, approved: boolean): void => {
    if (!data.canDecide || intent !== null) return
    void decide({ approvalId: decision.approvalId, approved, revision: decision.revision, idempotencyKey: randomUUID(), phase: 'sending' })
  }
  const retry = (): void => { if (intent?.phase === 'uncertain') void decide(intent) }
  const reload = (): void => { setRefresh(value => value + 1) }

  return <section className={css.root} aria-label={t('channelDecisions')}>
    <h3>{t('channelDecisions')}</h3>
    {phase === 'loading' && !loaded.current && <p role="status">{t('workflowLoading')}</p>}
    {phase === 'error' && <p className={css.error} role="alert">{t('decisionLoadFailed')} <button type="button" onClick={reload}>{t('retry')}</button></p>}
    {loaded.current && <>
      {data.items.length === 0 && <p className={css.muted}>{t('decisionEmpty')}</p>}
      {readback !== null && <p role="status" className={css.muted}>{t(readback === 'recorded' ? 'decisionRecorded' : 'decisionChanged')}</p>}
      <ul>{data.items.map(item => <li key={item.approvalId} className={css.card}>
        <span className={css.status}>{t('decisionPending')}</span><p>{item.summary}</p>
        {intent?.approvalId === item.approvalId ? <div className={css.feedback} role="status">
          <span>{t(intent.phase === 'sending' ? 'decisionSending' : intent.phase === 'accepted' ? 'decisionAwaitReadback'
            : intent.phase === 'conflict' ? 'decisionConflict' : intent.phase === 'forbidden' ? 'decisionForbidden' : 'decisionUncertain')}</span>
          {intent.phase === 'uncertain' && <button type="button" onClick={retry}>{t('decisionRetrySame')}</button>}
          {intent.phase !== 'sending' && <button type="button" onClick={reload}>{t('refresh')}</button>}
        </div> : data.canDecide && <div className={css.actions}>
          <button type="button" onClick={() => { start(item, true) }}>{t('decisionApprove')}</button>
          <button type="button" onClick={() => { start(item, false) }}>{t('decisionReject')}</button>
        </div>}
      </li>)}</ul>
    </>}
  </section>
}
