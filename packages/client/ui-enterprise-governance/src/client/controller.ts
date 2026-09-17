/** Browser controller for authentication and enterprise administration APIs. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { DepartmentManagerSet } from '@deepseek-ai/dsh-api-enterprise-controller/types'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'

/** Data used by `GovernancePrincipal`. */
export interface GovernancePrincipal {
  readonly userId: string
  readonly orgId: string
  readonly username: string
  readonly displayName: string
  readonly roles: readonly string[]
}

/** Data used by `GovernanceAuthStatus`. */
export interface GovernanceAuthStatus {
  readonly authenticated: boolean
  readonly organizationId?: string
  readonly defaultOrganizationId?: string
  readonly platformAdministrator?: boolean
  readonly organizations?: readonly GovernanceOrganization[]
  readonly principal?: GovernancePrincipal
  readonly providers: readonly { id: string; kind: string; label: string }[]
}

/** Data used by `GovernanceUser`. */
export interface GovernanceUser {
  readonly id: string
  readonly username: string
  readonly displayName: string
  readonly disabled: boolean
  readonly roles: readonly string[]
  readonly departmentIds?: readonly string[]
  readonly primaryDepartmentId?: string
  readonly departmentRevision?: number
}

/** Data used by `GovernanceDepartment`. */
export interface GovernanceDepartment {
  readonly id: string
  readonly orgId: string
  readonly parentId: string | null
  readonly name: string
  readonly sortOrder: number
  readonly revision: number
  readonly createdAt: number
  readonly updatedAt: number
}

/** Data used by `GovernanceWorkspace`. */
export interface GovernanceWorkspace {
  readonly workspaceId: string
  readonly orgId: string
  readonly name: string
  readonly kind: 'personal' | 'department'
  readonly ownerUserId?: string
  readonly departmentId?: string
  readonly rootPath: string
  readonly sandboxMode: 'read-only' | 'workspace-write'
  readonly revision: number
  readonly createdAt: number
  readonly updatedAt: number
}

/** Data used by `GovernanceMemory`. */
export interface GovernanceMemory {
  readonly id: string
  readonly orgId: string
  readonly scope: 'organization' | 'department'
  readonly departmentId?: string
  readonly kind: 'business-fact' | 'process' | 'terminology' | 'decision'
  readonly status: 'proposed' | 'approved' | 'rejected' | 'retired'
  readonly summary: string
  readonly sourceDigest: string
  readonly privacyFindings: readonly string[]
  readonly createdBy: string
  readonly reviewedBy?: string
  readonly reviewReason?: string
  readonly revision: number
  readonly createdAt: number
  readonly updatedAt: number
}

export interface GovernanceMemoryWriteback {
  readonly sourceKey: string
  readonly sessionId: string
  readonly turn: number
  readonly state: 'queued' | 'running' | 'completed' | 'failed'
  readonly attempts: number
  readonly nextAttemptAt: number
  readonly error?: string
  readonly result?: { readonly outcome: 'completed'; readonly activated: number; readonly pending: number; readonly skipped: number }
  readonly createdAt: number
  readonly updatedAt: number
}

/** Data used by `GovernanceOrganization`. */
export interface GovernanceOrganization {
  readonly id: string
  readonly name: string
}

/** Platform-admin request that creates one login-ready isolated organization. */
export interface CreateGovernanceOrganizationInput extends GovernanceOrganization {
  readonly administratorId: string
  readonly administratorUsername: string
  readonly administratorDisplayName: string
  readonly password: string
}

/** Data used by `GovernancePolicy`. */
export interface GovernancePolicy {
  readonly resourceType: string
  readonly resourceId: string
  readonly creatorUserId?: string
  readonly visibility: 'organization' | 'private' | 'restricted'
  readonly allowedUserIds: readonly string[]
}

/** Data used by `GovernanceAsset`. */
export interface GovernanceAsset {
  readonly type: 'channel' | 'model' | 'capability'
  readonly id: string
  readonly name: string
  readonly config: Readonly<Record<string, unknown>>
}

