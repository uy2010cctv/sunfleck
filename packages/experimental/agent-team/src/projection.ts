/** Host-only Team state projected incrementally from committed Session events. */

import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionEventMap, SessionId } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type {
  TeamDecisionSnapshot,
  TeamHumanMemberSnapshot,
  TeamId,
  TeamMemberSnapshot,
  TeamMessageId,
  TeamMessageSnapshot,
  TeamRunSnapshot,
  TeamRuntimeMutationReceipt,
  TeamTaskId,
  TeamTaskSnapshot,
} from './types.ts'
import {
  TeamId as toTeamId,
  TeamMessageId as toTeamMessageId,
  TeamTaskId as toTeamTaskId,
} from './types.ts'
import { assertTaskGraphCandidate } from './task-graph.ts'

const nonNegativeSafeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const positiveSafeInteger = nonNegativeSafeInteger.min(1)
const sessionIdSchema = z.string().min(1).transform(value => brandString<SessionId>(value))
const teamIdSchema = z.string().min(1).transform(value => toTeamId(value))
const numericTaskIdPattern = /^task-(\d+)$/u
const teamTaskIdSchema = z.string().min(1).refine((value) => {
  const match = numericTaskIdPattern.exec(value)
  return match === null || Number.isSafeInteger(Number(match[1]))
}, { message: 'numeric task id suffix must be a safe integer' }).transform(value => toTeamTaskId(value))
const teamMessageIdSchema = z.string().min(1).transform(value => toTeamMessageId(value))
const requiredText = z.string().min(1)

const capabilityBindingSchema = z.object({
  kind: z.enum(['sop', 'knowledge', 'skill', 'tool', 'model']),
  assetId: requiredText,
  version: positiveSafeInteger,
}).strict()

const releaseSchema = z.object({
  releaseId: requiredText,
  digest: requiredText,
  presetId: requiredText,
  modelRef: z.object({ provider: requiredText, model: requiredText }).strict(),
  capabilityBindings: z.array(capabilityBindingSchema),
}).strict()

const humanActorSchema = z.object({ userId: requiredText, displayName: requiredText }).strict()

const coreContentBlockTypes = new Set(['text', 'reasoning', 'image', 'tool-call', 'tool-result'])
const imageAttachmentSchema = z.object({
  attachmentId: z.string().min(1),
  mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  bytes: nonNegativeSafeInteger,
  width: positiveSafeInteger,
  height: positiveSafeInteger,
  name: z.string().optional(),
}).strict()

// ContentBlockMap is merge-extensible. Validate every core variant exactly,
// while retaining JSON-decoded plugin variants under an unknown type tag.
const contentBlockSchema: z.ZodType<ContentBlock> = z.lazy(() => z.union([
  z.object({ type: z.literal('text'), text: z.string() }).strict(),
  z.object({ type: z.literal('reasoning'), text: z.string() }).strict(),
  z.object({ type: z.literal('image'), attachment: imageAttachmentSchema }).strict(),
  z.object({
    type: z.literal('tool-call'),
    id: z.string().min(1),
    name: z.string(),
    arguments: z.string(),
  }).strict(),
  z.object({
    type: z.literal('tool-result'),
    toolCallId: z.string().min(1),
    content: z.array(contentBlockSchema),
    isError: z.boolean().optional(),
  }).strict(),
  z.object({ type: z.string().min(1) }).loose().refine(
    block => !coreContentBlockTypes.has(block.type),
    { message: 'known content block types must match their declared fields' },
  ),
])) as z.ZodType<ContentBlock>

const teamMemberSnapshotSchema = z.object({
  id: sessionIdSchema,
  name: z.string(),
  description: z.string(),
  provider: z.string(),
  context: z.enum(['fresh', 'fork']),
  phase: z.enum(['provisioning', 'active', 'failed']),
  error: z.string().optional(),
  employeeReleaseId: requiredText.optional(),
  roleId: requiredText.optional(),
  release: releaseSchema.optional(),
}).strict() as z.ZodType<TeamMemberSnapshot>

const humanMemberSnapshotSchema = z.object({
  userId: requiredText,
  displayName: requiredText,
  roleId: requiredText,
}).strict() as z.ZodType<TeamHumanMemberSnapshot>

const runSnapshotSchema = z.object({
  runId: requiredText,
  orgId: requiredText,
  teamDefinitionRevision: positiveSafeInteger,
  workspaceId: requiredText,
  operationId: requiredText,
  state: z.enum(['starting', 'active', 'waiting-human', 'verifying', 'completed', 'failed', 'cancelled']),
  runtimeRevision: positiveSafeInteger,
  actor: humanActorSchema,
  leader: z.object({ sessionId: sessionIdSchema, roleId: requiredText, release: releaseSchema }).strict(),
  failure: z.object({ code: requiredText, message: z.string().optional() }).strict().optional(),
}).strict() as z.ZodType<TeamRunSnapshot>

