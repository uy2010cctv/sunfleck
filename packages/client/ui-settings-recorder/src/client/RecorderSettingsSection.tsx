/** Explicit ASR/CAM configuration and runtime controls. */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { EnterpriseRecorderRuntimeSaveRequest } from '@deepseek-ai/dsh-api-enterprise-controller/types'
import type { EnterpriseRecorderMemoryRuntimeSaveRequest } from '@deepseek-ai/dsh-api-enterprise-controller/types'
import type { RecorderSettingsStore } from './store.ts'
import type { en } from './locales.ts'
import css from './RecorderSettingsSection.module.css'

/** Injected recorder settings services. */
export interface RecorderSettingsInjected {
  readonly controller: RecorderSettingsStore
  readonly hooks: { readonly snapshot: RecorderSettingsStore['store'] }
  readonly t: (key: keyof typeof en) => string
}

export type RecorderSettingsSectionProps = Partial<InjectFace<RecorderSettingsInjected>>
type Draft = Omit<EnterpriseRecorderRuntimeSaveRequest, 'expectedRevision'>
type MemoryDraft = Omit<EnterpriseRecorderMemoryRuntimeSaveRequest, 'expectedRevision'>

function statusKey(state: 'stopped' | 'starting' | 'running' | 'error'): keyof typeof en { return state }

/** Recorder settings page registered in the shared Settings shell. */
export function RecorderSettingsSection(props: RecorderSettingsSectionProps): ReactNode {
  const { controller, useSnapshot, t } = props
  if (controller === undefined || useSnapshot === undefined || t === undefined) return null
  return <Loaded controller={controller} useSnapshot={useSnapshot} t={t} />
}

