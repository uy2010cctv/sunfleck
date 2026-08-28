/** Browser controller for authentication and enterprise administration APIs. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

export interface GovernancePrincipal {
  readonly userId: string
  readonly orgId: string
  readonly username: string
  readonly displayName: string
  readonly roles: readonly string[]
}

export interface GovernanceAuthStatus {
  readonly authenticated: boolean
  readonly organizationId?: string
  readonly principal?: GovernancePrincipal
  readonly providers: readonly { id: string; kind: string; label: string }[]
}

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

export interface GovernanceOrganization {
  readonly id: string
  readonly name: string
}

export interface GovernancePolicy {
  readonly resourceType: string
  readonly resourceId: string
  readonly creatorUserId?: string
  readonly visibility: 'organization' | 'private' | 'restricted'
  readonly allowedUserIds: readonly string[]
}

export interface GovernanceAsset {
  readonly type: 'channel' | 'model' | 'capability'
  readonly id: string
  readonly name: string
  readonly config: Readonly<Record<string, unknown>>
}

export interface GovernanceAudit {
  readonly id: string
  readonly actorUserId: string
  readonly action: string
  readonly decision: string
  readonly resourceType?: string
  readonly resourceId?: string
  readonly at: number
}

export interface EnterpriseGovernanceState {
  readonly phase: 'loading' | 'ready' | 'error'
  readonly error: string | null
  readonly auth?: GovernanceAuthStatus
  readonly organizations: readonly GovernanceOrganization[]
  readonly users: readonly GovernanceUser[]
  readonly departments: readonly GovernanceDepartment[]
  readonly workspaces: readonly GovernanceWorkspace[]
  readonly memories: readonly GovernanceMemory[]
  readonly assets: readonly GovernanceAsset[]
  readonly policies: readonly GovernancePolicy[]
  readonly audit: readonly GovernanceAudit[]
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

const INITIAL: EnterpriseGovernanceState = {
  phase: 'loading', error: null, organizations: [], users: [], departments: [], workspaces: [], memories: [],
  assets: [], policies: [], audit: [],
}

export class EnterpriseGovernanceController {
  readonly store: SnapshotStore<EnterpriseGovernanceState> = createSnapshotStore(INITIAL)
  private readonly fetcher: Fetcher

  constructor(fetcher?: Fetcher) {
    this.fetcher = fetcher ?? ((input, init) => globalThis.fetch(input, init))
  }

  async refreshAuth(): Promise<void> {
    try {
      const auth = await this.get<GovernanceAuthStatus>('/auth/status')
      this.store.set({ ...this.store.getSnapshot(), phase: 'ready', error: null, auth })
    } catch (error) {
      this.fail(error)
    }
  }

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

  async logout(): Promise<void> {
    await this.request('/auth/logout', { method: 'POST' })
    this.store.set({ ...INITIAL, phase: 'ready', auth: { authenticated: false, providers: [] } })
    await this.refreshAuth()
  }

  async loadAdmin(): Promise<void> {
    try {
      const [organizations, users, departments, workspaces, memories, assets, policies, audit] = await Promise.all([
        this.get<GovernanceOrganization[]>('/auth/admin/organizations'),
        this.get<GovernanceUser[]>('/auth/admin/users'),
        this.get<GovernanceDepartment[]>('/auth/admin/departments'),
        this.get<GovernanceWorkspace[]>('/auth/admin/workspaces'),
        this.get<GovernanceMemory[]>('/auth/admin/memories'),
        this.get<GovernanceAsset[]>('/auth/admin/assets'),
        this.get<GovernancePolicy[]>('/auth/admin/resource-policies'),
        this.get<GovernanceAudit[]>('/auth/admin/audit?limit=200'),
      ])
      this.store.set({
        ...this.store.getSnapshot(), phase: 'ready', error: null,
        organizations, users, departments, workspaces, memories, assets, policies, audit,
      })
    } catch (error) {
      this.fail(error)
    }
  }

  async createUser(input: {
    id: string
    username: string
    displayName: string
    roles: readonly string[]
  }): Promise<void> {
    await this.request('/auth/admin/users', { method: 'POST', body: JSON.stringify(input) })
    await this.loadAdmin()
  }

  async createOrganization(input: GovernanceOrganization): Promise<void> {
    await this.request('/auth/admin/organizations', { method: 'POST', body: JSON.stringify(input) })
    await this.loadAdmin()
  }

  async updateUser(userId: string, input: {
    roles?: readonly string[]
    disabled?: boolean
    departmentIds?: readonly string[]
    primaryDepartmentId?: string
    expectedRevision?: number
  }): Promise<void> {
    await this.request(`/auth/admin/users/${encodeURIComponent(userId)}`, {
      method: 'PATCH', body: JSON.stringify(input),
    })
    await this.loadAdmin()
  }

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

  async createWorkspace(input: { name: string; idempotencyKey: string }): Promise<void> {
    await this.request('/auth/workspaces', { method: 'POST', body: JSON.stringify(input) })
    await this.loadAdmin()
  }

  async updateWorkspace(workspaceId: string, input: {
    sandboxMode: GovernanceWorkspace['sandboxMode']
    expectedRevision: number
  }): Promise<void> {
    await this.request(`/auth/admin/workspaces/${encodeURIComponent(workspaceId)}`, {
      method: 'PATCH', body: JSON.stringify(input),
    })
    await this.loadAdmin()
  }

  async proposeMemory(input: {
    id: string
    scope: GovernanceMemory['scope']
    departmentId?: string
    kind: GovernanceMemory['kind']
    summary: string
    sourceDigest: string
  }): Promise<void> {
    await this.request('/auth/admin/memories', { method: 'POST', body: JSON.stringify(input) })
    await this.loadAdmin()
  }

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

  async savePolicy(input: GovernancePolicy): Promise<void> {
    await this.request('/auth/admin/resource-policies', { method: 'POST', body: JSON.stringify(input) })
    await this.loadAdmin()
  }

  async createAsset(input: GovernanceAsset): Promise<void> {
    await this.request('/auth/admin/assets', { method: 'POST', body: JSON.stringify(input) })
    await this.loadAdmin()
  }

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
