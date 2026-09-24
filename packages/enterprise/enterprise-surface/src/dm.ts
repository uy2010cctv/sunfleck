/**
 * `EnterpriseSurfaces` implementation for the dm kind: durable surfaces and
 * inbox rows come from the `@deepseek-ai/dsh-enterprise-identity` employee
 * store, account checks from `ctx.employeeAccounts`, and each surface anchors
 * one Workspace-backed session created through the same shape as the webhook
 * session runtime. Delivery submits the inbound message as steering input and
 * confirms the durable landing before the claimed inbox row counts as
 * delivered.
 *
 * @module @deepseek-ai/dsh-enterprise-surface/dm
 */

import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type {} from '@deepseek-ai/dsh-agent'
import { installInitialModelSelection } from '@deepseek-ai/dsh-agent-default-model'
import { pendingInboxMessages } from '@deepseek-ai/dsh-agent-loop/inbox'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import { brandString } from '@deepseek-ai/dsh-brand'
import {
  employeeId,
  surfaceId,
  type EmployeeAccount,
  type EmployeeAccounts,
  type EmployeeId,
  type EmployeeInboxItem,
  type InboxItemId,
} from '@deepseek-ai/dsh-employee-account'
import { attachSurfaceSession, ensureSurface, failInboxItem } from '@deepseek-ai/dsh-enterprise-identity'
import type { SurfaceRow } from '@deepseek-ai/dsh-enterprise-identity'
import { createUserMessage, errorChain, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-workspace'
import { EnterpriseSurfaceError, type DmSurface, type Surface } from './types.ts'

/** Log a rollback failure without replacing the operation's original failure. */
function reportRollbackFailure(ctx: Context, subject: string, error: unknown): void {
  ctx.logger.warn(`enterprise surface: ${subject} rollback failed: ${errorChain(error)}`)
}

/** Parse one stored dm surface row into its surface value; the anchored session stays absent while unbound. */
export function dmSurfaceFromRow(row: SurfaceRow): DmSurface {
  return {
    id: surfaceId(row.id),
    kind: 'dm',
    orgId: row.orgId,
    userId: row.userId,
    employeeId: employeeId(row.employeeId),
    ...(row.sessionId === null ? {} : { sessionId: brandString<SessionId>(row.sessionId) }),
  }
}

/** Registry of durable dm surfaces and inbound delivery into anchored employee sessions. */
export class DmSurfaceRegistry {
  /** Swallowed delivery tails per employee, serializing claim-and-deliver passes in queued order. */
  private readonly deliveryTails = new Map<string, Promise<void>>()
  /** Swallowed creation tails per (user, employee) pair, serializing session creation. */
  private readonly pairCreationTails = new Map<string, Promise<void>>()

  /**
   * @param ctx - harness context owning the anchored sessions and the injected agent-host services.
   * @param database - migrated enterprise identity database; the composition owns its lifecycle.
   * @param defaultAgentPreset - preset composed into every anchored session this registry creates.
   */
  constructor(
    protected readonly ctx: Context,
    protected readonly database: DatabaseSync,
    protected readonly defaultAgentPreset: string,
  ) {}

  protected get accounts(): EmployeeAccounts {
    return this.ctx.employeeAccounts
  }

  async ensureDm(input: { orgId: string; userId: string; employeeId: EmployeeId }): Promise<DmSurface> {
    const account = this.requireEmployeeInOrg(input.employeeId, input.orgId)
    return this.ensurePairSurface(input, account)
  }

  stickyEmployee(orgId: string, actorKey: string): EmployeeId | undefined {
    return this.accounts.resolveSticky(orgId, actorKey)
  }

  async deliverToEmployee(surface: Surface, originActor: string, payloadText: string): Promise<InboxItemId> {
    if (surface.kind !== 'dm') {
      throw new EnterpriseSurfaceError(
        'surface-kind-mismatch',
        `enterprise surface ${surface.id} is a ${surface.kind} surface, not a dm surface`,
      )
    }
    this.requireEmployeeInOrg(surface.employeeId, surface.orgId)
    if (surface.sessionId === undefined) {
      throw new EnterpriseSurfaceError(
        'surface-session-missing',
        `enterprise surface ${surface.id} has no anchored session`,
      )
    }
    const item = this.accounts.enqueue({
      employeeId: surface.employeeId, surfaceId: surface.id, originActor, payloadText,
    })
    const sessionId: SessionId = surface.sessionId
    return this.runInTail(this.deliveryTails, surface.employeeId, () => this.deliverQueued(sessionId, item))
  }

  /** Read one account and refuse a missing employee or one from another organization. */
  protected requireEmployeeInOrg(id: EmployeeId, orgId: string): EmployeeAccount {
    const account = this.accounts.get(id)
    if (account === undefined) {
      throw new EnterpriseSurfaceError('employee-missing', `enterprise employee ${id} is missing`)
    }
    if (account.orgId !== orgId) {
      throw new EnterpriseSurfaceError(
        'employee-cross-org',
        `enterprise employee ${id} cannot be bound under ${orgId} (belongs to ${account.orgId})`,
      )
    }
    return account
  }

  /**
   * Serialize one pair's surface creation so concurrent `ensureDm` calls mint
   * and anchor the session once instead of leaking the loser's live agent.
   */
  private async ensurePairSurface(
    input: { orgId: string; userId: string; employeeId: EmployeeId },
    account: EmployeeAccount,
  ): Promise<DmSurface> {
    const key = `${input.userId}:${input.employeeId}`
    return this.runInTail(this.pairCreationTails, key, () => this.ensurePairSurfaceNow(input, account))
  }

  /**
   * Run one unit of work behind a per-key tail so concurrent units for the
   * same key execute in queued order. The tail absorbs the work's rejection
   * so the chain survives; callers await the work's own result.
   */
  protected async runInTail<T>(tails: Map<string, Promise<void>>, key: string, work: () => Promise<T>): Promise<T> {
    const prior = tails.get(key) ?? Promise.resolve()
    /* v8 ignore next -- tails absorb rejection, so the recovery callback is a fail-safe backstop. */
    const run = prior.then(work, work)
    /* v8 ignore next -- work captures its own failures and runInTail itself does not throw. */
    const tail = run.then(() => undefined, () => undefined)
    tails.set(key, tail)
    try {
      return await run
    } finally {
      if (tails.get(key) === tail) tails.delete(key)
    }
  }

  /** Mint or read the pair's surface row and attach its missing session. */
  private async ensurePairSurfaceNow(
    input: { orgId: string; userId: string; employeeId: EmployeeId },
    account: EmployeeAccount,
  ): Promise<DmSurface> {
    const row = ensureSurface(this.database, {
      id: surfaceId(randomUUID()),
      orgId: input.orgId,
      kind: 'dm',
      userId: input.userId,
      employeeId: input.employeeId,
      sessionId: null,
      createdAt: Date.now(),
    })
    if (row.sessionId !== null) return dmSurfaceFromRow(row)
    const sessionId = await this.createAnchoredSession(
      account,
      'employee-dm',
      (id) => { attachSurfaceSession(this.database, row.id, id) },
    )
    return { ...dmSurfaceFromRow(row), sessionId }
  }

  /**
   * Create the Workspace-backed session one surface lives in and hand it to
   * `attach` for its durable binding. The caller keeps the binding absent
   * until this resolves, so a failed attempt is retried by the next ensure
   * call for the same surface. The attach runs inside the creation sequence: a
   * failure after the workspace attach rolls the live agent back instead of
   * leaking it.
   * @param account - employee account whose home workspace anchors the session.
   * @param sessionIdPrefix - durable session-id prefix naming the surface kind.
   * @param attach - durable binding written once the live agent exists.
   * @returns the anchored session id.
   */
  protected async createAnchoredSession(
    account: EmployeeAccount,
    sessionIdPrefix: string,
    attach: (sessionId: SessionId) => void,
  ): Promise<SessionId> {
    const selection = this.ctx.agentDefaultModel.currentSelection()
    const preset = await this.ctx.agentPresets.resolve(this.defaultAgentPreset)
    if (preset.broken !== undefined) throw new Error(`agent preset ${preset.id} is unusable: ${preset.broken}`)
    const workspace = await this.ctx.workspaceRegistry.create(account.homeWorkspacePath)
    const sessionId = brandString<SessionId>(`${sessionIdPrefix}-${randomUUID()}`)
    const handle = await this.ctx.agents.create({
      sessionId,
      meta: { cwd: workspace.path, agentPreset: preset.id },
      agentOptions: { provider: selection.provider, model: selection.model },
      setup: async (agentCtx) => {
        await this.ctx.agentPresets.mount(agentCtx, preset.id)
        installInitialModelSelection(agentCtx, selection)
      },
    })

    let attached = false
    try {
      await workspace.attachSession(sessionId)
      attached = true
      this.ctx.sessionTitle.rename(handle.agent.session, account.displayName)
      attach(sessionId)
    } catch (error: unknown) {
      if (attached) {
        try {
          await workspace.detachSession(sessionId)
        } catch (rollbackError: unknown) {
          reportRollbackFailure(this.ctx, `Workspace detach for Session "${sessionId}"`, rollbackError)
        }
      }
      try {
        await handle.dispose()
      } catch (rollbackError: unknown) {
        reportRollbackFailure(this.ctx, `Agent disposal for Session "${sessionId}"`, rollbackError)
      }
      throw error
    }
    return sessionId
  }

  /** Claim queued items in creation order until this call's item is delivered. */
  private async deliverQueued(sessionId: SessionId, item: EmployeeInboxItem): Promise<InboxItemId> {
    for (;;) {
      const claimed = this.accounts.claim(item.employeeId, 1)
      const current = claimed[0]
      if (current === undefined) {
        throw new EnterpriseSurfaceError(
          'inbox-item-vanished',
          `enterprise inbox item ${item.id} for surface ${item.surfaceId} vanished from the claimed queue`,
        )
      }
      try {
        await this.deliverClaimed(sessionId, current)
      } catch (error: unknown) {
        failInboxItem(this.database, current.id, Date.now())
        throw error
      }
      if (current.id === item.id) return item.id
    }
  }

  /**
   * Submit one claimed inbox item to the anchored session and confirm its
   * durable landing. The message enters as steering input — a running session
   * consumes it at the nearest step boundary, an idle one opens a turn — and
   * the landing check accepts the appended user message or an entry the
   * spliced-inbox projection still holds pending; a cancellation splice
   * un-lands the item, so the row cannot count as delivered once its payload
   * can no longer reach the model.
   */
  private async deliverClaimed(sessionId: SessionId, item: EmployeeInboxItem): Promise<void> {
    const agent = this.ctx.agents.get(sessionId)
    if (agent === undefined) {
      throw new EnterpriseSurfaceError(
        'session-not-live',
        `anchored session ${sessionId} for enterprise inbox item ${item.id} is not live`,
      )
    }
    agent.steer(createUserMessage({
      content: [{ type: 'text', text: item.payloadText }],
      source: {
        kind: 'surface-message',
        surfaceId: item.surfaceId,
        inboxItemId: item.id,
        originActor: item.originActor,
      },
    }))
    const session: Session = agent.session
    await this.ctx.sessions.flush(session)
    if (!this.landed(session, item.id)) {
      throw new EnterpriseSurfaceError(
        'delivery-not-landed',
        `enterprise inbox item ${item.id} did not land in anchored session ${sessionId}`,
      )
    }
  }

  /**
   * Whether the session log records the item: appended as the delivered user
   * message, or still pending in the spliced-inbox projection. A pending entry
   * later removed by a cancellation splice stops counting, so the item only
   * lands while the payload can still reach the model.
   */
  private landed(session: Session, itemId: InboxItemId): boolean {
    const fromSurface = (message: UserMessage): boolean =>
      message.source.kind === 'surface-message' && message.source.inboxItemId === itemId
    const suffix = session.ownEvents()
    return suffix.some(event => event.type === 'user/message' && fromSurface(event.data))
      || pendingInboxMessages(suffix).some(fromSurface)
  }
}
