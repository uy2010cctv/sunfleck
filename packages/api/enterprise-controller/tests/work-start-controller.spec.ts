import { Context } from '@deepseek-ai/cordis'
import { EnterpriseRequestContext } from '@deepseek-ai/dsh-enterprise-auth-web'
import { describe, expect, it, vi } from 'vitest'
import { EnterpriseWorkController } from '../src/index.ts'
import { EnterpriseWorkStartService } from '../src/work-start.ts'
const principal = { orgId: 'org-a', userId: 'user-a', roles: ['member'] as const }
const release = (releaseId: string, presetId = 'preset-a', version = 1) => ({ releaseId, presetId, orgId: 'org-a', version, digest: `digest-${releaseId}`, snapshot: { profile: {}, bindings: [] }, publishedBy: 'user-a', publishedAt: 1 })
function operationDriver(upsertWorkRecord: (input: Record<string, unknown>) => Promise<unknown> = async () => ({})) {
  return {
    upsertWorkRecord,
    reserveWorkStart: async (input: Record<string, unknown>) => ({ ...input, state: 'starting' }),
    getWorkStart: async () => undefined,
    completeWorkStart: async () => ({}),
  }
}
function setup(overrides: Partial<ConstructorParameters<typeof EnterpriseWorkStartService>[0]> = {}) { const calls = { create: 0, records: 0, sessionIds: [] as string[] }; const service = new EnterpriseWorkStartService({ workspaceGrant: async id => ({ workspaceId: id, orgId: 'org-a' }), visibleWorkspace: async (_p, id) => id !== 'denied', sessionOwnedBy: async (_p, id) => id === 'owned-session', sessionWorkspace: async id => id === 'owned-session' ? 'session-workspace' : undefined, personalWorkspaces: async () => ['personal-workspace'], releases: async () => [release('release-a')], createSession: async (input) => { calls.create++; calls.sessionIds.push(input.sessionId); return { sessionId: input.sessionId } }, bindSession: async () => undefined, upsertRecord: async () => { calls.records++ }, reserveWorkStart: async input => ({ ...input, state: 'starting' as const }), getWorkStart: async () => undefined, completeWorkStart: async () => undefined, ...overrides }); return { service, calls } }
describe('enterprise work start', () => {
  it('uses explicit authorized workspace ahead of all hints', async () => { const { service } = setup(); await expect(service.prepare(principal, { objective: 'Close books', workspaceId: 'explicit', currentSessionId: 'owned-session', recentWorkspaceId: 'recent' })).resolves.toMatchObject({ kind: 'ready', workspaceId: 'explicit' }) })
  it('uses the only authorized caller-owned personal workspace when no hint exists', async () => { const { service } = setup({ personalWorkspaces: async () => ['personal-only'] }); await expect(service.prepare(principal, { objective: 'Close books' })).resolves.toMatchObject({ kind: 'ready', workspaceId: 'personal-only' }) })
  it('returns every authorized personal workspace when implicit selection is ambiguous', async () => { const { service, calls } = setup({ personalWorkspaces: async () => ['personal-z', 'personal-a'] }); await expect(service.prepare(principal, { objective: 'Close books' })).resolves.toEqual({ kind: 'needs-workspace-selection', availableWorkspaceIds: ['personal-z', 'personal-a'] }); await expect(service.start(principal, { objective: 'Close books', idempotencyKey: 'ambiguous-workspace' })).rejects.toThrow('workspace selection is required'); expect(calls.create).toBe(0) })
  it('returns a typed workspace selection when no caller-owned personal workspace is authorized', async () => { const { service, calls } = setup({ personalWorkspaces: async () => [] }); await expect(service.prepare(principal, { objective: 'Close books' })).resolves.toEqual({ kind: 'needs-workspace-selection', availableWorkspaceIds: [] }); await expect(service.start(principal, { objective: 'Close books', idempotencyKey: 'missing-workspace' })).rejects.toThrow('workspace selection is required'); expect(calls.create).toBe(0) })
  it('requires explicit employee selection when visible published presets are ambiguous', async () => { const { service } = setup({ releases: async () => [release('release-a'), release('release-b', 'preset-b')] }); await expect(service.prepare(principal, { objective: 'Close books' })).resolves.toMatchObject({ kind: 'needs-selection' }) })
  it('automatically chooses only the latest published release for one preset', async () => { const { service } = setup({ releases: async () => [release('release-v1', 'preset-a', 1), release('release-v2', 'preset-a', 2)] }); await expect(service.prepare(principal, { objective: 'Close books' })).resolves.toMatchObject({ kind: 'ready', employeeReleaseId: 'release-v2' }) })
  it('allows an explicitly preferred historical published release', async () => { const { service } = setup({ releases: async () => [release('release-v1', 'preset-a', 1), release('release-v2', 'preset-a', 2)] }); await expect(service.prepare(principal, { objective: 'Close books', preferredEmployeeReleaseId: 'release-v1' })).resolves.toMatchObject({ kind: 'ready', employeeReleaseId: 'release-v1' }) })
  it('rejects an unauthorized explicit workspace', async () => { const { service } = setup(); await expect(service.prepare(principal, { objective: 'Close books', workspaceId: 'denied' })).rejects.toThrow('workspace is not authorized') })
  it('adopts the same native session and records each idempotent retry', async () => { const { service, calls } = setup(); const input = { objective: 'Close books', idempotencyKey: 'same-key' }; expect(await service.start(principal, input)).toEqual(await service.start(principal, input)); expect(calls.create).toBe(2); expect(calls.records).toBe(2); expect(calls.sessionIds).toEqual([expect.stringMatching(/^session-work-/), calls.sessionIds[0]]) })
  it('uses the release preset when creating the native session', async () => { let created: { agentPresetId: string; sessionId: string } | undefined; const { service } = setup({ createSession: async (input) => { created = input; return { sessionId: input.sessionId } } }); await service.start(principal, { objective: 'Close books', idempotencyKey: 'mapping' }); expect(created).toMatchObject({ agentPresetId: 'preset-a', sessionId: expect.stringMatching(/^session-work-/) }) })
  it('uses one opaque deterministic native session id across independently constructed services', async () => {
    const first = setup(); const second = setup()
    const input = { objective: 'Close books', deadline: '2026-09-08T10:00:00.000Z', workspaceId: 'explicit', idempotencyKey: 'restart-safe' }
    const [left, right] = await Promise.all([first.service.start(principal, input), second.service.start(principal, input)])
    expect(left.sessionId).toBe(right.sessionId)
    expect(left.sessionId).toMatch(/^session-work-[a-f0-9]{64}$/)
    expect(left.sessionId).not.toContain(input.idempotencyKey)
    expect(first.calls.sessionIds).toEqual([left.sessionId])
    expect(second.calls.sessionIds).toEqual([right.sessionId])
  })
  it('rejects a changed input under the same idempotency key without allocating another Session', async () => {
    let fingerprint: string | undefined
    const { service, calls } = setup({ upsertRecord: async (input) => {
      if (fingerprint !== undefined && fingerprint !== input.sourceReferences.requestFingerprint) throw new Error('idempotency key request digest mismatch')
      fingerprint = input.sourceReferences.requestFingerprint
    } })
    await service.start(principal, { objective: 'Close books', idempotencyKey: 'conflicting-key' })
    await expect(service.start(principal, { objective: 'Reconcile receivables', idempotencyKey: 'conflicting-key' })).rejects.toThrow('idempotency key request digest mismatch')
    expect(calls.sessionIds).toEqual([calls.sessionIds[0], calls.sessionIds[0]])
  })
  it('reserves before native side effects, resumes the same partial start, and rejects changed input', async () => {
    type Reservation = {
      requestFingerprint: string
      sessionId: string
      workspaceId: string
      employeeReleaseId: string
      presetId: string
      deadline?: string
      state: 'starting' | 'completed'
    }
    type ReservationInput = Reservation & { orgId: string; userId: string; idempotencyKey: string }
    const reservations = new Map<string, Reservation>()
    let failRecord = true
    const reserveWorkStart = vi.fn(async (input: ReservationInput) => {
      const key = `${input.orgId}:${input.userId}:${input.idempotencyKey}`
      const prior = reservations.get(key)
      if (prior !== undefined) {
        if (prior.requestFingerprint !== input.requestFingerprint) throw new Error('idempotency key request digest mismatch')
        return prior
      }
      const value = { ...input, state: 'starting' as const }
      reservations.set(key, value)
      return value
    })
    const completeWorkStart = vi.fn(async (input: { orgId: string; userId: string; idempotencyKey: string }) => {
      const key = `${input.orgId}:${input.userId}:${input.idempotencyKey}`
      const reservation = reservations.get(key)
      if (reservation === undefined) throw new Error('missing reservation')
      reservation.state = 'completed'
    })
    const { service, calls } = setup({
      reserveWorkStart,
      getWorkStart: async input => reservations.get(`${input.orgId}:${input.principal.userId}:${input.idempotencyKey}`),
      completeWorkStart,
      upsertRecord: async () => { calls.records++; if (failRecord) { failRecord = false; throw new Error('record store unavailable') } },
    } as Partial<ConstructorParameters<typeof EnterpriseWorkStartService>[0]>)
    const first = { objective: 'Close books', idempotencyKey: 'partial-start' }
    await expect(service.start(principal, first)).rejects.toThrow('record store unavailable')
    await expect(service.start(principal, { objective: 'Changed objective', idempotencyKey: 'partial-start' })).rejects.toThrow('idempotency key request digest mismatch')
    expect(calls.create).toBe(1)
    await expect(service.start(principal, first)).resolves.toMatchObject({ sessionId: calls.sessionIds[0] })
    expect(calls.create).toBe(2)
    expect(completeWorkStart).toHaveBeenCalledTimes(1)
  })
  it('recovers a starting reservation with a new service instance after persistence failure', async () => {
    type Reservation = {
      requestFingerprint: string
      sessionId: string
      workspaceId: string
      employeeReleaseId: string
      presetId: string
      deadline?: string
      state: 'starting' | 'completed'
    }
    type ReservationInput = Reservation & { orgId: string; userId: string; idempotencyKey: string }
    const reservations = new Map<string, Reservation>()
    const reserveWorkStart = async (input: ReservationInput) => {
      const key = `${input.orgId}:${input.userId}:${input.idempotencyKey}`
      const prior = reservations.get(key)
      if (prior !== undefined) {
        if (prior.requestFingerprint !== input.requestFingerprint) throw new Error('idempotency key request digest mismatch')
        return prior
      }
      const value = { ...input, state: 'starting' as const }
      reservations.set(key, value)
      return value
    }
    const completeWorkStart = async (input: { orgId: string; userId: string; idempotencyKey: string }) => {
      const value = reservations.get(`${input.orgId}:${input.userId}:${input.idempotencyKey}`)
      if (value === undefined) throw new Error('missing reservation')
      value.state = 'completed'
    }
    const getWorkStart = async (input: { orgId: string; principal: typeof principal; idempotencyKey: string }) =>
      reservations.get(`${input.orgId}:${input.principal.userId}:${input.idempotencyKey}`)
    const first = setup({ reserveWorkStart, getWorkStart, completeWorkStart, upsertRecord: async () => { throw new Error('record store unavailable') } } as Partial<ConstructorParameters<typeof EnterpriseWorkStartService>[0]>)
    const input = { objective: 'Close books', idempotencyKey: 'restart-resume' }
    await expect(first.service.start(principal, input)).rejects.toThrow('record store unavailable')
    const second = setup({
      reserveWorkStart,
      getWorkStart,
      completeWorkStart,
      releases: async () => [],
      personalWorkspaces: async () => [],
      workspaceGrant: async () => undefined,
    } as Partial<ConstructorParameters<typeof EnterpriseWorkStartService>[0]>)
    await expect(second.service.start(principal, input)).resolves.toMatchObject({ sessionId: first.calls.sessionIds[0] })
    expect(second.calls.sessionIds).toEqual([first.calls.sessionIds[0]])
  })
})

