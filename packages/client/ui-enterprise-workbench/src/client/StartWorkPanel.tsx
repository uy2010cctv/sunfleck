/** Goal-first work entry that asks only for a human objective and resolving choices. */
import { useState } from 'react'
import type {
  EnterpriseEmployeeRelease, EnterpriseWorkPreparation, EnterpriseWorkPrepareRequest, EnterpriseWorkStartRequest,
  EnterpriseWorkStartValue,
} from '@deepseek-ai/dsh-api-enterprise-controller/types'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { IconCheckOutline16, IconWarningOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { EnterpriseWorkbenchKey } from './locales.ts'
import css from './EnterpriseWorkbench.module.css'

type Translate = (key: EnterpriseWorkbenchKey, params?: Record<string, string | number>) => string
type WorkInput = Pick<EnterpriseWorkPrepareRequest, 'objective' | 'deadline' | 'workspaceId' | 'preferredEmployeeReleaseId'>

export interface StartWorkPanelProps {
  readonly workspaces: WorkspaceSnapshot
  readonly releases: readonly EnterpriseEmployeeRelease[]
  readonly prepareWork: (input: WorkInput) => Promise<EnterpriseWorkPreparation>
  readonly startPreparedWork: (input: EnterpriseWorkStartRequest) => Promise<EnterpriseWorkStartValue>
  readonly onStarted: (sessionId: string) => void
  readonly t: Translate
}

function localDeadline(value: string): string | undefined {
  if (value === '') return undefined
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString()
}

function releaseLabel(release: EnterpriseEmployeeRelease): string {
  const profile = release.snapshot.profile as Readonly<Record<string, unknown>>
  const name = typeof profile.name === 'string' && profile.name.trim() !== '' ? profile.name : ''
  return name === '' ? `v${release.version}` : `${name} · v${release.version}`
}

/** Collect an objective, then reveal only human-readable choices required by the server. */
export function StartWorkPanel({ workspaces, releases, prepareWork, startPreparedWork, onStarted, t }: StartWorkPanelProps) {
  const [objective, setObjective] = useState('')
  const [deadline, setDeadline] = useState('')
  const [preparation, setPreparation] = useState<EnterpriseWorkPreparation>()
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>()
  const [selectedReleaseId, setSelectedReleaseId] = useState<string>()
  const [idempotencyKey, setIdempotencyKey] = useState<string>()
  const [phase, setPhase] = useState<'idle' | 'preparing' | 'starting' | 'error'>('idle')
  const [error, setError] = useState<string>()
  const buildInput = (workspaceId = selectedWorkspaceId, releaseId = selectedReleaseId): WorkInput => {
    const parsedDeadline = localDeadline(deadline)
    return {
      objective: objective.trim(),
      ...(parsedDeadline === undefined ? {} : { deadline: parsedDeadline }),
      ...(workspaceId === undefined ? {} : { workspaceId }),
      ...(releaseId === undefined ? {} : { preferredEmployeeReleaseId: releaseId }),
    }
  }
  const reset = (): void => {
    setPreparation(undefined); setSelectedWorkspaceId(undefined); setSelectedReleaseId(undefined)
    setIdempotencyKey(undefined); setPhase('idle'); setError(undefined)
  }
  const start = async (ready: Extract<EnterpriseWorkPreparation, { kind: 'ready' }>, input: WorkInput): Promise<void> => {
    setPhase('starting'); setError(undefined)
    const key = idempotencyKey ?? `enterprise-work:${randomUUID()}`
    setIdempotencyKey(key)
    try {
      const value = await startPreparedWork({
        ...input, workspaceId: ready.workspaceId, preferredEmployeeReleaseId: ready.employeeReleaseId, idempotencyKey: key,
      })
      onStarted(value.sessionId)
    } catch (reason) {
      setPhase('error'); setError(reason instanceof Error ? reason.message : String(reason))
    }
  }
  const prepare = async (workspaceId = selectedWorkspaceId, releaseId = selectedReleaseId): Promise<void> => {
    const input = buildInput(workspaceId, releaseId)
    if (input.objective === '') { setPhase('error'); setError(t('startWork.objectiveRequired')); return }
    setPhase('preparing'); setError(undefined)
    try {
      const next = await prepareWork(input)
      setPreparation(next)
      if (next.kind === 'ready') await start(next, input)
      else setPhase('idle')
    } catch (reason) {
      setPhase('error'); setError(reason instanceof Error ? reason.message : String(reason))
    }
  }
  const workspaceChoices = preparation?.kind === 'needs-workspace-selection'
    ? workspaces.items.filter(workspace => preparation.availableWorkspaceIds.includes(workspace.workspaceId)) : []
  const releaseChoices = preparation?.kind === 'needs-selection'
    ? releases.filter(release => preparation.availableEmployeeReleaseIds.includes(release.releaseId)) : []
  const busy = phase === 'preparing' || phase === 'starting'
  return <section className={css.startWorkPanel} aria-labelledby="enterprise-start-work-title">
    <div className={css.startWorkHeading}><h2 id="enterprise-start-work-title">{t('startWork.title')}</h2><p>{t('startWork.description')}</p></div>
    <form className={css.startWorkForm} onSubmit={(event) => { event.preventDefault(); void prepare() }}>
      <label className={css.startWorkObjective}><span>{t('startWork.objective')}</span><textarea value={objective} onChange={(event) => { setObjective(event.target.value); if (phase === 'error') setPhase('idle') }} placeholder={t('startWork.objectivePlaceholder')} required disabled={busy}/></label>
      <label className={css.startWorkDeadline}><span>{t('startWork.deadline')}</span><input type="datetime-local" value={deadline} onChange={(event) => { setDeadline(event.target.value) }} disabled={busy}/></label>
      <div className={css.startWorkActions}><button type="submit" className={css.primaryButton} disabled={busy || objective.trim() === ''}>{busy ? t('startWork.preparing') : t('startWork.submit')}</button>{(preparation !== undefined || error !== undefined) && <button type="button" className={css.secondaryButton} disabled={busy} onClick={reset}>{t('startWork.reset')}</button>}</div>
    </form>
    <div className={css.startWorkFeedback} aria-live="polite">
      {phase === 'starting' && <p role="status">{t('startWork.starting')}</p>}
      {preparation?.kind === 'ready' && phase !== 'starting' && <p role="status"><IconCheckOutline16 size={16}/>{t('startWork.ready')}</p>}
      {preparation?.kind === 'needs-workspace-selection' && <div><p>{t('startWork.workspacePrompt')}</p>{workspaceChoices.length > 0 ? <div className={css.startWorkChoices}>{workspaceChoices.map(workspace => <button type="button" className={css.secondaryButton} key={workspace.workspaceId} disabled={busy} onClick={() => { setSelectedWorkspaceId(workspace.workspaceId); setSelectedReleaseId(undefined); void prepare(workspace.workspaceId) }}>{workspace.title}</button>)}</div> : <p role="alert">{t('startWork.workspaceUnavailable')}</p>}</div>}
      {preparation?.kind === 'needs-selection' && <div><p>{t('startWork.employeePrompt')}</p>{releaseChoices.length > 0 ? <div className={css.startWorkChoices}>{releaseChoices.map(release => <button type="button" className={css.secondaryButton} key={release.releaseId} disabled={busy} onClick={() => { setSelectedReleaseId(release.releaseId); void prepare(selectedWorkspaceId, release.releaseId) }}>{releaseLabel(release)}</button>)}</div> : <p role="alert">{t('startWork.employeeUnavailable')}</p>}</div>}
      {error !== undefined && <div className={css.startWorkError} role="alert"><IconWarningOutline16 size={16}/><span>{error}</span><button type="button" className={css.secondaryButton} disabled={busy} onClick={() => { void prepare() }}>{t('retry')}</button></div>}
    </div>
  </section>
}
