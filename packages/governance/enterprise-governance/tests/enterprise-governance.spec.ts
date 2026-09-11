import { describe, expect, it } from 'vitest'
import {
  authorizeEnterprise,
  deploymentReadiness,
  governanceAuditEvent,
} from '../src/index.ts'

const resource = {
  orgId: 'org-a',
  creatorUserId: 'creator-1',
  visibility: 'restricted' as const,
  allowedUserIds: ['member-1'],
}

describe('enterprise authorization', () => {
  it('lets members pair and use only their own devices', () => {
    const member = { userId: 'member-1', orgId: 'org-a', roles: ['member'] as const }
    expect(authorizeEnterprise({ principal: member, action: 'device.manage' }))
      .toEqual({ allowed: true, reason: 'role' })
    expect(authorizeEnterprise({
      principal: member, action: 'device.execute',
      resource: { orgId: 'org-a', creatorUserId: member.userId, visibility: 'private' },
    })).toEqual({ allowed: true, reason: 'creator-owner' })
    expect(authorizeEnterprise({
      principal: member, action: 'device.execute',
      resource: { orgId: 'org-a', creatorUserId: 'other-user', visibility: 'private' },
    })).toEqual({ allowed: false, reason: 'insufficient-role' })
  })
  it('denies cross-organization access before considering roles', () => {
    expect(authorizeEnterprise({
      principal: { userId: 'admin-b', orgId: 'org-b', roles: ['administrator'] },
      action: 'employee.read',
      resource,
    })).toEqual({ allowed: false, reason: 'organization-mismatch' })
  })

  it('lets an administrator govern resources inside the organization', () => {
    const principal = { userId: 'admin-a', orgId: 'org-a', roles: ['administrator'] as const }
    for (const action of ['user.manage', 'model.manage', 'credential.manage', 'channel.manage'] as const) {
      expect(authorizeEnterprise({ principal, action, resource })).toEqual({ allowed: true, reason: 'administrator' })
    }
  })

  it('lets a member manage only a personal workspace they own', () => {
    const member = { userId: 'member-1', orgId: 'org-a', roles: ['member'] as const }
    expect(authorizeEnterprise({
      principal: member, action: 'workspace.manage',
      resource: { orgId: 'org-a', creatorUserId: 'member-1', visibility: 'private' },
    })).toEqual({ allowed: true, reason: 'creator-owner' })
    expect(authorizeEnterprise({
      principal: member, action: 'workspace.manage',
      resource: { orgId: 'org-a', creatorUserId: 'other', visibility: 'private' },
    })).toEqual({ allowed: false, reason: 'insufficient-role' })
  })

  it('lets creators create employees and update only employee definitions they own', () => {
    const principal = { userId: 'creator-1', orgId: 'org-a', roles: ['creator'] as const }
    expect(authorizeEnterprise({ principal, action: 'employee.create' }))
      .toEqual({ allowed: true, reason: 'role' })
    expect(authorizeEnterprise({ principal, action: 'employee.update', resource }))
      .toEqual({ allowed: true, reason: 'creator-owner' })
    expect(authorizeEnterprise({
      principal, action: 'employee.update', resource: { ...resource, creatorUserId: 'creator-2' },
    })).toEqual({ allowed: false, reason: 'insufficient-role' })
  })

  it('enforces private, restricted, and organization employee visibility', () => {
    const member = { userId: 'member-1', orgId: 'org-a', roles: ['member'] as const }
    expect(authorizeEnterprise({ principal: member, action: 'employee.read', resource }))
      .toEqual({ allowed: true, reason: 'resource-visible' })
    expect(authorizeEnterprise({
      principal: { ...member, userId: 'member-2' }, action: 'employee.read', resource,
    })).toEqual({ allowed: false, reason: 'resource-hidden' })
    expect(authorizeEnterprise({
      principal: member,
      action: 'session.read',
      resource: { ...resource, visibility: 'organization', allowedUserIds: [] },
    })).toEqual({ allowed: true, reason: 'resource-visible' })
  })

  it('keeps auditors read-only and limits audit access to auditors and administrators', () => {
    const auditor = { userId: 'audit-1', orgId: 'org-a', roles: ['auditor'] as const }
    expect(authorizeEnterprise({ principal: auditor, action: 'audit.read', resource }))
      .toEqual({ allowed: true, reason: 'auditor' })
    expect(authorizeEnterprise({ principal: auditor, action: 'employee.read', resource }))
      .toEqual({ allowed: true, reason: 'auditor' })
    expect(authorizeEnterprise({ principal: auditor, action: 'employee.update', resource }))
      .toEqual({ allowed: false, reason: 'insufficient-role' })
    expect(authorizeEnterprise({
      principal: { userId: 'member-1', orgId: 'org-a', roles: ['member'] },
      action: 'audit.read',
      resource,
    })).toEqual({ allowed: false, reason: 'insufficient-role' })
  })

  it('admits Cordis creation and review to authenticated members while reserving emergency governance for admins', () => {
    const member = { userId: 'member-1', orgId: 'org-a', roles: ['member'] as const }
    for (const action of ['plugin.read', 'plugin.create', 'plugin.review', 'plugin.publish'] as const) {
      expect(authorizeEnterprise({ principal: member, action, resource }))
        .toEqual({ allowed: true, reason: 'role' })
    }
    expect(authorizeEnterprise({ principal: member, action: 'plugin.manage', resource }))
      .toEqual({ allowed: false, reason: 'insufficient-role' })
  })

  it('keeps decision and autonomy central grants administrator-only while team execution remains role-based', () => {
    const operator = { userId: 'operator-a', orgId: 'org-a', roles: ['operator'] as const }
    const creator = { userId: 'creator-1', orgId: 'org-a', roles: ['creator'] as const }
    const member = { userId: 'member-1', orgId: 'org-a', roles: ['member'] as const }
    expect(authorizeEnterprise({ principal: operator, action: 'team.execute', resource }).allowed).toBe(true)
    expect(authorizeEnterprise({ principal: creator, action: 'team.autonomy.manage', resource }).allowed).toBe(false)
    expect(authorizeEnterprise({ principal: creator, action: 'team.decision.respond', resource }).allowed).toBe(false)
    expect(authorizeEnterprise({ principal: operator, action: 'team.decision.respond', resource }).allowed).toBe(false)
    for (const action of ['team.execute', 'team.autonomy.manage', 'team.decision.respond'] as const)
      expect(authorizeEnterprise({ principal: member, action, resource }).allowed).toBe(false)
  })
})

