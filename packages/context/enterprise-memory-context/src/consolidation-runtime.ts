/** Interval and per-compartment runtime for enterprise-memory consolidation: structure pass
 * (supersede duplicates, decay importance, retire decayed entries), shared-compartment digest,
 * and organization-wide private-note reflection, with the admin manual trigger behind the
 * controller's `POST /enterprise/consolidation/run` route.
 *
 * Single-host assumption: the in-flight guard is a module-level map, so overlapping runs of one
 * compartment in this process skip; multi-host deployments must not enable the interval on more
 * than one host. Digest and reflection rows are written through the ordinary proposal store API,
 * so consolidation keeps no outbox and never replays across restarts — the next tick or manual
 * run re-derives everything from the committed memory rows. */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import {
  classifyPrivacyForScope, inspectEnterpriseMemory, MEMORY_KINDS, memorySourceDigest,
  type EnterpriseIdentityStore, type EnterpriseMemoryEntry, type MemoryKind,
} from '@deepseek-ai/dsh-enterprise-identity'
import {
  consolidationTunables, decayImportance, groupDuplicates, reflectionCandidates, retirePlan,
  supersedePlan, type ConsolidationTunables,
} from './consolidation.ts'
import {
  reflectOnPrivateNotes, summarizeCompartment, type ConsolidationLlm, type ConsolidationRefinementOptions,
} from './consolidation-llm.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { memoryConsolidation: MemoryConsolidationRuntime }
}

/** One memory compartment a consolidation run operates on. */
export type ConsolidationCompartment =
  | { readonly kind: 'shared'; readonly scope: 'organization' }
  | { readonly kind: 'shared'; readonly scope: 'department'; readonly departmentId: string }
  | { readonly kind: 'project'; readonly projectId: string }

/** Outcome of one run's digest pass. `unchanged` also covers an empty compartment and the P3
 * deferral that keeps digests out of project compartments; `skipped-llm` covers a failed or
 * unconfigured refinement call over a non-empty compartment. */
export type ConsolidationDigestOutcome = 'written' | 'skipped-privacy' | 'skipped-llm' | 'unchanged'

/** Reflection-pass counts. `failed` counts non-dropped candidates whose proposal could not be
 * written, including department-target reflections (P3 cannot resolve a department for a
 * writer-less agent note) and store rejections. */
export interface ConsolidationReflectionReport {
  /** Reflection proposals that stand after the run, including ones already standing. */
  readonly proposed: number
  /** Reflections whose summary carried findings blocking the target shared compartment. */
  readonly droppedPrivacy: number
  /** Non-dropped candidates whose proposal write did not land. */
  readonly failed: number
  /** Present only when the pass was skipped whole because the `llm` service is unmounted —
   * the reflection mirror of the digest's `skipped-llm`. Proposal-level failures stay in
   * `failed`; an absent marker means the pass ran. */
  readonly skippedLlm?: true
}

/** Closed result of one consolidation run; the manual endpoint returns it as JSON. */
export interface ConsolidationReport {
  /** Organization the run operated in. */
  readonly orgId: string
  /** Compartment the run operated on. */
  readonly compartment: ConsolidationCompartment
  /** Duplicate rows successfully superseded by their group survivor. */
  readonly superseded: number
  /** Decayed entries retired through the review path. */
  readonly retired: number
  /** Importance rewrites the decay batch applied. */
  readonly importanceUpdates: number
  /** Digest-pass outcome. */
  readonly digest: ConsolidationDigestOutcome
  /** Reflection-pass counts; always zero outside a shared organization run. */
  readonly reflections: ConsolidationReflectionReport
  /** Run time in epoch milliseconds. */
  readonly at: number
}

/** Raised by `runCompartment` when the compartment already has a run in flight. */
export class ConsolidationRunningError extends Error {
  constructor(readonly key: string) {
    super(`enterprise memory consolidation is already running for ${key}`)
    this.name = 'ConsolidationRunningError'
  }
}

