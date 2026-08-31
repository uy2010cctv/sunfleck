import { describe, expect, it } from 'vitest'
import {
  EnterpriseOperationsError,
  assertTeamDefinitionExecutable,
  validateTeamDefinition,
  type EnterpriseTeamDefinition,
} from '../src/index.ts'

function definition(overrides: Partial<EnterpriseTeamDefinition> = {}): EnterpriseTeamDefinition {
  return {
    teamId: 'team-a', orgId: 'org-a', name: 'Finance close', northStar: 'Close the books with verified evidence.',
    ownerUserId: 'owner-a', visibility: 'restricted', allowedUserIds: ['owner-a'],
    leaderEmployeeReleaseId: 'release-a',
    roles: [
      { roleId: 'owner', name: 'Owner', responsibility: 'Own the close decision.' },
      { roleId: 'analyst', name: 'Analyst', responsibility: 'Prepare evidence.' },
    ],
    roster: [
      { actor: { kind: 'human', userId: 'owner-a' }, roleId: 'owner' },
      { actor: { kind: 'agent', employeeReleaseId: 'release-a' }, roleId: 'analyst' },
    ],
    verificationPolicy: {
      verifierRequired: true, rubricRefs: ['rubric://finance-close'], highRiskHumanReviewRequired: true,
    },
    attentionPolicy: { decisionQueue: 'centralized', openDecisionLimit: 5, workInProgressLimit: 3 },
    approvalPolicy: {}, revision: 1, state: 'active', createdAt: 1, updatedAt: 1,
    ...overrides,
  }
}

describe('enterprise team definition validation', () => {
  it('accepts an active human and Agent roster whose roles and policies are complete', () => {
    expect(() => validateTeamDefinition(definition())).not.toThrow()
    expect(() => assertTeamDefinitionExecutable(definition())).not.toThrow()
  })

  it.each([
    ['blank name', { name: ' ' }],
    ['blank north star', { northStar: '' }],
    ['owner absent from roster', { ownerUserId: 'missing-owner' }],
    ['leader absent from roster', { leaderEmployeeReleaseId: 'missing-release' }],
    ['duplicate role id', { roles: [
      { roleId: 'owner', name: 'Owner', responsibility: 'Own.' },
      { roleId: 'owner', name: 'Duplicate', responsibility: 'Duplicate.' },
    ] }],
    ['duplicate actor', { roster: [
      { actor: { kind: 'human' as const, userId: 'owner-a' }, roleId: 'owner' },
      { actor: { kind: 'human' as const, userId: 'owner-a' }, roleId: 'analyst' },
      { actor: { kind: 'agent' as const, employeeReleaseId: 'release-a' }, roleId: 'analyst' },
    ] }],
    ['unknown roster role', { roster: [
      { actor: { kind: 'human' as const, userId: 'owner-a' }, roleId: 'missing' },
      { actor: { kind: 'agent' as const, employeeReleaseId: 'release-a' }, roleId: 'analyst' },
    ] }],
    ['allowed users on organization visibility', { visibility: 'organization', allowedUserIds: ['owner-a'] }],
    ['missing verification field', { verificationPolicy: { verifierRequired: true } }],
    ['missing attention queue', { attentionPolicy: { openDecisionLimit: 5 } }],
    ['invalid work limit', { attentionPolicy: { decisionQueue: 'centralized', workInProgressLimit: 0 } }],
  ] satisfies readonly [string, Partial<EnterpriseTeamDefinition>][])('rejects an active definition with %s', (_name, update) => {
    expect(() => validateTeamDefinition(definition(update))).toThrow(EnterpriseOperationsError)
  })

  it('allows incomplete migrated charters but never treats them as executable', () => {
    const migrated = definition({
      name: '', northStar: '', state: 'needs-charter', roles: [
        { roleId: 'analyst', name: 'analyst', responsibility: '' },
      ],
      verificationPolicy: {}, attentionPolicy: {},
    })
    expect(() => validateTeamDefinition(migrated)).not.toThrow()
    expect(() => assertTeamDefinitionExecutable(migrated)).toThrow(EnterpriseOperationsError)
  })
})