const decisionSnapshotSchema = z.object({
  decisionId: requiredText,
  runId: requiredText,
  kind: z.enum(['approval', 'handoff', 'clarification']),
  question: requiredText,
  options: z.array(z.string()),
  recommendation: z.string().optional(),
  contextDigest: requiredText,
  assigneeUserId: requiredText,
  state: z.enum(['open', 'answered', 'cancelled', 'expired']),
  answer: z.string().optional(),
  revision: positiveSafeInteger,
  runtimeRevision: positiveSafeInteger,
  operationId: requiredText,
  respondedBy: humanActorSchema.optional(),
}).strict() as z.ZodType<TeamDecisionSnapshot>

const teamTaskSnapshotSchema = z.object({
  id: teamTaskIdSchema,
  revision: positiveSafeInteger,
  subject: z.string(),
  description: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed', 'deleted']),
  ownerId: sessionIdSchema.optional(),
  blockedBy: z.array(teamTaskIdSchema),
  writeScopes: z.array(z.string()),
}).strict() as z.ZodType<TeamTaskSnapshot>

const teamMessageSnapshotSchema = z.object({
  id: teamMessageIdSchema,
  senderId: sessionIdSchema,
  senderName: z.string(),
  targetId: sessionIdSchema,
  content: z.array(contentBlockSchema),
}).strict() as z.ZodType<TeamMessageSnapshot>

const teamEventSelectorSchema = z.object({
  version: nonNegativeSafeInteger,
  teamId: teamIdSchema,
}).loose()

const teamMemberEventSchema = z.object({
  version: z.literal(2),
  teamId: teamIdSchema,
  member: teamMemberSnapshotSchema,
}).strict() as z.ZodType<SessionEventMap['team/member']>

const teamTaskEventSchema = z.object({
  version: z.literal(2),
  teamId: teamIdSchema,
  task: teamTaskSnapshotSchema,
}).strict() as z.ZodType<SessionEventMap['team/task']>

const teamMessageQueuedEventSchema = z.object({
  version: z.literal(2),
  teamId: teamIdSchema,
  message: teamMessageSnapshotSchema,
}).strict() as z.ZodType<SessionEventMap['team/message/queued']>

const teamMessageDeliveredEventSchema = z.object({
  version: z.literal(2),
  teamId: teamIdSchema,
  messageId: teamMessageIdSchema,
  targetId: sessionIdSchema,
}).strict() as z.ZodType<SessionEventMap['team/message/delivered']>

const teamRunEventSchema = z.object({
  version: z.literal(1),
  teamId: teamIdSchema,
  run: runSnapshotSchema,
}).strict() as z.ZodType<SessionEventMap['team/run']>

const teamHumanMemberEventSchema = z.object({
  version: z.literal(1),
  teamId: teamIdSchema,
  member: humanMemberSnapshotSchema,
}).strict() as z.ZodType<SessionEventMap['team/human-member']>

const teamDecisionEventSchema = z.object({
  version: z.literal(1),
  teamId: teamIdSchema,
  decision: decisionSnapshotSchema,
}).strict() as z.ZodType<SessionEventMap['team/decision']>

/** Checkpoint-safe lookup array used by the existing runtime service. */
interface LookupArray<T> extends Array<T> {
  get(key: string): T | undefined
  has(key: string): boolean
}

interface TeamRuntimeOperation extends TeamRuntimeMutationReceipt {
  readonly operationId: string
  readonly intent: string
}

function lookupArray<T>(items: T[], keyOf: (item: T) => string): LookupArray<T> {
  const result = items as LookupArray<T>
  if (typeof result.get === 'function') return result
  Object.defineProperties(result, {
    get: { value: (key: string) => result.find(item => keyOf(item) === key), enumerable: false },
    has: { value: (key: string) => result.some(item => keyOf(item) === key), enumerable: false },
  })
  return result
}

/** Current Team state selected by durable Team identity. */
export interface TeamState {
  readonly id: TeamId
  readonly members: TeamMemberSnapshot[]
  readonly humans: LookupArray<TeamHumanMemberSnapshot>
  readonly tasks: TeamTaskSnapshot[]
  readonly messages: TeamMessageSnapshot[]
  readonly delivered: TeamMessageId[]
  readonly decisions: LookupArray<TeamDecisionSnapshot>
  readonly operations: LookupArray<TeamRuntimeOperation>
  run: TeamRunSnapshot | undefined
  runtimeRevision: number
  nextTaskNumber: number
}

