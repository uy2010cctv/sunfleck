/** Enterprise Cordis domain composition and Agent-facing persistence tools. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  CordisDynamicPackageId,
  CordisDynamicPluginId,
} from '@deepseek-ai/dsh-cordis-host-runner'
import type { EnterpriseCordisPrincipal } from '@deepseek-ai/dsh-enterprise-cordis'
import {
  EnterpriseCordisService,
  FilesystemEnterpriseCordisArtifactStore,
  InMemoryEnterpriseCordisArtifactStore,
} from '@deepseek-ai/dsh-enterprise-cordis'
import type {} from '@deepseek-ai/dsh-enterprise-auth-web'
import type {} from '@deepseek-ai/dsh-enterprise-postgres'
import type { EnterpriseIdentityStore, EnterpriseWorkspaceGrant } from '@deepseek-ai/dsh-enterprise-identity'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'enterprise-cordis-runtime'
export const inject = [
  'tools', 'systemPrompt', 'dynamicCordisRunner', 'enterprisePostgres', 'enterpriseRequestContext',
]

const POLICY = [
  'Preserve the native DSH Cordis workflow: inspect, define, run, and repair a dynamic Plugin first.',
  'After a useful Plugin is running, use cordis_save_personal when the user wants it available in their personal Workspace after restart.',
  'Use cordis_submit_department when a department Workspace extension should enter manager review.',
  'Do not persist experiments, failed Packages, or capabilities the user did not ask to keep.',
].join(' ')

/** Data used by `Config`. */
export interface Config {
  /** Host-owned directory for durable approved Cordis Package artifacts. */
  readonly artifactRoot?: string
}

function identity(ctx: Context): EnterpriseIdentityStore {
  const composition = ctx.get('enterprisePostgres') as { identity?: EnterpriseIdentityStore } | undefined
  if (composition?.identity === undefined) throw new Error('enterprise identity repository is unavailable')
  return composition.identity
}

async function grantForAgent(ctx: Context, agent: Agent): Promise<EnterpriseWorkspaceGrant> {
  const cwd = agent.session.header.cwd
  if (cwd === undefined) throw new Error('enterprise Cordis persistence requires an Agent Workspace')
  const grant = await identity(ctx).workspaceGrantByRootPath(cwd)
  if (grant === undefined) throw new Error('current Workspace is not enterprise-managed')
  return grant
}

async function principalFor(
  ctx: Context,
  grant: EnterpriseWorkspaceGrant,
  agent?: Agent,
): Promise<EnterpriseCordisPrincipal> {
  const current = ctx.enterpriseRequestContext.current()
  const ownerUserId = agent === undefined ? undefined : await identity(ctx).sessionOwnerUserId(String(agent.id))
  if (current !== undefined) {
    if (current.orgId !== grant.orgId) throw new Error('authenticated principal is outside the Workspace organization')
    if (ownerUserId !== undefined && current.userId !== ownerUserId) {
      throw new Error('authenticated principal does not own this Cordis Session')
    }
    return current
  }
  if (ownerUserId !== undefined) {
    const user = (await identity(ctx).listUsers(grant.orgId)).find(row => row.id === ownerUserId)
    if (user !== undefined && !user.disabled) return { orgId: user.orgId, userId: user.id, roles: user.roles }
  }
  throw new Error('authenticated enterprise principal is required for this Cordis persistence action')
}

function jsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

