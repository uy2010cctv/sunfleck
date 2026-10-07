/** Read-only local installation and macOS authorization diagnostics. */
import { existsSync } from 'node:fs'
import { installedBrowserExecutable } from './browser-executable.ts'

type PermissionValue = boolean | 'unknown'
type PermissionProbe = Pick<typeof import('@trycua/cua-driver'), 'currentMacOsPermissionStatus'>

/** Public diagnostics exclude device identifiers, identity material, and local paths. */
export interface LocalDeviceStatus {
  readonly protocolVersion: 2
  readonly agentVersion: string
  readonly platform: 'macos' | 'windows' | 'linux' | 'unsupported'
  readonly serverOrigin: string
  readonly connectionPresent: boolean
  readonly browser: { readonly available: PermissionValue }
  /** Ready means the SDK imported successfully; no driver or desktop action was started. */
  readonly cua: { readonly state: 'ready' | 'failed' | 'unsupported' }
  readonly permissions: {
    readonly state: 'available' | 'unknown' | 'unsupported'
    readonly accessibility: PermissionValue
    readonly screenRecording: PermissionValue
  }
  readonly diagnosticErrorCode?: 'browser_probe_failed' | 'cua_unavailable' | 'permission_status_unavailable'
}

/** Local dependency probes; none may request authorization or perform desktop actions. */
export interface LocalStatusOptions {
  readonly serverOrigin: string
  readonly agentVersion: string
  readonly connectionPresent: () => boolean
  readonly platform?: NodeJS.Platform
  readonly browserExecutable?: () => string | undefined
  readonly exists?: (path: string) => boolean
  readonly loadCua?: () => Promise<PermissionProbe>
}

/**
 * Inspect installation presence and existing grants without starting Cua or prompting.
 * @param options Current server connection and injectable read-only installation probes.
 * @returns Public readiness fields and safe error codes for failed probes.
 */
export async function readLocalDeviceStatus(options: LocalStatusOptions): Promise<LocalDeviceStatus> {
  const operatingSystem = options.platform ?? process.platform
  const platform = operatingSystem === 'darwin' ? 'macos'
    : operatingSystem === 'win32' ? 'windows' : operatingSystem === 'linux' ? 'linux' : 'unsupported'
  let available: PermissionValue = 'unknown'
  let diagnosticErrorCode: LocalDeviceStatus['diagnosticErrorCode']
  try {
    const executable = (options.browserExecutable ?? installedBrowserExecutable)()
    available = executable !== undefined && (options.exists ?? existsSync)(executable)
  } catch (error) {
    // Native and filesystem exceptions must not expose local paths to the browser.
    void error
    diagnosticErrorCode = 'browser_probe_failed'
  }
  let cua: LocalDeviceStatus['cua'] = { state: 'unsupported' }
  let permissions: LocalDeviceStatus['permissions'] = {
    state: platform === 'macos' ? 'unknown' : 'unsupported', accessibility: 'unknown', screenRecording: 'unknown',
  }
  if (platform !== 'unsupported') {
    let module: PermissionProbe | undefined
    try {
      module = await (options.loadCua ?? (() => import('@trycua/cua-driver')))()
      cua = { state: 'ready' }
    } catch (error) {
      // Import failure only reports SDK availability; no native driver is created.
      void error
      cua = { state: 'failed' }
      diagnosticErrorCode ??= 'cua_unavailable'
    }
    if (platform === 'macos' && module !== undefined) {
      try {
        const status = module.currentMacOsPermissionStatus()
        permissions = { state: 'available', accessibility: status.accessibility, screenRecording: status.screenRecording }
      } catch (error) {
        // Existing-grant inspection can fail independently of SDK import.
        void error
        diagnosticErrorCode ??= 'permission_status_unavailable'
      }
    }
  }
  return {
    protocolVersion: 2, agentVersion: options.agentVersion, platform, serverOrigin: options.serverOrigin,
    connectionPresent: options.connectionPresent(), browser: { available }, cua, permissions,
    ...(diagnosticErrorCode === undefined ? {} : { diagnosticErrorCode }),
  }
}
