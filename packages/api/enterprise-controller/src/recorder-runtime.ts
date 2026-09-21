/** Restricted server-to-gateway control plane for recorder inference runtime settings. */
import type {
  EnterpriseRecorderRuntimeSaveRequest, EnterpriseRecorderRuntimeView,
} from './contract/devices.ts'

type Fetch = (input: string, init?: RequestInit) => Promise<Response>

interface RecorderRuntimeBridgeOptions {
  readonly baseUrl: string
  readonly adminToken: string
  readonly fetch?: Fetch
}

interface ResolvedRecorderCredentials {
  readonly asrCredential?: string
  readonly camCredential?: string
}

function bounded(value: string, max: number): boolean {
  return value.trim().length > 0 && value.length <= max
}

function onlineReady(value: { mode: 'local' | 'online'; endpoint?: string; credentialRef?: string }): boolean {
  if (value.mode === 'local') return true
  if (!bounded(value.endpoint ?? '', 2_048) || !bounded(value.credentialRef ?? '', 512)) return false
  try { return new URL(value.endpoint ?? '').protocol === 'https:' } catch { return false }
}

/** Validate a browser-supplied recorder runtime save request at the Host boundary.
 * @param request - Candidate revision and ASR/CAM configuration.
 * @returns A detached validated request.
 */
export function validateRecorderRuntimeSave(
  request: EnterpriseRecorderRuntimeSaveRequest,
): EnterpriseRecorderRuntimeSaveRequest {
  if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0) {
    throw new Error('recorder runtime revision must be a non-negative integer')
  }
  if (!bounded(request.asr.model, 200) || !bounded(request.cam.model, 200)) {
    throw new Error('recorder model names must contain 1 to 200 characters')
  }
  if (!onlineReady(request.asr) || request.cam.enabled && !onlineReady(request.cam)) {
    throw new Error('online recorder models require an HTTPS endpoint and Credential reference')
  }
  if (!Number.isFinite(request.cam.matchThreshold)
    || request.cam.matchThreshold < 0.5 || request.cam.matchThreshold > 0.99) {
    throw new Error('CAM match threshold must be between 0.5 and 0.99')
  }
  return structuredClone(request)
}

function runtimeView(value: unknown): EnterpriseRecorderRuntimeView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('recorder runtime returned invalid JSON')
  const row = value as Record<string, unknown>
  const asr = row['asr']
  const cam = row['cam']
  if (!Number.isSafeInteger(row['revision']) || typeof asr !== 'object' || asr === null
    || typeof cam !== 'object' || cam === null
    || !['stopped', 'starting', 'running', 'error'].includes(String(row['state']))
    || typeof row['asrReady'] !== 'boolean' || typeof row['camReady'] !== 'boolean'
    || typeof row['credentialReady'] !== 'boolean' || !Number.isFinite(row['checkedAt'])
    || row['activeRevision'] !== undefined && !Number.isSafeInteger(row['activeRevision'])) {
    throw new Error('recorder runtime returned invalid fields')
  }
  return value as EnterpriseRecorderRuntimeView
}

/** Authenticated bridge to the local recorder gateway administration routes. */
export class RecorderRuntimeBridge {
  private readonly fetch: Fetch

  constructor(private readonly options: RecorderRuntimeBridgeOptions) {
    this.fetch = options.fetch ?? globalThis.fetch
  }

  /** Read the last saved configuration and a fresh runtime health check. */
  status(): Promise<EnterpriseRecorderRuntimeView> { return this.request('/v1/admin/runtime', 'GET') }

  /** Persist validated configuration and resolved Host credentials. */
  save(
    request: EnterpriseRecorderRuntimeSaveRequest,
    credentials: ResolvedRecorderCredentials,
  ): Promise<EnterpriseRecorderRuntimeView> {
    return this.request('/v1/admin/runtime/configure', 'POST', {
      ...validateRecorderRuntimeSave(request), credentials,
    })
  }

  /** Start or hot-reload the configured runtime and return verified health. */
  start(): Promise<EnterpriseRecorderRuntimeView> { return this.request('/v1/admin/runtime/start', 'POST', {}) }

  private async request(path: string, method: 'GET' | 'POST', body?: unknown): Promise<EnterpriseRecorderRuntimeView> {
    if (!bounded(this.options.adminToken, 4_096)) throw new Error('recorder runtime admin token is unavailable')
    const response = await this.fetch(`${this.options.baseUrl.replace(/\/$/u, '')}${path}`, {
      method,
      headers: {
        'x-dsh-recorder-admin-token': this.options.adminToken,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    })
    const raw = await response.text()
    if (!response.ok) throw new Error(`recorder runtime ${method} ${path} failed (${String(response.status)}): ${raw.slice(0, 500)}`)
    return runtimeView(JSON.parse(raw))
  }
}
