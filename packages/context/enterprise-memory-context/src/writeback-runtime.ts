/** Completed-turn capture, durable queue worker and independent LLM extraction. */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { EnterpriseIdentityStore, EnterpriseWorkspaceGrant } from '@deepseek-ai/dsh-enterprise-identity'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  captureMemoryTurn, EXTRACTION_SYSTEM_PROMPT, parseExtractionOutput,
  type MemoryExtractionCandidate, type MemoryTurnSnapshot,
} from './writeback-extraction.ts'
import {
  EnterpriseMemoryWritebackRepository, type MemoryWritebackDatabase, type MemoryWritebackView,
} from './writeback-repository.ts'
import { processMemoryWriteback, type MemoryWritebackJob, type MemoryWritebackResult, type PrivateMemoryActor } from './writeback-worker.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { enterpriseMemoryWriteback: EnterpriseMemoryWritebackRuntime }
}

interface RuntimeConfig {
  readonly maxInputChars: number
  readonly maxTokens: number
  readonly timeoutMs: number
  readonly pollMs: number
}

interface ExtractorChunk {
  readonly type: string
  readonly text?: string
  readonly block?: { readonly type: string; readonly text?: string }
  readonly reason?: { readonly kind: string }
}

function textFromStream(chunks: readonly ExtractorChunk[]): string {
  const deltas = chunks.flatMap(chunk => chunk.type === 'text-delta' && typeof chunk.text === 'string' ? [chunk.text] : [])
  if (deltas.length > 0) return deltas.join('')
  return chunks.flatMap(chunk => chunk.type === 'block-end' && chunk.block?.type === 'text'
    && typeof chunk.block.text === 'string' ? [chunk.block.text] : []).join('\n')
}

async function departmentFor(identity: EnterpriseIdentityStore, grant: EnterpriseWorkspaceGrant): Promise<string | undefined> {
  if (grant.departmentId !== undefined) return grant.departmentId
  if (grant.ownerUserId === undefined) return undefined
  const owner = (await identity.listUsers(grant.orgId)).find(user => user.id === grant.ownerUserId)
  return owner?.primaryDepartmentId ?? (owner?.departmentIds.length === 1 ? owner.departmentIds[0] : undefined)
}

/** Process-scoped service used by the admin API and background worker. */
export class EnterpriseMemoryWritebackRuntime {
  private active: Promise<void> | undefined
  private timer: ReturnType<typeof setInterval> | undefined
  private closed = false

  constructor(
    private readonly ctx: Context,
    private readonly identity: EnterpriseIdentityStore,
    database: MemoryWritebackDatabase,
    private readonly config: RuntimeConfig,
  ) {
    this.repository = new EnterpriseMemoryWritebackRepository(database)
  }
  private readonly repository: EnterpriseMemoryWritebackRepository

  async start(): Promise<void> {
    await this.repository.initialize()
    this.timer = setInterval(() => { this.kick() }, this.config.pollMs)
    this.timer.unref()
    this.kick()
  }

  install(): void {
    this.ctx.on('agent/turn-stopping', async ({ agent, turn }): Promise<void> => {
      const snapshot = captureMemoryTurn(agent.session, turn, this.config.maxInputChars)
      if (snapshot !== undefined) await this.enqueue(snapshot)
    })
    this.ctx.provide('enterpriseMemoryWriteback', this)
    this.ctx.effect(() => this.start().then(() => () => this.close()), 'enterprise memory writeback runtime')
  }

  async enqueue(snapshot: MemoryTurnSnapshot): Promise<MemoryWritebackView | undefined> {
    const grant = await this.identity.workspaceGrantByRootPath(snapshot.workspaceRoot)
    const actorUserId = await this.identity.sessionOwnerUserId(snapshot.sessionId)
    if (grant === undefined || actorUserId === undefined) return undefined
    const actor = (await this.identity.listUsers(grant.orgId)).find(user => user.id === actorUserId)
    if (actor === undefined || actor.disabled) return undefined
    const departmentId = await departmentFor(this.identity, grant)
    const result = await this.repository.enqueue({
      ...snapshot, orgId: grant.orgId, workspaceId: grant.workspaceId,
      ...(departmentId === undefined ? {} : { departmentId }),
      actorUserId,
    })
    this.kick()
    return result
  }

  list(orgId: string, limit?: number): Promise<readonly MemoryWritebackView[]> { return this.repository.list(orgId, limit) }
  async retry(orgId: string, sourceKey: string): Promise<MemoryWritebackView> {
    const result = await this.repository.retry(orgId, sourceKey)
    this.kick()
    return result
  }

