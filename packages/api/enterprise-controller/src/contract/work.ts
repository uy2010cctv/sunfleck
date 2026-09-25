/** Goal-first enterprise work Remote contracts. */
/** Employee identity and immutable release selected for a Session's base work mode. */
export interface EmployeeReleaseSelection {
  readonly employeeId: string
  readonly releaseId: string
  readonly releaseVersion?: number | undefined
  readonly orgId: string
  readonly ownerUserId: string
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Required replay fact for the employee prompt, capabilities, and private memory. */
    'enterprise-employee/selected': EmployeeReleaseSelection
    /** Return a still-blank Session to its base Agent preset alone. */
    'enterprise-employee/cleared': Record<string, never>
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    enterpriseEmployeeRelease: EmployeeReleaseSelection | null
  }
  interface SessionProjectionMap {
    enterpriseEmployeeRelease: Pick<EmployeeReleaseSelection, 'employeeId' | 'releaseId' | 'releaseVersion'> | null
  }
}

export interface WorkspaceEmployeeDefaultRequest { readonly workspaceId: string }
/** Revision-checked workspace selection. Null clears the employee. */
export interface WorkspaceEmployeeDefaultSaveRequest extends WorkspaceEmployeeDefaultRequest {
  readonly employeeId: string | null
  readonly expectedRevision: number
}
/** Caller-safe configuration; hidden or retired employees are not exposed. */
export interface WorkspaceEmployeeDefaultView extends WorkspaceEmployeeDefaultRequest {
  readonly employeeId: string | null
  readonly revision: number
  readonly unavailable: boolean
  readonly manageable: boolean
}

/** Bind a published employee to an authorized blank Session in its current Workspace. */
export interface EnterpriseEmployeeSessionRequest {
  readonly sessionId: string
  readonly employeeId: string
}
/** Employee release actually selected for the blank Session. */
export interface EnterpriseEmployeeSessionValue extends EnterpriseEmployeeSessionRequest {
  readonly workspaceId: string
  readonly employeeReleaseId: string
  readonly releaseVersion: number
}

export interface EnterpriseWorkPrepareRequest {
  readonly objective: string
  readonly deadline?: string
  readonly workspaceId?: string
  readonly currentSessionId?: string
  readonly recentWorkspaceId?: string
  readonly preferredEmployeeReleaseId?: string
}

/** Data used by `EnterpriseWorkStartRequest`. */
export interface EnterpriseWorkStartRequest extends EnterpriseWorkPrepareRequest {
  readonly idempotencyKey: string
}

/** Allowed values for `EnterpriseWorkPreparation`. */
export type EnterpriseWorkPreparation =
  | { readonly kind: 'ready'; readonly workspaceId: string; readonly employeeReleaseId: string }
  | { readonly kind: 'needs-workspace-selection'; readonly availableWorkspaceIds: readonly string[] }
  | { readonly kind: 'needs-selection'; readonly workspaceId: string; readonly availableEmployeeReleaseIds: readonly string[] }

/** Data used by `EnterpriseWorkStartValue`. */
export interface EnterpriseWorkStartValue {
  readonly sessionId: string
  readonly workspaceId: string
  readonly employeeReleaseId: string
  readonly executionSummary: string
}
