import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import DynamicCordisRunner from '@deepseek-ai/dsh-cordis-host-runner'
import {
  InMemoryEnterpriseCordisRepository,
  type EnterpriseCordisPrincipal,
} from '@deepseek-ai/dsh-enterprise-cordis'
import { EnterpriseRequestContext } from '@deepseek-ai/dsh-enterprise-auth-web'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as runtime from '../src/index.ts'

function agent(id = 'session-1', cwd = '/managed/personal'): Agent {
  const sessionId = SessionId(id)
  const session = Session.create(sessionId, [], { version: 0, id: sessionId, createdAt: 1, cwd })
  return { id: sessionId, session, steer() {}, inject() {} } as unknown as Agent
}

async function setup() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(DynamicCordisRunner)
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
  it('persists and activates an inspected dynamic Package in the personal Workspace', async () => {
    const app = await setup()
    const owner = agent()
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
      expect.objectContaining({ pluginId: String(defined.pluginId), dynamicPackageId: String(defined.packageId) }),
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
      expect.objectContaining({ pluginId: String(defined.pluginId), submittedBy: 'member-1', status: 'pending' }),
    ])
  })
})
