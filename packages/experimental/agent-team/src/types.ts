/** Public Agent Teams identities, durable records, and service request values. */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Identifies the implicit team rooted at one top-level Session. */
export type TeamId = Branded<'TeamId'>

/**
 * Brand one root Session identity as its implicit Team identity.
 * @param id - Root Session identity.
 * @returns the same string branded as a Team identity.
 */
export function TeamId(id: SessionId | string): TeamId {
  return id as TeamId
}

/** Stable identifier for one task in a Team. */
export type TeamTaskId = Branded<'TeamTaskId'>

/**
 * Brand a validated task id.
 * @param id - Team-local task identity.
 * @returns the same string branded as a Team task identity.
 */
export function TeamTaskId(id: string): TeamTaskId {
  return id as TeamTaskId
}

/** Stable identifier for one durable peer message. */
export type TeamMessageId = Branded<'TeamMessageId'>

/**
 * Brand a generated peer-message id.
 * @param id - Durable mailbox message identity.
 * @returns the same string branded as a Team message identity.
 */
export function TeamMessageId(id: string): TeamMessageId {
  return id as TeamMessageId
}

/** Durable teammate lifecycle. */
export type TeamMemberPhase = 'provisioning' | 'active' | 'failed'

/** One immutable capability asset pinned by an enterprise employee release. */
export interface TeamCapabilityBindingSnapshot {
  readonly kind: 'sop' | 'knowledge' | 'skill' | 'tool' | 'model'
  readonly assetId: string
  readonly version: number
}

/** Immutable enterprise employee release fields required to reconstruct one Agent. */
export interface TeamReleaseSnapshot {
  readonly releaseId: string
  readonly digest: string
  readonly presetId: string
  readonly modelRef: { readonly provider: string; readonly model: string }
  readonly capabilityBindings: readonly TeamCapabilityBindingSnapshot[]
}

/** Whole durable value written on every teammate lifecycle change. */
export interface TeamMemberSnapshot {
  readonly id: SessionId
  readonly name: string
  readonly description: string
  readonly provider: string
  readonly context: 'fresh' | 'fork'
  readonly phase: TeamMemberPhase
  readonly error?: string
  readonly employeeReleaseId?: string
  readonly roleId?: string
  readonly release?: TeamReleaseSnapshot
}

/** Current runtime-enriched Agent roster row. */
export interface TeamAgentMemberView {
  /** Explicit on live projections; optional for backward-compatible stored/UI fixtures. */
  readonly kind?: 'agent'
  readonly id: SessionId
  readonly name: string
  readonly role: 'lead' | 'teammate'
  readonly status: 'running' | 'idle' | 'inactive' | 'provisioning' | 'failed'
  readonly description?: string
  readonly provider?: string
  readonly context?: 'fresh' | 'fork'
  readonly model?: string
  readonly employeeReleaseId?: string
  readonly roleId?: string
  readonly release?: TeamReleaseSnapshot
  readonly diagnostics: string[]
}

/** Durable Human participant with no Agent Session or mailbox authority. */
export interface TeamHumanMemberSnapshot {
  readonly userId: string
  readonly displayName: string
  readonly roleId: string
}

/** Current Human roster row projected beside Agents. */
export interface TeamHumanMemberView {
  readonly kind: 'human'
  readonly id: string
  readonly userId: string
  readonly displayName: string
  readonly name: string
  readonly role: 'human'
  readonly roleId: string
  readonly status: 'active'
  readonly diagnostics: string[]
}

/** Backward-compatible Agent row returned by Agent control and model tools. */
export type TeamMemberView = TeamAgentMemberView

/** One Agent or Human row in the shared enterprise Team roster. */
export type TeamRosterMemberView = TeamAgentMemberView | TeamHumanMemberView

/** Human actor attribution retained on enterprise runtime mutations. */
export interface TeamHumanActorSnapshot {
  readonly userId: string
  readonly displayName: string
}

/** Enterprise Agent pinned as the TeamRun leader. */
export interface TeamRunLeaderSnapshot {
  readonly sessionId: SessionId
  readonly roleId: string
  readonly release: TeamReleaseSnapshot
}

