/** Account-confirmed pairing with automatic local checks and optional setup help. */
import { useEffect, useRef, useState } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { EnterpriseWorkbenchInjected } from './EnterpriseWorkbench.tsx'
import type { EnterpriseWorkbenchKey } from './locales.ts'
import { LocalDeviceError, type LocalDeviceStatus } from './localDevice.ts'
import css from './EnterpriseWorkbench.module.css'

/**
 * Detect the companion, confirm its account, and present connection and permission results.
 * @param props Local operations, account-scoped diagnostics, and translated copy.
 * @returns The pairing dialog; opening it never grants control or binds an account.
 */
export function DeviceSetup({ open, onClose, api, diagnostic, setupEpoch, t }: {
  open: boolean
  onClose: () => void
  api: EnterpriseWorkbenchInjected
  diagnostic?: import('./store.ts').LocalDeviceDiagnostic | undefined
  setupEpoch?: number | undefined
  t: (key: EnterpriseWorkbenchKey, params?: Record<string, string | number>) => string
}) {
  const generation = useRef(0)
  const [phase, setPhase] = useState<'detecting' | 'confirm' | 'connecting' | 'connected' | 'unavailable'>('detecting')
  const [status, setStatus] = useState<LocalDeviceStatus>()
  const [pairedDeviceId, setPairedDeviceId] = useState<string>()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<EnterpriseWorkbenchKey>()
  const [verification, setVerification] = useState<EnterpriseWorkbenchKey>()
  const cleanupRunId = diagnostic?.phase === 'cleanup-required' ? diagnostic.runId : undefined
  const desktopReady = status?.platform === 'macos' && status.cua.state === 'ready'
    && status.permissions.accessibility === 'granted' && status.permissions.screenRecording === 'granted'
  const manualCheckReady = status?.cua.state === 'ready' && status.platform !== 'unsupported'
    && (status.platform !== 'macos' || desktopReady)
  const failureKey = (failure: unknown): EnterpriseWorkbenchKey => failure instanceof LocalDeviceError
    ? `device.setup.error.${failure.code}` : 'device.setup.error.unavailable'

  useEffect(() => {
    const token = ++generation.current
    setPairedDeviceId(undefined); setVerification(undefined); setError(undefined); setStatus(undefined)
    if (!open) return
    setPhase('detecting'); setPending(true)
    void api.readLocalDeviceStatus().then((value) => {
      if (token !== generation.current) return
      setStatus(value); setPhase('confirm')
    }).catch((failure) => {
      if (token !== generation.current) return
      setError(failureKey(failure)); setPhase('unavailable')
    }).finally(() => { if (token === generation.current) setPending(false) })
    return () => { generation.current++ }
  }, [open, setupEpoch])

  const refresh = async (): Promise<void> => {
    const token = generation.current
    setPending(true); setError(undefined)
    try {
      const value = await api.readLocalDeviceStatus()
      if (token !== generation.current) return
      setStatus(value); setPhase(pairedDeviceId === undefined ? 'confirm' : 'connected')
    } catch (failure) {
      if (token === generation.current) setError(failureKey(failure))
    } finally { if (token === generation.current) setPending(false) }
  }
  const verify = async (deviceId: string, token: number): Promise<void> => {
    try {
      const result = await api.testLocalDevice(deviceId)
      if (token !== generation.current || result === undefined) return
      setVerification(result.action?.state === 'completed' ? 'device.testPassed' : 'device.setup.testFailed')
    } catch (failure) {
      if (token === generation.current) setVerification(failure instanceof LocalDeviceError
        ? `device.setup.error.${failure.code}` : 'device.setup.testFailed')
    }
  }
  const pair = async (): Promise<void> => {
    const token = generation.current
    setPending(true); setError(undefined); setPhase('connecting')
    try {
      const result = await api.pairLocalDevice(window.location.origin)
      if (token !== generation.current) return
      if (result === undefined) { setError('device.setup.error.completion-failed'); setPhase('confirm'); return }
      const value = await api.readLocalDeviceStatus()
      if (token !== generation.current) return
      setStatus(value)
      if (!value.connectionPresent) { setError('device.setup.error.completion-failed'); setPhase('confirm'); return }
      setPairedDeviceId(result.deviceId); setPhase('connected')
      if (value.platform === 'macos' && value.cua.state === 'ready'
        && value.permissions.accessibility === 'granted' && value.permissions.screenRecording === 'granted'
        && diagnostic === undefined) await verify(result.deviceId, token)
    } catch (failure) {
      if (token === generation.current) { setError(failureKey(failure)); setPhase('confirm') }
    } finally { if (token === generation.current) setPending(false) }
  }
  const stage = phase === 'detecting' || phase === 'unavailable' ? 0 : phase === 'connected' ? 2 : 1
  return <Modal open={open} title={t('device.setup.title')} closeLabel={t('close')} onClose={onClose}
    description={t('device.setup.simpleIntro')} className={css.deviceSetupDialog ?? ''} contentClassName={css.deviceSetupContent ?? ''}>
    <ol className={css.deviceSetupSteps} aria-label={t('device.setup.steps')}>
      {(['detect', 'bind', 'result'] as const).map((name, index) => <li key={name} aria-current={index === stage ? 'step' : undefined}>{t(`device.setup.simple.${name}`)}</li>)}
    </ol>
    {status !== undefined && <p role="status">{t('device.setup.detected', { platform: status.platform === 'unsupported' ? t('device.setup.permission.unknown') : t(`device.platform.${status.platform}`), version: status.version })}</p>}
    {phase === 'confirm' && <div className={css.deviceSetupSection}><p>{t('device.setup.simpleConfirm')}</p><button type="button" className={css.primaryButton} disabled={pending} onClick={() => { void pair() }}>{t('device.setup.confirmPair')}</button></div>}
    {phase === 'connected' && <div className={css.deviceSetupSection}>
      <h3>{t('device.setup.connected')}</h3><p>{t(desktopReady ? 'device.setup.permissionsReady' : status?.platform === 'macos' ? 'device.setup.permissionsPending' : 'device.setup.permissionsUnconfirmed')}</p>
      {verification !== undefined && <p role="status">{t(verification)}</p>}
      <button type="button" className={css.secondaryButton} disabled={pending || diagnostic !== undefined || !manualCheckReady} onClick={() => {
        if (pairedDeviceId === undefined) return
        const token = generation.current; setPending(true)
        void verify(pairedDeviceId, token).finally(() => { if (token === generation.current) setPending(false) })
      }}>{t('device.setup.verifyAction')}</button>
    </div>}
    {status !== undefined && <div className={css.deviceSetupSection}>
      <dl><dt>{t('device.setup.accessibility')}</dt><dd>{t(`device.setup.permission.${status.permissions.accessibility}`)}</dd><dt>{t('device.setup.screenRecording')}</dt><dd>{t(`device.setup.permission.${status.permissions.screenRecording}`)}</dd></dl>
      <details><summary>{t('device.setup.permissionsHelp')}</summary><div className={css.deviceSetupSection}>
        {!desktopReady && <><p>{t(status.platform === 'macos' ? 'device.setup.macPermissions' : 'device.setup.otherPlatform')}</p><p>{t('device.setup.restart')}</p></>}
        <p>{t(status.browser.available ? 'device.setup.browserReady' : 'device.setup.browserUnknown')}</p>
        <button type="button" className={css.secondaryButton} disabled={pending} onClick={() => { void refresh() }}>{t('device.setup.recheck')}</button>
      </div></details>
    </div>}
    <details open={phase === 'unavailable'} className={css.deviceSetupSection}><summary>{t('device.setup.installHelp')}</summary><p>{t('device.setup.install')}</p><p>{t('device.setup.prerequisites')}</p><pre className={css.deviceSetupCommand}>{t('device.setup.commands', { origin: window.location.origin })}</pre><p>{t('device.setup.keepRunning')}</p></details>
    {phase === 'unavailable' && <button type="button" className={css.primaryButton} disabled={pending} onClick={() => { void refresh() }}>{t('device.setup.check')}</button>}
    {phase === 'connected' && <><details><summary>{t('device.setup.controlHelp')}</summary><p>{t('device.setup.stopBody')}</p></details><button type="button" className={css.primaryButton} onClick={onClose}>{t('device.setup.done')}</button></>}
    {cleanupRunId !== undefined && <div role="alert"><p>{t('device.setup.cleanupFailed')}</p><button type="button" className={css.secondaryButton} disabled={pending} onClick={() => {
      const token = generation.current; setPending(true)
      void api.retryLocalDeviceTestCleanup(cleanupRunId).then((stopped) => { if (!stopped && token === generation.current) setError('device.setup.cleanupFailed') }).finally(() => { if (token === generation.current) setPending(false) })
    }}>{t('device.setup.retryCleanup')}</button></div>}
    {pending && <p role="status">{t('device.connecting')}</p>}
    {error !== undefined && <p role="alert">{t(error)}</p>}
  </Modal>
}