function Loaded({ controller, useSnapshot, t }: InjectFace<RecorderSettingsInjected>): ReactNode {
  const state = useSnapshot(value => value)
  const [draft, setDraft] = useState<Draft | undefined>(undefined)
  const [draftRevision, setDraftRevision] = useState<number | undefined>(undefined)
  const [memoryDraft, setMemoryDraft] = useState<MemoryDraft | undefined>(undefined)
  const [memoryRevision, setMemoryRevision] = useState<number | undefined>(undefined)
  const runtime = state.runtime
  const memory = state.memory

  useEffect(() => { if (state.phase === 'idle') void controller.load() }, [controller, state.phase])
  useEffect(() => {
    if (runtime === undefined || runtime.revision === draftRevision) return
    setDraft({ asr: { ...runtime.asr }, cam: { ...runtime.cam } })
    setDraftRevision(runtime.revision)
  }, [draftRevision, runtime])
  useEffect(() => {
    if (memory === undefined || memory.revision === memoryRevision) return
    setMemoryDraft({ provider: memory.provider, model: memory.model, timeoutMs: memory.timeoutMs })
    setMemoryRevision(memory.revision)
  }, [memory, memoryRevision])

  if (runtime === undefined || draft === undefined || memory === undefined || memoryDraft === undefined) {
    return <section className={css.section} aria-busy={state.phase === 'loading'}>
      <div className={css.heading}><h2 className={css.title}>{t('title')}</h2><p className={css.intro}>{t('intro')}</p></div>
      <p className={`${css.message} ${state.phase === 'error' ? css.error : ''}`} role="status">
        {state.phase === 'error' ? t('loadError') : t('startingAction')}
      </p>
    </section>
  }

  const busy = state.phase === 'saving' || state.phase === 'starting'
  const updateAsr = (value: Partial<Draft['asr']>): void => { setDraft(current => current && ({ ...current, asr: { ...current.asr, ...value } })) }
  const updateCam = (value: Partial<Draft['cam']>): void => { setDraft(current => current && ({ ...current, cam: { ...current.cam, ...value } })) }
  const save = (): void => { void controller.save({ expectedRevision: runtime.revision, ...draft }) }
  const saveMemory = (): void => { void controller.saveMemory({ expectedRevision: memory.revision, ...memoryDraft }) }

  return <section className={css.section} aria-busy={busy}>
    <div className={css.heading}><h2 className={css.title}>{t('title')}</h2><p className={css.intro}>{t('intro')}</p></div>
    <div className={css.statusPanel} aria-label={t('status')}>
      <Status label={t('status')} value={`${t(statusKey(runtime.state))}${runtime.activeRevision === undefined ? '' : ` · v${String(runtime.activeRevision)}`}`} ready={runtime.state === 'running'} error={runtime.state === 'error'} />
      <Status label={t('asr')} value={t(runtime.asrReady ? 'ready' : 'notReady')} ready={runtime.asrReady} />
      <Status label={t('cam')} value={t(runtime.camReady ? 'ready' : 'notReady')} ready={runtime.camReady} />
      <Status label={t('credentialRef')} value={t(runtime.credentialReady ? 'configured' : 'missingCredential')} ready={runtime.credentialReady} />
    </div>
    <div className={css.cards}>
      <fieldset className={css.card}>
        <legend className={css.cardTitle}>{t('asr')}</legend>
        <Mode value={draft.asr.mode} onChange={(mode) => { updateAsr({ mode }) }} t={t} />
        <p className={css.hint}>{t(draft.asr.mode === 'local' ? 'localAsrHint' : 'onlineAsrHint')}</p>
        <Field label={t('model')} value={draft.asr.model} onChange={(model) => { updateAsr({ model }) }} />
        {draft.asr.mode === 'online' && <>
          <Field label={t('endpoint')} value={draft.asr.endpoint ?? ''} onChange={(endpoint) => { updateAsr({ endpoint }) }} type="url" />
          <Field label={t('credentialRef')} value={draft.asr.credentialRef ?? ''} onChange={(credentialRef) => { updateAsr({ credentialRef }) }} />
        </>}
      </fieldset>
      <fieldset className={css.card}>
        <legend className={css.cardTitle}>{t('cam')}</legend>
        <label className={css.enableRow}><input className={css.checkbox} type="checkbox" checked={draft.cam.enabled}
          onChange={(event) => { updateCam({ enabled: event.target.checked }) }} />{t('enabled')}</label>
        <Mode value={draft.cam.mode} disabled={!draft.cam.enabled} onChange={(mode) => { updateCam({ mode }) }} t={t} />
        <p className={css.hint}>{t(draft.cam.mode === 'local' ? 'localCamHint' : 'onlineCamHint')}</p>
        <Field label={t('model')} value={draft.cam.model} disabled={!draft.cam.enabled} onChange={(model) => { updateCam({ model }) }} />
        {draft.cam.enabled && draft.cam.mode === 'online' && <>
          <Field label={t('endpoint')} value={draft.cam.endpoint ?? ''} onChange={(endpoint) => { updateCam({ endpoint }) }} type="url" />
          <Field label={t('credentialRef')} value={draft.cam.credentialRef ?? ''} onChange={(credentialRef) => { updateCam({ credentialRef }) }} />
        </>}
        <label className={css.field}>{t('threshold')}<input className={css.input} type="number" min="0.5" max="0.99" step="0.01"
          disabled={!draft.cam.enabled} value={draft.cam.matchThreshold}
          onChange={(event) => { updateCam({ matchThreshold: Number(event.target.value) }) }} /></label>
      </fieldset>
      <fieldset className={`${css.card} ${css.memoryCard}`}>
        <legend className={css.cardTitle}>{t('memoryProcessing')}</legend>
        <p className={css.hint}>{t('memoryHint')}</p>
        <div className={css.memoryFields}>
          <Field label={t('provider')} value={memoryDraft.provider}
            onChange={(provider) => { setMemoryDraft(current => current && ({ ...current, provider })) }} />
          <Field label={t('memoryProcessing')} value={memoryDraft.model}
            onChange={(model) => { setMemoryDraft(current => current && ({ ...current, model })) }} />
          <label className={css.field}>{t('timeoutMs')}<input className={css.input} type="number" min="1000" max="300000" step="1000"
            value={memoryDraft.timeoutMs} onChange={(event) => {
              const timeoutMs = Number(event.target.value)
              if (Number.isFinite(timeoutMs)) setMemoryDraft(current => current && ({ ...current, timeoutMs }))
            }} /></label>
          <Field label={t('dedicatedSessionId')} value={memory.sessionId} readOnly onChange={() => {}} />
        </div>
        <div className={css.actions}>
          <button type="button" className={`${css.button} ${css.primary}`} disabled={busy} onClick={saveMemory}>{t('saveMemory')}</button>
        </div>
      </fieldset>
    </div>
    <div className={css.actions}>
      <button type="button" className={`${css.button} ${css.primary}`} disabled={busy} onClick={save}>{state.phase === 'saving' ? t('saving') : t('save')}</button>
      <button type="button" className={css.button} disabled={busy} onClick={() => { void controller.start() }}>{state.phase === 'starting' ? t('startingAction') : t('start')}</button>
      <button type="button" className={css.button} disabled={busy} onClick={() => { void controller.load() }}>{t('refresh')}</button>
    </div>
    {(state.error !== undefined || state.saved) && <p className={`${css.message} ${state.error !== undefined ? css.error : css.success}`} role="status">
      {state.error !== undefined ? t('actionError') : t('saved')}
    </p>}
    {runtime.error !== undefined && <p className={`${css.message} ${css.error}`} role="alert">{runtime.error}</p>}
  </section>
}

function Status({ label, value, ready, error = false }: { label: string; value: string; ready: boolean; error?: boolean }): ReactNode {
  return <div className={css.statusCell}><span className={css.statusLabel}>{label}</span><span className={css.statusValue}>
    <span className={`${css.dot} ${ready ? css.dotReady : ''} ${error ? css.dotError : ''}`} aria-hidden="true" />{value}</span></div>
}

function Mode({ value, disabled = false, onChange, t }: {
  value: 'local' | 'online'
  disabled?: boolean
  onChange: (value: 'local' | 'online') => void
  t: (key: keyof typeof en) => string
}): ReactNode {
  return <div className={css.mode} role="group">
    {(['local', 'online'] as const).map(mode => <button key={mode} type="button" disabled={disabled}
      className={`${css.modeButton} ${value === mode ? css.modeButtonActive : ''}`}
      aria-pressed={value === mode} onClick={() => { onChange(mode) }}>{t(mode)}</button>)}
  </div>
}

function Field({ label, value, disabled = false, readOnly = false, type = 'text', onChange }: {
  label: string
  value: string
  disabled?: boolean
  readOnly?: boolean
  type?: 'text' | 'url'
  onChange: (value: string) => void
}): ReactNode {
  return <label className={css.field}>{label}<input className={css.input} type={type} value={value} disabled={disabled} readOnly={readOnly}
    onChange={(event) => { onChange(event.target.value) }} /></label>
}