describe('enterprise deployment and audit', () => {
  it('makes LAN readiness depend on identity, RBAC, encrypted secrets, audit, and one port', () => {
    expect(deploymentReadiness({
      mode: 'lan', authenticatedIdentity: false, rbac: false, encryptedCredentials: false,
      auditLog: false, tls: false, singlePort: false,
    })).toEqual({
      ready: false,
      issues: [
        'identity-provider-required', 'rbac-required', 'encrypted-credentials-required',
        'audit-sink-required', 'single-port-required',
      ],
    })
  })

  it('requires TLS for Public mode but not for a complete LAN deployment', () => {
    const complete = {
      authenticatedIdentity: true, rbac: true, encryptedCredentials: true,
      auditLog: true, tls: false, singlePort: true,
    }
    expect(deploymentReadiness({ mode: 'lan', ...complete })).toEqual({ ready: true, issues: [] })
    expect(deploymentReadiness({ mode: 'public', ...complete }))
      .toEqual({ ready: false, issues: ['tls-required'] })
  })

  it('keeps desktop local identity optional but still requires protected secrets and one-port packaging', () => {
    expect(deploymentReadiness({
      mode: 'desktop', authenticatedIdentity: false, rbac: false, encryptedCredentials: true,
      auditLog: true, tls: false, singlePort: true,
    })).toEqual({ ready: true, issues: [] })
  })

  it('creates attributable governance audit facts without accepting secret payloads', () => {
    expect(governanceAuditEvent({
      orgId: 'org-a', actorUserId: 'admin-a', action: 'credential.manage',
      resourceType: 'credential-ref', resourceId: 'wecom/main', decision: 'allowed',
      reason: 'administrator', correlationId: 'request-9', at: 1_787_739_600_000,
    })).toEqual({
      type: 'governance/action', orgId: 'org-a', actorUserId: 'admin-a',
      action: 'credential.manage', resourceType: 'credential-ref', resourceId: 'wecom/main',
      decision: 'allowed', reason: 'administrator', correlationId: 'request-9', at: 1_787_739_600_000,
    })
  })
})
