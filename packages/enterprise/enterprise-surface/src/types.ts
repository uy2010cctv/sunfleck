/**
 * Domain contract for the enterprise conversation-surface registry. A surface
 * is one durable inbound conversation endpoint bound to a persistent employee;
 * delivery carries an authenticated message into the employee's anchored
 * session.
 *
 * @module @deepseek-ai/dsh-enterprise-surface/types
 */

import type { EnterpriseTeamRun, EnterpriseTeamRunSource } from '@deepseek-ai/dsh-enterprise-operations'
import type { EmployeeId, InboxItemId, SurfaceId } from '@deepseek-ai/dsh-employee-account'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** Closed set of enterprise-surface failures, discriminable without message parsing. */
export type EnterpriseSurfaceErrorCode =
  /** The employee id is unknown to the account service. */
  | 'employee-missing'
  /** The employee account belongs to another organization than the request. */
  | 'employee-cross-org'
  /** The surface kind cannot serve the requested delivery. */
  | 'surface-kind-mismatch'
  /** The surface carries no anchored session id. */
  | 'surface-session-missing'
  /** The anchored session id has no live agent in this process. */
  | 'session-not-live'
  /** The steered message never became visible or durably pending in the session log. */
  | 'delivery-not-landed'
  /** This call's enqueued item vanished from the claimed queue. */
  | 'inbox-item-vanished'
  /** A federated group surface carries no member employee. */
  | 'group-members-missing'

/** One enterprise-surface operation failure; map `code` to transport status without parsing text. */
export class EnterpriseSurfaceError extends Error {
  constructor(readonly code: EnterpriseSurfaceErrorCode, message: string) { super(message) }
}

/** One durable dm conversation surface bound to one user-employee pair. */
export interface DmSurface {
  readonly id: SurfaceId
  readonly kind: 'dm'
  readonly orgId: string
  readonly userId: string
  readonly employeeId: EmployeeId
  /** Live session anchored to the surface, present once `ensureDm` created it. */
  readonly sessionId?: SessionId
}

/** One durable group conversation surface routing member employees or one chartered team. */
export interface GroupSurface {
  readonly id: SurfaceId
  readonly kind: 'group'
  readonly orgId: string
  /** Human-facing group name stored on the surface row. */
  readonly name: string
  /** Chartered team this group routes to; present means team-mode delivery. */
  readonly teamDefinitionId?: string
  /** Project the group collaborates on, when the group is project-bound. */
  readonly projectId?: string
}

/** How one channel surface decides the topic a routed message belongs to. */
export type ChannelTopicPolicy =
  /** The transport pins messages to topics; a routed message without one auto-creates a topic titled by its first 40 characters. */
  | 'thread'
  /** Topics exist only through the `/topic 标题` command; unpinned messages without a topic stay undelivered. */
  | 'command'
  /** The whole channel is one topic, titled by the channel name; per-message topic ids are ignored. */
  | 'lane'

/** How one channel surface answers a routed message. */
export type ChannelRespondPolicy =
  /** Route to the @-mentioned member employees, falling back to the duty roster head. */
  | 'mention_duty'
  /** Announcements only: every message becomes one organization-scope memory proposal; no session is steered. */
  | 'ingest_only'

/** One durable channel conversation surface partitioned into topics. */
export interface ChannelSurface {
  readonly id: SurfaceId
  readonly kind: 'channel'
  readonly orgId: string
  /** Human-facing channel name stored on the surface row. */
  readonly name: string
  /** Policy deciding the topic of a routed message. */
  readonly topicPolicy: ChannelTopicPolicy
  /** Policy deciding the answer a routed message gets. */
  readonly respondPolicy: ChannelRespondPolicy
  /** Project the channel collaborates on, when the channel is project-bound. */
  readonly projectId?: string
}

/** One durable conversation surface. */
export type Surface = DmSurface | GroupSurface | ChannelSurface

/** Source of a user message delivered from one enterprise conversation surface. */
export interface SurfaceMessageSource {
  readonly kind: 'surface-message'
  /** Surface the inbound message arrived on. */
  readonly surfaceId: SurfaceId
  /**
   * Durable inbox item the delivery fulfilled. Present for dm deliveries that
   * enqueue and claim an inbox row; absent for federated group deliveries,
   * which steer the member session directly and keep no inbox row.
   */
  readonly inboxItemId?: InboxItemId
  /** Opaque key of the authenticated actor that originated the message. */
  readonly originActor: string
  /**
   * Channel topic the message belongs to. Present for channel deliveries,
   * which steer one session per topic; absent for dm and group deliveries.
   */
  readonly topicId?: string
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Producer attribution for the recorded message blocks.
     * @persistenceAttribution
     */
    'surface-message': SurfaceMessageSource
  }
}

