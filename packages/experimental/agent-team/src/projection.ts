/** Team state projected incrementally from committed Session events, with a durable-only client view. */

import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionEventMap, SessionId } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type {
  TeamDecisionSnapshot,
  TeamHumanMemberSnapshot,
  TeamId,
  TeamMemberProjection,
  TeamMemberSnapshot,
  TeamMessageId,
  TeamMessageSnapshot,
  TeamProjection,
  TeamRunSnapshot,
  TeamRuntimeMutationReceipt,
  TeamTaskSnapshot,
  TeamTaskView,
} from './types.ts'
import {
  TeamId as toTeamId,
  TeamMessageId as toTeamMessageId,
  TeamTaskId as toTeamTaskId,
} from './types.ts'
import { assertTaskGraphCandidate } from './task-graph.ts'
import { projectTaskView } from './task-view.ts'

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

// Validate the listed variants; retired tool-result tags cannot enter the
// merge-extensible fallback for JSON-decoded plugin content.
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
  // Keep unknown JSON objects by reference; loose-object parsing drops their own __proto__ keys.
  z.custom<ContentBlock>((value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
    const type = (value as { type?: unknown }).type
    return typeof type === 'string' && type.length > 0 && !coreContentBlockTypes.has(type)
  }),
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

/**
 * Current Team state selected by durable Team identity. Every applied Team
 * event produces a new state object and replaces only the collection it
 * touched; untouched collections keep their references.
 */
export interface TeamState {
  readonly id: TeamId
  readonly members: readonly TeamMemberSnapshot[]
  readonly humans: LookupArray<TeamHumanMemberSnapshot>
  readonly tasks: readonly TeamTaskSnapshot[]
  readonly messages: readonly TeamMessageSnapshot[]
  readonly delivered: readonly TeamMessageId[]
  readonly decisions: LookupArray<TeamDecisionSnapshot>
  readonly operations: LookupArray<TeamRuntimeOperation>
  readonly run: TeamRunSnapshot | undefined
  readonly runtimeRevision: number
  readonly nextTaskNumber: number
}

/**
 * Construct empty state for one Team identity.
 * @param rootId - root Session identity.
 * @returns empty Team state.
 */
export function emptyTeamState(rootId: SessionId): TeamProjectionState {
  return {
    id: toTeamId(rootId),
    members: [],
    tasks: [],
    messages: [],
    delivered: [],
    humans: lookupArray<TeamHumanMemberSnapshot>([], member => member.userId),
    decisions: lookupArray<TeamDecisionSnapshot>([], decision => decision.decisionId),
    operations: lookupArray<TeamRuntimeOperation>([], operation => operation.operationId),
    run: undefined,
    runtimeRevision: 0,
    nextTaskNumber: 1,
  }
}

/** Checkpoint-safe state for the Team owned by the projected Session. */
export interface TeamProjectionState extends TeamState {
  readonly failure?: string
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

/**
 * Validate one enterprise runtime operation against the root-wide revision and
 * derive the operation row the caller folds into the next state.
 */
function checkedRuntimeOperation(
  state: TeamState,
  operationId: string,
  intent: string,
  runtimeRevision: number,
  sourceEventSeq: number,
): TeamRuntimeOperation {
  const prior = state.operations.get(operationId)
  if (prior !== undefined && prior.intent !== intent) {
    throw new Error(`team runtime operation "${operationId}" changed intent`)
  }
  if (runtimeRevision !== state.runtimeRevision + 1) {
    throw new Error(`team runtime revision is not contiguous: expected ${String(state.runtimeRevision + 1)}, got ${String(runtimeRevision)}`)
  }
  return { operationId, intent, runtimeRevision, sourceEventSeq }
}

/** Fold one validated runtime operation into the next state's revision bookkeeping. */
function withRuntimeOperation(state: TeamProjectionState, operation: TeamRuntimeOperation): TeamProjectionState {
  const index = state.operations.findIndex(candidate => candidate.operationId === operation.operationId)
  return {
    ...state,
    operations: lookupArray(replaceAt(state.operations, index, operation), candidate => candidate.operationId),
    runtimeRevision: operation.runtimeRevision,
  }
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

function applyProjectionEvent(state: TeamProjectionState, event: SessionEvent): TeamProjectionState {
  if (state.failure !== undefined) return state
  if (!isTeamEvent(event)) return state
  // Invariants apply candidate events to structured clones, which preserve the
  // checkpoint arrays but not their non-enumerable lookup helpers.
  const current = {
    ...state,
    humans: lookupArray(state.humans, member => member.userId),
    decisions: lookupArray(state.decisions, decision => decision.decisionId),
    operations: lookupArray(state.operations, operation => operation.operationId),
  }
  try {
    const selector = parsePersisted(event.type, teamEventSelectorSchema, event.data)
    if (selector.teamId !== current.id) return state
    const expectedVersion = event.type === 'team/run' || event.type === 'team/human-member' || event.type === 'team/decision' ? 1 : 2
    if (selector.version !== expectedVersion) {
      throw new Error(`unsupported Agent Teams event version ${String(selector.version)}`)
    }
    return applyCurrentTeamEvent(current, parseCurrentTeamEvent(event))
  } catch (error: unknown) {
    /* v8 ignore next -- the owned Team transition throws Error instances. */
    return { ...current, failure: error instanceof Error ? error.message : String(error) }
  }
}

function replaceAt<T>(items: readonly T[], index: number, item: T): T[] {
  const next = [...items]
  if (index < 0) next.push(item)
  else next[index] = item
  return next
}

function applyCurrentTeamEvent(state: TeamProjectionState, event: TeamSessionEvent): TeamProjectionState {
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
      return { ...state, members: replaceAt(state.members, index, member) }
    }
    case 'team/human-member': {
      const member = event.data.member
      const prior = state.humans.get(member.userId)
      if (prior !== undefined && JSON.stringify(prior) !== JSON.stringify(member)) {
        throw new Error(`human Team member "${member.userId}" changed immutable identity fields`)
      }
      if (prior !== undefined) return state
      const index = state.humans.findIndex(candidate => candidate.userId === member.userId)
      return { ...state, humans: lookupArray(replaceAt(state.humans, index, member), candidate => candidate.userId) }
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
      let nextTaskNumber = state.nextTaskNumber
      const match = numericTaskIdPattern.exec(task.id)
      if (match !== null) {
        const number = Number(match[1])
        nextTaskNumber = Math.max(
          nextTaskNumber,
          number === Number.MAX_SAFE_INTEGER ? number : number + 1,
        )
      }
      return { ...state, tasks: replaceAt(state.tasks, index, task), nextTaskNumber }
    }
    case 'team/message/queued': {
      const message = event.data.message
      if (state.messages.some(candidate => candidate.id === message.id)) {
        throw new Error(`team message "${message.id}" was queued twice`)
      }
      return { ...state, messages: [...state.messages, message] }
    }
    case 'team/message/delivered': {
      const queued = state.messages.find(message => message.id === event.data.messageId)
      if (queued === undefined) throw new Error(`team message "${event.data.messageId}" was delivered before queueing`)
      if (queued.targetId !== event.data.targetId) throw new Error(`team message "${event.data.messageId}" target changed`)
      if (state.delivered.includes(event.data.messageId)) throw new Error(`team message "${event.data.messageId}" was delivered twice`)
      return { ...state, delivered: [...state.delivered, event.data.messageId] }
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
      const operation = checkedRuntimeOperation(state, run.operationId, runOperationIntent(run, prior), run.runtimeRevision, event.seq)
      return { ...withRuntimeOperation(state, operation), run }
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
      const operation = checkedRuntimeOperation(state, decision.operationId, intent, decision.runtimeRevision, event.seq)
      const index = state.decisions.findIndex(candidate => candidate.decisionId === decision.decisionId)
      return {
        ...withRuntimeOperation(state, operation),
        decisions: lookupArray(replaceAt(state.decisions, index, decision), candidate => candidate.decisionId),
      }
    }
    /* v8 ignore next 2 -- TeamEventType is closed and every member is handled above. */
    default:
      return state
  }
}

