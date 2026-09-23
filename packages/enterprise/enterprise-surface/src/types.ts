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

/** One durable conversation surface. The channel kind lands with channel delivery. */
export type Surface = DmSurface | GroupSurface

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
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
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
  /** Resolve the sticky employee for one channel actor. */
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
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Enterprise conversation-surface registry and inbound delivery. */
    surfaces: EnterpriseSurfaces
  }
}
