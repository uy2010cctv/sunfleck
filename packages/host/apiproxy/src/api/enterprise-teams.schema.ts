import { z } from 'zod'

const id = z.string().min(1)
const member = z.object({ employeeReleaseId: id, role: id }).strict()
export const enterpriseTeamValueSchema = z.object({ teamId: id, orgId: id, leaderEmployeeReleaseId: id, members: z.array(member), workflowTemplate: z.record(z.string(), z.unknown()), approvalPolicy: z.record(z.string(), z.unknown()), revision: z.number().int().positive(), createdAt: z.number(), updatedAt: z.number() })
export const enterpriseTeamListRequestSchema = z.object({ limit: z.number().int().min(1).max(100).optional(), cursor: id.optional() }).strict()
export const enterpriseTeamListValueSchema = z.object({ items: z.array(enterpriseTeamValueSchema), nextCursor: id.optional() })
export const enterpriseTeamGetRequestSchema = z.object({ teamId: id }).strict()
export const enterpriseTeamSaveRequestSchema = z.object({ teamId: id, leaderEmployeeReleaseId: id, members: z.array(member), workflowTemplate: z.record(z.string(), z.unknown()), approvalPolicy: z.record(z.string(), z.unknown()), expectedRevision: z.number().int().nonnegative(), idempotencyKey: id }).strict()