/**
 * Construct empty state for one Team identity.
 * @param rootId - root Session identity.
 * @returns mutable empty Team state.
 */
export function emptyTeamState(rootId: SessionId): TeamProjectionState {
  return {
    id: toTeamId(rootId),
    members: [],
    humans: lookupArray([], member => member.userId),
    tasks: [],
    messages: [],
    delivered: [],
    decisions: lookupArray([], decision => decision.decisionId),
    operations: lookupArray([], operation => operation.operationId),
    run: undefined,
    runtimeRevision: 0,
    nextTaskNumber: 1,
  }
}

/** Checkpoint-safe state for the Team owned by the projected Session. */
export interface TeamProjectionState extends TeamState {
  failure?: string
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    agentTeam: TeamProjectionState
  }
}

const teamProjectionEntrySchema = z.object({
  id: teamIdSchema,
  members: z.array(teamMemberSnapshotSchema),
  tasks: z.array(teamTaskSnapshotSchema),
  messages: z.array(teamMessageSnapshotSchema),
  delivered: z.array(teamMessageIdSchema),
  humans: z.array(humanMemberSnapshotSchema).default([]),
  decisions: z.array(decisionSnapshotSchema).default([]),
  operations: z.array(z.object({
    operationId: requiredText,
    intent: requiredText,
    runtimeRevision: positiveSafeInteger,
    sourceEventSeq: nonNegativeSafeInteger,
  }).strict()).default([]),
  run: runSnapshotSchema.optional(),
  runtimeRevision: nonNegativeSafeInteger.default(0),
  nextTaskNumber: positiveSafeInteger,
  failure: z.string().optional(),
}).strict().transform(state => ({
  ...state,
  humans: lookupArray(state.humans, member => member.userId),
  decisions: lookupArray(state.decisions, decision => decision.decisionId),
  operations: lookupArray(state.operations, operation => operation.operationId),
})) as z.ZodType<TeamProjectionState>

/** Whether one event belongs to the Team domain. */
export type TeamEventType =
  | 'team/member'
  | 'team/task'
  | 'team/message/queued'
  | 'team/message/delivered'
  | 'team/run'
  | 'team/human-member'
  | 'team/decision'

/** One event owned by the Team domain. */
type TeamSessionEvent = SessionEvent<TeamEventType>

/**
 * Test whether a Session event belongs to the Team domain.
 * @param event - candidate Session event.
 * @returns whether the event has a Team-owned type.
 */
export function isTeamEvent(event: SessionEvent): event is TeamSessionEvent {
  return event.type === 'team/member'
    || event.type === 'team/task'
    || event.type === 'team/message/queued'
    || event.type === 'team/message/delivered'
    || event.type === 'team/run'
    || event.type === 'team/human-member'
    || event.type === 'team/decision'
}

/** Decode one persisted Team value and retain the schema failure as its cause. */
function parsePersisted<T>(type: TeamEventType, schema: z.ZodType<T>, value: unknown): T {
  try {
    return schema.parse(value)
  } catch (error: unknown) {
    throw new Error(`persisted Agent Teams ${type} payload is invalid`, { cause: error })
  }
}

/** Decode the complete current-version payload selected by one Team event type. */
function parseCurrentTeamEvent(event: TeamSessionEvent): TeamSessionEvent {
  switch (event.type) {
    case 'team/member':
      return { ...event, data: parsePersisted(event.type, teamMemberEventSchema, event.data) }
    case 'team/task':
      return { ...event, data: parsePersisted(event.type, teamTaskEventSchema, event.data) }
    case 'team/message/queued':
      return { ...event, data: parsePersisted(event.type, teamMessageQueuedEventSchema, event.data) }
    case 'team/message/delivered':
      return { ...event, data: parsePersisted(event.type, teamMessageDeliveredEventSchema, event.data) }
    case 'team/run':
      return { ...event, data: parsePersisted(event.type, teamRunEventSchema, event.data) }
    case 'team/human-member':
      return { ...event, data: parsePersisted(event.type, teamHumanMemberEventSchema, event.data) }
    case 'team/decision':
      return { ...event, data: parsePersisted(event.type, teamDecisionEventSchema, event.data) }
    /* v8 ignore next 2 -- TeamEventType is closed and every member is handled above. */
    default:
      return event
  }
}