/** Deployment configuration of one runtime; resolved by the plugin `apply` from the plugin
 * `Config`, which owns every default. */
export interface MemoryConsolidationConfig {
  /** Interval between automatic ticks in epoch milliseconds; `0` disables the interval entirely. */
  readonly intervalMs: number
  /** Organizations the interval consolidates; empty keeps the interval inert while the manual
   * endpoint still works per org. */
  readonly orgIds: readonly string[]
  /** Explicit `service:` identity consolidation writes, reviews, and audits attribute to. */
  readonly actorUserId: string
  /** Registered provider route of the refinement model calls. */
  readonly provider: string
  /** Model the refinement model calls run on. */
  readonly model: string
  /** Maximum output tokens for one refinement model call. */
  readonly maxTokens: number
  /** Wall-clock timeout for one refinement model call. */
  readonly timeoutMs: number
  /** Resolved consolidation thresholds. */
  readonly tunables: ConsolidationTunables
}

/** In-flight guard keyed by org and compartment; a module-level map so every runtime instance in
 * the process shares it. */
const running = new Map<string, Promise<ConsolidationReport>>()

/** Compartment identifier inside one org: the stable label used by the in-flight key, audit
 * resource ids, and digest source digests. */
export function compartmentTag(compartment: ConsolidationCompartment): string {
  switch (compartment.kind) {
    case 'project': return `project:${compartment.projectId}`
    case 'shared': return compartment.scope === 'organization'
      ? 'organization'
      : `department:${compartment.departmentId}`
  }
}

/** Stable string key identifying one org-and-compartment pair. */
export function compartmentKey(orgId: string, compartment: ConsolidationCompartment): string {
  return `${orgId}:${compartmentTag(compartment)}`
}

/** Human-readable compartment label the digest model call receives. */
function compartmentName(compartment: ConsolidationCompartment): string {
  switch (compartment.kind) {
    case 'project': return `Project memory (${compartment.projectId})`
    case 'shared': return compartment.scope === 'organization'
      ? 'Organization memory'
      : `Department memory (${compartment.departmentId})`
  }
}

/** Kinds the structure pass reviews; the `summary` rows consolidation itself writes never feed it. */
const STRUCTURE_KINDS: readonly MemoryKind[] = MEMORY_KINDS.filter(kind => kind !== 'summary')

/** Entries left after duplicate supersede, plus the pass counts the run reports. */
interface StructurePassResult {
  readonly remaining: EnterpriseMemoryEntry[]
  readonly superseded: number
  readonly retired: number
  readonly importanceUpdates: number
}

/** Review reason recorded when consolidation retires a decayed entry. */
const RETIRE_REASON = 'consolidation retired decayed memory'
/** Review reason recorded when consolidation activates its own fresh digest. */
const DIGEST_APPROVE_REASON = 'consolidation digest auto-activated'

/** Rationale cap for one reflection proposal; longer rationale is truncated before any
 * persistence because the rationale is reviewer context, never model-visible content. */
const REFLECTION_RATIONALE_MAX = 500

/** Runtime seams for deterministic tests and host clock injection. */
export interface MemoryConsolidationRuntimeOptions {
  /** Wall clock for run timestamps and decay ages; defaults to the process clock. */
  readonly now?: () => number
}

/** Process-scoped consolidation service: interval lifecycle, per-compartment runs, and the
 * reentrancy guard the manual endpoint answers 409 through. */
export class MemoryConsolidationRuntime {
  private timer: ReturnType<typeof setInterval> | undefined
  private closed = false
  private readonly clock: () => number

  constructor(
    private readonly ctx: Context,
    private readonly identity: EnterpriseIdentityStore,
    private readonly config: MemoryConsolidationConfig,
    options: MemoryConsolidationRuntimeOptions = {},
  ) {
    this.clock = options.now ?? Date.now
  }