function inspectedDraft(ctx: Context, agent: Agent, pluginId: string, packageId: string) {
  const inspected = ctx.dynamicCordisRunner.inspectPackage(
    agent, CordisDynamicPluginId(pluginId), CordisDynamicPackageId(packageId),
  )
  return {
    pluginId: `${String(agent.id)}:${pluginId}`,
    dynamicPackageId: packageId,
    name: inspected.name,
    purpose: inspected.purpose,
    ...(inspected.code.host === undefined ? {} : { hostCode: inspected.code.host }),
    ...(inspected.code.client === undefined ? {} : { clientCode: inspected.code.client }),
    manifest: {
      apiVersion: 'dsh-plugin/v1' as const,
      runtime: 'isolated-realm' as const,
      provides: [`dynamic-cordis:${pluginId}`],
      capabilities: [],
      license: 'LicenseRef-Proprietary',
      dependencies: [],
    },
    artifactRef: `cordis-artifact://${agent.id}/${pluginId}/${packageId}`,
    validationReportRef: `cordis-validation://${agent.id}/${pluginId}/${packageId}`,
  }
}

async function restoreWorkspaceGeneration(
  ctx: Context,
  service: EnterpriseCordisService,
  agent: Agent,
): Promise<void> {
  const grant = await grantForAgent(ctx, agent)
  const principal = await principalFor(ctx, grant, agent)
  const generation = await service.pinSessionGeneration({
    principal, workspaceId: grant.workspaceId, sessionId: String(agent.id),
  })
  for (const entry of generation.entries) {
    const pkg = await service.packageSource(entry.packageId)
    if (pkg === undefined) throw new Error(`enterprise Cordis Package ${entry.packageId} is missing`)
    const defined = ctx.dynamicCordisRunner.restoreApproved({
      sessionId: agent.id, idPrefix: 'ent', name: pkg.name, purpose: pkg.purpose,
      execution: entry.scope.type === 'organization' && entry.trustLevel === 'trusted-in-process'
        ? 'trusted-in-process' : 'isolated-realm',
      code: {
        ...(pkg.hostCode === undefined ? {} : { host: pkg.hostCode }),
        ...(pkg.clientCode === undefined ? {} : { client: pkg.clientCode }),
      },
    })
    const started = await ctx.dynamicCordisRunner.run(agent, defined.pluginId, defined.packageId, 'run')
    if (!started.ok) throw new Error(`restoring ${entry.pluginId} failed: ${started.message}`)
  }
}

