import { Context } from '@deepseek-ai/cordis'
import { EnterpriseRequestContext } from '@deepseek-ai/dsh-enterprise-auth-web'
import { describe, expect, it, vi } from 'vitest'
import { EnterpriseWorkController } from '../src/index.ts'
import { EnterpriseWorkStartService } from '../src/work-start.ts'
const principal = { orgId: 'org-a', userId: 'user-a', roles: ['member'] as const }
const release = (releaseId: string, presetId = 'preset-a', version = 1) => ({ releaseId, presetId, orgId: 'org-a', version, digest: `digest-${releaseId}`, snapshot: { profile: {}, bindings: [] }, publishedBy: 'user-a', publishedAt: 1 })
function setup(overrides: Partial<ConstructorParameters<typeof EnterpriseWorkStartService>[0]> = {}) { const calls = { create: 0, records: 0, sessionIds: [] as string[] }; const service = new EnterpriseWorkStartService({ workspaceGrant: async id => ({ workspaceId: id, orgId: 'org-a' }), visibleWorkspace: async (_p, id) => id !== 'denied', sessionOwnedBy: async (_p, id) => id === 'owned-session', sessionWorkspace: async id => id === 'owned-session' ? 'session-workspace' : undefined, personalWorkspace: async () => 'personal-workspace', releases: async () => [release('release-a')], createSession: async (input) => { calls.create++; calls.sessionIds.push(input.sessionId); return { sessionId: input.sessionId } }, bindSession: async () => undefined, upsertRecord: async () => { calls.records++ }, ...overrides }); return { service, calls } }
describe('enterprise work start', () => {
  it('uses explicit authorized workspace ahead of all hints', async () => { const { service } = setup(); await expect(service.prepare(principal, { objective: 'Close books', workspaceId: 'explicit', currentSessionId: 'owned-session', recentWorkspaceId: 'recent' })).resolves.toMatchObject({ kind: 'ready', workspaceId: 'explicit' }) })
  it('never falls back to first workspace when no authorized hint exists', async () => { const { service } = setup({ personalWorkspace: async () => 'personal-only' }); await expect(service.prepare(principal, { objective: 'Close books' })).resolves.toMatchObject({ kind: 'ready', workspaceId: 'personal-only' }) })
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
})

describe('enterprise work Remote controller', () => {
  it('passes the deterministic Session id and published release preset through the native and durable seams', async () => {
    const requestContext = new EnterpriseRequestContext()
    const create = vi.fn(async (input: { sessionId: string }) => ({ sessionId: input.sessionId }))
    const bindSessionWorkspaceAsync = vi.fn(async () => undefined)
    const upsertWorkRecord = vi.fn(async (input: Record<string, unknown>) => ({ ...input, revision: 1, createdAt: 1, updatedAt: 1 }))
    const authorizeApiAsync = vi.fn(async () => ({ allowed: true, reason: 'role' }))
    const auditApiAsync = vi.fn(async () => undefined)
    const ctx = new Context()
    ctx.provide('enterprisePostgres' as never, {
      identity: {
        workspaceGrant: async (workspaceId: string) => ({ workspaceId, orgId: 'org-a' }),
        listWorkspaceGrants: async () => [], sessionWorkspaceGrant: async () => undefined,
      },
      catalog: { listDrafts: async () => ({ items: [{ presetId: 'preset-a', status: 'published' }] }), listReleases: async () => [release('release-a')] },
      operations: { upsertWorkRecord },
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
    expect(bindSessionWorkspaceAsync).toHaveBeenCalledWith(principal, result.sessionId, 'workspace-a')
    expect(upsertWorkRecord).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-a', sessionId: result.sessionId, employeeReleaseId: 'release-a', idempotencyKey: 'remote-start',
      sourceReferences: expect.objectContaining({ employeeReleaseId: 'release-a', releasePresetId: 'preset-a' }),
    }))
    expect(authorizeApiAsync).toHaveBeenCalledWith(principal, 'enterpriseWork.start', expect.objectContaining({ idempotencyKey: 'remote-start' }))
    expect(auditApiAsync).toHaveBeenCalledWith(principal, 'enterpriseWork.start', expect.objectContaining({ idempotencyKey: 'remote-start' }), { allowed: true, reason: 'role' }, expect.any(String))
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