/** One federated destination: one member employee and its group-session outcome. */
export interface GroupEmployeeTarget {
  readonly kind: 'employee'
  readonly employeeId: EmployeeId
  /** Group session the message steered; absent when no session could serve the member. */
  readonly sessionId?: SessionId
  readonly delivered: boolean
  /** Captured per-target failure; the batch continues past a failed target. */
  readonly error?: string
}

/** One chartered-team destination: the TeamRun the input was submitted to. */
export interface GroupTeamRunTarget {
  readonly kind: 'team-run'
  readonly runId: string
  readonly delivered: boolean
}

/** One delivery destination with its per-destination outcome. */
export type GroupDeliveryTarget = GroupEmployeeTarget | GroupTeamRunTarget

/** Outcome of one group-surface delivery. Structured: callers map it to a transport response without catching. */
export type GroupDeliveryResult =
  | {
    readonly delivered: true
    /** `team` submitted one chartered-team run input; `federated` steered member group sessions. */
    readonly mode: 'team' | 'federated'
    readonly targets: readonly GroupDeliveryTarget[]
  }
  | {
    readonly delivered: false
    /** No member employee matched the mention rules. */
    readonly reason: 'no-target'
  }
  | {
    readonly delivered: false
    /** The team control plane or runtime driver is not mounted in this process. */
    readonly reason: 'team-runtime-unavailable'
  }
  | {
    readonly delivered: false
    /** The resolved team control plane failed to reuse, start, or submit the run. */
    readonly reason: 'team-run-failed'
    /** Root cause chain of the failed team operation. */
    readonly error: string
  }

/** One delivered channel message routed into its topic session. */
export interface ChannelRoutedDelivery {
  readonly delivered: true
  /** The message steered the topic session of the resolved topic. */
  readonly mode: 'routed'
  /** Topic the message routed into; the transport pins later messages with this id. */
  readonly topicId: string
  /** Topic session the message steered. */
  readonly sessionId: SessionId
  /** Employees the message addressed: the @-mentioned members, or the duty roster head. */
  readonly employeeIds: readonly EmployeeId[]
}

/** One `/done` command that settled its topic; the store row is the authoritative trace. */
export interface ChannelSettledDelivery {
  readonly delivered: true
  /** The topic settled and the session, when one existed, recorded the settle marker. */
  readonly mode: 'settled'
  /** Topic the command settled. */
  readonly topicId: string
  /** Topic session that received the landed settle marker; absent when the topic had no live session. */
  readonly sessionId?: SessionId
}

/** One announcement accepted into organization-scope memory. */
export interface ChannelIngestedDelivery {
  readonly delivered: true
  /** The message became memory proposals; no session exists on ingest-only channels. */
  readonly mode: 'ingested'
  /**
   * Ids of the memory proposals that stand after intake: one truncated-announcement proposal on
   * the fallback path, or one per extracted candidate on the extraction path. A candidate whose
   * deterministic id already stands is listed here without a second write.
   */
  readonly proposedMemoryIds: readonly string[]
  /**
   * Extracted candidates dropped by the scope-aware privacy gate instead of proposed; always 0
   * on the fallback path, which gates the whole announcement before proposing.
   */
  readonly droppedPrivacy: number
}

/** Outcome of one channel-surface delivery. Structured: callers map it to a transport response without catching. */
export type ChannelDeliveryResult =
  | ChannelRoutedDelivery
  | ChannelSettledDelivery
  | ChannelIngestedDelivery
  | {
    readonly delivered: false
    /** No member or duty employee matched the mention rules. */
    readonly reason: 'no-target'
  }
  | {
    readonly delivered: false
    /** No open topic on this surface resolves the message or command. */
    readonly reason: 'no-topic'
  }
  | {
    readonly delivered: false
    /** A `/topic` command carried no title. */
    readonly reason: 'invalid-command'
  }
  | {
    readonly delivered: false
    /** The message text carries no non-whitespace content, so no proposal or topic can be formed. */
    readonly reason: 'invalid-text'
  }
  | {
    readonly delivered: false
    /** The addressed topic already settled or archived, so it accepts neither routing nor a second settle. */
    readonly reason: 'already-settled'
  }
  | {
    readonly delivered: false
    /** The enterprise identity store backing memory is not mounted in this process. */
    readonly reason: 'memory-unavailable'
  }
  | {
    readonly delivered: false
    /**
     * The privacy gate rejected the truncated fallback proposal; it is dropped, not proposed.
     * The LLM extraction path drops gated candidates per candidate instead, reporting them in
     * `droppedPrivacy` while still delivering.
     */
    readonly reason: 'privacy-gated'
  }
  | {
    readonly delivered: false
    /** The memory proposal failed after the privacy gate allowed it. */
    readonly reason: 'intake-failed'
    /** Root cause chain of the failed proposal. */
    readonly error: string
  }
  | {
    readonly delivered: false
    /** The topic session could not be created, was not live, or the steer never landed. */
    readonly reason: 'routing-failed'
    /** Root cause chain of the failed routing. */
    readonly error: string
  }

