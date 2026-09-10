/** Data used by `EnterpriseTeamMember`. */
export interface EnterpriseTeamMember {
  employeeReleaseId: string
  role: string
}
/** Data used by `EnterpriseTeam`. */
export interface EnterpriseTeam {
  teamId: string
  orgId: string
  leaderEmployeeReleaseId: string
  members: readonly EnterpriseTeamMember[]
  workflowTemplate: Readonly<Record<string, JsonValue>>
  approvalPolicy: Readonly<Record<string, JsonValue>>
  revision: number
  createdAt: number
  updatedAt: number
}
/** Data used by `EnterpriseTeamPage`. */
export interface EnterpriseTeamPage {
  items: readonly EnterpriseTeam[]
  nextCursor?: string
}
/** Data used by `EnterpriseTeamListRequest`. */
export interface EnterpriseTeamListRequest { readonly limit?: number; readonly cursor?: string }
/** Data used by `EnterpriseTeamLookup`. */
export interface EnterpriseTeamLookup { readonly teamId: string }
/** Data used by `EnterpriseTeamSaveRequest`. */
export interface EnterpriseTeamSaveRequest {
  readonly teamId: string
  readonly leaderEmployeeReleaseId: string
  readonly members: readonly EnterpriseTeamMember[]
  readonly workflowTemplate: Readonly<Record<string, JsonValue>>
  readonly approvalPolicy: Readonly<Record<string, JsonValue>>
  readonly expectedRevision: number
  readonly idempotencyKey: string
}

/** A person or immutable Agent release assigned to a team. */
export type TeamActorRef =
  | { readonly kind: 'human'; readonly userId: string }
  | { readonly kind: 'agent'; readonly employeeReleaseId: string }
/** Named responsibility in a team charter. */
export interface TeamRoleDefinition {
  readonly roleId: string
  readonly name: string
  readonly responsibility: string
}
/** One actor's chartered role. */
export interface TeamRosterMember { readonly actor: TeamActorRef; readonly roleId: string }
/** Evidence and human-review requirements for team results. */
export interface TeamVerificationPolicy {
  readonly verifierRequired?: boolean
  readonly rubricRefs?: readonly string[]
  readonly highRiskHumanReviewRequired?: boolean
}
/** Central decision queue and optional concurrency bounds. */
export interface TeamAttentionPolicy {
  readonly decisionQueue?: 'centralized'
  readonly openDecisionLimit?: number
  readonly workInProgressLimit?: number
}
/** Team charter lifecycle. */
export type TeamDefinitionState = 'needs-charter' | 'draft' | 'active' | 'archived'
/** Durable team charter; runtime and TeamRun state are stored separately. */
export interface EnterpriseTeamDefinition {
  readonly teamId: string
  readonly orgId: string
  readonly name: string
  readonly northStar: string
  readonly ownerUserId: string
  readonly departmentId?: string
  readonly visibility: 'organization' | 'private' | 'restricted'
  readonly allowedUserIds?: readonly string[]
  readonly leaderEmployeeReleaseId: string
  readonly roster: readonly TeamRosterMember[]
  readonly roles: readonly TeamRoleDefinition[]
  readonly verificationPolicy: TeamVerificationPolicy
  readonly attentionPolicy: TeamAttentionPolicy
  readonly approvalPolicy: Readonly<Record<string, JsonValue>>
  readonly revision: number
  readonly state: TeamDefinitionState
  readonly createdAt: number
  readonly updatedAt: number
}
/** Stable page of visible team definitions. */
export interface EnterpriseTeamDefinitionPage {
  readonly items: readonly EnterpriseTeamDefinition[]
  readonly nextCursor?: string
}
/** Immutable historical charter revision, including drafts that are no longer current. */
export interface EnterpriseTeamDefinitionRevision extends EnterpriseTeamDefinition {}
/** Browser page request; Host supplies organization and actor identity. */
export interface EnterpriseTeamDefinitionListRequest { readonly limit?: number; readonly cursor?: string }
/** Browser lookup request; Host supplies organization and actor identity. */
export interface EnterpriseTeamDefinitionLookup { readonly teamId: string }
/** Read the current private draft of a team charter. */
export interface EnterpriseTeamDefinitionDraftLookup { readonly teamId: string }
/** Browser definition write; Host supplies organization and actor identity. */
export interface EnterpriseTeamDefinitionSaveRequest
  extends Omit<EnterpriseTeamDefinition, 'orgId' | 'revision' | 'createdAt' | 'updatedAt'> {
  readonly expectedRevision: number
  readonly idempotencyKey: string
}
/** Browser terminal archive write; Host supplies organization and actor identity. */
export interface EnterpriseTeamDefinitionArchiveRequest {
  readonly teamId: string
  readonly expectedRevision: number
  readonly idempotencyKey: string
}
/** Explicit draft edit; it never mutates the active revision. */
export interface EnterpriseTeamDefinitionDraftRequest
  extends Omit<EnterpriseTeamDefinitionSaveRequest, 'state'> { readonly state?: 'needs-charter' | 'draft' }
/** Atomically validate and promote the current draft for future runs. */
export interface EnterpriseTeamDefinitionPublishRequest {
  readonly teamId: string
  readonly expectedRevision: number
  readonly idempotencyKey: string
}
/** Explicitly remove the current draft while retaining published history. */
export interface EnterpriseTeamDefinitionDiscardDraftRequest {
  readonly teamId: string
  readonly expectedRevision: number
  readonly idempotencyKey: string
}
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