  private kick(): void {
    if (this.closed || this.active !== undefined) return
    this.active = new Promise<void>(resolve => setImmediate(resolve)).then(() => this.drain())
      .catch((error: unknown) => { this.ctx.logger.warn(`enterprise memory writeback worker failed: ${String(error)}`) })
      .finally(() => { this.active = undefined })
  }

  private async drain(): Promise<void> {
    while (!this.closed) {
      const job = await this.repository.claim(this.config.timeoutMs + 30_000)
      if (job === undefined) return
      try { await this.repository.complete(job, await this.process(job)) }
      catch (error) { await this.repository.fail(job, error) }
    }
  }

  private async process(job: MemoryWritebackJob): Promise<MemoryWritebackResult> {
    return processMemoryWriteback(job, {
      currentGrant: () => Promise.resolve(this.identity.workspaceGrant(job.workspaceId)),
      currentActorEnabled: async () => {
        const ownerUserId = await this.identity.sessionOwnerUserId(job.sessionId)
        return ownerUserId === job.actorUserId && (await this.identity.listUsers(job.orgId))
          .some(user => user.id === job.actorUserId && !user.disabled)
      },
      listMemories: async (scope, departmentId) => {
        const values = await this.identity.listMemories({
          orgId: job.orgId, statuses: ['approved', 'proposed'],
          ...(scope === 'department' && departmentId !== undefined ? { departmentIds: [departmentId] } : { departmentIds: [] }),
        })
        return values.filter(memory => memory.scope === scope)
      },
      extract: (value, existing) => this.extract(value, existing),
      writePrivateMemory: input => Promise.resolve(this.identity.writePrivateMemory(input)),
      resolvePrivateMemoryActor: sessionId => Promise.resolve(this.resolvePrivateMemoryActor(sessionId)),
      propose: input => Promise.resolve(this.identity.proposeMemory(input)),
      approve: (memory, reason) => Promise.resolve(this.identity.reviewMemory({
        id: memory.id, orgId: job.orgId, decision: 'approved', reviewedBy: job.actorUserId,
        reason, expectedRevision: memory.revision,
      })),
      audit: input => Promise.resolve(this.identity.appendAudit({
        id: randomUUID(), orgId: job.orgId, actorUserId: job.actorUserId, action: 'capability.manage',
        resourceType: 'enterprise-memory-writeback', resourceId: input.memoryId, decision: 'allowed',
        reason: input.reason, correlationId: job.sourceKey, at: Date.now(),
        details: { source: 'completed-turn-extraction', sessionId: job.sessionId, turn: job.turn, result: input.action },
      })),
    })
  }

  private async extract(
    job: MemoryWritebackJob,
    existing: readonly { id: string; summary: string; status: string }[],
  ): Promise<readonly MemoryExtractionCandidate[]> {
    const request = createUserMessage({
      source: { kind: 'plugin', plugin: 'enterprise-memory-writeback' },
      content: [{ type: 'text', text: JSON.stringify({
        conversation: { user: job.userText, assistant: job.assistantText },
        existing: existing.map(memory => ({ id: memory.id, summary: memory.summary, status: memory.status })),
      }) }],
    })
    const chunks: ExtractorChunk[] = []
    for await (const chunk of this.ctx.llm.stream({
      provider: job.provider, model: job.model, messages: [request], system: EXTRACTION_SYSTEM_PROMPT,
      maxTokens: this.config.maxTokens, sessionId: SessionId(job.sessionId), signal: AbortSignal.timeout(this.config.timeoutMs),
    })) chunks.push(chunk)
    const finish = chunks.findLast(chunk => chunk.type === 'finish')
    if (finish?.reason?.kind !== 'stop') throw new Error(`enterprise memory extractor ended with ${finish?.reason?.kind ?? 'no finish'}`)
    return parseExtractionOutput(textFromStream(chunks))
  }

  /**
   * Resolve the private-memory actor for one session through the employee-account service, kept
   * optional because compositions without persistent employees do not mount it. An absent service
   * or unanchored session resolves to undefined, and the worker skips private-target candidates
   * with the ordinary skip count instead of failing the job.
   */
  private resolvePrivateMemoryActor(sessionId: string): PrivateMemoryActor | undefined {
    const accounts = (this.ctx.get.bind(this.ctx) as (name: string) => unknown)('employeeAccounts') as
      | { resolveSessionActor(sessionId: string): PrivateMemoryActor | undefined }
      | undefined
    return accounts?.resolveSessionActor(sessionId)
  }

  async close(): Promise<void> {
    this.closed = true
    if (this.timer !== undefined) clearInterval(this.timer)
    await this.active
  }
}