/**
 * Chartered-team control-plane seam group delivery consumes, resolved lazily
 * under the `enterpriseTeamControl` service name. Implementations translate
 * these reads and the idempotent start onto the enterprise operations control
 * plane and own the charter-revision and run-Workspace choices a group
 * surface does not carry.
 */
export interface GroupTeamControl {
  /**
   * List one team's runs in the requested state.
   * @param input - organization, team, and run state to filter by.
   * @returns The matching runs, newest first.
   */
  listTeamRuns(input: {
    readonly orgId: string
    readonly teamId: string
    readonly state: EnterpriseTeamRun['state']
  }): Promise<readonly EnterpriseTeamRun[]>
  /**
   * Start, or idempotently reuse, one run for the team's active charter.
   * @param input - organization, team, originating user, prompt, recorded origin, and stable idempotency key.
   * @returns The started or reused run.
   */
  startRun(input: {
    readonly orgId: string
    readonly teamId: string
    readonly userId: string
    readonly prompt: string
    readonly source: EnterpriseTeamRunSource
    readonly idempotencyKey: string
  }): Promise<EnterpriseTeamRun>
}

/** One stored surface with its stored member count, the governance listing slice. */
export interface SurfaceListEntry {
  /** The stored surface value. */
  readonly surface: Surface
  /**
   * Stored member principals: group and channel surfaces count their
   * `surface_members` rows; dm surfaces store no member rows and always
   * report 0 — their bound user-employee pair is the surface itself.
   */
  readonly memberCount: number
}

