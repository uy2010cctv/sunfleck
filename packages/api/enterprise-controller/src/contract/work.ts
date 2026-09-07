/** Goal-first enterprise work Remote contracts. */
export interface EnterpriseWorkPrepareRequest {
  readonly objective: string
  readonly deadline?: string
  readonly workspaceId?: string
  readonly currentSessionId?: string
  readonly recentWorkspaceId?: string
  readonly preferredEmployeeReleaseId?: string
}

export interface EnterpriseWorkStartRequest extends EnterpriseWorkPrepareRequest {
  readonly idempotencyKey: string
}

export type EnterpriseWorkPreparation =
  | { readonly kind: 'ready'; readonly workspaceId: string; readonly employeeReleaseId: string }
  | { readonly kind: 'needs-workspace-selection'; readonly availableWorkspaceIds: readonly string[] }
  | { readonly kind: 'needs-selection'; readonly workspaceId: string; readonly availableEmployeeReleaseIds: readonly string[] }

export interface EnterpriseWorkStartValue {
  readonly sessionId: string
  readonly workspaceId: string
  readonly employeeReleaseId: string
  readonly executionSummary: string
}