/** Data used by `GovernanceAudit`. */
export interface GovernanceAudit {
  readonly id: string
  readonly actorUserId: string
  readonly action: string
  readonly decision: string
  readonly resourceType?: string
  readonly resourceId?: string
  readonly at: number
}

/** Data used by `EnterpriseGovernanceState`. */
export interface EnterpriseGovernanceState {
  readonly phase: 'loading' | 'ready' | 'error'
  readonly error: string | null
  readonly auth?: GovernanceAuthStatus
  readonly organizations: readonly GovernanceOrganization[]
  readonly users: readonly GovernanceUser[]
  readonly departments: readonly GovernanceDepartment[]
  readonly workspaces: readonly GovernanceWorkspace[]
  readonly memories: readonly GovernanceMemory[]
  readonly memoryWritebacks: readonly GovernanceMemoryWriteback[]
  readonly assets: readonly GovernanceAsset[]
  readonly policies: readonly GovernancePolicy[]
  readonly audit: readonly GovernanceAudit[]
  readonly departmentManagers: Readonly<Record<string, DepartmentManagerSet>>
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

const INITIAL: EnterpriseGovernanceState = {
  phase: 'loading', error: null, organizations: [], users: [], departments: [], workspaces: [], memories: [], memoryWritebacks: [],
  assets: [], policies: [], audit: [],
  departmentManagers: {},
}

type CordisGovernanceRemote = ClientRemote['cordisGovernance']

function remoteValue<T>(response: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
  | { result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } } }): T {
  const result = 'result' in response ? response.result : response
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
  return result.value
}

/** Provides `EnterpriseGovernanceController` capabilities. */
export class EnterpriseGovernanceController {
  /** Current `EnterpriseGovernanceController.store` value. */
  readonly store: SnapshotStore<EnterpriseGovernanceState> = createSnapshotStore(INITIAL)
  private readonly fetcher: Fetcher

  constructor(fetcher?: Fetcher, private readonly cordisGovernance?: CordisGovernanceRemote) {
    this.fetcher = fetcher ?? ((input, init) => globalThis.fetch(input, init))
  }

  /** Executes `EnterpriseGovernanceController.refreshAuth` for this instance. */
  async refreshAuth(): Promise<void> {
    try {
      const auth = await this.get<GovernanceAuthStatus>('/auth/status')
      const current = this.store.getSnapshot()
      const organizations = auth.organizations !== undefined && auth.organizations.length > 0
        ? auth.organizations
        : auth.organizationId === undefined
          ? current.organizations
          : [{ id: auth.organizationId, name: auth.organizationId }]
      this.store.set({ ...current, phase: 'ready', error: null, auth, organizations })
    } catch (error) {
      this.fail(error)
    }
  }

  /** Executes `EnterpriseGovernanceController.loginLocal` for this instance.
   * @param input - Input value used by this API.
   */
  async loginLocal(input: { organizationId: string; username: string; password: string }): Promise<void> {
    this.store.set({ ...this.store.getSnapshot(), phase: 'loading', error: null })
    try {
      await this.request('/auth/login/local', { method: 'POST', body: JSON.stringify(input) })
      await this.refreshAuth()
      if (this.store.getSnapshot().auth?.authenticated === true) globalThis.location.reload()
    } catch (error) {
      this.fail(error)
    }
  }

  /** Executes `EnterpriseGovernanceController.logout` for this instance. */
  async logout(): Promise<void> {
    await this.request('/auth/logout', { method: 'POST' })
    this.store.set({ ...INITIAL, phase: 'ready', auth: { authenticated: false, providers: [] } })
    await this.refreshAuth()
  }

