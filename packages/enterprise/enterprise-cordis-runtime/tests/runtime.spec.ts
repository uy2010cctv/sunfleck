import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import DynamicCordisRunner from '@deepseek-ai/dsh-cordis-host-runner'
import * as ToolCordis from '@deepseek-ai/dsh-tool-cordis'
import {
  InMemoryEnterpriseCordisRepository,
  type EnterpriseCordisPrincipal,
} from '@deepseek-ai/dsh-enterprise-cordis'
import { EnterpriseRequestContext } from '@deepseek-ai/dsh-enterprise-auth-web'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createScope } from '@deepseek-ai/dsh-scope'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as runtime from '../src/index.ts'

function agent(id = 'session-1', cwd = '/managed/personal', ctx?: Context): Agent {
  const sessionId = SessionId(id)
  const session = Session.create(sessionId, [], { version: 4, id: sessionId, createdAt: 1, cwd, isSeeded: false })
  return { id: sessionId, session, ctx: ctx === undefined ? undefined : createScope(ctx, {}).ctx,
    steer() {}, inject() {} } as unknown as Agent
}

async function setup() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(DynamicCordisRunner)
  await ctx.plugin(ToolCordis)
  const cordis = new InMemoryEnterpriseCordisRepository()
  const identity = {
    workspaceGrant: async (id: string) => id === 'personal-1'
      ? { workspaceId: id, orgId: 'org-a', kind: 'personal', ownerUserId: 'member-1', rootPath: '/managed/personal' }
      : id === 'department-1'
        ? { workspaceId: id, orgId: 'org-a', kind: 'department', departmentId: 'dept-a', rootPath: '/managed/department' }
        : undefined,
    workspaceGrantByRootPath: async (root: string) => root === '/managed/personal'
      ? { workspaceId: 'personal-1', orgId: 'org-a', kind: 'personal', ownerUserId: 'member-1', rootPath: root }
      : root === '/managed/department'
        ? { workspaceId: 'department-1', orgId: 'org-a', kind: 'department', departmentId: 'dept-a', rootPath: root }
        : undefined,
    sessionWorkspaceGrant: async () => undefined,
    sessionOwnerUserId: async (sessionId: string) => sessionId === 'session-new' ? 'member-1' : undefined,
    listUsers: async () => [{ id: 'member-1', orgId: 'org-a', roles: ['member'], departmentIds: ['dept-a'], disabled: false }],
  }
  const requestContext = new EnterpriseRequestContext()
  ctx.provide('enterprisePostgres' as never, { cordis, identity } as never)
  ctx.provide('enterpriseRequestContext' as never, requestContext as never)
  await ctx.plugin(runtime)
  return { ctx, cordis, requestContext }
}

function call(ctx: Context, name: string, args: unknown, owner: Agent) {
  return ctx.tools.execute({
    signal: new AbortController().signal, callId: ToolCallId(`${name}-call`),
    name, arguments: args, agent: owner,
  })
}

const principal: EnterpriseCordisPrincipal = { orgId: 'org-a', userId: 'member-1', roles: ['member'] }

