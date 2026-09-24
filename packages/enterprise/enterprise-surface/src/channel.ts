/**
 * Channel-surface delivery: topic partitioning, duty routing, and announcement
 * intake. Interactive (`mention_duty`) channels partition conversation into
 * topics — one durable session per topic, anchored by its first routed
 * employee — and route each message to the @-mentioned member employees or
 * the duty roster head. Ingest-only channels never steer a session: with an
 * extraction route and the `llm` service mounted, every message is distilled
 * into at most three organization-scope memory proposals (privacy-blocked
 * candidates counted, not proposed); otherwise the message becomes one
 * truncated proposal through the lazily mounted enterprise identity store,
 * dropped as a structured result when the privacy gate rejects it.
 *
 * @module @deepseek-ai/dsh-enterprise-surface/channel
 */

import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import {
  employeeId,
  surfaceId,
  type EmployeeAccount,
  type EmployeeId,
  type SurfaceId,
} from '@deepseek-ai/dsh-employee-account'
import {
  channelSurfaceByExternalKey,
  attachTopicSession,
  channelTopic,
  classifyPrivacyForScope,
  dutyRoster,
  ensureChannelSurface as ensureChannelSurfaceRow,
  ensureTopic,
  inspectEnterpriseMemory,
  listSurfaces as listSurfaceRows,
  memorySourceDigest,
  settleTopic,
  setSurfaceMembers,
  surfaceById,
  surfaceMembers,
  type ChannelSurfaceRow,
  type ChannelTopicRow,
  type EnterpriseIdentityStore,
  type GroupSurfaceRow,
  type SurfaceRow,
} from '@deepseek-ai/dsh-enterprise-identity'
import { createUserMessage, errorChain, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import {
  extractAnnouncementMemories, type ConsolidationLlm, type ConsolidationRefinementOptions,
} from '@deepseek-ai/dsh-enterprise-memory-context'
import { dmSurfaceFromRow } from './dm.ts'
import { GroupSurfaceRegistry, groupSurfaceFromRow, landedCount } from './group.ts'
import {
  EnterpriseSurfaceError,
  type ChannelDeliveryResult,
  type ChannelSurface,
  type EnterpriseSurfaces,
  type Surface,
  type SurfaceListEntry,
} from './types.ts'

/** Maximum characters of an announcement carried into its memory-proposal summary. */
export const MEMORY_ANNOUNCEMENT_SUMMARY_CHARS = 500

/** Maximum characters of an announcement carried into one extraction model call. Announcements
 * are short broadcast messages; the cap only bounds a pathological or hostile paste, and the
 * fallback summary cap stays independent at 500 characters. */
const ANNOUNCEMENT_EXTRACTION_INPUT_CHARS = 4_000

/** Maximum characters of a routed message carried into an auto-created topic title. */
const TOPIC_TITLE_CHARS = 40

/** Text recognizing the topic-creation command; the remainder of the line is the title. */
const TOPIC_COMMAND = '/topic'

/** Text recognizing the topic-settle command. */
const DONE_COMMAND = '/done'

/** Memory scope every channel announcement proposes into. */
const ANNOUNCEMENT_SCOPE = 'organization' as const

/** Memory kind every channel announcement proposes as. */
const ANNOUNCEMENT_KIND = 'business-fact' as const

/** Deterministic id of a lane channel's one surface-wide topic. */
function laneTopicId(surface: SurfaceId): string {
  return `${surface}:lane`
}

/** Capped summary of one announcement for its memory proposal. */
function announcementSummary(text: string): string {
  return text.trim().slice(0, MEMORY_ANNOUNCEMENT_SUMMARY_CHARS)
}

/** Topic title derived from the first routed message of a thread topic. */
function derivedTopicTitle(text: string): string {
  return text.trim().slice(0, TOPIC_TITLE_CHARS)
}

/** One recognized channel control command. */
type ChannelCommand =
  | { readonly kind: 'topic'; readonly title: string }
  | { readonly kind: 'done' }

/** Recognize the channel control commands; text that starts no command returns undefined. */
function parseCommand(text: string): ChannelCommand | undefined {
  const trimmed = text.trim()
  if (trimmed === DONE_COMMAND) return { kind: 'done' }
  if (trimmed === TOPIC_COMMAND) return { kind: 'topic', title: '' }
  if (trimmed.startsWith(`${TOPIC_COMMAND} `)) {
    return { kind: 'topic', title: trimmed.slice(TOPIC_COMMAND.length).trim() }
  }
  return undefined
}

/** Parse one stored channel-surface row into its surface value. */
export function channelSurfaceFromRow(row: ChannelSurfaceRow): ChannelSurface {
  return {
    id: surfaceId(row.id),
    kind: 'channel',
    orgId: row.orgId,
    name: row.name,
    topicPolicy: row.topicPolicy,
    respondPolicy: row.respondPolicy,
    ...(row.projectId === undefined ? {} : { projectId: row.projectId }),
  }
}

/** Parse any stored surface row into its surface value, dispatching on the stored kind. */
function surfaceValueFromRow(row: SurfaceRow | GroupSurfaceRow | ChannelSurfaceRow): Surface {
  if (row.kind === 'dm') return dmSurfaceFromRow(row)
  if (row.kind === 'group') return groupSurfaceFromRow(row)
  return channelSurfaceFromRow(row)
}

/** Routing and budget of one announcement-extraction model call, resolved once per composition.
 * An empty provider or model keeps intake on the truncated fallback. */
export interface AnnouncementExtractionOptions {
  /** Registered provider route selecting the adapter instance. */
  readonly provider: string
  /** Model the extraction call runs on. */
  readonly model: string
  /** Maximum output tokens for one extraction call. */
  readonly maxTokens: number
  /** Wall-clock timeout for one extraction call, carried by the request abort signal. */
  readonly timeoutMs: number
}

/** Default intake options: no extraction route, so every announcement takes the P2 fallback. */
const DEFAULT_EXTRACTION_OPTIONS: AnnouncementExtractionOptions = {
  provider: '', model: '', maxTokens: 1_024, timeoutMs: 60_000,
}

/**
 * Registry adding channel surfaces to the group registry. Interactive
 * channels steer one session per topic; ingest-only channels propose
 * announcements into organization-scope memory through the `enterprisePostgres`
 * identity store, resolved lazily so deployments without memory report
 * `memory-unavailable` instead of failing. With an extraction route configured
 * and the `llm` service mounted, intake first extracts up to three durable
 * candidates and falls back to the single truncated proposal whenever the
 * extraction is unavailable or fails.
 */
export class ChannelSurfaceRegistry extends GroupSurfaceRegistry implements EnterpriseSurfaces {
  /** Swallowed work tails per topic, serializing session creation and steering in queued order. */
  private readonly topicTails = new Map<string, Promise<void>>()

  /**
   * @param ctx - harness context owning the anchored sessions and the injected agent-host services.
   * @param database - migrated enterprise identity database; the composition owns its lifecycle.
   * @param defaultAgentPreset - preset composed into every anchored session this registry creates.
   * @param extractionOptions - routing of the announcement-extraction model call; defaults to none.
   */
  constructor(
    ctx: Context,
    database: DatabaseSync,
    defaultAgentPreset: string,
    private readonly extractionOptions: AnnouncementExtractionOptions = DEFAULT_EXTRACTION_OPTIONS,
  ) {
    super(ctx, database, defaultAgentPreset)
  }

  // oxlint-disable-next-line typescript/require-await -- async keeps roster validation a rejection, not a synchronous throw
  async ensureChannelSurface(input: {
    orgId: string
    name: string
    externalKey?: string
    memberEmployeeIds: readonly EmployeeId[]
    topicPolicy: 'thread' | 'command' | 'lane'
    respondPolicy: 'mention_duty' | 'ingest_only'
    dutyEmployeeIds: readonly EmployeeId[]
    projectId?: string
  }): Promise<ChannelSurface> {
    const members = [...new Set(input.memberEmployeeIds)]
    for (const member of members) this.requireEmployeeInOrg(member, input.orgId)
    for (const duty of input.dutyEmployeeIds) this.requireEmployeeInOrg(duty, input.orgId)
    const row = ensureChannelSurfaceRow(this.database, {
      id: surfaceId(randomUUID()),
      orgId: input.orgId,
      name: input.name,
      ...(input.externalKey === undefined ? {} : { externalKey: input.externalKey }),
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
      topicPolicy: input.topicPolicy,
      respondPolicy: input.respondPolicy,
      dutyEmployeeIds: input.dutyEmployeeIds,
      createdAt: Date.now(),
    })
    // The stored member set always mirrors the latest ensure call, so roster
    // and membership updates ride the same idempotent creation path.
    setSurfaceMembers(
      this.database,
      row.id,
      members.map(member => ({ principalType: 'employee' as const, principalId: member })),
    )
    return channelSurfaceFromRow(row)
  }

  async deliverToChannel(
    surface: Surface,
    input: { originUserId: string; text: string; mentionedEmployeeIds?: readonly EmployeeId[]; topicId?: string },
  ): Promise<ChannelDeliveryResult> {
    if (surface.kind !== 'channel') {
      throw new EnterpriseSurfaceError(
        'surface-kind-mismatch',
        `enterprise surface ${surface.id} is a ${surface.kind} surface, not a channel surface`,
      )
    }
    // Ingest-only answers every message — commands included — with a memory
    // proposal; topic and duty routing never runs.
    if (surface.respondPolicy === 'ingest_only') return this.intakeAnnouncement(surface, input)
    const command = parseCommand(input.text)
    if (command?.kind === 'done') return this.settleCurrentTopic(surface, input)
    if (command?.kind === 'topic' && command.title === '') {
      return { delivered: false, reason: 'invalid-command' }
    }
    const targets = this.resolveRoutedTargets(surface, input)
    const anchor = targets[0]
    if (anchor === undefined) return { delivered: false, reason: 'no-target' }
    const topic = this.resolveTopicRow(surface, input, command)
    if (topic === undefined) return { delivered: false, reason: 'no-topic' }
    if (topic.state !== 'open') return { delivered: false, reason: 'already-settled' }
    return this.runInTail(this.topicTails, topic.topicId, () =>
      this.steerRouted(surface, topic, anchor, targets, input))
  }

  /**
   * Propose the announcement as organization-scope memory entries. With an
   * extraction route configured and the `llm` service mounted, the announcement
   * first goes through the shared extractor: every candidate is
   * privacy-classified for the organization scope, blocked candidates are
   * counted instead of proposed, and survivors land as proposals with
   * deterministic ids so a repeated announcement converges on its rows. Any
   * extraction failure — unmounted service, stream failure, malformed output —
   * falls back to the exact pre-extraction behavior: one truncated proposal
   * behind the whole-announcement privacy gate.
   */
  private async intakeAnnouncement(
    surface: ChannelSurface,
    input: { originUserId: string; text: string },
  ): Promise<ChannelDeliveryResult> {
    const summary = announcementSummary(input.text)
    // A trimmed-empty announcement has no summary to propose; reject it before
    // the memory plane answers with a store-side validation failure.
    if (summary === '') return { delivered: false, reason: 'invalid-text' }
    const identity = this.memoryIdentity()
    if (identity === undefined) return { delivered: false, reason: 'memory-unavailable' }
    const extracted = await this.extractAnnouncementProposals(surface, input)
    if (extracted !== undefined) return extracted
    // The privacy gate classifies before the store runs, so a gated announcement is
    // a structured drop instead of a failed write; `proposeMemory` re-runs the
    // inspection itself, and its scope classification stays in parity with this
    // call because the announcement scope is the fixed organization constant.
    const inspection = inspectEnterpriseMemory(summary)
    if (!classifyPrivacyForScope(inspection.findings, ANNOUNCEMENT_SCOPE).allowed) {
      return { delivered: false, reason: 'privacy-gated' }
    }
    try {
      const entry = await identity.proposeMemory({
        id: randomUUID(),
        orgId: surface.orgId,
        scope: ANNOUNCEMENT_SCOPE,
        kind: ANNOUNCEMENT_KIND,
        summary,
        // The digest pins the announcement's source material without storing it.
        sourceDigest: memorySourceDigest(JSON.stringify([surface.orgId, surface.id, input.originUserId, summary])),
        createdBy: input.originUserId,
      })
      return { delivered: true, mode: 'ingested', proposedMemoryIds: [entry.id], droppedPrivacy: 0 }
    } catch (error: unknown) {
      return { delivered: false, reason: 'intake-failed', error: errorChain(error) }
    }
  }

  /**
   * Extract durable candidates from the announcement and propose the survivors.
   * Returns undefined — without touching the store — whenever extraction is not
   * in play: no configured route, no mounted `llm` service, or a failed or
   * malformed refinement call. The caller falls back to the truncated proposal.
   */
  private async extractAnnouncementProposals(
    surface: ChannelSurface,
    input: { originUserId: string; text: string },
  ): Promise<ChannelDeliveryResult | undefined> {
    if (this.extractionOptions.provider === '' || this.extractionOptions.model === '') return undefined
    const identity = this.memoryIdentity()
    const llm = this.ctx.get.bind(this.ctx)('llm') as ConsolidationLlm | undefined
    if (identity === undefined || llm === undefined) return undefined
    const options: ConsolidationRefinementOptions = {
      provider: this.extractionOptions.provider,
      model: this.extractionOptions.model,
      maxTokens: this.extractionOptions.maxTokens,
      timeoutMs: this.extractionOptions.timeoutMs,
      plugin: 'enterprise-surface',
    }
    const outcomes = await extractAnnouncementMemories(
      llm, input.text.slice(0, ANNOUNCEMENT_EXTRACTION_INPUT_CHARS), ANNOUNCEMENT_SCOPE, options,
    )
    if (outcomes === undefined) return undefined
    const proposedMemoryIds: string[] = []
    let droppedPrivacy = 0
    for (const outcome of outcomes) {
      if (outcome.dropped === 'privacy') {
        droppedPrivacy += 1
        continue
      }
      const { summary } = outcome.candidate
      const sourceDigest = memorySourceDigest(JSON.stringify([surface.orgId, surface.id, input.originUserId, summary]))
      const id = `announcement-memory-${sourceDigest}`
      const standing = (await identity.listMemories({ orgId: surface.orgId, statuses: ['proposed', 'approved'] }))
        .find(row => row.id === id)
      if (standing !== undefined) {
        proposedMemoryIds.push(id)
        continue
      }
      try {
        const entry = await identity.proposeMemory({
          id,
          orgId: surface.orgId,
          scope: ANNOUNCEMENT_SCOPE,
          kind: outcome.candidate.kind,
          summary,
          sourceDigest,
          createdBy: input.originUserId,
        })
        proposedMemoryIds.push(entry.id)
      } catch (error: unknown) {
        // A store failure mid-batch surfaces as the structured intake failure;
        // already-proposed siblings stand as ordinary proposals awaiting review.
        return { delivered: false, reason: 'intake-failed', error: errorChain(error) }
      }
    }
    return { delivered: true, mode: 'ingested', proposedMemoryIds, droppedPrivacy }
  }

  /** Resolve the lazily mounted enterprise identity store; absent means announcements cannot intake. */
  private memoryIdentity(): EnterpriseIdentityStore | undefined {
    const postgres = (this.ctx.get.bind(this.ctx) as (name: string) => unknown)('enterprisePostgres') as
      | { identity?: EnterpriseIdentityStore }
      | undefined
    return postgres?.identity
  }

  /**
   * List one organization's stored surfaces in creation order, optionally narrowed to one kind.
   * Member counts read the stored member rows; dm surfaces store none and stay dm-specific.
   */
  listSurfaces(input: {
    orgId: string
    kind?: Surface['kind']
  }): Promise<readonly SurfaceListEntry[]> {
    return Promise.resolve(listSurfaceRows(this.database, input.orgId, input.kind).map(row => ({
      surface: surfaceValueFromRow(row),
      memberCount: row.kind === 'dm' ? 0 : surfaceMembers(this.database, row.id).length,
    })))
  }

  /**
   * Read one stored surface by id within one organization; unknown and cross-organization ids
   * both resolve nothing so callers can fold existence behind one 404.
   */
  findSurface(input: { orgId: string; surfaceId: SurfaceId }): Promise<Surface | undefined> {
    const row = surfaceById(this.database, input.surfaceId)
    if (row === undefined || row.orgId !== input.orgId) return Promise.resolve(undefined)
    return Promise.resolve(surfaceValueFromRow(row))
  }

  /**
   * Read the one channel surface bound to an external key. The deployment token owns the
   * organization scope on the inbound path, so the key alone addresses the surface; the store
   * fails loud when several organizations bound the same key.
   */
  findChannelByExternalKey(input: { externalKey: string }): Promise<ChannelSurface | undefined> {
    const row = channelSurfaceByExternalKey(this.database, input.externalKey)
    return Promise.resolve(row === undefined ? undefined : channelSurfaceFromRow(row))
  }

  /** Resolve the employees a routed message addresses: mentioned members first, then the duty roster head. */
  private resolveRoutedTargets(
    surface: ChannelSurface,
    input: { text: string; mentionedEmployeeIds?: readonly EmployeeId[] },
  ): EmployeeAccount[] {
    const mentioned = this.mentionedMembers(surface, input.text, input.mentionedEmployeeIds)
    if (mentioned.length > 0) return mentioned
    const [duty] = dutyRoster(this.database, surface.id)
    return duty === undefined ? [] : [this.requireEmployeeInOrg(employeeId(duty), surface.orgId)]
  }

  /**
   * Resolve or create the topic row a routed message belongs to; undefined
   * means the message names no resolvable topic of this surface. Lane
   * channels pin every message — topic commands included — to their one
   * topic; `/topic` titles override auto-derived names on the other policies.
   */
  private resolveTopicRow(
    surface: ChannelSurface,
    input: { originUserId: string; text: string; topicId?: string },
    command: { readonly kind: 'topic'; readonly title: string } | undefined,
  ): ChannelTopicRow | undefined {
    const base = {
      surfaceId: surface.id,
      createdBy: input.originUserId,
      createdAt: Date.now(),
    }
    if (surface.topicPolicy === 'lane') {
      return this.ownTopic(surface, ensureTopic(this.database, {
        ...base, topicId: laneTopicId(surface.id), title: surface.name,
      }))
    }
    if (command !== undefined) {
      return this.ownTopic(surface, ensureTopic(this.database, {
        ...base, topicId: input.topicId ?? randomUUID(), title: command.title,
      }))
    }
    if (surface.topicPolicy === 'thread') {
      return this.ownTopic(surface, ensureTopic(this.database, {
        ...base, topicId: input.topicId ?? randomUUID(), title: derivedTopicTitle(input.text),
      }))
    }
    // Command policy: topics exist only through `/topic`, so an unpinned
    // plain message names no topic.
    return input.topicId === undefined ? undefined : this.surfaceTopic(surface, input.topicId)
  }

  /** Keep an ensured topic only when it belongs to this surface. */
  private ownTopic(surface: ChannelSurface, topic: ChannelTopicRow): ChannelTopicRow | undefined {
    return topic.surfaceId === surface.id ? topic : undefined
  }

  /** Read the topic of this surface named by an id; a foreign or unknown id resolves nothing. */
  private surfaceTopic(surface: ChannelSurface, topicId: string): ChannelTopicRow | undefined {
    const topic = channelTopic(this.database, topicId)
    return topic?.surfaceId === surface.id ? topic : undefined
  }

  /** Settle the command's topic and record the settle in its session when one exists. */
  private async settleCurrentTopic(
    surface: ChannelSurface,
    input: { originUserId: string; topicId?: string },
  ): Promise<ChannelDeliveryResult> {
    if (input.topicId === undefined) return { delivered: false, reason: 'no-topic' }
    const topic = this.surfaceTopic(surface, input.topicId)
    if (topic === undefined) return { delivered: false, reason: 'no-topic' }
    if (topic.state !== 'open') return { delivered: false, reason: 'already-settled' }
    // The store row settles first and stays the authoritative trace; the
    // session marker is the second, best-effort trace.
    settleTopic(this.database, topic.topicId, Date.now())
    return this.runInTail(this.topicTails, topic.topicId, () => this.markSettled(surface, topic.topicId, input.originUserId))
  }

  /**
   * Steer the settle marker into the settled topic's live session. The settle
   * is already committed, so a marker that cannot land only warns.
   */
  private async markSettled(
    surface: ChannelSurface,
    topicId: string,
    originActor: string,
  ): Promise<ChannelDeliveryResult> {
    // Re-read inside the topic tail so a session created by an earlier queued
    // routing pass still receives the marker.
    const stored = channelTopic(this.database, topicId)?.sessionId
    const sessionId = stored === undefined ? undefined : brandString<SessionId>(stored)
    if (sessionId === undefined || this.ctx.agents.get(sessionId) === undefined) {
      return { delivered: true, mode: 'settled', topicId }
    }
    try {
      await this.steerAndConfirm(sessionId, surface, originActor, topicId, DONE_COMMAND)
      return { delivered: true, mode: 'settled', topicId, sessionId }
    } catch (error: unknown) {
      this.ctx.logger.warn(`enterprise channel: settle marker for topic ${topicId} failed: ${errorChain(error)}`)
      return { delivered: true, mode: 'settled', topicId }
    }
  }

  /** Steer the routed message into the topic's one session, creating that session once for the topic. */
  private async steerRouted(
    surface: ChannelSurface,
    topic: ChannelTopicRow,
    anchor: EmployeeAccount,
    targets: readonly EmployeeAccount[],
    input: { originUserId: string; text: string },
  ): Promise<ChannelDeliveryResult> {
    try {
      const sessionId = await this.ensureTopicSession(topic.topicId, anchor)
      await this.steerAndConfirm(sessionId, surface, input.originUserId, topic.topicId, input.text)
      return {
        delivered: true,
        mode: 'routed',
        topicId: topic.topicId,
        sessionId,
        employeeIds: targets.map(target => target.id),
      }
    } catch (error: unknown) {
      return { delivered: false, reason: 'routing-failed', error: errorChain(error) }
    }
  }

  /**
   * Reuse the topic's stored session, creating and binding it once per topic.
   * Runs inside the topic's serialized tail, so this check-then-attach pair
   * sees every earlier creation and concurrent first messages share one
   * session; a failed attempt stays unbound and is retried by the next routed
   * message for the topic. The anchored employee owns the session's home
   * workspace; later contributors attribute through their message's
   * `originActor`.
   */
  private async ensureTopicSession(topicId: string, anchor: EmployeeAccount): Promise<SessionId> {
    const stored = channelTopic(this.database, topicId)?.sessionId
    if (stored !== undefined) return brandString<SessionId>(stored)
    return this.createAnchoredSession(
      anchor,
      'employee-topic',
      (sessionId) => { attachTopicSession(this.database, topicId, sessionId) },
    )
  }

  /**
   * Steer one message into a live topic session and confirm its durable
   * landing: the appended user message or a still-pending spliced copy
   * counts, and a cancellation splice un-lands the message.
   */
  private async steerAndConfirm(
    sessionId: SessionId,
    surface: ChannelSurface,
    originActor: string,
    topicId: string,
    text: string,
  ): Promise<void> {
    const agent = this.ctx.agents.get(sessionId)
    if (agent === undefined) {
      throw new EnterpriseSurfaceError(
        'session-not-live',
        `topic session ${sessionId} of enterprise surface ${surface.id} is not live`,
      )
    }
    const session: Session = agent.session
    const fromChannel = (message: UserMessage): boolean =>
      message.source.kind === 'surface-message'
      && message.source.surfaceId === surface.id
      && message.source.originActor === originActor
      && message.source.topicId === topicId
    const landedBefore = landedCount(session, fromChannel)
    agent.steer(createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'surface-message', surfaceId: surface.id, originActor, topicId },
    }))
    await this.ctx.sessions.flush(session)
    if (landedCount(session, fromChannel) === landedBefore) {
      throw new EnterpriseSurfaceError(
        'delivery-not-landed',
        `enterprise channel message from ${originActor} did not land in topic session ${sessionId}`,
      )
    }
  }
}