  /** Start the interval timer; an interval of `0` or an empty org list starts nothing. */
  async start(): Promise<void> {
    if (this.config.intervalMs === 0 || this.config.orgIds.length === 0) return
    this.timer = setInterval(() => { this.tick() }, this.config.intervalMs)
    this.timer.unref()
  }

  /** Wire the service into the context and tie the timer to the context lifecycle. */
  install(): void {
    this.ctx.provide('memoryConsolidation', this)
    this.ctx.effect(() => this.start().then(() => () => this.close()), 'enterprise memory consolidation runtime')
  }

  /** Stop the timer; an in-flight run finishes but no tick fires afterwards. */
  close(): void {
    this.closed = true
    if (this.timer !== undefined) clearInterval(this.timer)
  }

  /**
   * Run consolidation once for one compartment. An overlapping run of the same compartment —
   * a tick racing a manual trigger, or two manual triggers — throws `ConsolidationRunningError`.
   * @param orgId - organization whose memory is consolidated.
   * @param compartment - the compartment to consolidate.
   * @returns the closed run report.
   */
  async runCompartment(orgId: string, compartment: ConsolidationCompartment): Promise<ConsolidationReport> {
    const key = compartmentKey(orgId, compartment)
    if (running.has(key)) throw new ConsolidationRunningError(key)
    const run = this.execute(orgId, compartment)
    running.set(key, run)
    try {
      return await run
    } finally {
      if (running.get(key) === run) running.delete(key)
    }
  }

  private tick(): void {
    if (this.closed) return
    void this.runIntervalTick()
  }

  /** One interval pass over every configured org: the shared organization compartment (which
   * carries the reflection pass) and then each department compartment. Per-compartment failures
   * log and move on; an overlapping skip is silent by contract. */
  private async runIntervalTick(): Promise<void> {
    for (const orgId of this.config.orgIds) {
      await this.runIntervalCompartment(orgId, { kind: 'shared', scope: 'organization' })
      for (const department of await this.identity.listDepartments(orgId)) {
        await this.runIntervalCompartment(orgId, { kind: 'shared', scope: 'department', departmentId: department.id })
      }
    }
  }

  private async runIntervalCompartment(orgId: string, compartment: ConsolidationCompartment): Promise<void> {
    try {
      await this.runCompartment(orgId, compartment)
    } catch (error: unknown) {
      if (error instanceof ConsolidationRunningError) return
      this.ctx.logger.warn(`enterprise memory consolidation failed for ${compartmentKey(orgId, compartment)}: ${String(error)}`)
    }
  }

  private async execute(orgId: string, compartment: ConsolidationCompartment): Promise<ConsolidationReport> {
    const now = this.clock()
    const correlationId = randomUUID()
    const actor = await this.requireActor(orgId)
    const entries = await this.compartmentEntries(orgId, compartment)
    const structure = await this.structurePass(orgId, compartment, entries, actor, now, correlationId)
    const digest = await this.digestPass(orgId, compartment, structure.remaining, actor, now, correlationId)
    const reflections = await this.reflectionPass(orgId, compartment, actor, now, correlationId)
    return {
      orgId, compartment, superseded: structure.superseded, retired: structure.retired,
      importanceUpdates: structure.importanceUpdates, digest, reflections, at: now,
    }
  }

  /** Approved, non-summary entries of one compartment. The explicit scope filters keep the
   * legacy organization-plus-departments listing from bleeding rows across compartments. */
  private async compartmentEntries(orgId: string, compartment: ConsolidationCompartment): Promise<EnterpriseMemoryEntry[]> {
    if (compartment.kind === 'project') {
      const rows = await this.identity.listMemories({
        orgId, scopes: ['project'], projectId: compartment.projectId, statuses: ['approved'], kinds: STRUCTURE_KINDS,
      })
      return rows.filter(row => row.scope === 'project' && row.projectId === compartment.projectId)
    }
    if (compartment.scope === 'organization') {
      const rows = await this.identity.listMemories({
        orgId, departmentIds: [], statuses: ['approved'], kinds: STRUCTURE_KINDS,
      })
      return rows.filter(row => row.scope === 'organization')
    }
    const rows = await this.identity.listMemories({
      orgId, departmentIds: [compartment.departmentId], statuses: ['approved'], kinds: STRUCTURE_KINDS,
    })
    return rows.filter(row => row.scope === 'department' && row.departmentId === compartment.departmentId)
  }

