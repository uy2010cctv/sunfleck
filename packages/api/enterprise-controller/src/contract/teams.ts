export interface EnterpriseTeamMember {
  employeeReleaseId: string
  role: string
}
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
export interface EnterpriseTeamPage {
  items: readonly EnterpriseTeam[]
  nextCursor?: string
}
export interface EnterpriseTeamListRequest { readonly limit?: number; readonly cursor?: string }
export interface EnterpriseTeamLookup { readonly teamId: string }
export interface EnterpriseTeamSaveRequest {
  readonly teamId: string
  readonly leaderEmployeeReleaseId: string
  readonly members: readonly EnterpriseTeamMember[]
  readonly workflowTemplate: Readonly<Record<string, JsonValue>>
  readonly approvalPolicy: Readonly<Record<string, JsonValue>>
  readonly expectedRevision: number
  readonly idempotencyKey: string
}
import type { JsonValue } from '@deepseek-ai/dsh-session/types'