/** Enterprise conversation surface registry and inbound delivery. */
export interface EnterpriseSurfaces {
  /**
   * Return the durable dm surface for one (user, employee) pair, creating it
   * and its anchored session on first call. Repeated calls return the same
   * surface and create the session at most once; concurrent calls for one pair
   * share one creation.
   * @param input - organization, channel user, and employee.
   * @returns the dm surface, with its anchored session id once attached.
   */
  ensureDm(input: { orgId: string; userId: string; employeeId: EmployeeId }): Promise<DmSurface>
  /**
   * Return the durable group surface keyed by the organization and external
   * key, creating it when absent and replacing its member set with the given
   * employee ids. The external key carries the idempotency: a call without
   * one always creates a new surface keyed by its fresh id. Keyed repeats
   * return the stored surface; group surfaces create no session at ensure
   * time.
   * @param input - organization, name, optional external key and project, the
   * member employees, and the chartered team for team-mode groups.
   * @returns the stored group surface.
   * @throws an `EnterpriseSurfaceError` when a federated group carries no
   * member employee, or a member is missing or belongs to another organization.
   */
  ensureGroupSurface(input: {
    orgId: string
    name: string
    externalKey?: string
    memberEmployeeIds: readonly EmployeeId[]
    teamDefinitionId?: string
    projectId?: string
  }): Promise<GroupSurface>
  /**
   * Return the durable channel surface keyed by the organization and external
   * key, creating it when absent and replacing its member set with the given
   * employee ids — the same idempotency as `ensureGroupSurface`. Keyed repeats
   * return the stored surface without rewriting its policies; duty roster
   * updates ride `setDutyRoster`. Channel surfaces create no session at ensure
   * time.
   *
   * Policy pairing: `respondPolicy: 'ingest_only'` makes the duty roster and
   * mention routing moot — every message becomes a memory proposal — so a
   * stored roster is allowed but inert. Every duty employee id must name an
   * employee of the organization.
   * @param input - organization, name, optional external key and project, the
   * member employees, both policies, and the duty roster in routing order.
   * @returns the stored channel surface.
   * @throws an `EnterpriseSurfaceError` when a duty employee is missing or
   * belongs to another organization.
   */
  ensureChannelSurface(input: {
    orgId: string
    name: string
    externalKey?: string
    memberEmployeeIds: readonly EmployeeId[]
    topicPolicy: ChannelTopicPolicy
    respondPolicy: ChannelRespondPolicy
    dutyEmployeeIds: readonly EmployeeId[]
    projectId?: string
  }): Promise<ChannelSurface>
  /**
   * Resolve the sticky employee for one channel actor.
   * @param orgId - organization the actor belongs to.
   * @param actorKey - opaque actor key of the channel participant.
   * @returns the sticky employee, or undefined while unbound.
   */
  stickyEmployee(orgId: string, actorKey: string): EmployeeId | undefined
  /**
   * Enqueue one authenticated inbound message and deliver it to the employee's anchored session.
   * @param surface - surface the message arrived on; its anchored session must be live.
   * @param originActor - opaque key of the authenticated actor that sent the message.
   * @param payloadText - message text delivered to the employee.
   * @returns the durable inbox item id delivered by this call.
   * @throws an `EnterpriseSurfaceError` when the surface is not a dm surface, the employee is missing or belongs
   * to another organization, the surface has no anchored session, the anchored
   * session is not live, or the delivery does not land in the session log; the
   * failed path also marks the inbox item failed. When an older queued item
   * fails mid-loop, the rejection names that older item while this call's item
   * stays queued. Underlying agent-host failures propagate unchanged after the
   * failing row is marked failed.
   */
  deliverToEmployee(surface: Surface, originActor: string, payloadText: string): Promise<InboxItemId>
  /**
   * Deliver one inbound group message. Team-mode surfaces submit the text into
   * the chartered team's active run, starting one with the given idempotency
   * key when none is active; federated surfaces steer the @-mentioned member
   * employees' group sessions. Group delivery never enqueues employee inbox
   * rows; the inbox stays dm-specific.
   * @param surface - surface the message arrived on.
   * @param input - originating user, message text, optional explicitly
   * mentioned employee ids, and the optional channel message id: passing it
   * makes a team-mode run start retry-safe (the same envelope reuses its
   * run), while omitting it starts every start-needing message its own run
   * and leaves transport-level dedup to the channel kernel.
   * @returns the structured delivery outcome; federated no-target and team
   * control failures come back as results, not rejections. Per-member steering
   * failures are captured on their targets while the rest of the batch lands.
   */
  deliverToGroup(
    surface: Surface,
    input: { originUserId: string; text: string; mentionedEmployeeIds?: readonly EmployeeId[]; messageId?: string },
  ): Promise<GroupDeliveryResult>
  /**
   * Deliver one inbound channel message. Ingest-only surfaces propose the
   * truncated text as one organization-scope memory announcement and never
   * touch a session. Interactive (`mention_duty`) surfaces resolve the topic
   * and the addressed employees, then steer the topic's one session:
   *
   * - `/done` settles the topic named by `topicId` and steers a settle marker
   *   into its session when one exists — the store row and the session log
   *   both record the settle. Without `topicId` the command is a `no-topic`
   *   result; on a settled or archived topic it is `already-settled`.
   * - `/topic 标题` ensures the topic titled by the command, under the given
   *   `topicId` or a fresh one. A bare `/topic` with no title is
   *   `invalid-command`.
   * - Plain messages resolve their topic by policy: `thread` uses the given
   *   `topicId` or auto-creates one titled by the message's first 40
   *   characters; `command` requires `topicId` naming an existing topic of
   *   this surface; `lane` routes into the one surface-wide topic titled by
   *   the channel name, ignoring `topicId`.
   *
   * Routing targets the @-mentioned members — explicit ids win over
   * display-name tokens, matching group delivery — and falls back to the duty
   * roster head for unaddressed messages. A topic session anchors to its
   * first routed employee's home workspace and the shared default preset;
   * later messages from other employees steer the same session and attribute
   * through the message's `originActor`. Topic sessions are created at most
   * once per topic even under concurrent first messages.
   * @param surface - surface the message arrived on.
   * @param input - originating user, message text, optional explicitly
   * mentioned employee ids, and the optional topic id the transport pinned
   * from a previous routed result.
   * @returns the structured delivery outcome; routing and intake failures
   * come back as results, not rejections. Unknown or cross-org employees and
   * a non-channel surface still reject, matching dm and group delivery.
   */
  deliverToChannel(
    surface: Surface,
    input: { originUserId: string; text: string; mentionedEmployeeIds?: readonly EmployeeId[]; topicId?: string },
  ): Promise<ChannelDeliveryResult>
  /**
   * List one organization's stored surfaces in creation order, optionally narrowed to one kind.
   * @param input - organization and the optional kind filter.
   * @returns The stored surfaces with their stored member counts.
   */
  listSurfaces(input: { orgId: string; kind?: Surface['kind'] }): Promise<readonly SurfaceListEntry[]>
  /**
   * Read one stored surface by id within one organization; unknown and
   * cross-organization ids both resolve nothing so callers can fold existence.
   * @param input - organization and surface id.
   * @returns The stored surface, or undefined when the id is missing or foreign.
   */
  findSurface(input: { orgId: string; surfaceId: SurfaceId }): Promise<Surface | undefined>
  /**
   * Read the one channel surface bound to an external key. The deployment token
   * owns the organization scope on the inbound path, so the key alone addresses
   * the surface; the store fails loud when several organizations bound the same key.
   * @param input - the transport-pinned external key.
   * @returns The stored channel surface, or undefined when the key is unbound.
   */
  findChannelByExternalKey(input: { externalKey: string }): Promise<ChannelSurface | undefined>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Enterprise conversation-surface registry and inbound delivery. */
    surfaces: EnterpriseSurfaces
  }
}
