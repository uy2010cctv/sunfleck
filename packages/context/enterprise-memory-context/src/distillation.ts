/** Project-archival distillation: an LLM distills the approved project-compartment memories of one
 * project into at most a handful of durable lessons and proposes each into its target shared
 * compartment for human review. The manual controller route and the post-archive trigger both run
 * it through `MemoryConsolidationRuntime.distillProject`, which owns service resolution and the
 * audit shape; this module owns the checks, the refinement call, and the proposal writes. */
import {
  classifyPrivacyForScope, inspectEnterpriseMemory, memorySourceDigest,
  type EnterpriseIdentityStore, type EnterpriseMemoryEntry,
} from '@deepseek-ai/dsh-enterprise-identity'
import { completeRefinement, parseRefinedCandidates, type ConsolidationLlm, type ConsolidationRefinementOptions, type ReflectionTargetScope } from './consolidation-llm.ts'

/** Maximum lessons one project distillation may propose. A closing project leaves a handful of
 * durable takeaways, not its full history; every lesson becomes a human-review proposal, so the
 * bound keeps review queues short. */
export const PROJECT_DISTILL_LESSON_LIMIT = 5

/** Rationale cap for one distillation proposal; longer rationale is truncated before any
 * persistence because the rationale is reviewer context, never model-visible content. */
const DISTILL_RATIONALE_MAX = 500

/** Maximum characters of one distilled lesson summary, mirroring the reflection bound. */
const DISTILL_SUMMARY_MAX = 2_000

/** One lesson the model distilled from a closing project's memory compartment. */
export interface ProjectDistillLesson {
  readonly summary: string
  /** Shared compartment the lesson proposes to enter. */
  readonly targetScope: ReflectionTargetScope
  /** Why this knowledge outlives the project; recorded for reviewers. */
  readonly rationale: string
}

/** Closed result of one distillation run; the manual endpoint returns it as JSON. */
export interface ProjectDistillReport {
  /** Organization the run operated in. */
  readonly orgId: string
  /** Project the run distilled. */
  readonly projectId: string
  /** Lessons whose proposal now stands in shared memory. */
  readonly distilled: number
  /** Lessons whose summary carried findings blocking their target compartment. */
  readonly droppedPrivacy: number
  /** Lessons targeting a department, which P3 cannot resolve from a project compartment. */
  readonly droppedDepartment: number
  /** Lessons whose deterministic id already carries a memory row, so the proposal was skipped. */
  readonly skippedDuplicate: number
  /** Non-dropped lessons whose proposal write did not land. */
  readonly failed: number
  /** Present when the run produced nothing without writing: no compartment entries, the `llm`
   * service unmounted, or a failed refinement call. An absent marker means the run proposed. */
  readonly reason?: 'empty' | 'llm-unavailable' | 'llm-failed'
  /** Run time in epoch milliseconds. */
  readonly at: number
}

/** Structural view of the lazily resolved project governance service; only the fields the
 * existence check and the model prompt need. */
export interface ProjectDistillationProjects {
  get(projectId: string): Promise<{ orgId: string; name: string; state: string } | undefined>
}

/** Resolved dependencies of one distillation run; the runtime owns the lazy lookups and the audit
 * shape, so this module stays directly testable against fakes. */
export interface ProjectDistillationDependencies {
  readonly identity: EnterpriseIdentityStore
  /** Project governance service; a composition without the project entity cannot distill. */
  readonly projects: ProjectDistillationProjects | undefined
  /** Streaming model surface; `undefined` resolves the structured `llm-unavailable` reason. */
  readonly llm: ConsolidationLlm | undefined
  /** Routing and budget of the refinement model call. */
  readonly options: ConsolidationRefinementOptions
  /** Clock for the report timestamp. */
  readonly now: () => number
  /** Append the run's audit record in the caller's shape; every run — including a skipped one —
   * audits exactly once. */
  readonly audit: (input: { reason: string; details: Record<string, unknown> }) => Promise<void>
}

const DISTILL_SYSTEM_PROMPT = [
  'Distill the durable company-wide lessons of one closing enterprise project from its memory compartment.',
  'Return JSON only: {"lessons":[{"summary":"...","targetScope":"organization|department","rationale":"..."}]} with at most the requested number of lessons.',
  'Propose only knowledge valuable beyond the project. Never propose personal data, credentials, customer records, or raw records.',
].join(' ')

/** Strictly validate the lesson list; anything outside the contract throws.
 * @param output - complete visible model output.
 * @param limit - maximum lessons the output may carry.
 * @returns the parsed lessons in model order.
 */
function parseLessons(output: string, limit: number): ProjectDistillLesson[] {
  return parseRefinedCandidates(output, limit, 'lessons', 'enterprise project distillation lessons', DISTILL_SUMMARY_MAX)
}

/** Distill one closing project's approved compartment entries into lesson proposals. A stream
 * failure, timeout, or malformed output resolves to `undefined` as a structured skip.
 * @param llm - streaming model surface the call runs on.
 * @param projectLabel - human-readable project label the model call receives.
 * @param entries - the project compartment entries feeding the distillation.
 * @param options - routing and budget of the model call.
 * @param limit - maximum lessons.
 * @returns the parsed lessons in model order, or undefined when the refinement failed.
 */
