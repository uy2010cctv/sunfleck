import type { JsonValue } from '@deepseek-ai/dsh-util-values'

export type EnterpriseTeamRunSource = 'console' | 'schedule' | 'channel'
export type EnterpriseTeamRunState =
  | 'starting' | 'active' | 'waiting-human' | 'verifying' | 'completed' | 'failed' | 'cancelled'
export type EnterpriseTeamRosterMember =
  | { readonly actor: { readonly kind: 'human'; readonly userId: string }; readonly roleId: string }
  | { readonly actor: { readonly kind: 'agent'; readonly employeeReleaseId: string }; readonly roleId: string }
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
export interface EnterpriseTeamRunPage {
  readonly items: readonly EnterpriseTeamRun[]
  readonly nextCursor?: string
}
export interface EnterpriseTeamRunStartRequest {
  readonly teamId: string
  readonly expectedTeamRevision: number
  readonly workspaceId: string
  readonly prompt: string
  readonly source: EnterpriseTeamRunSource
  readonly idempotencyKey: string
}
export interface EnterpriseTeamRunListRequest {
  readonly teamId?: string
  readonly state?: EnterpriseTeamRunState
  readonly limit?: number
  readonly cursor?: string
}
export interface EnterpriseTeamRunLookup { readonly runId: string }
export interface EnterpriseTeamRunCancelRequest {
  readonly runId: string
  readonly expectedRevision: number
  readonly idempotencyKey: string
}

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
export interface EnterpriseTeamDecisionPage {
  readonly items: readonly EnterpriseTeamDecision[]
  readonly nextCursor?: string
}
export interface EnterpriseTeamDecisionListRequest {
  readonly runId?: string
  readonly state?: EnterpriseTeamDecision['state']
  readonly assigneeUserId?: string
  readonly limit?: number
  readonly cursor?: string
}
export interface EnterpriseTeamDecisionRespondRequest {
  readonly decisionId: string
  readonly answer: string
  readonly expectedRevision: number
  readonly idempotencyKey: string
}

export type EnterpriseTeamAutonomyLevel = 'observe' | 'propose' | 'execute-reviewed' | 'execute-delegated'
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
export interface EnterpriseTeamAutonomyGrantPage {
  readonly items: readonly EnterpriseTeamAutonomyGrant[]
  readonly nextCursor?: string
}
export interface EnterpriseTeamAutonomyListRequest {
  readonly teamId?: string
  readonly employeeReleaseId?: string
  readonly state?: EnterpriseTeamAutonomyGrant['state']
  readonly limit?: number
  readonly cursor?: string
}
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
export interface EnterpriseTeamAutonomyRevokeRequest {
  readonly teamId: string
  readonly employeeReleaseId: string
  readonly taskType: string
  readonly capabilityScope: string
  readonly expectedRevision: number
  readonly idempotencyKey: string
}

// Keep JsonValue in the generated graph for future structured metadata without exposing runtime writes.
export type EnterpriseTeamControlJsonValue = JsonValue