  /** Structure pass: supersede duplicate groups per survivor, rewrite every remaining entry's
   * importance to its decayed weight, and retire the entries decayed below the retirement
   * threshold. Per-row failures are recorded in the pass audit and never abort the run.
   *
   * Decay anchor: `decayImportance` ages an entry from `lastAccessAt ?? updatedAt`, and the batch
   * below writes only the weight — never the clock. A consecutive run therefore re-applies the
   * full anchor-age factor to the already-decayed value, so an entry neither recalled nor
   * otherwise touched decays faster than the half-life curve and reaches the retirement threshold
   * sooner; this is intentional. Advancing the anchor here instead would reset `retirePlan`'s
   * staleness test on every run and disable retirement outright — one clock serves both decay and
   * staleness, and staleness wins. Recall (`touchMemoryAccess`) is what advances the anchor and
   * resets decay for memories in active use. */
  private async structurePass(
    orgId: string,
    compartment: ConsolidationCompartment,
    entries: readonly EnterpriseMemoryEntry[],
    actor: string,
    now: number,
    correlationId: string,
  ): Promise<StructurePassResult> {
    const supersededIds = new Set<string>()
    const failures: string[] = []
    for (const group of groupDuplicates(entries, this.config.tunables)) {
      const plan = supersedePlan(group)
      for (const old of plan.superseded) {
        try {
          await this.identity.supersedeMemory(old.id, plan.survivor.id, now)
          supersededIds.add(old.id)
        } catch (error: unknown) {
          failures.push(`supersede ${old.id}: ${String(error)}`)
        }
      }
    }
    const remaining = entries.filter(entry => !supersededIds.has(entry.id))
    // The decay write is the mutation API: every remaining entry's importance becomes its
    // decayed weight, floored at zero by `decayImportance` itself. The access clock is
    // deliberately left untouched — see the anchor note on this pass.
    const importanceUpdates = remaining.length === 0
      ? 0
      : await this.identity.batchUpdateImportance(remaining.map(entry => ({
        id: entry.id,
        importance: decayImportance(entry, now, this.config.tunables.halfLifeDays),
      })))
    let retired = 0
    for (const entry of remaining) {
      if (!retirePlan(entry, now, this.config.tunables)) continue
      try {
        await this.identity.reviewMemory({
          id: entry.id, orgId, decision: 'retired', reviewedBy: actor,
          reason: RETIRE_REASON, expectedRevision: entry.revision,
        })
        retired += 1
      } catch (error: unknown) {
        failures.push(`retire ${entry.id}: ${String(error)}`)
      }
    }
    const superseded = supersededIds.size
    await this.appendPassAudit({
      orgId, actor, correlationId, at: now, pass: 'structure', compartment,
      reason: failures.length === 0 ? 'consolidation structure pass applied' : 'consolidation structure pass applied with failures',
      details: { superseded, retired, importanceUpdates, ...(failures.length === 0 ? {} : { failures }) },
    })
    return { remaining, superseded, retired, importanceUpdates }
  }

