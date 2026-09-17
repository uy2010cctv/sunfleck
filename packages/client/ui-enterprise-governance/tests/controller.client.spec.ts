import { describe, expect, it, vi } from 'vitest'
import { EnterpriseGovernanceController } from '../src/client/controller.ts'

function response(value: unknown, status = 200, headers: HeadersInit = {}): Response {
  const responseHeaders = new Headers(headers)
  responseHeaders.set('content-type', 'application/json')
  return new Response(value === undefined ? null : JSON.stringify(value), {
    status, headers: responseHeaders,
  })
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

describe('EnterpriseGovernanceController', () => {
  it('invokes the browser fetch method through globalThis instead of detaching it', async () => {
    const original = globalThis.fetch
    const boundFetch = function (this: typeof globalThis): Promise<Response> {
      if (this !== globalThis) throw new Error('Illegal invocation')
      return Promise.resolve(response({ authenticated: false, providers: [] }))
    }
    globalThis.fetch = boundFetch
    try {
      const controller = new EnterpriseGovernanceController()
      await controller.refreshAuth()
      expect(controller.store.getSnapshot().phase).toBe('ready')
    } finally {
      globalThis.fetch = original
    }
  })

  it('loads auth status and the administrator datasets', async () => {
    const fetcher = vi.fn((input: RequestInfo | URL) => {
      const path = new URL(requestUrl(input), 'http://dsh.test').pathname
      if (path === '/auth/status') return Promise.resolve(response({
        authenticated: true,
        principal: { userId: 'admin-1', orgId: 'org-a', username: 'admin', displayName: 'Admin', roles: ['administrator'] },
        providers: [],
      }))
      if (path.endsWith('/users')) return Promise.resolve(response([{ id: 'admin-1', roles: ['administrator'] }]))
      if (path.endsWith('/assets')) return Promise.resolve(response([]))
      if (path.endsWith('/organizations')) return Promise.resolve(response([{ id: 'org-a', name: 'Example' }]))
      if (path.endsWith('/resource-policies')) return Promise.resolve(response([]))
      if (path.endsWith('/departments')) return Promise.resolve(response([{ id: 'dept-1', name: 'Operations', parentId: null }]))
      if (path.endsWith('/workspaces')) return Promise.resolve(response([{ workspaceId: 'workspace-1', kind: 'personal' }]))
      if (path.endsWith('/memories')) return Promise.resolve(response([{ id: 'memory-1', status: 'proposed' }]))
      if (path.endsWith('/memory-writeback')) return Promise.resolve(response([]))
      if (path.endsWith('/audit')) return Promise.resolve(response([{ id: 'audit-1', action: 'user.manage' }]))
      throw new Error(path)
    })
    const cordisGovernance = {
      departmentManagers: vi.fn(() => Promise.resolve({ ok: true, value: {
        orgId: 'org-a', departmentId: 'dept-1', managerUserIds: ['admin-1'],
        revision: 1, updatedBy: 'admin-1', updatedAt: 1,
      } })),
      setDepartmentManagers: vi.fn(() => Promise.resolve({ ok: true, value: {
        orgId: 'org-a', departmentId: 'dept-1', managerUserIds: ['admin-1'],
        revision: 2, updatedBy: 'admin-1', updatedAt: 2,
      } })),
    }
    const controller = new EnterpriseGovernanceController(fetcher, cordisGovernance as never)
    await controller.refreshAuth()
    expect(controller.store.getSnapshot().auth?.principal?.userId).toBe('admin-1')

    await controller.loadAdmin()
    expect(controller.store.getSnapshot()).toMatchObject({
      phase: 'ready', organizations: [{ id: 'org-a', name: 'Example' }],
      users: [{ id: 'admin-1', roles: ['administrator'] }],
      departments: [{ id: 'dept-1', name: 'Operations', parentId: null }],
      workspaces: [{ workspaceId: 'workspace-1', kind: 'personal' }],
      memories: [{ id: 'memory-1', status: 'proposed' }],
      departmentManagers: { 'dept-1': expect.objectContaining({ managerUserIds: ['admin-1'], revision: 1 }) },
      policies: [], audit: [{ id: 'audit-1', action: 'user.manage' }],
    })

    await controller.setDepartmentManagers('dept-1', ['admin-1'], 1)
    expect(cordisGovernance.setDepartmentManagers).toHaveBeenCalledWith(expect.objectContaining({
      departmentId: 'dept-1', managerUserIds: ['admin-1'], expectedRevision: 1,
    }))
    expect(controller.store.getSnapshot().departmentManagers['dept-1']?.revision).toBe(2)
  })

  it('submits local credentials without retaining the password and refreshes status', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    let authenticated = false
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input)
      calls.push(init === undefined ? { url } : { url, init })
      if (url === '/auth/login/local') {
        authenticated = true
        return Promise.resolve(response({ principal: { userId: 'admin-1' } }))
      }
      return Promise.resolve(response({ authenticated, providers: [] }))
    })
    const reload = vi.fn()
    vi.stubGlobal('location', { reload })
    try {
      const controller = new EnterpriseGovernanceController(fetcher)
      await controller.loginLocal({ organizationId: 'org-a', username: 'admin', password: 'password' })
      expect(calls[0]?.init?.credentials).toBe('same-origin')
      expect(calls[0]?.init?.body).toContain('password')
      expect(JSON.stringify(controller.store.getSnapshot())).not.toContain('password')
      expect(reload).toHaveBeenCalledOnce()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('creates users, updates roles, writes asset policies, and refreshes audit', async () => {
    const calls: string[] = []
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input)
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (url === '/auth/status') return Promise.resolve(response({
        authenticated: true,
        principal: { userId: 'admin-1', orgId: 'org-a', username: 'admin', displayName: 'Admin', roles: ['administrator'] },
        providers: [],
      }))
      if (url.endsWith('/users') && init?.method === 'POST') return Promise.resolve(response({}, 201))
      if (url.endsWith('/assets') && init?.method === 'POST') return Promise.resolve(response({}, 201))
      if (url.endsWith('/organizations') && init?.method === 'POST') return Promise.resolve(response({}, 201))
      if (url.includes('/users/') && init?.method === 'PATCH') return Promise.resolve(response(undefined, 204))
      if (url.endsWith('/resource-policies') && init?.method === 'POST') return Promise.resolve(response(undefined, 204))
      if (url.endsWith('/departments') && init?.method === 'POST') return Promise.resolve(response({}, 201))
      if (url.endsWith('/workspaces') && init?.method === 'POST') return Promise.resolve(response({}, 201))
      if (url.endsWith('/memories') && init?.method === 'POST') return Promise.resolve(response({}, 201))
      if (url.includes('/memories/') && init?.method === 'PATCH') return Promise.resolve(response({}))
      if (url.includes('/workspaces/') && init?.method === 'PATCH') return Promise.resolve(response({}))
      if (url.endsWith('/users')) return Promise.resolve(response([]))
      if (url.endsWith('/assets')) return Promise.resolve(response([]))
      if (url.endsWith('/organizations')) return Promise.resolve(response([]))
      if (url.endsWith('/resource-policies')) return Promise.resolve(response([]))
      if (url.endsWith('/departments')) return Promise.resolve(response([]))
      if (url.endsWith('/workspaces')) return Promise.resolve(response([]))
      if (url.endsWith('/memories')) return Promise.resolve(response([]))
      if (url.includes('/audit')) return Promise.resolve(response([]))
      throw new Error(url)
    })
    const controller = new EnterpriseGovernanceController(fetcher)
    await controller.createOrganization({
      id: 'org-b', name: 'Second organization', administratorId: 'org-b:administrator',
      administratorUsername: 'admin', administratorDisplayName: 'Second Admin', password: 'second-password',
    })
    await controller.createAsset({ type: 'channel', id: 'wecom-main', name: 'WeCom', config: {} })
    await controller.createUser({
      id: 'operator-1', username: 'operator', displayName: 'Operator', password: 'operator@123', roles: ['operator'],
    })
    await controller.updateUser('operator-1', {
      username: 'operator.renamed', displayName: 'Renamed Operator', password: 'operator@456',
      roles: ['auditor'], disabled: false,
    })
    await controller.saveDepartment({ id: 'dept-1', name: 'Operations', parentId: null, sortOrder: 0, expectedRevision: 0 })
    await controller.createWorkspace({ name: '专项空间', idempotencyKey: 'workspace-1' })
    await controller.updateWorkspace('workspace-1', { sandboxMode: 'read-only', expectedRevision: 1 })
    await controller.proposeMemory({
      id: 'memory-1', scope: 'organization', kind: 'business-fact', summary: '使用统一合同编号。',
      sourceDigest: 'a'.repeat(64),
    })
    await controller.reviewMemory('memory-1', { decision: 'approved', reason: 'verified', expectedRevision: 1 })
    await controller.savePolicy({
      resourceType: 'channel', resourceId: 'wecom-main', visibility: 'restricted', allowedUserIds: ['operator-1'],
    })
    expect(calls).toEqual(expect.arrayContaining([
      'POST /auth/admin/users',
      'POST /auth/admin/organizations',
      'POST /auth/admin/assets',
      'PATCH /auth/admin/users/operator-1',
      'GET /auth/status',
      'POST /auth/admin/departments',
      'POST /auth/workspaces',
      'PATCH /auth/admin/workspaces/workspace-1',
      'POST /auth/admin/memories',
      'PATCH /auth/admin/memories/memory-1',
      'POST /auth/admin/resource-policies',
    ]))
    const organizationCall = fetcher.mock.calls.find(([input, init]) =>
      requestUrl(input).endsWith('/organizations') && init?.method === 'POST')
    expect(JSON.parse(String(organizationCall?.[1]?.body))).toEqual({
      id: 'org-b', name: 'Second organization', administratorId: 'org-b:administrator',
      administratorUsername: 'admin', administratorDisplayName: 'Second Admin', password: 'second-password',
    })
  })
})
