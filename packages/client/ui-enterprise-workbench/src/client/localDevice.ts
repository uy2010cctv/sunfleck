/** Loopback companion responses, restricted to setup facts and coded failures. */
export type LocalDeviceErrorCode = 'diagnostic-pending' | 'account-changed' | 'unavailable' | 'upgrade-required' | 'invalid-response' | 'origin-denied' | 'pairing-conflict' | 'completion-failed'

/** A companion failure translated by the owning locale dictionary. */
export class LocalDeviceError extends Error {
  constructor(readonly code: LocalDeviceErrorCode) { super(code); this.name = 'LocalDeviceError' }
}

/** Read-only setup facts; unknown permission states never imply OS authorization. */
export interface LocalDeviceStatus {
  readonly platform: 'macos' | 'windows' | 'linux' | 'unsupported'
  readonly version: string
  readonly connectionPresent: boolean
  readonly serverOrigin: string
  readonly cua: { readonly state: 'ready' | 'failed' | 'unsupported' }
  readonly permissions: { readonly accessibility: 'granted' | 'denied' | 'unknown' | 'unsupported'; readonly screenRecording: 'granted' | 'denied' | 'unknown' | 'unsupported' }
  readonly browser: { readonly available: boolean }
}

/** Read companion setup facts without requesting OS authorization.
 * @param localBase Loopback companion origin.
 * @param fetcher Browser fetch implementation.
 * @returns Validated setup status.
 */
export async function readLocalDeviceStatus(localBase = 'http://127.0.0.1:47631', fetcher: typeof globalThis.fetch = globalThis.fetch): Promise<LocalDeviceStatus> {
  let response: Response
  try { response = await fetcher(`${localBase}/v1/status`, { headers: { accept: 'application/json' } }) }
  catch (error) { throw error instanceof LocalDeviceError ? error : new LocalDeviceError('unavailable') }
  if (response.status === 404) throw new LocalDeviceError('upgrade-required')
  if (response.status === 403) throw new LocalDeviceError('origin-denied')
  if (!response.ok) throw new LocalDeviceError('unavailable')
  const value: unknown = await response.json()
  if (typeof value !== 'object' || value === null) throw new LocalDeviceError('invalid-response')
  const record = value as Record<string, unknown>
  const platform = record['platform']
  if ((platform !== 'macos' && platform !== 'windows' && platform !== 'linux' && platform !== 'unsupported') || record['protocolVersion'] !== 2 || typeof record['agentVersion'] !== 'string' || typeof record['serverOrigin'] !== 'string' || typeof record['connectionPresent'] !== 'boolean') throw new LocalDeviceError('invalid-response')
  const permissions = typeof record['permissions'] === 'object' && record['permissions'] !== null ? record['permissions'] as Record<string, unknown> : {}
  const permission = (value: unknown): 'granted' | 'denied' | 'unknown' | 'unsupported' => value === true ? 'granted' : value === false ? 'denied' : permissions['state'] === 'unsupported' ? 'unsupported' : 'unknown'
  const browser = typeof record['browser'] === 'object' && record['browser'] !== null ? record['browser'] as Record<string, unknown> : {}
  const cua = typeof record['cua'] === 'object' && record['cua'] !== null ? record['cua'] as Record<string, unknown> : {}
  return { platform, version: record['agentVersion'], connectionPresent: record['connectionPresent'], serverOrigin: record['serverOrigin'], cua: { state: cua['state'] === 'ready' || cua['state'] === 'unsupported' ? cua['state'] : 'failed' }, permissions: { accessibility: permission(permissions['accessibility']), screenRecording: permission(permissions['screenRecording']) }, browser: { available: browser['available'] === true } }
}

/** Read the authenticated account without exposing its identity in setup UI.
 * @returns Organization and user identity, or undefined when signed out.
 */
export async function readDeviceAccountIdentity(): Promise<string | undefined> {
  let response: Response
  try { response = await globalThis.fetch('/auth/status', { credentials: 'same-origin', cache: 'no-store' }) }
  catch (_error) { throw new LocalDeviceError('account-changed') }
  if (!response.ok) throw new LocalDeviceError('account-changed')
  const value: unknown = await response.json()
  if (typeof value !== 'object' || value === null) throw new LocalDeviceError('invalid-response')
  const auth = value as Record<string, unknown>
  if (auth['authenticated'] !== true) return undefined
  const principal = auth['principal']
  if (typeof principal !== 'object' || principal === null) throw new LocalDeviceError('invalid-response')
  const fields = principal as Record<string, unknown>
  if (typeof fields['orgId'] !== 'string' || typeof fields['userId'] !== 'string') throw new LocalDeviceError('invalid-response')
  return JSON.stringify([fields['orgId'], fields['userId']])
}