/** Authoritative enterprise TeamRun state stored in the root Session log. */
export interface TeamRunSnapshot {
  readonly runId: string
  readonly orgId: string
  readonly teamDefinitionRevision: number
  readonly workspaceId: string
  readonly operationId: string
  readonly state: 'starting' | 'active' | 'waiting-human' | 'verifying' | 'completed' | 'failed' | 'cancelled'
  readonly runtimeRevision: number
  readonly actor: TeamHumanActorSnapshot
  readonly leader: TeamRunLeaderSnapshot
  readonly failure?: { readonly code: string; readonly message?: string }
}

/** Authoritative Human decision snapshot stored in the root Session log. */
export interface TeamDecisionSnapshot {
  readonly decisionId: string
  readonly runId: string
  readonly kind: 'approval' | 'handoff' | 'clarification'
  readonly question: string
  readonly options: readonly string[]
  readonly recommendation?: string
  readonly contextDigest: string
  readonly assigneeUserId: string
  readonly state: 'open' | 'answered' | 'cancelled' | 'expired'
  readonly answer?: string
  readonly revision: number
  readonly runtimeRevision: number
  readonly operationId: string
  readonly respondedBy?: TeamHumanActorSnapshot
}

/** Runtime revision and root event position committed for one idempotent operation. */
export interface TeamRuntimeMutationReceipt {
  readonly runtimeRevision: number
  readonly sourceEventSeq: number
}

/** Initial TeamRun fields whose revision and starting state are assigned by the Team service. */
export type TeamRunStartRequest = Omit<TeamRunSnapshot, 'state' | 'runtimeRevision' | 'failure'>

/** One authoritative TeamRun transition requested by its Host runtime adapter. */
export interface TeamRunStateRequest {
  readonly operationId: string
  readonly state: Exclude<TeamRunSnapshot['state'], 'starting'>
  readonly actor: TeamHumanActorSnapshot
  readonly failure?: TeamRunSnapshot['failure']
}

/** Open-decision fields whose revisions are assigned by the Team service. */
export type TeamDecisionProjectRequest = Omit<
  TeamDecisionSnapshot,
  'state' | 'revision' | 'runtimeRevision' | 'answer' | 'respondedBy'
>

/** Human answer using decision revision CAS and operation idempotency. */
export interface TeamDecisionResponseRequest {
  readonly operationId: string
  readonly decisionId: string
  readonly expectedRevision: number
  readonly answer: string
  readonly actor: TeamHumanActorSnapshot
}

/** Durable task lifecycle. */
export type TeamTaskStatus = 'pending' | 'in_progress' | 'completed' | 'deleted'

/** Whole durable task snapshot; every mutation increments {@link revision}. */
export interface TeamTaskSnapshot {
  readonly id: TeamTaskId
  readonly revision: number
  readonly subject: string
  readonly description: string
  readonly status: TeamTaskStatus
  readonly ownerId?: SessionId
  readonly blockedBy: TeamTaskId[]
  readonly writeScopes: string[]
}

/** Runtime-enriched task view returned to tools and hosts. */
export interface TeamTaskView {
  readonly id: TeamTaskId
  readonly revision: number
  readonly subject: string
  readonly description: string
  readonly status: TeamTaskStatus
  readonly blockedBy: TeamTaskId[]
  readonly writeScopes: string[]
  readonly ownerName?: string
  readonly ready: boolean
  readonly writeScopeWarnings: string[]
}

/** Point-in-time roster and task-board projection returned to browser clients. */
export interface TeamView {
  readonly members: TeamMemberView[]
  readonly humans?: TeamHumanMemberView[]
  readonly roster?: TeamRosterMemberView[]
  readonly tasks: TeamTaskView[]
  readonly run?: TeamRunSnapshot
  readonly decisions?: TeamDecisionSnapshot[]
}

/** One peer message retained until its target Session records it. */
export interface TeamMessageSnapshot {
  readonly id: TeamMessageId
  readonly senderId: SessionId
  readonly senderName: string
  readonly targetId: SessionId
  readonly content: ContentBlock[]
}

/** Source retained by the target Session for durable mailbox de-duplication. */
export interface TeamMessageSource {
  readonly kind: 'team-message'
  readonly teamId: TeamId
  readonly messageId: TeamMessageId
  readonly senderId: SessionId
  readonly senderName: string
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'team-message': TeamMessageSource
  }
}