  /** Executes `EnterpriseGovernanceController.loadAdmin` for this instance. */
  async loadAdmin(): Promise<void> {
    try {
      const [organizations, users, departments, workspaces, memories, memoryWritebacks, assets, policies, audit] = await Promise.all([
        this.get<GovernanceOrganization[]>('/auth/admin/organizations'),
        this.get<GovernanceUser[]>('/auth/admin/users'),
        this.get<GovernanceDepartment[]>('/auth/admin/departments'),
        this.get<GovernanceWorkspace[]>('/auth/admin/workspaces'),
        this.get<GovernanceMemory[]>('/auth/admin/memories'),
        this.get<GovernanceMemoryWriteback[]>('/auth/admin/memory-writeback'),
        this.get<GovernanceAsset[]>('/auth/admin/assets'),
        this.get<GovernancePolicy[]>('/auth/admin/resource-policies'),
        this.get<GovernanceAudit[]>('/auth/admin/audit?limit=200'),
      ])
      const departmentManagers: Record<string, DepartmentManagerSet> = {}
      const cordisGovernance = this.cordisGovernance
      if (cordisGovernance !== undefined) {
        await Promise.all(departments.map(async (department) => {
          const value = remoteValue(await cordisGovernance.departmentManagers({ departmentId: department.id }))
          if (value !== null) departmentManagers[department.id] = value
        }))
      }
      this.store.set({
        ...this.store.getSnapshot(), phase: 'ready', error: null,
        organizations, users, departments, workspaces, memories, memoryWritebacks, assets, policies, audit, departmentManagers,
      })
    } catch (error) {
      this.fail(error)
    }
  }

  /** Executes `EnterpriseGovernanceController.setDepartmentManagers` for this instance.
   * @param departmentId - Input value used by this API.
   * @param expectedRevision - Input value used by this API.
   * @param managerUserIds - Input value used by this API.
   */
  async setDepartmentManagers(
    departmentId: string,
    managerUserIds: readonly string[],
    expectedRevision: number,
  ): Promise<void> {
    if (this.cordisGovernance === undefined) throw new Error('department manager service is unavailable')
    const value = remoteValue(await this.cordisGovernance.setDepartmentManagers({
      departmentId, managerUserIds, expectedRevision,
      idempotencyKey: `department-managers:${randomUUID()}`,
    }))
    this.store.set({
      ...this.store.getSnapshot(),
      departmentManagers: { ...this.store.getSnapshot().departmentManagers, [departmentId]: value },
      error: null,
    })
  }

  /** Executes `EnterpriseGovernanceController.createUser` for this instance.
   * @param input - Input value used by this API.
   */
  async createUser(input: {
    id: string
    username: string
    displayName: string
    password: string
    roles: readonly string[]
  }): Promise<void> {
    await this.request('/auth/admin/users', { method: 'POST', body: JSON.stringify(input) })
    await this.loadAdmin()
  }

  /** Executes `EnterpriseGovernanceController.createOrganization` for this instance.
   * @param input - Input value used by this API.
   */
  async createOrganization(input: CreateGovernanceOrganizationInput): Promise<void> {
    await this.request('/auth/admin/organizations', { method: 'POST', body: JSON.stringify(input) })
    await this.loadAdmin()
  }

  /** Executes `EnterpriseGovernanceController.updateUser` for this instance.
   * @param input - Input value used by this API.
   * @param userId - Input value used by this API.
   */
  async updateUser(userId: string, input: {
    roles?: readonly string[]
    disabled?: boolean
    username?: string
    displayName?: string
    password?: string
    departmentIds?: readonly string[]
    primaryDepartmentId?: string
    expectedRevision?: number
  }): Promise<void> {
    await this.request(`/auth/admin/users/${encodeURIComponent(userId)}`, {
      method: 'PATCH', body: JSON.stringify(input),
    })
    await this.loadAdmin()
    if (input.username !== undefined || input.displayName !== undefined || input.password !== undefined) {
      await this.refreshAuth()
    }
  }

  /** Executes `EnterpriseGovernanceController.saveDepartment` for this instance.
   * @param input - Input value used by this API.
   */
  async saveDepartment(input: {
    id: string
    name: string
    parentId: string | null
    sortOrder: number
    expectedRevision: number
  }): Promise<void> {
    await this.request('/auth/admin/departments', { method: 'POST', body: JSON.stringify(input) })
    await this.loadAdmin()
  }

