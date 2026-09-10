import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** Allowed values for `EnterpriseTeamRunSource`. */
export type EnterpriseTeamRunSource = 'console' | 'schedule' | 'channel'
/** Allowed values for `EnterpriseTeamRunState`. */
export type EnterpriseTeamRunState =
  | 'starting' | 'active' | 'waiting-human' | 'verifying' | 'completed' | 'failed' | 'cancelled'
/** Allowed values for `EnterpriseTeamRosterMember`. */
export type EnterpriseTeamRosterMember =
  | { readonly actor: { readonly kind: 'human'; readonly userId: string }; readonly roleId: string }
  | { readonly actor: { readonly kind: 'agent'; readonly employeeReleaseId: string }; readonly roleId: string }
/** Data used by `EnterpriseTeamRun`. */
export interface EnterpriseTeamRun {
  readonly runId: string
  readonly orgId: string
  readonly teamId: string
  readonly teamDefinitionRevision: number
  readonly workspaceId: string
  readonly rootSessionId?: string
  readonly rosterSnapshot: readonly EnterpriseTeamRosterMember[]
  readonly createdBy: string
  readonly source: EnterpriseTeamRunSource
  readonly state: EnterpriseTeamRunState
  readonly runtimeRevision: number
  readonly sourceEventSeq?: number
  readonly failure?: { readonly code: string; readonly message?: string }
  readonly revision: number
  readonly createdAt: number
  readonly updatedAt: number
}
/** Data used by `EnterpriseTeamRunPage`. */
export interface EnterpriseTeamRunPage {
  readonly items: readonly EnterpriseTeamRun[]
  readonly nextCursor?: string
}
/** Data used by `EnterpriseTeamRunStartRequest`. */
export interface EnterpriseTeamRunStartRequest {
  readonly teamId: string
  readonly expectedTeamRevision: number
  readonly workspaceId: string
  readonly prompt: string
  readonly source: EnterpriseTeamRunSource
  readonly idempotencyKey: string
}
/** Data used by `EnterpriseTeamRunListRequest`. */
export interface EnterpriseTeamRunListRequest {
  readonly teamId?: string
  readonly state?: EnterpriseTeamRunState
  readonly limit?: number
  readonly cursor?: string
}
/** Data used by `EnterpriseTeamRunLookup`. */
export interface EnterpriseTeamRunLookup { readonly runId: string }
/** Data used by `EnterpriseTeamRunCancelRequest`. */
export interface EnterpriseTeamRunCancelRequest {
  readonly runId: string
  readonly expectedRevision: number
  readonly idempotencyKey: string
}

/** Data used by `EnterpriseTeamDecision`. */
export interface EnterpriseTeamDecision {
  readonly decisionId: string
  readonly orgId: string
  readonly runId: string
  readonly kind: 'approval' | 'handoff' | 'clarification'
  readonly question: string
  readonly options: readonly string[]
  readonly recommendation?: string
  readonly contextDigest: string
  readonly assigneeUserId: string
  readonly state: 'open' | 'answered' | 'cancelled' | 'expired'
  readonly answer?: string
  readonly runtimeRevision: number
  readonly sourceEventSeq?: number
  readonly revision: number
  readonly createdAt: number
  readonly updatedAt: number
}
/** Data used by `EnterpriseTeamDecisionPage`. */
export interface EnterpriseTeamDecisionPage {
  readonly items: readonly EnterpriseTeamDecision[]
  readonly nextCursor?: string
}
/** Data used by `EnterpriseTeamDecisionListRequest`. */
export interface EnterpriseTeamDecisionListRequest {
  readonly runId?: string
  readonly state?: EnterpriseTeamDecision['state']
  readonly assigneeUserId?: string
  readonly limit?: number
  readonly cursor?: string
}
/** Data used by `EnterpriseTeamDecisionRespondRequest`. */
export interface EnterpriseTeamDecisionRespondRequest {
  readonly decisionId: string
  readonly answer: string
  readonly expectedRevision: number
  readonly idempotencyKey: string
}

/** Allowed values for `EnterpriseTeamAutonomyLevel`. */
export type EnterpriseTeamAutonomyLevel = 'observe' | 'propose' | 'execute-reviewed' | 'execute-delegated'
/** Data used by `EnterpriseTeamAutonomyGrant`. */
export interface EnterpriseTeamAutonomyGrant {
  readonly orgId: string
  readonly teamId: string
  readonly employeeReleaseId: string
  readonly taskType: string
  readonly capabilityScope: string
  readonly level: EnterpriseTeamAutonomyLevel
  readonly grantedBy: string
  readonly evidenceRefs: readonly string[]
  readonly state: 'active' | 'revoked'
  readonly revision: number
  readonly createdAt: number
  readonly updatedAt: number
}
/** Data used by `EnterpriseTeamAutonomyGrantPage`. */
export interface EnterpriseTeamAutonomyGrantPage {
  readonly items: readonly EnterpriseTeamAutonomyGrant[]
  readonly nextCursor?: string
}
/** Data used by `EnterpriseTeamAutonomyListRequest`. */
export interface EnterpriseTeamAutonomyListRequest {
  readonly teamId?: string
  readonly employeeReleaseId?: string
  readonly state?: EnterpriseTeamAutonomyGrant['state']
  readonly limit?: number
  readonly cursor?: string
}
/** Data used by `EnterpriseTeamAutonomySaveRequest`. */
export interface EnterpriseTeamAutonomySaveRequest {
  readonly teamId: string
  readonly employeeReleaseId: string
  readonly taskType: string
  readonly capabilityScope: string
  readonly level: EnterpriseTeamAutonomyLevel
  readonly evidenceRefs: readonly string[]
  readonly expectedRevision: number
  readonly idempotencyKey: string
}
/** Data used by `EnterpriseTeamAutonomyRevokeRequest`. */
export interface EnterpriseTeamAutonomyRevokeRequest {
  readonly teamId: string
  readonly employeeReleaseId: string
  readonly taskType: string
  readonly capabilityScope: string
  readonly expectedRevision: number
  readonly idempotencyKey: string
}

// Keep JsonValue in the generated graph for future structured metadata without exposing runtime writes.
/** Allowed values for `EnterpriseTeamControlJsonValue`. */
export type EnterpriseTeamControlJsonValue = JsonValue