/** Team-service deployment limits. */
export interface Config {
  /** Maximum immutable teammate names retained by one Team. */
  readonly maxMembers?: number
  /** Maximum non-deleted tasks retained by one Team. */
  readonly maxTasks?: number
  /** Maximum queued-minus-delivered messages for one target member. */
  readonly maxPendingMessagesPerMember?: number
  /** Maximum UTF-8 bytes in one complete sender-framed delivery. */
  readonly maxMessageBytes?: number
  /** Maximum milliseconds allowed for Team-owned runtime disposal. */
  readonly disposalTimeoutMs?: number
}

/** Input for creating one durable teammate. */
export interface TeamAgentOptions {
  readonly provider?: string
  readonly model?: string
}

/** Client-safe global-tool restriction persisted for one enterprise teammate. */
export interface TeamToolRestriction {
  readonly allow?: readonly string[]
  readonly deny?: readonly string[]
}

/** Input for creating one durable teammate. */
export interface SpawnTeammateRequest {
  readonly name: string
  readonly description: string
  readonly prompt: ContentBlock[]
  readonly context: 'fresh' | 'fork'
  readonly provider: string
  readonly agentOptions?: TeamAgentOptions
  readonly persona?: string
  readonly toolFilter?: TeamToolRestriction
  readonly employeeReleaseId?: string
  readonly roleId?: string
  readonly release?: TeamReleaseSnapshot
  readonly signal: AbortSignal
}

/** Result after one teammate reaches a durable active or failed edge. */
export interface SpawnTeammateResult {
  readonly member: TeamMemberView
}

/** Input for one durable peer message. */
export interface SendTeamMessageRequest {
  readonly target: string
  readonly content: ContentBlock[]
  readonly signal: AbortSignal
}

/** Result after a peer message enters the durable mailbox. */
export interface SendTeamMessageResult {
  readonly messageId: TeamMessageId
  readonly status: 'accepted' | 'queued'
}

/** Input for creating one shared task. */
export interface CreateTeamTaskRequest {
  readonly subject: string
  readonly description: string
  readonly blockedBy?: readonly TeamTaskId[]
  readonly writeScopes?: readonly string[]
}

/** Supported task mutation actions. */
export type TeamTaskAction =
  | 'claim'
  | 'release'
  | 'edit'
  | 'set_dependencies'
  | 'complete'
  | 'reopen'
  | 'reassign'
  | 'delete'

/** Compare-and-set mutation of one shared task. */
export interface UpdateTeamTaskRequest {
  readonly taskId: TeamTaskId
  readonly expectedRevision: number
  readonly action: TeamTaskAction
  readonly subject?: string
  readonly description?: string
  readonly blockedBy?: readonly TeamTaskId[]
  readonly writeScopes?: readonly string[]
  readonly owner?: string
}

/** Browser task mutation result with stale revisions kept distinct from other Team rejections. */
export type TeamTaskMutationResult =
  | { readonly ok: true; readonly value: TeamTaskView }
  | {
    readonly ok: false
    readonly error: {
      readonly code: 'team-task-conflict' | 'team-rejected'
      readonly message: string
    }
  }

/** Result of waiting for Team activity. */
export interface TeamWaitResult {
  readonly timedOut: boolean
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Whole teammate lifecycle value, stored only in the Team Lead Session. */
    'team/member': { version: 2; teamId: TeamId; member: TeamMemberSnapshot }
    /** Whole shared-task value, stored only in the Team Lead Session. */
    'team/task': { version: 2; teamId: TeamId; task: TeamTaskSnapshot }
    /** Durable mailbox enqueue, stored before delivery is attempted. */
    'team/message/queued': { version: 2; teamId: TeamId; message: TeamMessageSnapshot }
    /** Durable acknowledgement that the target Session recorded the message. */
    'team/message/delivered': {
      version: 2
      teamId: TeamId
      messageId: TeamMessageId
      targetId: SessionId
    }
    /** Authoritative enterprise TeamRun value, stored only in the Team Lead Session. */
    'team/run': { version: 1; teamId: TeamId; run: TeamRunSnapshot }
    /** Human roster row, stored only in the Team Lead Session and never granted Agent mailbox authority. */
    'team/human-member': { version: 1; teamId: TeamId; member: TeamHumanMemberSnapshot }
    /** Authoritative Human decision value, stored only in the Team Lead Session. */
    'team/decision': { version: 1; teamId: TeamId; decision: TeamDecisionSnapshot }
  }
}
