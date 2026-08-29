import { Context, Service, symbols } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import TypertGatewayService from '@deepseek-ai/dsh-api-gateway'
import { bindTypertRemote, Remote, type InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'

class WorkspaceFixture extends Service {
  readonly typertRemote = bindTypertRemote(this, 'workspaceFixture', { namespace: 'workspace' })
  readonly deleted: string[] = []

  constructor(ctx: Context) { super(ctx, 'workspaceFixture') }

  @Remote create(request: { path: string }) {
    return {
      created: true,
      workspace: { workspaceId: 'created-1', path: request.path, title: 'Created', sessionIds: [] },
    }
  }

  @Remote delete(request: { workspaceId: string }) {
    this.deleted.push(request.workspaceId)
    return { deleted: true }
  }

  @Remote({ mode: 'stream' }) async *follow(): AsyncIterable<unknown> {
    yield { type: 'baseline', value: { items: [{ workspaceId: 'raw' }], archivedSessionIds: [] } }
  }
}

const roots: Context[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await root.fiber.dispose()
})

describe('enterprise Workspace gateway enforcement', () => {
  it('denies protected deletes before the native Workspace command runs', async () => {
    const harness = await setup({ allowed: false })
    const result = await harness.gateway.dispatchRpc(
      'workspace/delete', { args: { request: { workspaceId: 'protected' } } }, new AbortController().signal,
    )
    expect(result).toMatchObject({ ok: false, error: { code: 'enterprise-forbidden' } })
    expect(harness.service.deleted).toEqual([])
    expect(harness.security.auditApiAsync).toHaveBeenCalledOnce()
  })

  it('records a native personal Workspace and filters the follow stream', async () => {
    const harness = await setup({ allowed: true })
    const created = await harness.gateway.dispatchRpc(
      'workspace/create', { args: { request: { path: '/managed/member/new' } } }, new AbortController().signal,
    )
    if (!record(created) || created['ok'] !== true) throw new Error(JSON.stringify(created))
    expect(created).toMatchObject({ ok: true, value: { workspace: { workspaceId: 'created-1' } } })
    expect(harness.security.recordWorkspaceCreated).toHaveBeenCalledWith(
      harness.principal, expect.objectContaining({ created: true }),
    )

    const stream = await harness.gateway.openWireStream(
      'workspace/follow', { args: {} }, new AbortController().signal,
    )
    const frames: unknown[] = []
    for await (const frame of stream) frames.push(frame)
    expect(frames).toEqual([{ type: 'projected' }])
    expect(harness.security.filterWorkspaceFollow).toHaveBeenCalledOnce()
  })
})

async function setup(decision: { allowed: boolean }) {
  const ctx = new Context()
  roots.push(ctx)
  const principal = { userId: 'member-1', orgId: 'org-a', roles: ['member'] as const }
  const security = {
    authorizeApiAsync: vi.fn(async () => ({
      allowed: decision.allowed,
      reason: decision.allowed ? 'role' as const : 'resource-hidden' as const,
    })),
    auditApiAsync: vi.fn(async () => {}),
    recordWorkspaceCreated: vi.fn(async () => {}),
    filterWorkspaceFollow: vi.fn(async function* () { yield { type: 'projected' } }),
  }
  ctx.provide('enterpriseSecurity' as never, security as never)
  ctx.provide('enterpriseRequestContext' as never, {
    current: () => principal,
    requirePrincipal: () => principal,
  } as never)
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(TypertGatewayService)
  await ctx.plugin(WorkspaceFixture)
  ctx.typert.register({
    package: '@fixture/enterprise-workspace', face: 'host', schemas: [],
    model: { events: [], objects: [], services: [] },
    invocations: descriptors(),
  })
  const receiver = ctx.get('workspaceFixture') as WorkspaceFixture & { [symbols.original]?: WorkspaceFixture }
  const gateway = ctx.typertGateway as unknown as {
    dispatchRpc(endpoint: string, payload: unknown, signal: AbortSignal): Promise<unknown>
    openWireStream(endpoint: string, payload: unknown, signal: AbortSignal): Promise<AsyncIterable<unknown>>
  }
  return { ctx, principal, security, service: receiver[symbols.original] ?? receiver, gateway }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function descriptors(): InvocationDescriptor[] {
  const request = (schema: z.ZodType) => [{
    name: 'request', wire: 'request', source: 'json' as const,
    codec: { mode: 'strict' as const, typeSymbol: '@fixture/enterprise-workspace#Request', schema },
  }]
  const result = { mode: 'strict' as const, typeSymbol: '@fixture/enterprise-workspace#Result', schema: z.unknown() }
  return [
    {
      id: '@fixture/enterprise-workspace#workspace/create', service: 'workspaceFixture', namespace: 'workspace',
      method: 'create', invocation: { kind: 'direct' },
      parameters: request(z.object({ path: z.string() })), result,
    },
    {
      id: '@fixture/enterprise-workspace#workspace/delete', service: 'workspaceFixture', namespace: 'workspace',
      method: 'delete', invocation: { kind: 'direct' },
      parameters: request(z.object({ workspaceId: z.string() })), result,
    },
    {
      id: '@fixture/enterprise-workspace#workspace/follow', service: 'workspaceFixture', namespace: 'workspace',
      method: 'follow', mode: 'stream', invocation: { kind: 'direct' }, parameters: [], result,
    },
  ]
}
