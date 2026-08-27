import { z } from 'zod'

const id = z.string().min(1)
const revision = z.number().int().nonnegative()
const write = { expectedRevision: revision, idempotencyKey: id }
const source = z.enum(['console', 'schedule', 'wecom'])
const businessState = z.enum(['active', 'waiting-approval', 'completed', 'failed'])
const approvalKind = z.enum(['publish', 'tool', 'business', 'handoff'])
const approvalState = z.enum(['pending', 'approved', 'rejected', 'cancelled'])
const scheduleState = z.enum(['active', 'paused', 'archived'])
const target = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('employee'), employeeReleaseId: id }),
  z.object({ kind: z.literal('team'), teamId: id }),
])
export const enterpriseWorkRecordValueSchema = z.object({
  orgId: id,
  sessionId: id,
  employeeReleaseId: id,
  teamId: id.optional(),
  source,
  businessState,
  sourceReferences: z.record(z.string(), z.unknown()),
  revision: z.number().int().positive(),
  createdAt: z.number(),
  updatedAt: z.number(),
})
export const enterpriseApprovalValueSchema = z.object({
  approvalId: id,
  orgId: id,
  kind: approvalKind,
  subjectType: id,
  subjectId: id,
  requestedBy: id,
  state: approvalState,
  revision: z.number().int().positive(),
  reviewerUserId: id.optional(),
  reason: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
})
export const enterpriseScheduleValueSchema = z.object({
  scheduleId: id,
  orgId: id,
  target,
  timezone: id,
  rule: id,
  input: z.record(z.string(), z.unknown()),
  state: scheduleState,
  nextRunAt: z.number().nullable(),
  lastRunAt: z.number().nullable(),
  revision: z.number().int().positive(),
  createdAt: z.number(),
  updatedAt: z.number(),
})
const page = <T extends z.ZodType>(value: T) =>
  z.object({ items: z.array(value), nextCursor: id.optional() })
export const enterpriseOperationWorkRecordListRequestSchema = z
  .object({
    businessState: businessState.optional(),
    source: source.optional(),
    teamId: id.optional(),
    limit: z.number().int().min(1).max(100).optional(),
    cursor: id.optional(),
  })
  .strict()
export const enterpriseOperationWorkRecordListValueSchema = page(enterpriseWorkRecordValueSchema)
export const enterpriseOperationWorkRecordGetRequestSchema = z
  .object({ sessionId: id, employeeReleaseId: id })
  .strict()
export const enterpriseOperationWorkRecordUpdateRequestSchema = z
  .object({
    sessionId: id,
    employeeReleaseId: id,
    teamId: id.optional(),
    source,
    businessState,
    sourceReferences: z.record(z.string(), z.unknown()),
    ...write,
  })
  .strict()
export const enterpriseApprovalListRequestSchema = z
  .object({
    kind: approvalKind.optional(),
    state: approvalState.optional(),
    requestedBy: id.optional(),
    limit: z.number().int().min(1).max(100).optional(),
    cursor: id.optional(),
  })
  .strict()
export const enterpriseApprovalListValueSchema = page(enterpriseApprovalValueSchema)
export const enterpriseApprovalGetRequestSchema = z.object({ approvalId: id }).strict()
export const enterpriseApprovalCreateRequestSchema = z
  .object({ approvalId: id, kind: approvalKind, subjectType: id, subjectId: id, ...write })
  .strict()
export const enterpriseApprovalTransitionRequestSchema = z
  .object({
    approvalId: id,
    state: z.enum(['approved', 'rejected']),
    reason: z.string().optional(),
    ...write,
  })
  .strict()
export const enterpriseApprovalCancelRequestSchema = z
  .object({ approvalId: id, reason: z.string().optional(), ...write })
  .strict()
export const enterpriseScheduleListRequestSchema = z
  .object({
    state: scheduleState.optional(),
    limit: z.number().int().min(1).max(100).optional(),
    cursor: id.optional(),
  })
  .strict()
export const enterpriseScheduleListValueSchema = page(enterpriseScheduleValueSchema)
export const enterpriseScheduleGetRequestSchema = z.object({ scheduleId: id }).strict()
export const enterpriseScheduleSaveRequestSchema = z
  .object({
    scheduleId: id,
    target,
    timezone: id,
    rule: id,
    input: z.record(z.string(), z.unknown()),
    nextRunAt: z.number().nullable(),
    ...write,
  })
  .strict()
export const enterpriseScheduleTransitionRequestSchema = z
  .object({ scheduleId: id, state: scheduleState, ...write })
  .strict()
