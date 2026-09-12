/** Employee-owned learning: versioned text capabilities, not permission grants. */
import { createHash, randomUUID } from 'node:crypto'
import { open, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-agent-presets/types'
import type { Context } from '@deepseek-ai/cordis'
import type { EnterpriseCatalogRepository } from '@deepseek-ai/dsh-enterprise-catalog'
import type { EnterpriseIdentityStore } from '@deepseek-ai/dsh-enterprise-identity'
import { defineTool } from '@deepseek-ai/dsh-tools'

export interface LearningRepositories {
  readonly identity: EnterpriseIdentityStore
  readonly catalog: EnterpriseCatalogRepository
}

const POLICY = 'After successfully learning a reusable SOP or skill, write its Markdown source in the current workspace, then call learn_employee_capability. It automatically registers, binds and publishes the capability for you, the current digital employee; no administrator confirmation is needed. Do not save guesses, credentials, raw transactions or customer records. Learning does not grant new tools or data access. Report success only from the tool result.'

/** Register automatic learning within the existing enterprise context composition. */
export function registerEmployeeLearning(ctx: Context, repositories: LearningRepositories, maxChars: number): void {
  ctx.effect(() => ctx.systemPrompt.section({ name: 'enterprise:self-learning', order: 701, text: POLICY }))
  ctx.tools.register(defineTool({
    name: 'learn_employee_capability', description: POLICY,
    parameters: {
      kind: { type: 'string', required: true, enum: ['sop', 'skill'], description: 'Reusable procedure or skill learned from completed work.' },
      name: { type: 'string', required: true, description: 'Short business-facing capability name.' },
      sourcePath: { type: 'string', required: true, description: 'Workspace-relative Markdown source; for skills use the SKILL.md path.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        assetId: { type: 'string', required: true }, version: { type: 'number', required: true },
        employeeId: { type: 'string', required: true }, releaseId: { type: 'string', required: true },
      } },
      render: (_args, value) => [{ type: 'text', text: `Capability learned, registered and bound to ${value.employeeId}: ${value.assetId} v${String(value.version)} (release ${value.releaseId}).` }],
    },
    execute: async (args, exec) => {
      const agent = exec.agent
      const cwd = agent?.session.header.cwd
      const presetId = agent === undefined ? undefined : ctx.get('sessionProjections')?.stateOf(agent.session, 'agentPreset') ?? undefined
      if (agent === undefined || cwd === undefined || presetId === undefined) throw new Error('Learning requires a digital employee session with a workspace')
      const { identity, catalog } = repositories
      const grant = await identity.workspaceGrantByRootPath(cwd)
      if (grant === undefined) throw new Error('Current workspace is not enterprise-managed')
      const actorUserId = await identity.sessionOwnerUserId(String(agent.id))
      const actor = (await identity.listUsers(grant.orgId)).find(user => user.id === actorUserId)
      if (actorUserId === undefined || actor === undefined || actor.disabled) {
        throw new Error('Learning requires an active enterprise Session owner')
      }
      const name = args.name.trim()
      if (name.length === 0 || name.length > 160) throw new Error('Capability name must contain 1 to 160 characters')
      if (isAbsolute(args.sourcePath) || !args.sourcePath.endsWith('.md')) throw new Error('Source must be a workspace-relative Markdown file')
      const root = await realpath(cwd)
      const source = await realpath(resolve(root, args.sourcePath))
      const sourcePath = relative(root, source)
      if (sourcePath === '..' || sourcePath.startsWith(`..${sep}`) || isAbsolute(sourcePath)) throw new Error('Source is outside the current workspace')
      const file = await open(source, 'r')
      let content: string
      try {
        const stat = await file.stat()
        if (!stat.isFile() || stat.size > maxChars) throw new Error(`Source must be a text file of at most ${String(maxChars)} bytes; extract a focused reusable procedure first`)
        const buffer = Buffer.alloc(maxChars + 1)
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
        if (bytesRead > maxChars) throw new Error('Source exceeds the learning content budget')
        content = buffer.subarray(0, bytesRead).toString('utf8')
      } finally { await file.close() }
      if (content.trim() === '') throw new Error('Learning source is empty')
      const digest = createHash('sha256').update(JSON.stringify([grant.orgId, presetId, root, args.kind, sourcePath])).digest('hex')
      const assetId = `learned-${digest}`
      const result = await catalog.learnEmployeeAsset({
        orgId: grant.orgId, presetId, assetId, kind: args.kind, name,
        content: { name, content, sourcePath, workspaceRoot: root, learnedBy: presetId },
        actorUserId, idempotencyKey: `learn:${String(agent.id)}:${String(exec.callId)}`,
      })
      await identity.appendAudit({
        id: randomUUID(), orgId: grant.orgId, actorUserId, action: 'capability.manage',
        resourceType: 'employee-learning', resourceId: assetId, decision: 'allowed', reason: 'employee-self-learning',
        correlationId: String(exec.rootCallId), at: Date.now(),
        details: {
          employeeId: presetId, workspaceId: grant.workspaceId, sessionId: String(agent.id),
          assetVersion: result.asset.version, releaseId: result.release.releaseId,
        },
      })
      return { assetId, version: result.asset.version, employeeId: presetId, releaseId: result.release.releaseId }
    },
    presentCall: args => ({ card: 'generic', title: 'Learn employee capability', kind: 'other', rawInput: args }),
  }))
}

/** Read only this employee's learned, version-pinned text in its source workspace. */
export async function learnedEmployeeContext(
  repositories: LearningRepositories, presetId: string, cwd: string, maxChars: number,
): Promise<string | undefined> {
  const grant = await repositories.identity.workspaceGrantByRootPath(cwd)
  if (grant === undefined) return undefined
  const release = (await repositories.catalog.listReleases(presetId, grant.orgId)).at(-1)
  if (release === undefined) return undefined
  const root = await realpath(cwd)
  const blocks: string[] = []
  let remaining = maxChars
  for (const binding of release.snapshot.bindings) {
    if (binding.kind !== 'sop' && binding.kind !== 'skill') continue
    const asset = await repositories.catalog.getAsset(grant.orgId, binding.assetId)
    if (asset === undefined || asset.archived) continue
    const versions = await repositories.catalog.listAssetVersions(grant.orgId, binding.assetId)
    const version = versions.find(item => item.version === binding.version)
    const content = version?.content
    if (content?.['learnedBy'] !== presetId || content['workspaceRoot'] !== root || typeof content['content'] !== 'string') continue
    const sourcePath = typeof content['sourcePath'] === 'string' ? content['sourcePath'] : ''
    const name = typeof content['name'] === 'string' ? content['name'] : binding.assetId
    const block = `Capability ${binding.assetId} v${String(binding.version)} (${binding.kind}); source ${sourcePath}:\n${content['content']}`
    // Keep complete instructions; when large, expose the source so the Agent can load it on demand.
    const rendered = block.length + 2 <= remaining ? block
      : `Learned ${binding.kind}: ${name}. Read workspace source ${sourcePath} before use.`
    if (rendered.length + 2 > remaining) continue
    blocks.push(rendered)
    remaining -= rendered.length + 2
  }
  return blocks.length === 0 ? undefined : blocks.join('\n\n')
}
