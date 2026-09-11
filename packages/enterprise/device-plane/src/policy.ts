import type { ComputerUseMode, DeviceAdapterKind, DeviceCapability, DeviceOperation } from './index.ts'

/** Validate adapter, capability, mode, and operation coherence before queueing.
 * @param input - Candidate run mode and routed operation tuple.
 */
export function validateQueuedDeviceAction(input: {
  readonly mode: ComputerUseMode
  readonly capability: DeviceCapability
  readonly adapter: DeviceAdapterKind
  readonly operation: DeviceOperation
}): void {
  const browser = input.operation.kind.startsWith('browser.')
  const control = input.operation.kind === 'browser.open'
    || input.operation.kind === 'browser.click'
    || input.operation.kind === 'browser.fill'
  const expectedCapability: DeviceCapability = browser
    ? control ? 'browser.control' : 'browser.observe'
    : 'desktop.observe'
  if (input.capability !== expectedCapability) throw new Error('device action capability does not match operation')
  if (browser && input.adapter === 'cua') throw new Error('device action adapter does not match browser operation')
  if (!browser && input.adapter !== 'cua') throw new Error('device action adapter does not match desktop operation')
  if (input.mode === 'observe' && control) throw new Error('observe Run cannot execute control actions')
}