async function distillLessons(
  llm: ConsolidationLlm,
  projectLabel: string,
  entries: readonly EnterpriseMemoryEntry[],
  options: ConsolidationRefinementOptions,
  limit: number,
): Promise<ProjectDistillLesson[] | undefined> {
  try {
    return parseLessons(
      await completeRefinement(llm, options, DISTILL_SYSTEM_PROMPT, {
        limit,
        project: projectLabel,
        entries: entries.map(entry => ({ id: entry.id, kind: entry.kind, summary: entry.summary })),
      }),
      limit,
    )
  } catch {
    // Malformed or failed distillation output is a structured skip: the run writes nothing and
    // reports the reason, and nothing else can reach the failure.
  }
  return undefined
}

/** Run one project distillation: verify the project, distill its approved non-summary compartment
 * entries, and propose every surviving lesson into its target shared compartment as
 * `proposed` (human review). Idempotent per lesson content: the deterministic
 * `project-distill-<sha256([projectId, summary])>` id skips lessons whose row already stands.
 * @param deps - resolved stores, model surface, clock, and audit seam.
 * @param input - organization, project, and the actor the proposals and audit attribute to.
 * @returns the closed run report.
 * @throws When the project service is unmounted, or the project is missing or outside the organization.
 */
export async function distillProjectMemory(
  deps: ProjectDistillationDependencies,
  input: { orgId: string; projectId: string; actorUserId: string },
): Promise<ProjectDistillReport> {
  const at = deps.now()
  if (deps.projects === undefined) {
    throw new Error('enterprise project distillation requires the enterprise project service, which is not mounted')
  }
  const project = await deps.projects.get(input.projectId)
  if (project === undefined || project.orgId !== input.orgId) {
    throw new Error(`enterprise project ${input.projectId} is missing or outside organization ${input.orgId}`)
  }
  const entries = (await deps.identity.listMemories({
    orgId: input.orgId, scopes: ['project'], projectId: input.projectId, statuses: ['approved'],
  })).filter(entry => entry.kind !== 'summary' && entry.scope === 'project' && entry.projectId === input.projectId)
  if (entries.length === 0) {
    const details = { distilled: 0, droppedPrivacy: 0, droppedDepartment: 0, skippedDuplicate: 0, failed: 0, reason: 'empty' as const }
    await deps.audit({ reason: 'distillation skipped for empty project compartment', details })
    return { orgId: input.orgId, projectId: input.projectId, ...details, at }
  }
  if (deps.llm === undefined) {
    const details = { distilled: 0, droppedPrivacy: 0, droppedDepartment: 0, skippedDuplicate: 0, failed: 0, reason: 'llm-unavailable' as const }
    await deps.audit({ reason: 'distillation skipped without the llm service', details })
    return { orgId: input.orgId, projectId: input.projectId, ...details, at }
  }
  const lessons = await distillLessons(
    deps.llm, `${project.name} (${input.projectId})`, entries, deps.options, PROJECT_DISTILL_LESSON_LIMIT,
  )
  if (lessons === undefined) {
    const details = { distilled: 0, droppedPrivacy: 0, droppedDepartment: 0, skippedDuplicate: 0, failed: 0, reason: 'llm-failed' as const }
    await deps.audit({ reason: 'project distillation refinement failed', details })
    return { orgId: input.orgId, projectId: input.projectId, ...details, at }
  }
  const report = { distilled: 0, droppedPrivacy: 0, droppedDepartment: 0, skippedDuplicate: 0, failed: 0 }
  const proposals: Array<{ memoryId: string; targetScope: string; rationale: string }> = []
  const failures: string[] = []
  for (const lesson of lessons) {
    // P3 cannot resolve a department for a project compartment row, mirroring the reflection
    // pass; the lesson is counted and recorded instead of downgraded into a guessed department.
    if (lesson.targetScope === 'department') {
      report.droppedDepartment += 1
      failures.push(`distill ${JSON.stringify(lesson.summary.slice(0, 50))}: department target has no resolvable department`)
      continue
    }
    const decision = classifyPrivacyForScope(inspectEnterpriseMemory(lesson.summary).findings, lesson.targetScope)
    if (!decision.allowed) {
      report.droppedPrivacy += 1
      continue
    }
    const sourceDigest = memorySourceDigest(JSON.stringify([input.projectId, lesson.summary]))
    const memoryId = `project-distill-${sourceDigest}`
    const existing = (await deps.identity.listMemories({ orgId: input.orgId, statuses: ['proposed', 'approved'] }))
      .find(row => row.id === memoryId)
    if (existing !== undefined) {
      report.skippedDuplicate += 1
      continue
    }
    const rationale = lesson.rationale.slice(0, DISTILL_RATIONALE_MAX)
    try {
      await deps.identity.proposeMemory({
        id: memoryId, orgId: input.orgId, scope: lesson.targetScope, kind: 'business-fact',
        summary: lesson.summary, sourceDigest, createdBy: input.actorUserId,
      })
      report.distilled += 1
      proposals.push({ memoryId, targetScope: lesson.targetScope, rationale })
    } catch (error: unknown) {
      report.failed += 1
      failures.push(`propose ${memoryId}: ${String(error)}`)
    }
  }
  await deps.audit({
    reason: failures.length === 0 ? 'project distillation applied' : 'project distillation applied with failures',
    details: {
      distilled: report.distilled, droppedPrivacy: report.droppedPrivacy, droppedDepartment: report.droppedDepartment,
      skippedDuplicate: report.skippedDuplicate, failed: report.failed,
      ...(proposals.length === 0 ? {} : { proposals }),
      ...(failures.length === 0 ? {} : { failures }),
    },
  })
  return { orgId: input.orgId, projectId: input.projectId, ...report, at }
}