  /** Digest pass over the surviving entries. The digest is only ever written into the shared
   * compartments: project compartments keep P3 deferral, a compartment summary that carries
   * findings blocking its own scope is skipped, and a failed refinement is a structured skip.
   * The fresh digest activates immediately — consolidation is the authority over `summary`
   * rows, the scope-aware privacy gate has already run — so the previous digest can be
   * superseded through the store's approved-status requirement on the next run.
   *
   * Rejected digests: a rejected `summary` row stays out of `liveSummaries`, so regenerating
   * identical text re-proposes the same deterministic id and the store's id conflict fails the
   * run loud. The propose-reject-regenerate cycle is pathological and requires human attention;
   * it is never silently swallowed as `unchanged`. */
  private async digestPass(
    orgId: string,
    compartment: ConsolidationCompartment,
    remaining: readonly EnterpriseMemoryEntry[],
    actor: string,
    now: number,
    correlationId: string,
  ): Promise<ConsolidationDigestOutcome> {
    if (compartment.kind === 'project') {
      await this.appendPassAudit({
        orgId, actor, correlationId, at: now, pass: 'digest', compartment, reason: 'digest deferred for project scope',
        details: { digest: 'unchanged', digestReason: 'project-scope-deferred' },
      })
      return 'unchanged'
    }
    const scope = compartment.scope
    const live = await this.liveSummaries(orgId, compartment)
    const llm = this.refinementLlm()
    const digest = remaining.length === 0 || llm === undefined
      ? undefined
      : await summarizeCompartment(llm, compartmentName(compartment), remaining, this.refinementOptions())
    if (digest === undefined) {
      const outcome: ConsolidationDigestOutcome = remaining.length === 0 ? 'unchanged' : 'skipped-llm'
      await this.appendPassAudit({
        orgId, actor, correlationId, at: now, pass: 'digest', compartment,
        reason: remaining.length === 0 ? 'digest skipped for empty compartment' : 'digest refinement unavailable',
        details: { digest: outcome },
      })
      return outcome
    }
    const decision = classifyPrivacyForScope(inspectEnterpriseMemory(digest).findings, scope)
    if (!decision.allowed) {
      await this.appendPassAudit({
        orgId, actor, correlationId, at: now, pass: 'digest', compartment,
        reason: 'digest blocked by scope-aware privacy findings', details: { digest: 'skipped-privacy', blocked: decision.blocked },
      })
      return 'skipped-privacy'
    }
    const sourceDigest = memorySourceDigest(JSON.stringify([orgId, compartmentTag(compartment), 'summary', digest]))
    if (live.some(row => row.sourceDigest === sourceDigest)) {
      await this.appendPassAudit({
        orgId, actor, correlationId, at: now, pass: 'digest', compartment,
        reason: 'digest matches the live compartment summary', details: { digest: 'unchanged' },
      })
      return 'unchanged'
    }
    const proposed = await this.identity.proposeMemory({
      id: `consolidation-digest-${sourceDigest}`, orgId, scope,
      ...(compartment.scope === 'department' ? { departmentId: compartment.departmentId } : {}),
      kind: 'summary', summary: digest, sourceDigest, createdBy: actor,
    })
    await this.identity.reviewMemory({
      id: proposed.id, orgId, decision: 'approved', reviewedBy: actor,
      reason: DIGEST_APPROVE_REASON, expectedRevision: proposed.revision,
    })
    const failures: string[] = []
    for (const old of live) {
      try {
        await this.identity.supersedeMemory(old.id, proposed.id, now)
      } catch (error: unknown) {
        failures.push(`supersede digest ${old.id}: ${String(error)}`)
      }
    }
    await this.appendPassAudit({
      orgId, actor, correlationId, at: now, pass: 'digest', compartment,
      reason: failures.length === 0 ? 'compartment digest written' : 'compartment digest written with supersede failures',
      details: {
        digest: 'written', digestMemoryId: proposed.id,
        ...(failures.length === 0 ? {} : { failures }),
      },
    })
    return 'written'
  }