  /** Executes `EnterpriseGovernanceController.createWorkspace` for this instance.
   * @param input - Input value used by this API.
   */
  async createWorkspace(input: { name: string; idempotencyKey: string }): Promise<void> {
    await this.request('/auth/workspaces', { method: 'POST', body: JSON.stringify(input) })
    await this.loadAdmin()
  }

  /** Executes `EnterpriseGovernanceController.updateWorkspace` for this instance.
   * @param input - Input value used by this API.
   * @param workspaceId - Input value used by this API.
   */
  async updateWorkspace(workspaceId: string, input: {
    name?: string
    sandboxMode?: GovernanceWorkspace['sandboxMode']
    expectedRevision: number
  }): Promise<void> {
    await this.request(`/auth/admin/workspaces/${encodeURIComponent(workspaceId)}`, {
      method: 'PATCH', body: JSON.stringify(input),
    })
    await this.loadAdmin()
  }

  /** Executes `EnterpriseGovernanceController.proposeMemory` for this instance.
   * @param input - Input value used by this API.
   */
  async proposeMemory(input: {
    id: string
    scope: GovernanceMemory['scope']
    departmentId?: string
    kind: GovernanceMemory['kind']
    summary: string
    sourceDigest?: string
  }): Promise<void> {
    await this.request('/auth/admin/memories', { method: 'POST', body: JSON.stringify(input) })
    await this.loadAdmin()
  }

  /** Executes `EnterpriseGovernanceController.reviewMemory` for this instance.
   * @param input - Input value used by this API.
   * @param memoryId - Input value used by this API.
   */
  async reviewMemory(memoryId: string, input: {
    decision: 'approved' | 'rejected' | 'retired'
    reason: string
    expectedRevision: number
  }): Promise<void> {
    await this.request(`/auth/admin/memories/${encodeURIComponent(memoryId)}`, {
      method: 'PATCH', body: JSON.stringify(input),
    })
    await this.loadAdmin()
  }

  async retryMemoryWriteback(sourceKey: string): Promise<void> {
    await this.request(`/auth/admin/memory-writeback/${encodeURIComponent(sourceKey)}/retry`, { method: 'POST' })
    await this.loadAdmin()
  }

  /** Executes `EnterpriseGovernanceController.savePolicy` for this instance.
   * @param input - Input value used by this API.
   */
  async savePolicy(input: GovernancePolicy): Promise<void> {
    await this.request('/auth/admin/resource-policies', { method: 'POST', body: JSON.stringify(input) })
    await this.loadAdmin()
  }

  /** Executes `EnterpriseGovernanceController.createAsset` for this instance.
   * @param input - Input value used by this API.
   */
  async createAsset(input: GovernanceAsset): Promise<void> {
    await this.request('/auth/admin/assets', { method: 'POST', body: JSON.stringify(input) })
    await this.loadAdmin()
  }

  /** Executes `EnterpriseGovernanceController.filterAudit` for this instance.
   * @param input - Input value used by this API.
   */
  async filterAudit(input: { actorUserId?: string; action?: string }): Promise<void> {
    const params = new URLSearchParams({ limit: '200' })
    if (input.actorUserId !== undefined && input.actorUserId !== '') params.set('actorUserId', input.actorUserId)
    if (input.action !== undefined && input.action !== '') params.set('action', input.action)
    try {
      const audit = await this.get<GovernanceAudit[]>(`/auth/admin/audit?${params.toString()}`)
      this.store.set({ ...this.store.getSnapshot(), audit, error: null })
    } catch (error) {
      this.fail(error)
    }
  }

  private async get<T>(url: string): Promise<T> {
    const response = await this.request(url)
    return await response.json() as T
  }

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    const response = await this.fetcher(url, {
      credentials: 'same-origin',
      ...init,
      headers: (() => {
        const headers = new Headers(init.headers)
        if (init.body !== undefined) headers.set('content-type', 'application/json')
        return headers
      })(),
    })
    if (!response.ok) throw new Error(`enterprise request failed (${String(response.status)})`)
    return response
  }

  private fail(error: unknown): void {
    this.store.set({
      ...this.store.getSnapshot(), phase: 'error', error: error instanceof Error ? error.message : String(error),
    })
  }
}