describe('enterprise Cordis runtime tools', () => {
  it('refuses to persist an unbound Session without an authenticated caller', async () => {
    const app = await setup()
    const result = await call(app.ctx, 'cordis_define', {
      plugin: { kind: 'new', idPrefix: 'test' }, name: 'Unbound', purpose: 'Unowned session.',
      code: { host: 'return { apply() {} }' },
    }, agent('orphan-session'))
    expect(result.isError).toBe(true)
    expect(await app.cordis.listPackages('org-a')).toEqual([])
  })

  it('submits a newly defined department plugin for review without activating it', async () => {
    const app = await setup()
    const owner = agent('session-new', '/managed/department')
    const result = await call(app.ctx, 'cordis_define', {
      plugin: { kind: 'new', idPrefix: 'test' }, name: 'Department helper', purpose: 'Help the department.',
      code: { host: 'return { apply() {} }' },
    }, owner)
    expect(result.isError).toBe(false)
    const packages = await app.cordis.listPackages('org-a')
    expect(packages).toHaveLength(1)
    expect(packages[0]?.pluginId).toContain('session-new:')
    expect(packages[0]?.name).toBe('Department helper')
    expect(packages[0]?.scope).toEqual({ type: 'department', departmentId: 'dept-a' })
    expect(await app.cordis.listBindings('org-a')).toEqual([])
    expect(await app.cordis.listReviews('org-a')).toEqual([
      expect.objectContaining({ submittedBy: 'member-1', status: 'pending' }),
    ])
  })

  it('keeps Session-local dynamic Package activation available in the enterprise profile', async () => {
    const app = await setup()
    const owner = agent('session-runner', '/managed/personal', app.ctx)
    const defined = app.ctx.dynamicCordisRunner.define({
      sessionId: owner.id, plugin: { kind: 'new', idPrefix: 'run' },
      name: 'Run helper', purpose: 'Exercise the retained Session tool.',
      code: { host: 'return { apply() {} }' },
    })
    const result = await app.requestContext.run(principal, () => call(app.ctx, 'cordis_run', {
      pluginId: String(defined.pluginId), packageId: String(defined.packageId), mode: 'run',
    }, owner))
    expect(result.isError).toBe(false)
    expect(app.ctx.dynamicCordisRunner.snapshot(owner)[0]?.activeRun?.packageId).toBe(defined.packageId)
  })

  it('inspects, stops, and removes a Session-local Plugin through enterprise tools', async () => {
    const app = await setup()
    const owner = agent('session-lifecycle', '/managed/personal', app.ctx)
    const defined = app.ctx.dynamicCordisRunner.define({
      sessionId: owner.id, plugin: { kind: 'new', idPrefix: 'life' },
      name: 'Lifecycle helper', purpose: 'Exercise Session control.',
      code: { host: 'return { apply() {} }' },
    })
    const inspected = await call(app.ctx, 'cordis_inspect_self', {
      pluginId: String(defined.pluginId), packageId: String(defined.packageId),
    }, owner)
    expect(inspected.isError).toBe(false)
    await app.ctx.dynamicCordisRunner.run(owner, defined.pluginId, defined.packageId, 'run')
    expect((await call(app.ctx, 'cordis_stop', { pluginId: String(defined.pluginId) }, owner)).isError).toBe(false)
    expect((await call(app.ctx, 'cordis_undefine', { pluginId: String(defined.pluginId) }, owner)).isError).toBe(false)
    expect(app.ctx.dynamicCordisRunner.listPlugins(owner)).toEqual([])
  })

  it('persists and activates an inspected dynamic Package in the personal Workspace', async () => {
    const app = await setup()
    const owner = agent('session-1', '/managed/personal', app.ctx)
    const defined = app.ctx.dynamicCordisRunner.define({
      sessionId: owner.id, plugin: { kind: 'new', idPrefix: 'ord' },
      name: 'Order helper', purpose: 'Validate order fields.',
      code: { host: 'return { apply(ctx) { void ctx } }' },
    })
    await app.ctx.dynamicCordisRunner.run(owner, defined.pluginId, defined.packageId, 'run')
    const result = await app.requestContext.run(principal, () => call(app.ctx, 'cordis_save_personal', {
      pluginId: defined.pluginId, packageId: defined.packageId,
    }, owner))

    expect(result.isError).toBe(false)
    expect(await app.cordis.listPackages('org-a')).toEqual([
      expect.objectContaining({ pluginId: `session-1:${String(defined.pluginId)}`, dynamicPackageId: String(defined.packageId) }),
    ])
    expect(await app.cordis.listBindings('org-a')).toEqual([
      expect.objectContaining({ scope: { type: 'personal-workspace', workspaceId: 'personal-1', ownerUserId: 'member-1' } }),
    ])
  })

  it('submits an inspected department Workspace Package for manager review', async () => {
    const app = await setup()
    const owner = agent('session-dept', '/managed/department')
    const defined = app.ctx.dynamicCordisRunner.define({
      sessionId: owner.id, plugin: { kind: 'new', idPrefix: 'dep' },
      name: 'Department helper', purpose: 'Render department status.',
      code: { client: 'return () => {}' },
    })
    const result = await app.requestContext.run(principal, () => call(app.ctx, 'cordis_submit_department', {
      pluginId: defined.pluginId, packageId: defined.packageId,
    }, owner))

    expect(result.isError).toBe(false)
    expect(await app.cordis.listReviews('org-a')).toEqual([
      expect.objectContaining({ pluginId: `session-dept:${String(defined.pluginId)}`, submittedBy: 'member-1', status: 'pending' }),
    ])
  })

  it('pins and restores an active Workspace Generation for a new Session', async () => {
    const app = await setup()
    const author = agent('session-author', '/managed/personal', app.ctx)
    const defined = app.ctx.dynamicCordisRunner.define({
      sessionId: author.id, plugin: { kind: 'new', idPrefix: 'sav' },
      name: 'Saved helper', purpose: 'Remain available after restart.',
      code: { host: 'return { apply(ctx) { void ctx } }' },
    })
    await app.ctx.dynamicCordisRunner.run(author, defined.pluginId, defined.packageId, 'run')
    await app.requestContext.run(principal, () => call(app.ctx, 'cordis_save_personal', {
      pluginId: defined.pluginId, packageId: defined.packageId,
    }, author))

    const restored = agent('session-restored', '/managed/personal', app.ctx)
    await app.requestContext.run(principal, () => app.ctx.systemPrompt.assemble({ agent: restored }))
    const first = app.ctx.dynamicCordisRunner.inventory().filter(row => row.agentId === restored.id)
    await app.requestContext.run(principal, () => app.ctx.systemPrompt.assemble({ agent: restored }))
    const repeated = app.ctx.dynamicCordisRunner.inventory().filter(row => row.agentId === restored.id)

    expect(first).toHaveLength(1)
    expect(first[0]?.activeRun?.packageId).toBeDefined()
    expect(first[0]?.packages[0]?.name).toBe('Saved helper')
    expect(repeated).toHaveLength(1)
    const generation = await app.cordis.sessionGeneration(String(restored.id))
    expect(generation?.entries).toHaveLength(1)
    expect(generation?.entries[0]?.packageId).toContain('cordis-package-')
    app.ctx.emit('agent/disposed', { agent: restored })
    expect(app.ctx.dynamicCordisRunner.inventory().filter(row => row.agentId === restored.id)).toEqual([])
    const resumed = agent('session-restored', '/managed/personal', app.ctx)
    await app.requestContext.run(principal, () => app.ctx.systemPrompt.assemble({ agent: resumed }))
    expect(app.ctx.dynamicCordisRunner.inventory().filter(row => row.agentId === resumed.id)).toHaveLength(1)
  })

  it('rolls back every restored definition when a later saved Plugin fails', async () => {
    const app = await setup()
    const source = `return { name: 'duplicate-tool', inject: ['tools'], apply(ctx) {
      harness.registerTool(ctx, harness.defineTool({
        name: 'shared_saved_tool', description: 'Read saved state.', parameters: {},
        output: { schema: { type: 'json' }, render: () => [] },
        async execute() { return { ok: true } },
      }))
    } }`
    for (const pluginId of ['first-saved', 'second-saved']) {
      const pkg = await app.ctx.enterpriseCordis.savePersonal({
        principal, workspaceId: 'personal-1', idempotencyKey: `save-${pluginId}`,
        draft: {
          pluginId, dynamicPackageId: pluginId, name: pluginId, purpose: 'Exercise rollback.',
          hostCode: source, artifactRef: `draft://${pluginId}`, validationReportRef: `validation://${pluginId}`,
          manifest: { apiVersion: 'dsh-plugin/v1', runtime: 'isolated-realm',
            provides: [`dynamic-cordis:${pluginId}`], capabilities: [],
            license: 'LicenseRef-Proprietary', dependencies: [] },
        },
      })
      await app.ctx.enterpriseCordis.activatePersonal({
        principal, workspaceId: 'personal-1', pluginId, packageId: pkg.packageId,
        expectedRevision: 0, idempotencyKey: `activate-${pluginId}`,
      })
    }
    const restored = agent('session-new', '/managed/personal', app.ctx)

    await expect(app.requestContext.run(principal, () => app.ctx.systemPrompt.assemble({ agent: restored })))
      .rejects.toThrow('shared_saved_tool')
    expect(app.ctx.dynamicCordisRunner.inventory().filter(row => row.agentId === restored.id)).toEqual([])
  })

  it('restores one version from a historical generation with overlapping scope entries', async () => {
    const app = await setup()
    const pkg = await app.ctx.enterpriseCordis.savePersonal({
      principal, workspaceId: 'personal-1', idempotencyKey: 'historical-save',
      draft: {
        pluginId: 'historical-plugin', dynamicPackageId: 'historical-source',
        name: 'Historical helper', purpose: 'Resume after restart.',
        hostCode: 'return { name: "historical-helper", apply(ctx) { void ctx } }',
        artifactRef: 'draft://historical', validationReportRef: 'validation://historical',
        manifest: { apiVersion: 'dsh-plugin/v1', runtime: 'isolated-realm',
          provides: ['dynamic-cordis:historical-plugin'], capabilities: [],
          license: 'LicenseRef-Proprietary', dependencies: [] },
      },
    })
    const binding = await app.ctx.enterpriseCordis.activatePersonal({
      principal, workspaceId: 'personal-1', pluginId: pkg.pluginId,
      packageId: pkg.packageId, expectedRevision: 0, idempotencyKey: 'historical-activate',
    })
    await app.cordis.putSessionGeneration({
      sessionId: 'session-new', orgId: 'org-a', workspaceId: 'personal-1', createdAt: 1,
      entries: [
        { pluginId: pkg.pluginId, packageId: pkg.packageId,
          bindingId: 'legacy-shared', generation: 1,
          scope: { type: 'organization', organizationId: 'org-a' }, trustLevel: 'isolated' },
        { pluginId: pkg.pluginId, packageId: pkg.packageId,
          bindingId: binding.bindingId, generation: binding.generation,
          scope: binding.scope, trustLevel: binding.trustLevel },
      ],
    })
    const restored = agent('session-new', '/managed/personal', app.ctx)
    await app.requestContext.run(principal, () => app.ctx.systemPrompt.assemble({ agent: restored }))
    expect(app.ctx.dynamicCordisRunner.inventory().filter(row => row.agentId === restored.id))
      .toHaveLength(1)
    expect((await app.cordis.sessionGeneration('session-new'))?.entries).toHaveLength(2)
  })
})
