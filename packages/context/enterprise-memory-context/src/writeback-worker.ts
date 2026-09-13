/** Authority-rechecked reconciliation for one durable enterprise-memory writeback job. */
import { createHash } from 'node:crypto'
import type {
  EnterpriseMemoryEntry, EnterpriseWorkspaceGrant, ProposeEnterpriseMemoryInput,
} from '@deepseek-ai/dsh-enterprise-identity'
import type { MemoryExtractionCandidate } from './writeback-extraction.ts'

export interface MemoryWritebackJob {
  readonly sourceKey: string
  readonly orgId: string
  readonly workspaceId: string
  readonly departmentId?: string
  readonly actorUserId: string
  readonly sessionId: string
  readonly turn: number
  readonly provider: string
  readonly model: string
  readonly userText: string
  readonly assistantText: string
  readonly attempts: number
  readonly leaseOwner: string
}

export interface MemoryWritebackResult {
  readonly outcome: 'completed'
  readonly activated: number
  readonly pending: number
  readonly skipped: number
  readonly memoryIds: readonly string[]
}

export interface MemoryWritebackDependencies {
  currentGrant(): Promise<EnterpriseWorkspaceGrant | undefined>
  currentActorEnabled(): Promise<boolean>
  listMemories(scope: 'organization' | 'department', departmentId?: string): Promise<readonly EnterpriseMemoryEntry[]>
  extract(job: MemoryWritebackJob, existing: readonly EnterpriseMemoryEntry[]): Promise<readonly MemoryExtractionCandidate[]>
  propose(input: ProposeEnterpriseMemoryInput): Promise<EnterpriseMemoryEntry>
  approve(memory: EnterpriseMemoryEntry, reason: string): Promise<EnterpriseMemoryEntry>
  audit(input: { memoryId: string; action: 'activated' | 'pending' | 'skipped'; reason: string }): Promise<void>
}

function normalized(value: string): string { return value.normalize('NFKC').replaceAll(/\s+/gu, '').replaceAll(/[，。；：、,.!?！？;:]/gu, '').toLowerCase() }
function digest(value: string): string { return createHash('sha256').update(value).digest('hex') }

/** Reconcile extracted candidates while preserving organization, workspace, actor and conflict boundaries. */
export async function processMemoryWriteback(
  job: MemoryWritebackJob,
  dependencies: MemoryWritebackDependencies,
): Promise<MemoryWritebackResult> {
  const grant = await dependencies.currentGrant()
  if (grant === undefined || grant.orgId !== job.orgId || grant.workspaceId !== job.workspaceId) {
    throw new Error('enterprise memory writeback workspace authority changed')
  }
  if (!await dependencies.currentActorEnabled()) throw new Error('enterprise memory writeback actor is disabled or missing')
  const visible = [
    ...await dependencies.listMemories('organization'),
    ...job.departmentId === undefined ? [] : await dependencies.listMemories('department', job.departmentId),
  ]
  const candidates = await dependencies.extract(job, visible.slice(0, 80))
  let activated = 0; let pending = 0; let skipped = 0
  const memoryIds: string[] = []
  for (const candidate of candidates) {
    if (candidate.action === 'skip' || candidate.confidence < .75) { skipped += 1; continue }
    const departmentId = candidate.scope === 'department' ? job.departmentId : undefined
    if (candidate.scope === 'department' && departmentId === undefined) { skipped += 1; continue }
    const sourceDigest = digest(JSON.stringify([job.sourceKey, candidate.scope, departmentId ?? null, candidate.kind, candidate.summary]))
    const id = `turn-memory-${sourceDigest}`
    const sameScope = visible.filter(memory => memory.scope === candidate.scope
      && memory.departmentId === departmentId && (memory.status === 'approved' || memory.status === 'proposed'))
    const exact = sameScope.find(memory => normalized(memory.summary) === normalized(candidate.summary))
    if (exact !== undefined) {
      if (exact.id === id && exact.status === 'proposed' && candidate.action === 'create' && candidate.confidence >= .9) {
        await dependencies.approve(exact, '对话完成后独立提取并自动启用')
        activated += 1
        memoryIds.push(exact.id)
        await dependencies.audit({ memoryId: exact.id, action: 'activated', reason: 'resumed-interrupted-activation' })
        continue
      }
      skipped += 1
      await dependencies.audit({ memoryId: exact.id, action: 'skipped', reason: 'exact-normalized-duplicate' })
      continue
    }
    const proposed = await dependencies.propose({
      id, orgId: job.orgId, scope: candidate.scope,
      ...(departmentId === undefined ? {} : { departmentId }),
      kind: candidate.kind, summary: candidate.summary, sourceDigest, createdBy: job.actorUserId,
    })
    memoryIds.push(proposed.id)
    if (candidate.action === 'conflict' || candidate.confidence < .9) {
      pending += 1
      await dependencies.audit({ memoryId: proposed.id, action: 'pending', reason: candidate.reason })
      continue
    }
    await dependencies.approve(proposed, '对话完成后独立提取并自动启用')
    activated += 1
    await dependencies.audit({ memoryId: proposed.id, action: 'activated', reason: candidate.reason })
  }
  return { outcome: 'completed', activated, pending, skipped, memoryIds }
}
