import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EnterpriseIdentityRepository } from '@deepseek-ai/dsh-enterprise-identity'
import { createPasswordVerifier } from '@deepseek-ai/dsh-enterprise-sso'
import { EnterpriseAuthHttpHandler, EnterpriseSecurity } from '../src/index.ts'

describe('EnterpriseAuthHttpHandler', () => {
  let root: string
  let repository: EnterpriseIdentityRepository
  let handler: EnterpriseAuthHttpHandler

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-enterprise-auth-http-'))
    repository = new EnterpriseIdentityRepository(join(root, 'identity.sqlite'))
    repository.createOrganization({ id: 'org-a', name: 'Example' })
    repository.createUser({
      id: 'admin-1', orgId: 'org-a', username: 'admin', displayName: 'Admin', disabled: false,
    })
    repository.setRoles('admin-1', ['administrator'])
    repository.setPasswordVerifier('admin-1', createPasswordVerifier('enterprise-password'))
    let token = 0
    let id = 0
    const security = new EnterpriseSecurity(repository, {
      organizationId: 'org-a', sessionCookieName: 'dsh_session', sessionTtlMs: 60_000,
      secureCookies: true, autoProvisionSsoUsers: true,
    }, { randomToken: () => `token-${String(++token)}`, randomId: () => `generated-${String(++id)}` })
    handler = new EnterpriseAuthHttpHandler(security, {
      localEnabled: true,
      oidc: [{
        id: 'oidc-main', label: 'Company OIDC',
        begin: () => Promise.resolve({ url: new URL('https://id.example.com/authorize'), state: 'state' }),
        complete: () => Promise.resolve({
          providerId: 'oidc-main', subject: 'oidc-1', organizationId: 'org-a',
          username: 'oidc-user', displayName: 'OIDC User', roles: ['member'], returnTo: '/work',
        }),
      }],
      saml: [],
      ldap: [],
    })
  })

  afterEach(async () => {
    repository.close()
    await rm(root, { recursive: true, force: true })
  })

  it('reports anonymous status and available login providers', async () => {
    const response = await handler.fetch(new Request('https://dsh.example.com/auth/status'))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      authenticated: false,
      organizationId: 'org-a',
      providers: [
        { id: 'local', kind: 'local', label: 'Local account' },
        { id: 'oidc-main', kind: 'oidc', label: 'Company OIDC' },
      ],
    })
  })

  it('logs in locally, returns the current principal, and revokes logout', async () => {
    const login = await handler.fetch(new Request('https://dsh.example.com/auth/login/local', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://dsh.example.com' },
      body: JSON.stringify({ organizationId: 'org-a', username: 'admin', password: 'enterprise-password' }),
    }))
    expect(login.status).toBe(200)
    const cookie = login.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('HttpOnly')

    const status = await handler.fetch(new Request('https://dsh.example.com/auth/status', {
      headers: { cookie },
    }))
    await expect(status.json()).resolves.toMatchObject({
      authenticated: true, principal: { userId: 'admin-1', roles: ['administrator'] },
    })

    const logout = await handler.fetch(new Request('https://dsh.example.com/auth/logout', {
      method: 'POST', headers: { cookie, origin: 'https://dsh.example.com' },
    }))
    expect(logout.status).toBe(204)
    const after = await handler.fetch(new Request('https://dsh.example.com/auth/status', { headers: { cookie } }))
    await expect(after.json()).resolves.toMatchObject({ authenticated: false })
  })

  it('ensures a managed personal workspace after successful local login', async () => {
    const ensured: string[] = []
    const security = new EnterpriseSecurity(repository, {
      organizationId: 'org-a', sessionCookieName: 'dsh_session', sessionTtlMs: 60_000,
      secureCookies: true, autoProvisionSsoUsers: true,
    }, { randomToken: () => 'workspace-token' })
    const managed = new EnterpriseAuthHttpHandler(security, {
      localEnabled: true, oidc: [], saml: [], ldap: [],
    }, {
      workspaceProvisioner: { ensurePersonal: async (user) => { ensured.push(user.id); return {} as never } },
    })
    const response = await managed.fetch(new Request('https://dsh.example.com/auth/login/local', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://dsh.example.com' },
      body: JSON.stringify({ organizationId: 'org-a', username: 'admin', password: 'enterprise-password' }),
    }))
    expect(response.status).toBe(200)
    expect(ensured).toEqual(['admin-1'])
  })

  it('starts OIDC and commits the validated external identity on callback', async () => {
    const start = await handler.fetch(new Request('https://dsh.example.com/auth/login/oidc-main?returnTo=/work'))
    expect(start.status).toBe(303)
    expect(start.headers.get('location')).toBe('https://id.example.com/authorize')

    const callback = await handler.fetch(new Request(
      'https://dsh.example.com/auth/callback/oidc-main?code=code&state=state',
    ))
    expect(callback.status).toBe(303)
    expect(callback.headers.get('location')).toBe('/work')
    expect(callback.headers.get('set-cookie')).toContain('HttpOnly')
    expect(repository.resolveExternalIdentity('oidc-main', 'oidc-1')).toMatchObject({ username: 'oidc-user' })
  })

  it('rejects cross-origin local login and unknown auth routes', async () => {
    const crossOrigin = await handler.fetch(new Request('https://dsh.example.com/auth/login/local', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example.com' },
      body: '{}',
    }))
    expect(crossOrigin.status).toBe(403)
    expect((await handler.fetch(new Request('https://dsh.example.com/auth/nope'))).status).toBe(404)
  })

  it('lists the organization department directory for an authenticated member', async () => {
    repository.createUser({ id: 'member-1', orgId: 'org-a', username: 'member', displayName: 'Member', disabled: false })
    repository.setRoles('member-1', ['member'])
    repository.setPasswordVerifier('member-1', createPasswordVerifier('member-password'))
    repository.saveDepartment({
      id: 'dept-ops', orgId: 'org-a', name: '运营部', parentId: null, sortOrder: 0, expectedRevision: 0,
    })
    const login = await handler.fetch(new Request('https://dsh.example.com/auth/login/local', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://dsh.example.com' },
      body: JSON.stringify({ organizationId: 'org-a', username: 'member', password: 'member-password' }),
    }))
    const response = await handler.fetch(new Request('https://dsh.example.com/auth/departments', {
      headers: { cookie: login.headers.get('set-cookie') ?? '' },
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual([
      expect.objectContaining({ id: 'dept-ops', name: '运营部' }),
    ])
  })

  it('manages departments, user membership, workspaces, and reviewed memory', async () => {
    const provisioned: string[] = []
    const synchronizedWorkspaceNames: string[] = []
    let auditId = 0
    const security = new EnterpriseSecurity(repository, {
      organizationId: 'org-a', sessionCookieName: 'dsh_session', sessionTtlMs: 60_000,
      secureCookies: true, autoProvisionSsoUsers: true,
    }, { randomToken: () => 'directory-token', randomId: () => `directory-audit-${String(++auditId)}` })
    const managed = new EnterpriseAuthHttpHandler(security, {
      localEnabled: true, oidc: [], saml: [], ldap: [],
    }, {
      workspaceProvisioner: {
        ensurePersonal: async (user) => {
          provisioned.push(`user:${user.id}`)
          return {} as never
        },
        ensureDepartment: async (department) => {
          provisioned.push(`department:${department.id}`)
          return {} as never
        },
        createPersonal: async (user, name) => repository.saveWorkspaceGrant({
          workspaceId: 'workspace-extra', orgId: user.orgId, name, kind: 'personal',
          ownerUserId: user.id, rootPath: '/managed/extra', sandboxMode: 'workspace-write', expectedRevision: 0,
        }),
        ensureWorkspace: async (grant) => { synchronizedWorkspaceNames.push(grant.name) },
      },
    })
    const login = await managed.fetch(new Request('https://dsh.example.com/auth/login/local', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://dsh.example.com' },
      body: JSON.stringify({ organizationId: 'org-a', username: 'admin', password: 'enterprise-password' }),
    }))
    const cookie = login.headers.get('set-cookie') ?? ''
    const mutationHeaders = { cookie, origin: 'https://dsh.example.com', 'content-type': 'application/json' }

    const department = await managed.fetch(new Request('https://dsh.example.com/auth/admin/departments', {
      method: 'POST', headers: mutationHeaders,
      body: JSON.stringify({ id: 'dept-ops', name: '运营部', parentId: null, sortOrder: 0, expectedRevision: 0 }),
    }))
    expect(department.status).toBe(201)
    expect(provisioned).toContain('department:dept-ops')

    const user = await managed.fetch(new Request('https://dsh.example.com/auth/admin/users/admin-1', {
      method: 'PATCH', headers: mutationHeaders,
      body: JSON.stringify({ departmentIds: ['dept-ops'], primaryDepartmentId: 'dept-ops', expectedRevision: 0 }),
    }))
    expect(user.status).toBe(204)

    const workspace = await managed.fetch(new Request('https://dsh.example.com/auth/workspaces', {
      method: 'POST', headers: mutationHeaders,
      body: JSON.stringify({ name: '专项工作区', idempotencyKey: 'workspace-request-1' }),
    }))
    expect(workspace.status).toBe(201)
    const workspaceList = await managed.fetch(new Request('https://dsh.example.com/auth/workspaces', {
      headers: { cookie },
    }))
    await expect(workspaceList.json()).resolves.toEqual([
      expect.objectContaining({ workspaceId: 'workspace-extra', ownerUserId: 'admin-1' }),
    ])
    const sandbox = await managed.fetch(new Request('https://dsh.example.com/auth/admin/workspaces/workspace-extra', {
      method: 'PATCH', headers: mutationHeaders,
      body: JSON.stringify({ name: '管理员指定工作区', sandboxMode: 'read-only', expectedRevision: 1 }),
    }))
    expect(sandbox.status).toBe(200)
    await expect(sandbox.json()).resolves.toMatchObject({
      name: '管理员指定工作区', sandboxMode: 'read-only', revision: 2,
    })
    expect(synchronizedWorkspaceNames).toContain('管理员指定工作区')

    const proposal = await managed.fetch(new Request('https://dsh.example.com/auth/admin/memories', {
      method: 'POST', headers: mutationHeaders,
      body: JSON.stringify({
        id: 'memory-1', scope: 'department', departmentId: 'dept-ops', kind: 'process',
        summary: '报价审批必须保留版本记录。', sourceDigest: 'd'.repeat(64), needsConfirmation: true,
      }),
    }))
    expect(proposal.status).toBe(201)
    const automaticDigest = await managed.fetch(new Request('https://dsh.example.com/auth/admin/memories', {
      method: 'POST', headers: mutationHeaders,
      body: JSON.stringify({
        id: 'memory-2', scope: 'organization', kind: 'terminology', summary: 'SKU 指库存单位。',
      }),
    }))
    expect(automaticDigest.status).toBe(201)
    const automaticMemory = await automaticDigest.json() as { id?: unknown; sourceDigest?: unknown; status?: unknown }
    expect(automaticMemory.status).toBe('approved')
    expect(automaticMemory.id).toBe('memory-2')
    expect(automaticMemory.sourceDigest).toMatch(/^[a-f0-9]{64}$/)
    const review = await managed.fetch(new Request('https://dsh.example.com/auth/admin/memories/memory-1', {
      method: 'PATCH', headers: mutationHeaders,
      body: JSON.stringify({ decision: 'approved', reason: '制度核验完成', expectedRevision: 1 }),
    }))
    expect(review.status).toBe(200)
    const memories = await managed.fetch(new Request('https://dsh.example.com/auth/admin/memories?status=approved', {
      headers: { cookie },
    }))
    await expect(memories.json()).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'memory-1', status: 'approved' }), expect.objectContaining({ id: 'memory-2', status: 'approved' })]))
  })

  it('serves user, role, resource-policy, and audit administration only to administrators', async () => {
    const login = await handler.fetch(new Request('https://dsh.example.com/auth/login/local', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://dsh.example.com' },
      body: JSON.stringify({ organizationId: 'org-a', username: 'admin', password: 'enterprise-password' }),
    }))
    const cookie = login.headers.get('set-cookie') ?? ''

    const created = await handler.fetch(new Request('https://dsh.example.com/auth/admin/users', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://dsh.example.com', cookie },
      body: JSON.stringify({
        id: 'operator-1', username: 'operator', displayName: 'Operator', password: 'operator-password',
        roles: ['operator'],
      }),
    }))
    expect(created.status).toBe(201)
    const users = await handler.fetch(new Request('https://dsh.example.com/auth/admin/users', { headers: { cookie } }))
    const userRows: unknown = await users.json()
    expect(userRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'operator-1', roles: ['operator'] }),
    ]))
    expect(JSON.stringify(userRows)).not.toContain('password')

    const updated = await handler.fetch(new Request('https://dsh.example.com/auth/admin/users/operator-1', {
      method: 'PATCH', headers: { 'content-type': 'application/json', origin: 'https://dsh.example.com', cookie },
      body: JSON.stringify({
        username: 'operator.renamed', displayName: 'Renamed Operator', password: 'operator-password-2',
      }),
    }))
    expect(updated.status).toBe(204)
    const oldLogin = await handler.fetch(new Request('https://dsh.example.com/auth/login/local', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://dsh.example.com' },
      body: JSON.stringify({ organizationId: 'org-a', username: 'operator', password: 'operator-password' }),
    }))
    expect(oldLogin.status).toBe(401)
    const newLogin = await handler.fetch(new Request('https://dsh.example.com/auth/login/local', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://dsh.example.com' },
      body: JSON.stringify({ organizationId: 'org-a', username: 'operator.renamed', password: 'operator-password-2' }),
    }))
    expect(newLogin.status).toBe(200)

    const policy = await handler.fetch(new Request('https://dsh.example.com/auth/admin/resource-policies', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://dsh.example.com', cookie },
      body: JSON.stringify({
        resourceType: 'employee', resourceId: 'support', creatorUserId: 'admin-1',
        visibility: 'restricted', allowedUserIds: ['operator-1'],
      }),
    }))
    expect(policy.status).toBe(204)

    const asset = await handler.fetch(new Request('https://dsh.example.com/auth/admin/assets', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://dsh.example.com', cookie },
      body: JSON.stringify({
        type: 'channel', id: 'wecom-main', name: '企微主渠道',
        config: { provider: 'wecom-bot', employeeIds: ['support'] },
      }),
    }))
    expect(asset.status).toBe(201)
    expect(repository.listManagedAssets('org-a')).toEqual([
      expect.objectContaining({ type: 'channel', id: 'wecom-main' }),
    ])

    const audit = await handler.fetch(new Request('https://dsh.example.com/auth/admin/audit?limit=20', {
      headers: { cookie },
    }))
    expect(audit.status).toBe(200)
    expect((await audit.json() as unknown[]).length).toBeGreaterThan(0)
  })

  it('rejects a local user password shorter than the scrypt verifier minimum before persistence', async () => {
    const login = await handler.fetch(new Request('https://dsh.example.com/auth/login/local', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://dsh.example.com' },
      body: JSON.stringify({ organizationId: 'org-a', username: 'admin', password: 'enterprise-password' }),
    }))
    const response = await handler.fetch(new Request('https://dsh.example.com/auth/admin/users', {
      method: 'POST', headers: {
        'content-type': 'application/json', origin: 'https://dsh.example.com',
        cookie: login.headers.get('set-cookie') ?? '',
      },
      body: JSON.stringify({
        id: 'short-password-user', username: 'shortpass', displayName: 'Short Password',
        password: 'short@1234', roles: ['member'],
      }),
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'bad-request' })
    expect(repository.findUser('org-a', 'shortpass')).toBeUndefined()
  })
})