/** Provide the shared service and register persistence/review tools.
 * @param config - Input value used by this API.
 * @param ctx - Input value used by this API.
*/
export function apply(ctx: Context, config: Config = {}): void {
  const composition = ctx.enterprisePostgres
  const artifactStore = config.artifactRoot === undefined
    ? new InMemoryEnterpriseCordisArtifactStore()
    : new FilesystemEnterpriseCordisArtifactStore(config.artifactRoot)
  const service = new EnterpriseCordisService(composition.cordis, {
    directory: {
      workspace: async (workspaceId) => {
        const grant = await composition.identity.workspaceGrant(workspaceId)
        return grant === undefined ? undefined : {
          workspaceId: grant.workspaceId, orgId: grant.orgId, kind: grant.kind,
          ...(grant.ownerUserId === undefined ? {} : { ownerUserId: grant.ownerUserId }),
          ...(grant.departmentId === undefined ? {} : { departmentId: grant.departmentId }),
        }
      },
      userDepartments: async (orgId, userId) =>
        (await composition.identity.listUsers(orgId)).find(user => user.id === userId)?.departmentIds ?? [],
      isDepartmentManager: async (orgId, departmentId, userId) =>
        (await composition.cordis.departmentManagers(orgId, departmentId))?.managerUserIds.includes(userId) ?? false,
    },
    emit: (eventName, event) => { ctx.emit(eventName, event) },
    artifactStore,
  })
  ctx.provide('enterpriseCordis', service)
  ctx.systemPrompt.section({ name: 'enterprise:cordis-persistence', order: 2550, text: POLICY })
  ctx.on('tools/post-execute', async (exec, result, next) => {
    if (exec.name !== 'cordis_define' || result.isError || exec.agent === undefined) return next()
    const value = result.value
    if (typeof value !== 'object' || value === null || Array.isArray(value)
      || typeof value['pluginId'] !== 'string' || typeof value['packageId'] !== 'string') return next()
    const cwd = exec.agent.session.header.cwd
    if (cwd === undefined || await identity(ctx).workspaceGrantByRootPath(cwd) === undefined) return next()
    const grant = await grantForAgent(ctx, exec.agent)
    const principal = await principalFor(ctx, grant, exec.agent)
    await service.savePersonal({
      principal, workspaceId: grant.workspaceId,
      draft: inspectedDraft(ctx, exec.agent, value['pluginId'], value['packageId']),
      idempotencyKey: `${String(exec.agent.id)}:${String(exec.rootCallId)}:auto-save`,
    })
    return next()
  })
  const restores = new Map<string, Promise<void>>()
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const agent = context.agent
    if (agent !== undefined) {
      const sessionId = String(agent.id)
      let pending = restores.get(sessionId)
      if (pending === undefined) {
        pending = restoreWorkspaceGeneration(ctx, service, agent).catch((error: unknown) => {
          restores.delete(sessionId)
          throw error
        })
        restores.set(sessionId, pending)
      }
      await pending
    }
    return next()
  })

  ctx.tools.register(defineTool({
    name: 'cordis_save_personal',
    description: 'Persist one already-defined dynamic Cordis Package in the current personal Workspace and activate its immutable enterprise binding.',
    parameters: {
      pluginId: { type: 'string', required: true },
      packageId: { type: 'string', required: true },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (args, exec) => {
      if (exec.agent === undefined) throw new Error('cordis_save_personal requires an owning Agent')
      const grant = await grantForAgent(ctx, exec.agent)
      const principal = await principalFor(ctx, grant, exec.agent)
      const draft = inspectedDraft(ctx, exec.agent, args.pluginId, args.packageId)
      const view = await service.listWorkspace({ principal, workspaceId: grant.workspaceId })
      const packageVersion = view.packages.find(pkg => pkg.pluginId === draft.pluginId
        && pkg.dynamicPackageId === draft.dynamicPackageId) ?? await service.savePersonal({
        principal, workspaceId: grant.workspaceId, draft,
        idempotencyKey: `${String(exec.rootCallId)}:save`,
      })
      const current = view.bindings.find(binding => binding.pluginId === packageVersion.pluginId)
      const binding = await service.activatePersonal({
        principal, workspaceId: grant.workspaceId, pluginId: packageVersion.pluginId,
        packageId: packageVersion.packageId, expectedRevision: current?.revision ?? 0,
        idempotencyKey: `${String(exec.rootCallId)}:activate`,
      })
      return jsonValue({ package: packageVersion, binding })
    },
    presentCall: args => ({
      card: 'generic', kind: 'execute', title: `Save Cordis Plugin ${args.pluginId}`,
      rawInput: args,
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'cordis_submit_department',
    description: 'Submit one already-defined dynamic Cordis Package from the current department Workspace for manager review.',
    parameters: {
      pluginId: { type: 'string', required: true },
      packageId: { type: 'string', required: true },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (args, exec) => {
      if (exec.agent === undefined) throw new Error('cordis_submit_department requires an owning Agent')
      const grant = await grantForAgent(ctx, exec.agent)
      if (grant.kind !== 'department') throw new Error('cordis_submit_department requires a department Workspace')
      const principal = await principalFor(ctx, grant, exec.agent)
      return jsonValue(await service.submitDepartment({
        principal, workspaceId: grant.workspaceId, sourceSessionId: String(exec.agent.id),
        draft: inspectedDraft(ctx, exec.agent, args.pluginId, args.packageId),
        idempotencyKey: `${String(exec.rootCallId)}:submit`,
      }))
    },
    presentCall: args => ({
      card: 'generic', kind: 'execute', title: `Submit Cordis Plugin ${args.pluginId}`,
      rawInput: args,
    }),
  }))
}

export { name as invariantName } from './invariant.ts'
