/**
 * Domain types and the `EmployeeAccounts` service interface for persistent
 * digital employees. The store row types stay internal to
 * `@deepseek-ai/dsh-enterprise-identity`; consumers see only these.
 *
 * @module @deepseek-ai/dsh-employee-account/types
 */

import type { InboxRow } from '@deepseek-ai/dsh-enterprise-identity'
import type { EmployeeId, InboxItemId, SurfaceId } from './ids.ts'

/** Lifecycle of one persistent employee account; archived is terminal. */
export type EmployeeState = 'active' | 'suspended' | 'archived'

/** One persistent digital employee account. */
export interface EmployeeAccount {
  /** Durable employee identifier. */
  readonly id: EmployeeId
  /** Owning organization identifier. */
  readonly orgId: string
  /** Human-readable employee name shown on enterprise surfaces. */
  readonly displayName: string
  /** Role-card preset text that seeds the employee's system persona. */
  readonly roleCard: string
  /** Catalog release currently serving the employee, when one is active. */
  readonly activeReleaseId?: string
  /** Current lifecycle state. */
  readonly state: EmployeeState
  /** Absolute filesystem path of the workspace the employee runs in. */
  readonly homeWorkspacePath: string
}

/** One message queued for an employee's direct-message inbox. */
export interface EmployeeInboxItem {
  /** Durable inbox item identifier. */
  readonly id: InboxItemId
  /** Employee the item is queued for. */
  readonly employeeId: EmployeeId
  /** Direct-message surface the item arrived on. */
  readonly surfaceId: SurfaceId
  /** Opaque key of the actor that originated the message. */
  readonly originActor: string
  /** Message text delivered to the employee. */
  readonly payloadText: string
  /**
   * Delivery state; derived from the durable `InboxRow` so the service
   * vocabulary and the stored column cannot drift.
   */
  readonly state: InboxRow['state']
}

/** Actor one anchored session resolves for memory-compartment work. Dm sessions carry the full
 * (user, employee) pair that owns the private compartments; group member sessions carry only
 * their employee; channel topic sessions carry no principal identity. `projectId` is present
 * when the anchoring surface is bound to a project, and consumers gate project-scoped work on
 * their own membership check. */
export interface SessionMemoryActor {
  /** Organization the surface belongs to. */
  readonly orgId: string
  /** User on the surface's (user, employee) pair; owns the `pair` compartment. Absent for group
   * and channel anchors, which bind no dm pair. */
  readonly userId?: string
  /** Employee account serving the session; owns the `agent` compartment. Absent for channel
   * topic sessions, whose anchoring stores no employee. */
  readonly employeeId?: string
  /** Project the anchoring surface is bound to, when any. */
  readonly projectId?: string
}

/** Inputs for creating one employee account. */
export interface CreateEmployeeAccountInput {
  /** Owning organization identifier. */
  readonly orgId: string
  /** Human-readable employee name; must not be empty. */
  readonly displayName: string
  /** Role-card preset text; must not be empty. */
  readonly roleCard: string
  /** Absolute filesystem path of the workspace the employee runs in. */
  readonly homeWorkspacePath: string
  /** Catalog release to activate at creation, when one is already published. */
  readonly activeReleaseId?: string
}

/** Inputs for queueing one employee inbox item. */
export interface EnqueueEmployeeInboxInput {
  /** Employee the item is queued for; the account must exist. */
  readonly employeeId: EmployeeId
  /** Direct-message surface the item arrived on; the surface row must exist. */
  readonly surfaceId: SurfaceId
  /** Opaque key of the actor that originated the message. */
  readonly originActor: string
  /** Message text delivered to the employee. */
  readonly payloadText: string
}

/** Enterprise employee account service. */
export interface EmployeeAccounts {
  /**
   * Create one employee account in the active state with a fresh durable id.
   * @param input - organization, display name, role card, and home workspace.
   * @returns the created account.
   */
  create(input: CreateEmployeeAccountInput): EmployeeAccount
  /**
   * Read one employee account by id.
   * @param id - employee identifier.
   * @returns the stored account, or undefined when the id is unknown.
   */
  get(id: EmployeeId): EmployeeAccount | undefined
  /**
   * List one organization's employee accounts in creation order.
   * @param orgId - organization whose accounts are listed.
   * @param options - pass `includeArchived` to also return archived accounts.
   * @returns the matching accounts in creation order.
   */
  list(orgId: string, options?: { includeArchived?: boolean }): EmployeeAccount[]
  /**
   * Move one employee account to a new lifecycle state; archived is terminal.
   * @param id - employee identifier.
   * @param state - new lifecycle state.
   */
  setState(id: EmployeeId, state: EmployeeState): void
  /**
   * Bind one actor key to an employee account within one organization,
   * replacing any previous binding for the pair.
   * @param orgId - organization the actor key belongs to.
   * @param actorKey - opaque actor key whose requests stick to one employee.
   * @param id - employee identifier the actor key binds to.
   */
  bindSticky(orgId: string, actorKey: string, id: EmployeeId): void
  /**
   * Read the employee account an actor key is bound to within one organization.
   * @param orgId - organization the actor key belongs to.
   * @param actorKey - opaque actor key to resolve.
   * @returns the bound employee identifier, or undefined when the key is unbound.
   */
  resolveSticky(orgId: string, actorKey: string): EmployeeId | undefined
  /**
   * Queue one inbox item for an employee in the queued state with a fresh
   * durable id. The caller owns surface-employee org consistency; the
   * composing surfaces are org-scoped by construction.
   * @param input - employee, surface, origin actor, and message text.
   * @returns the created inbox item.
   */
  enqueue(input: EnqueueEmployeeInboxInput): EmployeeInboxItem
  /**
   * Take an employee's queued inbox items in creation order and mark them
   * delivered.
   * @param employeeId - employee whose inbox is claimed.
   * @param limit - maximum number of items to take; passed through to the store.
   * @returns the claimed items in creation order.
   */
  claim(employeeId: EmployeeId, limit: number): EmployeeInboxItem[]
  /**
   * Read the employee account whose home workspace is one path. Matching is exact string
   * equality against the stored column, mirroring the workspace-grant root-path lookup; no
   * path normalization runs on either side.
   * @param homeWorkspacePath - absolute home workspace path to look up.
   * @returns the stored account, or undefined when no account claims that path.
   */
  findByHomeWorkspacePath(homeWorkspacePath: string): EmployeeAccount | undefined
  /**
   * Resolve the memory actor for one anchored session so compartment work can resolve at
   * process time without a schema change to outbox rows. Dm sessions resolve the full pair;
   * group member sessions resolve their employee and the surface's project; channel topic
   * sessions resolve only the surface's project.
   * @param sessionId - session id attached through `attachSurfaceSession`,
   *   `attachGroupSurfaceSession`, or `attachTopicSession`.
   * @returns the session's memory actor, or undefined when no surface anchors the session.
   */
  resolveSessionActor(sessionId: string): SessionMemoryActor | undefined
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Persistent employee account service used by enterprise composition and Agent tools. */
    employeeAccounts: EmployeeAccounts
  }
}