/** Require one enterprise runtime event to advance the root-wide revision exactly once. */
function advanceRuntime(
  state: TeamState,
  operationId: string,
  intent: string,
  runtimeRevision: number,
  sourceEventSeq: number,
): void {
  const prior = state.operations.get(operationId)
  if (prior !== undefined && prior.intent !== intent) {
    throw new Error(`team runtime operation "${operationId}" changed intent`)
  }
  if (runtimeRevision !== state.runtimeRevision + 1) {
    throw new Error(`team runtime revision is not contiguous: expected ${String(state.runtimeRevision + 1)}, got ${String(runtimeRevision)}`)
  }
  state.runtimeRevision = runtimeRevision
  const operation: TeamRuntimeOperation = {
    operationId,
    intent,
    runtimeRevision,
    sourceEventSeq,
  }
  if (prior === undefined) state.operations.push(operation)
  else state.operations[state.operations.indexOf(prior)] = operation
}

const RUN_TRANSITIONS: Readonly<Record<TeamRunSnapshot['state'], ReadonlySet<TeamRunSnapshot['state']>>> = {
  starting: new Set(['active', 'failed', 'cancelled']),
  active: new Set(['waiting-human', 'verifying', 'completed', 'failed', 'cancelled']),
  'waiting-human': new Set(['active', 'verifying', 'failed', 'cancelled']),
  verifying: new Set(['active', 'completed', 'failed', 'cancelled']),
  completed: new Set(),
  failed: new Set(),
  cancelled: new Set(),
}

/** Stable intent lets a start operation own both its starting and terminal admission records. */
function runOperationIntent(run: TeamRunSnapshot, prior: TeamRunSnapshot | undefined): string {
  return prior === undefined || (prior.operationId === run.operationId && prior.state === 'starting')
    ? `run-start:${run.runId}`
    : `run-${run.state}:${run.runId}`
}

function applyProjectionEvent(state: TeamProjectionState, event: SessionEvent): void {
  if (state.failure !== undefined) return
  if (!isTeamEvent(event)) return
  // Invariants apply candidate events to structured clones, which preserve the
  // checkpoint arrays but not their non-enumerable lookup helpers.
  lookupArray(state.humans, member => member.userId)
  lookupArray(state.decisions, decision => decision.decisionId)
  lookupArray(state.operations, operation => operation.operationId)
  try {
    const selector = parsePersisted(event.type, teamEventSelectorSchema, event.data)
    if (selector.teamId !== state.id) return
    const expectedVersion = event.type === 'team/run' || event.type === 'team/human-member' || event.type === 'team/decision' ? 1 : 2
    if (selector.version !== expectedVersion) {
      throw new Error(`unsupported Agent Teams event version ${String(selector.version)}`)
    }
    applyCurrentTeamEvent(state, parseCurrentTeamEvent(event))
  } catch (error: unknown) {
    /* v8 ignore next -- the owned Team transition throws Error instances. */
    state.failure = error instanceof Error ? error.message : String(error)
  }
}

