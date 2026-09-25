/** Bounded declarative channel workflow syntax and step execution. */
import { load } from 'js-yaml'
import { z } from 'zod'

const text = z.string().trim().min(1).max(500)
const messageTrigger = z.strictObject({ type: z.literal('message'), contains: text })
const reactionTrigger = z.strictObject({ type: z.literal('reaction'), emoji: z.string().min(1).max(16) })
const scheduleTrigger = z.strictObject({
  type: z.literal('schedule'), scheduleId: text,
  at: z.iso.datetime({ offset: true }).optional(),
  everySeconds: z.number().int().min(60).max(31_536_000).optional(),
}).refine(value => (value.at === undefined) !== (value.everySeconds === undefined),
  { message: 'schedule requires exactly one time selector' })
const webhookTrigger = z.strictObject({ type: z.literal('webhook'), hookId: text })
const gitTrigger = z.strictObject({ type: z.literal('git'),
  event: z.enum(['tag_pushed', 'review_submitted', 'patch_merged']),
  source: text, repository: text })
const trigger = z.discriminatedUnion('type', [messageTrigger, reactionTrigger, scheduleTrigger, webhookTrigger, gitTrigger])
const botStep = z.strictObject({ type: z.literal('bot_request'), employeeId: text, prompt: text })
const approvalStep = z.strictObject({ type: z.literal('approval_request'), summary: text })
const postStep = z.strictObject({ type: z.literal('room_post'), text })
const step = z.discriminatedUnion('type', [botStep, approvalStep, postStep])
const spec = z.strictObject({
  version: z.literal(1), name: z.string().trim().min(1).max(120),
  on: z.array(trigger).min(1).max(8), steps: z.array(step).min(1).max(12),
})

/** Strict channel YAML document; unknown instructions are rejected. */
export type ChannelWorkflow = z.infer<typeof spec>
/** Supported events after the Host has authenticated and scoped their producer. */
export type ChannelWorkflowTrigger =
  | { readonly type: 'message'; readonly text: string }
  | { readonly type: 'reaction'; readonly emoji: string }
  | { readonly type: 'schedule'; readonly scheduleId: string }
  | { readonly type: 'webhook'; readonly hookId: string }
  | { readonly type: 'git'
    readonly event: 'tag_pushed' | 'review_submitted' | 'patch_merged'
    readonly source: string
    readonly repository: string }

/** Parse a bounded YAML workflow without code execution or implicit instructions.
 * @param yaml - Channel manager's YAML document.
 * @returns Validated workflow.
 */
export function parseChannelWorkflow(yaml: string): ChannelWorkflow {
  if (Buffer.byteLength(yaml, 'utf8') > 65_536) throw new Error('channel workflow YAML is too large')
  return spec.parse(load(yaml))
}

/** Determine whether an authenticated incoming event matches a declared trigger.
 * @param workflow - Validated workflow.
 * @param incoming - Trusted event facts, already scoped to the channel.
 * @returns Whether any trigger matches.
 */
export function workflowMatches(workflow: ChannelWorkflow, incoming: ChannelWorkflowTrigger): boolean {
  return workflow.on.some((configured) => {
    if (configured.type !== incoming.type) return false
    switch (configured.type) {
      case 'message': return incoming.type === 'message' && incoming.text.toLocaleLowerCase().includes(configured.contains.toLocaleLowerCase())
      case 'reaction': return incoming.type === 'reaction' && incoming.emoji === configured.emoji
      case 'schedule': return incoming.type === 'schedule' && incoming.scheduleId === configured.scheduleId
      case 'webhook': return incoming.type === 'webhook' && incoming.hookId === configured.hookId
      case 'git': return incoming.type === 'git' && incoming.event === configured.event
        && incoming.source === configured.source && incoming.repository === configured.repository
    }
  })
}

/** Stable source identity assigned by the authenticated trigger consumer. */
export interface ChannelWorkflowRun {
  readonly channelId: string
  readonly workflowId: string
  readonly revision: number
  readonly sourceEventId: string
}
/** One worker's fenced claim of a workflow run. */
export interface ClaimedChannelWorkflowRun extends ChannelWorkflowRun {
  readonly leaseToken: string
}
/** Authorized room, employee, and approval actions supplied by the Host. */
export interface ChannelWorkflowActions {
  bot(input: { readonly employeeId: string; readonly prompt: string; readonly idempotencyKey: string }): Promise<void>
  approval(input: { readonly summary: string; readonly idempotencyKey: string }): Promise<{ readonly decisionId: string }>
  post(input: { readonly text: string; readonly idempotencyKey: string }): Promise<void>
}
/** A workflow either finishes or awaits an existing Enterprise approval decision. */
export type ChannelWorkflowResult = { readonly state: 'completed' }
  | { readonly state: 'waiting-human'; readonly decisionId: string; readonly nextStep: number }

/** Execute validated actions with stable per-step keys and stop for human authority.
 * @param workflow - Validated workflow.
 * @param run - Durable trigger identity.
 * @param actions - Host-owned, authorized action providers.
 * @param startAt - Saved next step after an approved decision; defaults to the first step.
 * @returns Completion or the next human decision.
 */
export async function executeChannelWorkflow(workflow: ChannelWorkflow, run: ChannelWorkflowRun,
  actions: ChannelWorkflowActions, startAt = 0): Promise<ChannelWorkflowResult> {
  if (!Number.isInteger(startAt) || startAt < 0 || startAt > workflow.steps.length) throw new Error('invalid workflow continuation')
  for (let index = startAt; index < workflow.steps.length; index += 1) {
    const item = workflow.steps[index]
    if (item === undefined) throw new Error('workflow step missing')
    const idempotencyKey = `${run.channelId}:${run.workflowId}:${run.revision}:${run.sourceEventId}:${index}`
    switch (item.type) {
      case 'bot_request': await actions.bot({ employeeId: item.employeeId, prompt: item.prompt, idempotencyKey }); break
      case 'room_post': await actions.post({ text: item.text, idempotencyKey }); break
      case 'approval_request': {
        const decision = await actions.approval({ summary: item.summary, idempotencyKey })
        return { state: 'waiting-human', decisionId: decision.decisionId, nextStep: index + 1 }
      }
    }
  }
  return { state: 'completed' }
}
