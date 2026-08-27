import type { RpcRequest, RpcResponse } from './rpc.ts'

export type EnterpriseBusinessState = 'active' | 'waiting-approval' | 'completed' | 'failed'
export interface EnterpriseWorkRecord { orgId: string; sessionId: string; employeeReleaseId: string; teamId?: string; source: 'console' | 'schedule' | 'wecom'; businessState: EnterpriseBusinessState; sourceReferences: Readonly<Record<string, unknown>>; revision: number; createdAt: number; updatedAt: number }
export interface EnterpriseApproval { approvalId: string; orgId: string; kind: 'publish' | 'tool' | 'business' | 'handoff'; subjectType: string; subjectId: string; requestedBy: string; state: 'pending' | 'approved' | 'rejected' | 'cancelled'; revision: number; reviewerUserId?: string; reason?: string; createdAt: number; updatedAt: number }
export type EnterpriseScheduleTarget = { kind: 'employee'; employeeReleaseId: string } | { kind: 'team'; teamId: string }
export interface EnterpriseSchedule { scheduleId: string; orgId: string; target: EnterpriseScheduleTarget; timezone: string; rule: string; input: Readonly<Record<string, unknown>>; state: 'active' | 'paused' | 'archived'; nextRunAt: number | null; lastRunAt: number | null; revision: number; createdAt: number; updatedAt: number }
export interface EnterprisePage<T> { items: readonly T[]; nextCursor?: string }
export interface EnterpriseOperationsApi {
  listWorkRecords(request: RpcRequest<{ businessState?: EnterpriseBusinessState; source?: EnterpriseWorkRecord['source']; teamId?: string; limit?: number; cursor?: string }>): Promise<RpcResponse<EnterprisePage<EnterpriseWorkRecord>>>
  getWorkRecord(request: RpcRequest<{ sessionId: string; employeeReleaseId: string }>): Promise<RpcResponse<EnterpriseWorkRecord>>
  updateWorkRecord(request: RpcRequest<{ sessionId: string; employeeReleaseId: string; teamId?: string; source: EnterpriseWorkRecord['source']; businessState: EnterpriseBusinessState; sourceReferences: Readonly<Record<string, unknown>>; expectedRevision: number; idempotencyKey: string }>): Promise<RpcResponse<EnterpriseWorkRecord>>
  listApprovals(request: RpcRequest<{ kind?: EnterpriseApproval['kind']; state?: EnterpriseApproval['state']; requestedBy?: string; limit?: number; cursor?: string }>): Promise<RpcResponse<EnterprisePage<EnterpriseApproval>>>
  getApproval(request: RpcRequest<{ approvalId: string }>): Promise<RpcResponse<EnterpriseApproval>>
  createApproval(request: RpcRequest<{ approvalId: string; kind: EnterpriseApproval['kind']; subjectType: string; subjectId: string; expectedRevision: number; idempotencyKey: string }>): Promise<RpcResponse<EnterpriseApproval>>
  transitionApproval(request: RpcRequest<{ approvalId: string; state: 'approved' | 'rejected'; reason?: string; expectedRevision: number; idempotencyKey: string }>): Promise<RpcResponse<EnterpriseApproval>>
  cancelApproval(request: RpcRequest<{ approvalId: string; reason?: string; expectedRevision: number; idempotencyKey: string }>): Promise<RpcResponse<EnterpriseApproval>>
  listSchedules(request: RpcRequest<{ state?: EnterpriseSchedule['state']; limit?: number; cursor?: string }>): Promise<RpcResponse<EnterprisePage<EnterpriseSchedule>>>
  getSchedule(request: RpcRequest<{ scheduleId: string }>): Promise<RpcResponse<EnterpriseSchedule>>
  saveSchedule(request: RpcRequest<{ scheduleId: string; target: EnterpriseScheduleTarget; timezone: string; rule: string; input: Readonly<Record<string, unknown>>; nextRunAt: number | null; expectedRevision: number; idempotencyKey: string }>): Promise<RpcResponse<EnterpriseSchedule>>
  transitionSchedule(request: RpcRequest<{ scheduleId: string; state: EnterpriseSchedule['state']; expectedRevision: number; idempotencyKey: string }>): Promise<RpcResponse<EnterpriseSchedule>>
}