function applyCurrentTeamEvent(state: TeamState, event: TeamSessionEvent): void {
  switch (event.type) {
    case 'team/member': {
      const member = event.data.member
      const index = state.members.findIndex(candidate => candidate.id === member.id)
      const prior = state.members[index]
      const named = state.members.find(candidate => candidate.name === member.name)
      if (named !== undefined && named.id !== member.id) {
        throw new Error(`teammate name "${member.name}" is reused by another member`)
      }
      if (prior === undefined) {
        if (member.phase !== 'provisioning') throw new Error(`teammate "${member.name}" must begin provisioning`)
      } else {
        if (prior.name !== member.name || prior.provider !== member.provider || prior.context !== member.context
          || prior.employeeReleaseId !== member.employeeReleaseId || prior.roleId !== member.roleId
          || JSON.stringify(prior.release) !== JSON.stringify(member.release)) {
          throw new Error(`teammate "${member.id}" changed immutable identity fields`)
        }
        if (prior.phase !== 'provisioning' || member.phase === 'provisioning') {
          throw new Error(`teammate "${member.name}" has an invalid ${prior.phase} -> ${member.phase} transition`)
        }
      }
      if (index < 0) state.members.push(member)
      else state.members[index] = member
      break
    }
    case 'team/human-member': {
      const member = event.data.member
      const prior = state.humans.get(member.userId)
      if (prior !== undefined && JSON.stringify(prior) !== JSON.stringify(member)) {
        throw new Error(`human Team member "${member.userId}" changed immutable identity fields`)
      }
      if (prior === undefined) state.humans.push(member)
      else state.humans[state.humans.indexOf(prior)] = member
      break
    }
    case 'team/task': {
      const task = event.data.task
      const index = state.tasks.findIndex(candidate => candidate.id === task.id)
      const prior = state.tasks[index]
      if (prior === undefined && task.revision !== 1) {
        throw new Error(`team task "${task.id}" must begin at revision 1`)
      }
      if (prior !== undefined && task.revision !== prior.revision + 1) {
        throw new Error(`team task "${task.id}" revision is not contiguous`)
      }
      assertTaskGraphCandidate(state.tasks, task)
      const match = numericTaskIdPattern.exec(task.id)
      if (match !== null) {
        const number = Number(match[1])
        state.nextTaskNumber = Math.max(
          state.nextTaskNumber,
          number === Number.MAX_SAFE_INTEGER ? number : number + 1,
        )
      }
      if (index < 0) state.tasks.push(task)
      else state.tasks[index] = task
      break
    }
    case 'team/message/queued': {
      const message = event.data.message
      if (state.messages.some(candidate => candidate.id === message.id)) {
        throw new Error(`team message "${message.id}" was queued twice`)
      }
      state.messages.push(message)
      break
    }
    case 'team/message/delivered': {
      const queued = state.messages.find(message => message.id === event.data.messageId)
      if (queued === undefined) throw new Error(`team message "${event.data.messageId}" was delivered before queueing`)
      if (queued.targetId !== event.data.targetId) throw new Error(`team message "${event.data.messageId}" target changed`)
      if (state.delivered.includes(event.data.messageId)) throw new Error(`team message "${event.data.messageId}" was delivered twice`)
      state.delivered.push(event.data.messageId)
      break
    }
    case 'team/run': {
      const run = event.data.run
      const prior = state.run
      if (prior !== undefined) {
        if (prior.runId !== run.runId || prior.orgId !== run.orgId
          || prior.teamDefinitionRevision !== run.teamDefinitionRevision
          || prior.workspaceId !== run.workspaceId
          || JSON.stringify(prior.leader) !== JSON.stringify(run.leader)) {
          throw new Error(`TeamRun "${run.runId}" changed immutable identity fields`)
        }
        if (!RUN_TRANSITIONS[prior.state].has(run.state)) {
          throw new Error(`TeamRun "${run.runId}" has an invalid ${prior.state} -> ${run.state} transition`)
        }
      } else if (run.state !== 'starting') {
        throw new Error(`TeamRun "${run.runId}" must begin starting`)
      }
      advanceRuntime(state, run.operationId, runOperationIntent(run, prior), run.runtimeRevision, event.seq)
      state.run = run
      break
    }
    case 'team/decision': {
      const decision = event.data.decision
      if (state.run?.runId !== decision.runId) {
        throw new Error(`team decision "${decision.decisionId}" does not belong to the current TeamRun`)
      }
      const prior = state.decisions.get(decision.decisionId)
      if (prior === undefined) {
        if (decision.state !== 'open' || decision.revision !== 1) {
          throw new Error(`team decision "${decision.decisionId}" must begin open at revision 1`)
        }
      } else {
        if (decision.revision !== prior.revision + 1) {
          throw new Error(`team decision "${decision.decisionId}" revision is not contiguous`)
        }
        if (prior.state !== 'open' || decision.state === 'open') {
          throw new Error(`team decision "${decision.decisionId}" has an invalid ${prior.state} -> ${decision.state} transition`)
        }
        if (prior.runId !== decision.runId || prior.kind !== decision.kind || prior.question !== decision.question
          || prior.contextDigest !== decision.contextDigest || prior.assigneeUserId !== decision.assigneeUserId
          || JSON.stringify(prior.options) !== JSON.stringify(decision.options)) {
          throw new Error(`team decision "${decision.decisionId}" changed immutable identity fields`)
        }
      }
      const intent = prior === undefined
        ? `decision-project:${decision.decisionId}`
        : `decision-${decision.state}:${decision.decisionId}`
      advanceRuntime(state, decision.operationId, intent, decision.runtimeRevision, event.seq)
      if (prior === undefined) state.decisions.push(decision)
      else state.decisions[state.decisions.indexOf(prior)] = decision
      break
    }
    /* v8 ignore next 2 -- TeamEventType is closed and every member is handled above. */
    default:
      return
  }
}

/** Host-only Team projection selected by the projected Session identity. */
export const teamProjectionDefinition = {
  key: 'agentTeam',
  stateVersion: 4,
  stateSchema: teamProjectionEntrySchema,
  init: header => emptyTeamState(header.id),
  apply: (state, event) => {
    applyProjectionEvent(state, event)
    return state
  },
} satisfies ProjectionDefinition<'agentTeam', TeamProjectionState>