  /** Non-superseded `summary` rows of one shared compartment: the digests a fresh digest
   * compares against and supersedes. */
  private async liveSummaries(
    orgId: string,
    compartment: Extract<ConsolidationCompartment, { kind: 'shared' }>,
  ): Promise<EnterpriseMemoryEntry[]> {
    const rows = await this.identity.listMemories({
      orgId, scopes: [compartment.scope], statuses: ['approved', 'proposed'], kinds: ['summary'],
    })
    return rows.filter(row => row.invalidatedBy === undefined
      && (compartment.scope === 'organization'
        ? row.scope === 'organization'
        : row.scope === 'department' && row.departmentId === compartment.departmentId))
  }

  /** Reflection pass. It runs once per `runCompartment` call and only for a shared organization
   * compartment, reading approved agent rows org-wide — consolidation is the org authority, so
   * the recall layer's owner restriction does not apply here. Every non-dropped proposal enters
   * review as `proposed` (human decision) with `business-fact` as its kind; the rationale is
   * truncated to the audit cap and recorded in the audit record only. P3 cannot resolve a
   * department for a writer-less agent note, so department-target proposals count as failed. */
  private async reflectionPass(
    orgId: string,
    compartment: ConsolidationCompartment,
    actor: string,
    now: number,
    correlationId: string,
  ): Promise<ConsolidationReflectionReport> {
    if (compartment.kind !== 'shared' || compartment.scope !== 'organization') {
      return { proposed: 0, droppedPrivacy: 0, failed: 0 }
    }
    const llm = this.refinementLlm()
    if (llm === undefined) {
      await this.appendPassAudit({
        orgId, actor, correlationId, at: now, pass: 'reflection', compartment,
        reason: 'reflection skipped without the llm service',
        details: { proposed: 0, droppedPrivacy: 0, failed: 0, reflectionLlm: 'unavailable' },
      })
      return { proposed: 0, droppedPrivacy: 0, failed: 0, skippedLlm: true }
    }
    const agentRows = await this.identity.listMemories({ orgId, scopes: ['agent'], statuses: ['approved'] })
    const candidates = reflectionCandidates(agentRows, now, this.config.tunables)
    const outcomes = await reflectOnPrivateNotes(llm, candidates, this.config.tunables, this.refinementOptions())
    const report = { proposed: 0, droppedPrivacy: 0, failed: 0 }
    const failures: string[] = []
    const proposals: Array<{ memoryId: string; targetScope: string; rationale: string }> = []
    for (const outcome of outcomes) {
      if (outcome.dropped === 'privacy') {
        report.droppedPrivacy += 1
        continue
      }
      const scope = outcome.candidate.targetScope
      // A shared department row requires a department id and the candidate carries none; no
      // mounted service maps an agent note's writer to a department, so P3 records the failure.
      if (scope === 'department') {
        report.failed += 1
        failures.push(`reflection ${JSON.stringify(outcome.candidate.summary.slice(0, 50))}: department target has no resolvable department`)
        continue
      }
      const rationale = outcome.candidate.rationale.slice(0, REFLECTION_RATIONALE_MAX)
      const sourceDigest = memorySourceDigest(
        JSON.stringify([orgId, scope, 'business-fact', outcome.candidate.summary]),
      )
      const memoryId = `consolidation-reflection-${sourceDigest}`
      const existing = (await this.identity.listMemories({ orgId })).find(row => row.id === memoryId)
      if (existing !== undefined && existing.status !== 'rejected' && existing.status !== 'retired') {
        report.proposed += 1
        proposals.push({ memoryId, targetScope: scope, rationale })
        continue
      }
      try {
        await this.identity.proposeMemory({
          id: memoryId, orgId, scope, kind: 'business-fact',
          summary: outcome.candidate.summary, sourceDigest, createdBy: actor,
        })
        report.proposed += 1
        proposals.push({ memoryId, targetScope: scope, rationale })
      } catch (error: unknown) {
        report.failed += 1
        failures.push(`propose ${memoryId}: ${String(error)}`)
      }
    }
    await this.appendPassAudit({
      orgId, actor, correlationId, at: now, pass: 'reflection', compartment,
      reason: failures.length === 0 ? 'consolidation reflection pass applied' : 'consolidation reflection pass applied with failures',
      details: {
        proposed: report.proposed, droppedPrivacy: report.droppedPrivacy, failed: report.failed,
        ...(proposals.length === 0 ? {} : { proposals }),
        ...(failures.length === 0 ? {} : { failures }),
      },
    })
    return report
  }

