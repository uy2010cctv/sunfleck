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
import type {} from '@deepseek-ai/dsh-agent-presets'
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
import { createUserMessage, errorChain, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-workspace'
import type { EnterpriseSurfaces, Surface } from './types.ts'

/** Log a rollback failure without replacing the operation's original failure. */
function reportRollbackFailure(ctx: Context, subject: string, error: unknown): void {
  ctx.logger.warn(`enterprise surface: ${subject} rollback failed: ${errorChain(error)}`)
}

/** Registry of durable dm surfaces and inbound delivery into anchored employee sessions. */
export class DmSurfaceRegistry implements EnterpriseSurfaces {
  /**
   * @param ctx - harness context owning the anchored sessions and the injected agent-host services.
   * @param database - migrated enterprise identity database; the composition owns its lifecycle.
   * @param defaultAgentPreset - preset composed into every anchored session this registry creates.
   */
  constructor(
    private readonly ctx: Context,
    private readonly database: DatabaseSync,
    private readonly defaultAgentPreset: string,
  ) {}

  private get accounts(): EmployeeAccounts {
    return this.ctx.employeeAccounts
  }

  async ensureDm(input: { orgId: string; userId: string; employeeId: EmployeeId }): Promise<Surface> {
    const account = this.requireEmployeeInOrg(input.employeeId, input.orgId)
    const row = ensureSurface(this.database, {
      id: surfaceId(randomUUID()),
      orgId: input.orgId,
      kind: 'dm',
      userId: input.userId,
      employeeId: input.employeeId,
      sessionId: null,
      createdAt: Date.now(),
    })
    const sessionId = row.sessionId ?? await this.attachNewSession(account, row.id)
    return {
      id: surfaceId(row.id),
      kind: row.kind,
      orgId: row.orgId,
      userId: row.userId,
      employeeId: employeeId(row.employeeId),
      sessionId,
    }
  }

  stickyEmployee(orgId: string, actorKey: string): EmployeeId | undefined {
    return this.accounts.resolveSticky(orgId, actorKey)
  }

  async deliverToEmployee(surface: Surface, originActor: string, payloadText: string): Promise<InboxItemId> {
    this.requireEmployeeInOrg(surface.employeeId, surface.orgId)
    if (surface.sessionId === undefined) {
      throw new Error(`enterprise surface ${surface.id} has no anchored session`)
    }
    const item = this.accounts.enqueue({
      employeeId: surface.employeeId, surfaceId: surface.id, originActor, payloadText,
    })
    for (;;) {
      const claimed = this.accounts.claim(surface.employeeId, 1)
      const current = claimed[0]
      if (current === undefined) {
        throw new Error(`enterprise inbox item ${item.id} for surface ${surface.id} vanished from the claimed queue`)
      }
      try {
        await this.deliverClaimed(surface.sessionId, current)
      } catch (error: unknown) {
        failInboxItem(this.database, current.id, Date.now())
        throw error
      }
      if (current.id === item.id) return item.id
    }
  }

  /** Read one account and refuse a missing employee or one from another organization. */
  private requireEmployeeInOrg(id: EmployeeId, orgId: string): EmployeeAccount {
    const account = this.accounts.get(id)
    if (account === undefined) throw new Error(`enterprise employee ${id} is missing`)
    if (account.orgId !== orgId) {
      throw new Error(`enterprise employee ${id} cannot be bound under ${orgId} (belongs to ${account.orgId})`)
    }
    return account
  }

  /**
   * Create the Workspace-backed session one dm surface lives in and bind it
   * to the surface row. The row keeps `session_id` null until this resolves,
   * so a failed attempt is retried by the next `ensureDm` call for the same
   * pair.
   */
  private async attachNewSession(account: EmployeeAccount, surfaceRowId: string): Promise<string> {
    const sessionId = await this.createAnchoredSession(account)
    attachSurfaceSession(this.database, surfaceRowId, sessionId)
    return sessionId
  }

  /** Create one anchored session through the webhook session-creation shape. */
  private async createAnchoredSession(account: EmployeeAccount): Promise<string> {
    const selection = this.ctx.agentDefaultModel.currentSelection()
    const preset = await this.ctx.agentPresets.resolve(this.defaultAgentPreset)
    await this.ctx.agentPresets.standingKeyFor(preset.id)
    const workspace = await this.ctx.workspaceRegistry.create(account.homeWorkspacePath)
    const sessionId = brandString<SessionId>(`employee-dm-${randomUUID()}`)
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

  /**
   * Submit one claimed inbox item to the anchored session and confirm its
   * durable landing. The message enters as steering input — a running session
   * consumes it at the nearest step boundary, an idle one opens a turn — and
   * the landing check accepts the appended user message or an entry the
   * spliced-inbox projection still holds pending; a cancellation splice
   * un-lands the item, so the row cannot count as delivered once its payload
   * can no longer reach the model.
   */
  private async deliverClaimed(sessionId: string, item: EmployeeInboxItem): Promise<void> {
    const agent = this.ctx.agents.get(brandString<SessionId>(sessionId))
    if (agent === undefined) {
      throw new Error(`anchored session ${sessionId} for enterprise inbox item ${item.id} is not live`)
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
      throw new Error(`enterprise inbox item ${item.id} did not land in anchored session ${sessionId}`)
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
    const suffix = session.snapshotEvents(session.inheritedEventCount)
    return suffix.some(event => event.type === 'user/message' && fromSurface(event.data))
      || pendingInboxMessages(suffix).some(fromSurface)
  }
}
