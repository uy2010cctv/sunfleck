/** Explicit local companion setup with retained progress and read-only checks. */
import { useEffect, useState } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { EnterpriseDeviceView } from '@deepseek-ai/dsh-api-enterprise-controller/types'
import type { EnterpriseWorkbenchInjected } from './EnterpriseWorkbench.tsx'
import type { EnterpriseWorkbenchKey } from './locales.ts'
import { LocalDeviceError, type LocalDeviceStatus } from './localDevice.ts'
import css from './EnterpriseWorkbench.module.css'

/** Local setup dialog; pairing only runs from its account confirmation button.
 * @param props Local companion operations and locale-owned copy.
 * @returns The setup dialog with retained step and error state.
 */
export function DeviceSetup({ open, onClose, api, devices, diagnostic, setupEpoch, t }: {
  open: boolean
  onClose: () => void
  api: EnterpriseWorkbenchInjected
  diagnostic?: import('./store.ts').LocalDeviceDiagnostic | undefined
  setupEpoch?: number | undefined
  devices: readonly EnterpriseDeviceView[]
  t: (key: EnterpriseWorkbenchKey, params?: Record<string, string | number>) => string
}) {
  const [step, setStep] = useState(0)
  const [status, setStatus] = useState<LocalDeviceStatus>()
  const [pairedDeviceId, setPairedDeviceId] = useState<string>()
  const paired = pairedDeviceId !== undefined
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<EnterpriseWorkbenchKey>()
  const [tested, setTested] = useState(false)
  const cleanupRunId = diagnostic?.phase === 'cleanup-required' ? diagnostic.runId : undefined
  useEffect(() => { setPairedDeviceId(undefined); setTested(false); setPending(false); setError(undefined) }, [setupEpoch])
  const check = async (): Promise<void> => {
    setPending(true); setError(undefined)
    try { setStatus(await api.readLocalDeviceStatus()); setStep(1) }
    catch (failure) { setError(failure instanceof LocalDeviceError ? `device.setup.error.${failure.code}` : 'device.setup.error.unavailable') }
    finally { setPending(false) }
  }
  const pair = async (): Promise<void> => {
    setPending(true); setError(undefined)
    try {
      const result = await api.pairLocalDevice(window.location.origin)
      if (result === undefined) { setError('device.setup.error.completion-failed'); return }
      setPairedDeviceId(result.deviceId); setStep(2); setStatus(await api.readLocalDeviceStatus())
    } catch (failure) { setError(failure instanceof LocalDeviceError ? `device.setup.error.${failure.code}` : 'device.setup.error.completion-failed') }
    finally { setPending(false) }
  }
  const test = async (): Promise<void> => {
    const device = devices.find(value => value.deviceId === pairedDeviceId)
    if (device === undefined) { setError('device.setup.testNeedsBinding'); return }
    setPending(true); setError(undefined)
    try {
      const result = await api.testLocalDevice(device.deviceId)
      if (result === undefined) return
      if (result.action?.state === 'completed') { setTested(true); setStep(5) }
      else setError('device.setup.testFailed')
    } catch { setError('device.setup.testNeedsRecord') }
    finally { setPending(false) }
  }
  return <Modal open={open} title={t('device.setup.title')} closeLabel={t('close')} onClose={onClose}
    description={t('device.setup.intro')} contentClassName={css.deviceSetupContent ?? ''}>
    <ol className={css.deviceSetupSteps} aria-label={t('device.setup.steps')}>
      {(['install', 'check', 'permissions', 'browser', 'test', 'done'] as const).map((name, index) => <li key={name} aria-current={index === step ? 'step' : undefined}><button type="button" className={css.secondaryButton} disabled={pending || index === 4 && !paired || index > 1 && index < 4 && status === undefined} onClick={() => { setStep(index); setError(undefined) }}>{t(`device.setup.step.${name}`)}</button></li>)}
    </ol>
    {step === 0 && <div className={css.deviceSetupSection}><h3>{t('device.setup.step.install')}</h3><p>{t('device.setup.install')}</p><p>{t('device.setup.prerequisites')}</p><pre className={css.deviceSetupCommand}>{t('device.setup.commands', { origin: window.location.origin })}</pre><p>{t('device.setup.keepRunning')}</p><button type="button" className={css.primaryButton} disabled={pending} onClick={() => { void check() }}>{t('device.setup.check')}</button></div>}
    {step === 1 && <div className={css.deviceSetupSection}><h3>{t('device.setup.step.check')}</h3><p>{t('device.setup.checkBody')}</p>{status !== undefined && <p role="status">{t('device.setup.detected', { platform: status.platform === 'unsupported' ? t('device.setup.permission.unknown') : t(`device.platform.${status.platform}`), version: status.version })}</p>}<div className={css.inlineActions}><button type="button" className={css.secondaryButton} disabled={pending} onClick={() => { void check() }}>{t('device.setup.check')}</button><button type="button" className={css.primaryButton} disabled={pending || status === undefined} onClick={() => { void pair() }}>{t('device.setup.confirmPair')}</button></div></div>}
    {step === 2 && <div className={css.deviceSetupSection}><h3>{t('device.setup.step.permissions')}</h3><p>{t(status?.platform === 'macos' ? 'device.setup.macPermissions' : 'device.setup.otherPlatform')}</p><dl><dt>{t('device.setup.accessibility')}</dt><dd>{t(`device.setup.permission.${status?.permissions.accessibility ?? 'unknown'}`)}</dd><dt>{t('device.setup.screenRecording')}</dt><dd>{t(`device.setup.permission.${status?.permissions.screenRecording ?? 'unknown'}`)}</dd></dl><p>{t('device.setup.restart')}</p><button type="button" className={css.secondaryButton} disabled={pending} onClick={() => { setPending(true); void api.readLocalDeviceStatus().then(setStatus).catch(() => { setError('device.setup.error.unavailable') }).finally(() => { setPending(false) }) }}>{t('device.setup.recheck')}</button><button type="button" className={css.primaryButton} disabled={pending} onClick={() => { setStep(3) }}>{t('device.setup.next')}</button></div>}
    {step === 3 && <div className={css.deviceSetupSection}><h3>{t('device.setup.step.browser')}</h3><p>{t('device.setup.browserBody')}</p><p role="status">{t(status?.browser.available === true ? 'device.setup.browserReady' : 'device.setup.browserUnknown')}</p><button type="button" className={css.primaryButton} disabled={pending || !paired} onClick={() => { setStep(4) }}>{t('device.setup.next')}</button></div>}
    {step === 4 && <div className={css.deviceSetupSection}><h3>{t('device.setup.step.test')}</h3><p>{t('device.setup.testBody')}</p><button type="button" className={css.primaryButton} disabled={pending || diagnostic !== undefined} onClick={() => { void test() }}>{t('device.test')}</button></div>}
    {step === 5 && <div className={css.deviceSetupSection}><h3>{t(tested ? 'device.setup.finished' : 'device.setup.pendingTest')}</h3><p>{t('device.setup.stopBody')}</p><button type="button" className={css.primaryButton} onClick={onClose}>{t('close')}</button></div>}
    {cleanupRunId !== undefined && <div role="alert"><p>{t('device.setup.cleanupFailed')}</p><button type="button" className={css.secondaryButton} disabled={pending} onClick={() => { setPending(true); void api.retryLocalDeviceTestCleanup(cleanupRunId).then((stopped) => { if (!stopped) setError('device.setup.cleanupFailed') }).finally(() => { setPending(false) }) }}>{t('device.setup.retryCleanup')}</button></div>}
    {pending && <p role="status">{t('device.connecting')}</p>}
    {error !== undefined && <p role="alert">{t(error)}</p>}
  </Modal>
}