  /** Append one pass audit record in the writeback store-audit shape. */
  private async appendPassAudit(input: {
    orgId: string
    actor: string
    correlationId: string
    at: number
    pass: 'structure' | 'digest' | 'reflection'
    compartment: ConsolidationCompartment
    reason: string
    details: Record<string, unknown>
  }): Promise<void> {
    await this.identity.appendAudit({
      id: randomUUID(), orgId: input.orgId, actorUserId: input.actor, action: 'capability.manage',
      resourceType: 'enterprise-memory-consolidation',
      resourceId: compartmentKey(input.orgId, input.compartment),
      decision: 'allowed', reason: input.reason, correlationId: input.correlationId, at: input.at,
      details: { pass: input.pass, ...input.details },
    })
  }

  /** Resolve the consolidation actor: an explicit `service:` identity that exists and is enabled
   * in the org, because every store write and audit attributes to it. */
  private async requireActor(orgId: string): Promise<string> {
    const user = (await this.identity.listUsers(orgId)).find(candidate => candidate.id === this.config.actorUserId)
    if (user === undefined || user.disabled) {
      throw new Error(`enterprise memory consolidation actor is unavailable or disabled in ${orgId}`)
    }
    return user.id
  }

  /** Tolerant lookup of the streaming model surface: compositions without the `llm` service
   * still consolidate structurally, and the digest and reflection passes report their
   * structured skips instead of failing the run. */
  private refinementLlm(): ConsolidationLlm | undefined {
    return (this.ctx.get.bind(this.ctx) as (name: string) => unknown)('llm') as ConsolidationLlm | undefined
  }

  private refinementOptions(): ConsolidationRefinementOptions {
    return {
      provider: this.config.provider, model: this.config.model,
      maxTokens: this.config.maxTokens, timeoutMs: this.config.timeoutMs,
    }
  }
}

/** Resolve the plugin-level consolidation configuration, rejecting invalid overrides at this
 * configuration boundary. The interval path is enabled only when both an interval and an org
 * list are configured, and then a complete refinement route (actor, provider, model) is
 * required — misconfiguration fails loud here instead of at 3 a.m. on a tick.
 * @param partial - validated plugin `Config` values.
 * @returns the complete runtime configuration.
 * @throws When the actor is set but leaves the reserved `service:` prefix, the interval is
 *   enabled without a complete refinement route, or the tunables reject an override.
 */
export function consolidationRuntimeConfig(partial: {
  intervalMs: number
  orgIds: readonly string[]
  actorUserId: string
  provider: string
  model: string
  maxTokens: number
  timeoutMs: number
  tunables: Partial<ConsolidationTunables>
}): MemoryConsolidationConfig {
  if (partial.actorUserId !== '' && !partial.actorUserId.startsWith('service:')) {
    throw new Error('enterprise memory consolidation actor must use the reserved service: prefix')
  }
  const intervalEnabled = partial.intervalMs > 0 && partial.orgIds.length > 0
  if (intervalEnabled && (partial.actorUserId === '' || partial.provider === '' || partial.model === '')) {
    throw new Error('enterprise memory consolidation interval requires a service: actor, a provider, and a model route')
  }
  return {
    intervalMs: partial.intervalMs,
    orgIds: [...partial.orgIds],
    actorUserId: partial.actorUserId,
    provider: partial.provider,
    model: partial.model,
    maxTokens: partial.maxTokens,
    timeoutMs: partial.timeoutMs,
    tunables: consolidationTunables(partial.tunables),
  }
}
