/** Driver-neutral contracts for DSH enterprise operations. */
export type OperationSource = 'console' | 'schedule' | 'wecom'
export type BusinessState = 'active' | 'waiting-approval' | 'completed' | 'failed'
export type ApprovalKind = 'publish' | 'tool' | 'business' | 'handoff'

export interface WorkRecordInput {
  readonly orgId: string
  readonly sessionId: string
  readonly employeeReleaseId: string
  readonly teamId?: string
  readonly source: OperationSource
  readonly businessState: BusinessState
  readonly sourceReferences: Readonly<Record<string, unknown>>
  readonly expectedRevision: number
  readonly idempotencyKey: string
}
export interface WorkRecordView extends Omit<WorkRecordInput, 'expectedRevision' | 'idempotencyKey'> {
  readonly revision: number
  readonly createdAt: number
  readonly updatedAt: number
}
export interface WorkRecordPage {
  readonly items: readonly WorkRecordView[]
  readonly nextCursor?: string
}
export interface ApprovalPage { readonly items: readonly ApprovalView[]; readonly nextCursor?: string }
export interface FixedTeamPage { readonly items: readonly FixedTeamView[]; readonly nextCursor?: string }
export interface SchedulePage { readonly items: readonly ScheduleView[]; readonly nextCursor?: string }

export interface ApprovalView {
  readonly approvalId: string
  readonly orgId: string
  readonly kind: ApprovalKind
  readonly subjectType: string
  readonly subjectId: string
  readonly requestedBy: string
  readonly state: 'pending' | 'approved' | 'rejected' | 'cancelled'
  readonly reviewerUserId?: string
  readonly reason?: string
  readonly revision: number
  readonly createdAt: number
  readonly updatedAt: number
}
export type ScheduleTarget =
  | { readonly kind: 'employee'; readonly employeeReleaseId: string }
  | { readonly kind: 'team'; readonly teamId: string }
export interface ScheduleView {
  readonly scheduleId: string
  readonly orgId: string
  readonly target: ScheduleTarget
  readonly timezone: string
  readonly rule: string
  readonly input: Readonly<Record<string, unknown>>
  readonly state: 'active' | 'paused' | 'archived'
  readonly nextRunAt: number | null
  readonly lastRunAt: number | null
  readonly revision: number
  readonly createdAt: number
  readonly updatedAt: number
}
export interface ScheduleFireView {
  readonly workRecord: WorkRecordView
  readonly command: {
    readonly kind: 'start-session'
    readonly sessionId: string
    readonly employeeReleaseId: string
    readonly teamId?: string
  }
}
export type OutboxState = 'pending' | 'processing' | 'completed' | 'failed'
export interface OutboxCommandView {
  readonly commandId: string
  readonly orgId: string
  readonly scheduleId: string
  readonly occurrenceKey: string
  readonly workSessionId: string
  readonly employeeReleaseId: string
  readonly teamId?: string
  readonly payload: Readonly<Record<string, unknown>>
  readonly state: OutboxState
  readonly attemptCount: number
  readonly leaseOwner?: string
  readonly leaseExpiresAt?: number
  readonly lastError?: string
  readonly completedAt?: number
  readonly startAdmittedAt?: number
  readonly createdAt: number
}
export interface FixedTeamView {
  readonly teamId: string
  readonly orgId: string
  readonly leaderEmployeeReleaseId: string
  readonly members: readonly { employeeReleaseId: string; role: string }[]
  readonly workflowTemplate: Readonly<Record<string, unknown>>
  readonly approvalPolicy: Readonly<Record<string, unknown>>
  readonly revision: number
  readonly createdAt: number
  readonly updatedAt: number
}

/** A person or immutable Agent release assigned to an enterprise team. */
export type TeamActorRef =
  | { readonly kind: 'human'; readonly userId: string }
  | { readonly kind: 'agent'; readonly employeeReleaseId: string }

/** A responsibility named by a team charter. */
export interface TeamRoleDefinition {
  readonly roleId: string
  readonly name: string
  readonly responsibility: string
}

/** One actor's chartered role. */
export interface TeamRosterMember {
  readonly actor: TeamActorRef
  readonly roleId: string
}

/** Evidence and human-review requirements applied to team results. */
export interface TeamVerificationPolicy {
  readonly verifierRequired?: boolean
  readonly rubricRefs?: readonly string[]
  readonly highRiskHumanReviewRequired?: boolean
}

/** Decision concentration and optional concurrency bounds for a team. */
export interface TeamAttentionPolicy {
  readonly decisionQueue?: 'centralized'
  readonly openDecisionLimit?: number
  readonly workInProgressLimit?: number
}

/** Definition lifecycle; archived definitions cannot return to another state. */
export type TeamDefinitionState = 'needs-charter' | 'active' | 'archived'

/** Durable charter and roster, separate from team execution state. */
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
  readonly approvalPolicy: Readonly<Record<string, unknown>>
  readonly revision: number
  readonly state: TeamDefinitionState
  readonly createdAt: number
  readonly updatedAt: number
}

/** Stable keyset page of organization-scoped team definitions. */
export interface TeamDefinitionPage {
  readonly items: readonly EnterpriseTeamDefinition[]
  readonly nextCursor?: string
}
/** Minimal Host-derived identity used only to constrain team-definition reads. */
export interface TeamDefinitionReadScope {
  readonly userId: string
  readonly isAdministrator: boolean
}
export interface PostgresQueryResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  readonly rows: readonly Row[]
  readonly rowCount: number | null
}
export interface PostgresDatabase {
  query<Row extends Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<PostgresQueryResult<Row>>
  transaction<T>(operation: (database: PostgresDatabase) => Promise<T>): Promise<T>
}

export interface EnterpriseOperationsRepositoryOptions {
  readonly now?: () => number
  /** HMAC-SHA256 key used for scope-bound opaque list cursors. Must be at least 32 bytes. */
  readonly cursorSigningKey?: Buffer | string
  readonly resolveSession?: (database: PostgresDatabase, orgId: string, sessionId: string) => boolean | Promise<boolean>
  readonly resolveRelease?: (database: PostgresDatabase, orgId: string, employeeReleaseId: string) => boolean | Promise<boolean>
  readonly resolveUser?: (database: PostgresDatabase, orgId: string, userId: string) => boolean | Promise<boolean>
  readonly resolveDepartment?: (database: PostgresDatabase, orgId: string, departmentId: string) => boolean | Promise<boolean>
  /** Explicit test/development escape hatch; production composition must omit it. */
  readonly allowUnverifiedReferences?: boolean
}