const teamMemberProjectionSchema = z.object({
  id: sessionIdSchema,
  name: z.string(),
  role: z.enum(['lead', 'teammate']),
  phase: z.enum(['provisioning', 'active', 'failed']),
  error: z.string().optional(),
}).strict() as z.ZodType<TeamMemberProjection>

const teamTaskViewSchema = z.object({
  id: teamTaskIdSchema,
  revision: positiveSafeInteger,
  subject: z.string(),
  description: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed', 'deleted']),
  blockedBy: z.array(teamTaskIdSchema),
  writeScopes: z.array(z.string()),
  ownerName: z.string().optional(),
  ready: z.boolean(),
  writeScopeWarnings: z.array(z.string()),
}).strict() as z.ZodType<TeamTaskView>

const teamProjectionSchema = z.object({
  members: z.array(teamMemberProjectionSchema),
  tasks: z.array(teamTaskViewSchema),
  failure: z.string().optional(),
}).strict() as z.ZodType<TeamProjection>

/** Client views keyed by the member and task collections they were derived from. */
const teamProjectionViews = new WeakMap<readonly TeamMemberSnapshot[], WeakMap<readonly TeamTaskSnapshot[], TeamProjection>>()

function buildTeamProjection(state: TeamProjectionState): TeamProjection {
  const rootId = brandString<SessionId>(state.id)
  const members: TeamMemberProjection[] = [{ id: rootId, name: 'lead', role: 'lead', phase: 'active' }]
  for (const member of state.members) {
    members.push({
      id: member.id,
      name: member.name,
      role: 'teammate',
      phase: member.phase,
      ...member.error === undefined ? {} : { error: member.error },
    })
  }
  return {
    members,
    tasks: state.tasks
      .filter(task => task.status !== 'deleted')
      .map(task => projectTaskView(state, task)),
    ...state.failure === undefined ? {} : { failure: state.failure },
  }
}

/**
 * Durable client view of one Team state. Mailbox-only state changes reuse the
 * previous view reference, so the live drive publishes nothing for them.
 * A failure is terminal: later events retain the failed state reference and
 * do not republish its view.
 * @param state - current Team state.
 * @returns the roster and non-deleted task board, plus any projection failure.
 */
export function teamProjectionView(state: TeamProjectionState): TeamProjection {
  if (state.failure !== undefined) return buildTeamProjection(state)
  let byTasks = teamProjectionViews.get(state.members)
  if (byTasks === undefined) {
    byTasks = new WeakMap()
    teamProjectionViews.set(state.members, byTasks)
  }
  let view = byTasks.get(state.tasks)
  if (view === undefined) {
    view = buildTeamProjection(state)
    byTasks.set(state.tasks, view)
  }
  return view
}

/** Team projection selected by the projected Session identity; the wire view carries durable roster and task state only. */
export const teamProjectionDefinition = {
  key: 'agentTeam',
  stateVersion: 4,
  stateSchema: teamProjectionEntrySchema,
  init: header => emptyTeamState(header.id),
  apply: applyProjectionEvent,
  wire: { viewSchema: teamProjectionSchema, view: teamProjectionView },
} satisfies ProjectionDefinition<'agentTeam', TeamProjectionState>
