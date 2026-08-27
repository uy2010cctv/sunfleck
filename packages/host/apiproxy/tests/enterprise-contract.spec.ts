import { describe, expect, it } from 'vitest'
import {
  enterpriseEmployeeSaveDraftRequestSchema,
  enterpriseEmployeePublishRequestSchema,
} from '../src/api/enterprise-employees.schema.ts'
import { enterpriseAssetArchiveRequestSchema } from '../src/api/enterprise-assets.schema.ts'
import { enterpriseTeamSaveRequestSchema } from '../src/api/enterprise-teams.schema.ts'
import {
  enterpriseApprovalCreateRequestSchema,
  enterpriseOperationWorkRecordUpdateRequestSchema,
} from '../src/api/enterprise-operations.schema.ts'

describe('enterprise ApiProxy wire contracts', () => {
  it('never accepts caller-supplied identity or organization scope', () => {
    const employee = {
      presetId: 'employee-1',
      expectedRevision: 0,
      idempotencyKey: 'idem-1',
      visibility: 'organization',
      profile: {},
      bindings: [],
      principal: { userId: 'attacker' },
      orgId: 'other',
    }
    expect(enterpriseEmployeeSaveDraftRequestSchema.safeParse(employee).success).toBe(false)
    expect(
      enterpriseEmployeeSaveDraftRequestSchema.safeParse({
        presetId: employee.presetId,
        expectedRevision: 0,
        idempotencyKey: 'idem-1',
        visibility: 'organization',
        profile: {},
        bindings: [],
      }).success,
    ).toBe(true)
  })

  it('requires optimistic concurrency and idempotency on every mutation', () => {
    const invalidMutations = [
      [enterpriseEmployeePublishRequestSchema, { presetId: 'employee-1' }],
      [enterpriseAssetArchiveRequestSchema, { assetId: 'asset-1' }],
      [
        enterpriseTeamSaveRequestSchema,
        {
          teamId: 'team-1',
          leaderEmployeeReleaseId: 'release-1',
          members: [],
          workflowTemplate: {},
          approvalPolicy: {},
        },
      ],
      [
        enterpriseOperationWorkRecordUpdateRequestSchema,
        {
          sessionId: 'session-1',
          employeeReleaseId: 'release-1',
          source: 'console',
          businessState: 'active',
          sourceReferences: {},
        },
      ],
      [
        enterpriseApprovalCreateRequestSchema,
        {
          approvalId: 'approval-1',
          kind: 'business',
          subjectType: 'order',
          subjectId: 'order-1',
        },
      ],
    ] as const
    for (const [schema, payload] of invalidMutations) {
      expect(schema.safeParse(payload).success).toBe(false)
    }
  })
})
