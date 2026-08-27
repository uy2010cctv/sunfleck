import type { RpcRequest, RpcResponse } from './rpc.ts'

export interface EnterpriseTeamMember {
  employeeReleaseId: string
  role: string
}
export interface EnterpriseTeam {
  teamId: string
  orgId: string
  leaderEmployeeReleaseId: string
  members: readonly EnterpriseTeamMember[]
  workflowTemplate: Readonly<Record<string, unknown>>
  approvalPolicy: Readonly<Record<string, unknown>>
  revision: number
  createdAt: number
  updatedAt: number
}
export interface EnterpriseTeamPage {
  items: readonly EnterpriseTeam[]
  nextCursor?: string
}
export interface EnterpriseTeamsApi {
  list(
    request: RpcRequest<{ limit?: number; cursor?: string }>,
  ): Promise<RpcResponse<EnterpriseTeamPage>>
  get(request: RpcRequest<{ teamId: string }>): Promise<RpcResponse<EnterpriseTeam>>
  save(
    request: RpcRequest<{
      teamId: string
      leaderEmployeeReleaseId: string
      members: readonly EnterpriseTeamMember[]
      workflowTemplate: Readonly<Record<string, unknown>>
      approvalPolicy: Readonly<Record<string, unknown>>
      expectedRevision: number
      idempotencyKey: string
    }>,
  ): Promise<RpcResponse<EnterpriseTeam>>
}