describe('enterprise work Remote controller', () => {
  it('requires workspace selection instead of choosing the first caller-owned personal workspace', async () => {
    const requestContext = new EnterpriseRequestContext()
    const create = vi.fn(async (input: { sessionId: string }) => ({ sessionId: input.sessionId }))
    const ctx = new Context()
    ctx.provide('enterprisePostgres' as never, {
      identity: {
        workspaceGrant: async (workspaceId: string) => ({ workspaceId, orgId: 'org-a' }),
        listWorkspaceGrants: async () => [
          { workspaceId: 'personal-z', kind: 'personal', ownerUserId: 'user-a', orgId: 'org-a' },
          { workspaceId: 'personal-a', kind: 'personal', ownerUserId: 'user-a', orgId: 'org-a' },
        ],
        sessionWorkspaceGrant: async () => undefined,
      },
      catalog: { listDrafts: async () => ({ items: [{ presetId: 'preset-a', status: 'published' }] }), listReleases: async () => [release('release-a')] },
      operations: operationDriver(),
    } as never)
    ctx.provide('enterpriseSecurity' as never, {
      authorizeApiAsync: async () => ({ allowed: true, reason: 'role' }), auditApiAsync: async () => undefined,
      sessionOwnedBy: async () => false, bindSessionWorkspaceAsync: async () => undefined,
    } as never)
    ctx.provide('enterpriseRequestContext' as never, requestContext as never)
    ctx.provide('sessionController' as never, { create } as never)
    const controller = new EnterpriseWorkController(ctx)

    await expect(requestContext.run(principal, () => controller.prepare({ objective: 'Close books' }))).resolves.toEqual({
      kind: 'needs-workspace-selection', availableWorkspaceIds: ['personal-z', 'personal-a'],
    })
    expect(create).not.toHaveBeenCalled()
  })
  it('finds a published employee on a later draft page before automatically starting work', async () => {
    const requestContext = new EnterpriseRequestContext()
    const create = vi.fn(async (input: { sessionId: string }) => ({ sessionId: input.sessionId }))
    const listDrafts = vi.fn(async (input: { cursor?: string }) => input.cursor === undefined
      ? { items: Array.from({ length: 100 }, (_, index) => ({ presetId: `draft-${index}`, status: 'draft' as const })), nextCursor: 'page-2' }
      : { items: [{ presetId: 'preset-later', status: 'published' as const }] })
    const ctx = new Context()
    ctx.provide('enterprisePostgres' as never, {
      identity: { workspaceGrant: async (workspaceId: string) => ({ workspaceId, orgId: 'org-a' }), listWorkspaceGrants: async () => [{ workspaceId: 'personal-a', kind: 'personal', ownerUserId: 'user-a', orgId: 'org-a' }], sessionWorkspaceGrant: async () => undefined },
      catalog: { listDrafts, listReleases: async (presetId: string) => [release('release-later', presetId)] },
      operations: operationDriver(),
    } as never)
    ctx.provide('enterpriseSecurity' as never, { authorizeApiAsync: async () => ({ allowed: true, reason: 'role' }), auditApiAsync: async () => undefined, sessionOwnedBy: async () => false, bindSessionWorkspaceAsync: async () => undefined } as never)
    ctx.provide('enterpriseRequestContext' as never, requestContext as never)
    ctx.provide('sessionController' as never, { create } as never)
    const controller = new EnterpriseWorkController(ctx)

    await expect(requestContext.run(principal, () => controller.start({ objective: 'Close books', idempotencyKey: 'later-page' }))).resolves.toMatchObject({ employeeReleaseId: 'release-later' })
    expect(listDrafts).toHaveBeenCalledTimes(4)
    expect(listDrafts).toHaveBeenNthCalledWith(2, expect.objectContaining({ cursor: 'page-2' }))
    expect(listDrafts).toHaveBeenNthCalledWith(4, expect.objectContaining({ cursor: 'page-2' }))
  })
  it('requires administrator employee selection when another owner has a published preset on a later page', async () => {
    const administrator = { orgId: 'org-a', userId: 'admin-a', roles: ['administrator'] as const }
    const requestContext = new EnterpriseRequestContext()
    const create = vi.fn(async (input: { sessionId: string }) => ({ sessionId: input.sessionId }))
    const listDrafts = vi.fn(async (input: { cursor?: string }) => input.cursor === undefined
      ? { items: [{ presetId: 'preset-admin', status: 'published' as const }], nextCursor: 'page-2' }
      : { items: [{ presetId: 'preset-other-owner', status: 'published' as const }] })
    const ctx = new Context()
    ctx.provide('enterprisePostgres' as never, {
      identity: { workspaceGrant: async (workspaceId: string) => ({ workspaceId, orgId: 'org-a' }), listWorkspaceGrants: async () => [{ workspaceId: 'personal-a', kind: 'personal', ownerUserId: 'admin-a', orgId: 'org-a' }], sessionWorkspaceGrant: async () => undefined },
      catalog: { listDrafts, listReleases: async (presetId: string) => [release(`release-${presetId}`, presetId)] },
      operations: operationDriver(),
    } as never)
    ctx.provide('enterpriseSecurity' as never, { authorizeApiAsync: async () => ({ allowed: true, reason: 'role' }), auditApiAsync: async () => undefined, sessionOwnedBy: async () => false, bindSessionWorkspaceAsync: async () => undefined } as never)
    ctx.provide('enterpriseRequestContext' as never, requestContext as never)
    ctx.provide('sessionController' as never, { create } as never)
    const controller = new EnterpriseWorkController(ctx)

    await expect(requestContext.run(administrator, () => controller.prepare({ objective: 'Close books' }))).resolves.toEqual({
      kind: 'needs-selection', workspaceId: 'personal-a', availableEmployeeReleaseIds: ['release-preset-admin', 'release-preset-other-owner'],
    })
    expect(listDrafts).toHaveBeenCalledTimes(2)
    expect(listDrafts).toHaveBeenNthCalledWith(1, expect.objectContaining({ includeAllVisible: true }))
    expect(listDrafts).toHaveBeenNthCalledWith(2, expect.objectContaining({ includeAllVisible: true, cursor: 'page-2' }))
    expect(create).not.toHaveBeenCalled()
  })
  it('passes the deterministic Session id and published release preset through the native and durable seams', async () => {
    const requestContext = new EnterpriseRequestContext()
    const create = vi.fn(async (input: { sessionId: string }) => ({ sessionId: input.sessionId }))
    const bindSessionWorkspaceAsync = vi.fn(async () => undefined)
    const upsertWorkRecord = vi.fn(async (input: Record<string, unknown>) => ({ ...input, revision: 1, createdAt: 1, updatedAt: 1 }))
    const reserveWorkStart = vi.fn(async (input: Record<string, unknown>) => ({ ...input, state: 'starting' }))
    const completeWorkStart = vi.fn(async () => ({}))
    const authorizeApiAsync = vi.fn(async () => ({ allowed: true, reason: 'role' }))
    const auditApiAsync = vi.fn(async () => undefined)
    const ctx = new Context()
    ctx.provide('enterprisePostgres' as never, {
      identity: {
        workspaceGrant: async (workspaceId: string) => ({ workspaceId, orgId: 'org-a' }),
        listWorkspaceGrants: async () => [], sessionWorkspaceGrant: async () => undefined,
      },
      catalog: { listDrafts: async () => ({ items: [{ presetId: 'preset-a', status: 'published' }] }), listReleases: async () => [release('release-a')] },
      operations: { upsertWorkRecord, reserveWorkStart, getWorkStart: async () => undefined, completeWorkStart },
    } as never)
    ctx.provide('enterpriseSecurity' as never, {
      authorizeApiAsync, auditApiAsync,
      sessionOwnedBy: async () => false, bindSessionWorkspaceAsync,
    } as never)
    ctx.provide('enterpriseRequestContext' as never, requestContext as never)
    ctx.provide('sessionController' as never, { create } as never)
    const controller = new EnterpriseWorkController(ctx)
    const result = await requestContext.run(principal, () => controller.start({
      objective: 'Close books', workspaceId: 'workspace-a', preferredEmployeeReleaseId: 'release-a', idempotencyKey: 'remote-start',
    }))
    expect(create).toHaveBeenCalledWith({ sessionId: result.sessionId, workspaceId: 'workspace-a', agentPreset: 'preset-a' })
    expect(reserveWorkStart.mock.invocationCallOrder[0]).toBeLessThan(create.mock.invocationCallOrder[0] as number)
    expect(reserveWorkStart).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-a', idempotencyKey: 'remote-start', sessionId: result.sessionId,
      workspaceId: 'workspace-a', employeeReleaseId: 'release-a', presetId: 'preset-a',
    }))
    expect(bindSessionWorkspaceAsync).toHaveBeenCalledWith(principal, result.sessionId, 'workspace-a')
    expect(upsertWorkRecord).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-a', sessionId: result.sessionId, employeeReleaseId: 'release-a', idempotencyKey: 'remote-start',
      sourceReferences: expect.objectContaining({ employeeReleaseId: 'release-a', releasePresetId: 'preset-a' }),
    }))
    expect(completeWorkStart).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-a', idempotencyKey: 'remote-start' }))
    expect(authorizeApiAsync).toHaveBeenCalledWith(principal, 'enterpriseWork.start', expect.objectContaining({ idempotencyKey: 'remote-start' }))
    expect(auditApiAsync).toHaveBeenCalledWith(principal, 'enterpriseWork.start', expect.objectContaining({ idempotencyKey: 'remote-start' }), { allowed: true, reason: 'role' }, expect.any(String))
    for (const endpoint of ['enterpriseOperation.workStarts.reserve', 'enterpriseOperation.workStarts.complete']) {
      expect(auditApiAsync).toHaveBeenCalledWith(
        principal, endpoint, { idempotencyKey: 'remote-start' }, { allowed: true, reason: 'role' }, expect.any(String),
      )
    }
  })
  it('audits and rejects an unauthorized start before native Session creation', async () => {
    const requestContext = new EnterpriseRequestContext()
    const create = vi.fn()
    const auditApiAsync = vi.fn(async () => undefined)
    const ctx = new Context()
    ctx.provide('enterprisePostgres' as never, {} as never)
    ctx.provide('enterpriseSecurity' as never, {
      authorizeApiAsync: async () => ({ allowed: false, reason: 'insufficient-role' }), auditApiAsync,
    } as never)
    ctx.provide('enterpriseRequestContext' as never, requestContext as never)
    ctx.provide('sessionController' as never, { create } as never)
    const controller = new EnterpriseWorkController(ctx)
    await expect(requestContext.run(principal, () => controller.start({ objective: 'Close books', idempotencyKey: 'denied-start' }))).rejects.toMatchObject({ code: 'enterprise-forbidden' })
    expect(create).not.toHaveBeenCalled()
    expect(auditApiAsync).toHaveBeenCalledWith(principal, 'enterpriseWork.start', expect.objectContaining({ idempotencyKey: 'denied-start' }), { allowed: false, reason: 'insufficient-role' }, expect.any(String))
  })
})
