/**
 * Domain contract for the enterprise conversation-surface registry. A surface
 * is one durable inbound conversation endpoint bound to a persistent employee;
 * delivery carries an authenticated message into the employee's anchored
 * session.
 *
 * @module @deepseek-ai/dsh-enterprise-surface/types
 */

import type { EmployeeId, InboxItemId, SurfaceId } from '@deepseek-ai/dsh-employee-account'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** Closed set of enterprise-surface failures, discriminable without message parsing. */
export type EnterpriseSurfaceErrorCode =
  /** The employee id is unknown to the account service. */
  | 'employee-missing'
  /** The employee account belongs to another organization than the request. */
  | 'employee-cross-org'
  /** The surface carries no anchored session id. */
  | 'surface-session-missing'
  /** The anchored session id has no live agent in this process. */
  | 'session-not-live'
  /** The steered message never became visible or durably pending in the session log. */
  | 'delivery-not-landed'
  /** This call's enqueued item vanished from the claimed queue. */
  | 'inbox-item-vanished'

/** One enterprise-surface operation failure; map `code` to transport status without parsing text. */
export class EnterpriseSurfaceError extends Error {
  constructor(readonly code: EnterpriseSurfaceErrorCode, message: string) { super(message) }
}

/** One durable conversation surface; P0 ships the dm kind only. */
export interface Surface {
  readonly id: SurfaceId
  readonly kind: 'dm'
  readonly orgId: string
  readonly userId: string
  readonly employeeId: EmployeeId
  /** Live session anchored to the surface, present once `ensureDm` created it. */
  readonly sessionId?: SessionId
}

/** Source of a user message delivered from one enterprise conversation surface. */
export interface SurfaceMessageSource {
  readonly kind: 'surface-message'
  /** Surface the inbound message arrived on. */
  readonly surfaceId: SurfaceId
  /** Durable inbox item the delivery fulfilled. */
  readonly inboxItemId: InboxItemId
  /** Opaque key of the authenticated actor that originated the message. */
  readonly originActor: string
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'surface-message': SurfaceMessageSource
  }
}

/** Enterprise conversation surface registry and inbound delivery. */
export interface EnterpriseSurfaces {
  /**
   * Return the durable dm surface for one (user, employee) pair, creating it
   * and its anchored session on first call. Repeated calls return the same
   * surface and create the session at most once; concurrent calls for one pair
   * share one creation.
   * @param input - organization, channel user, and employee.
   * @returns the surface, with its anchored session id once attached.
   */
  ensureDm(input: { orgId: string; userId: string; employeeId: EmployeeId }): Promise<Surface>
  /** Resolve the sticky employee for one channel actor. */
  stickyEmployee(orgId: string, actorKey: string): EmployeeId | undefined
  /**
   * Enqueue one authenticated inbound message and deliver it to the employee's anchored session.
   * @param surface - surface the message arrived on; its anchored session must be live.
   * @param originActor - opaque key of the authenticated actor that sent the message.
   * @param payloadText - message text delivered to the employee.
   * @returns the durable inbox item id delivered by this call.
   * @throws an `EnterpriseSurfaceError` when the employee is missing or belongs
   * to another organization, the surface has no anchored session, the anchored
   * session is not live, or the delivery does not land in the session log; the
   * failed path also marks the inbox item failed. When an older queued item
   * fails mid-loop, the rejection names that older item while this call's item
   * stays queued. Underlying agent-host failures propagate unchanged after the
   * failing row is marked failed.
   */
  deliverToEmployee(surface: Surface, originActor: string, payloadText: string): Promise<InboxItemId>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Enterprise conversation-surface registry and inbound delivery. */
    surfaces: EnterpriseSurfaces
  }
}
