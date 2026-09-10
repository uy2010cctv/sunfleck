export type EnterpriseBusinessState = 'active' | 'waiting-approval' | 'completed' | 'failed'
export interface EnterpriseWorkRecord {
  orgId: string
  sessionId: string
  employeeReleaseId: string
  teamId?: string
  source: 'console' | 'schedule' | 'wecom'
  businessState: EnterpriseBusinessState
  sourceReferences: Readonly<Record<string, JsonValue>>
  revision: number
  createdAt: number
  updatedAt: number
}
export interface EnterpriseApproval {
  approvalId: string
  orgId: string
  kind: 'publish' | 'tool' | 'business' | 'handoff'
  subjectType: string
  subjectId: string
  requestedBy: string
  state: 'pending' | 'approved' | 'rejected' | 'cancelled'
  revision: number
  reviewerUserId?: string
  reason?: string
  createdAt: number
  updatedAt: number
}
export type EnterpriseScheduleTarget =
  | { kind: 'employee'; employeeReleaseId: string }
  | { kind: 'team'; teamId: string }
export interface EnterpriseSchedule {
  scheduleId: string
  orgId: string
  target: EnterpriseScheduleTarget
  timezone: string
  rule: string
  input: Readonly<Record<string, JsonValue>>
  state: 'active' | 'paused' | 'archived'
  nextRunAt: number | null
  lastRunAt: number | null
  revision: number
  createdAt: number
  updatedAt: number
}
export interface EnterprisePage<T> {
  items: readonly T[]
  nextCursor?: string
}
export interface EnterpriseWorkRecordListRequest {
  readonly businessState?: EnterpriseBusinessState
  readonly source?: EnterpriseWorkRecord['source']
  readonly teamId?: string
  readonly limit?: number
  readonly cursor?: string
}
export interface EnterpriseWorkRecordLookup {
  readonly sessionId: string
  readonly employeeReleaseId: string
}
export interface EnterpriseWorkRecordUpdateRequest {
  readonly sessionId: string
  readonly employeeReleaseId: string
  readonly teamId?: string
  readonly source: EnterpriseWorkRecord['source']
  readonly businessState: EnterpriseBusinessState
  readonly sourceReferences: Readonly<Record<string, JsonValue>>
  readonly expectedRevision: number
  readonly idempotencyKey: string
}
export interface EnterpriseApprovalListRequest {
  readonly kind?: EnterpriseApproval['kind']
  readonly state?: EnterpriseApproval['state']
  readonly requestedBy?: string
  readonly limit?: number
  readonly cursor?: string
}
export interface EnterpriseApprovalLookup { readonly approvalId: string }
export interface EnterpriseApprovalCreateRequest {
  readonly approvalId: string
  readonly kind: EnterpriseApproval['kind']
  readonly subjectType: string
  readonly subjectId: string
  readonly expectedRevision: number
  readonly idempotencyKey: string
}
export interface EnterpriseApprovalTransitionRequest {
  readonly approvalId: string
  readonly state: 'approved' | 'rejected'
  readonly reason?: string
  readonly expectedRevision: number
  readonly idempotencyKey: string
}
export interface EnterpriseApprovalCancelRequest {
  readonly approvalId: string
  readonly reason?: string
  readonly expectedRevision: number
  readonly idempotencyKey: string
}
export interface EnterpriseScheduleListRequest {
  readonly state?: EnterpriseSchedule['state']
  readonly limit?: number
  readonly cursor?: string
}
export interface EnterpriseScheduleLookup { readonly scheduleId: string }
export interface EnterpriseScheduleSaveRequest {
  readonly scheduleId: string
  readonly target: EnterpriseScheduleTarget
  readonly timezone: string
  readonly rule: string
  readonly input: Readonly<Record<string, JsonValue>>
  readonly nextRunAt: number | null
  readonly expectedRevision: number
  readonly idempotencyKey: string
}
export interface EnterpriseScheduleTransitionRequest {
  readonly scheduleId: string
  readonly state: EnterpriseSchedule['state']
  readonly expectedRevision: number
  readonly idempotencyKey: string
}
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
