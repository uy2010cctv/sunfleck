import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  EnterpriseIdentityRepository,
  sessionTokenHash,
  type EnterpriseAuditRecord,
} from '../src/index.ts'

describe('EnterpriseIdentityRepository', () => {
  let root: string
  let path: string
  let repository: EnterpriseIdentityRepository
  let now: number

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-enterprise-identity-'))
    path = join(root, 'enterprise.sqlite')
    now = Date.UTC(2026, 7, 26, 12)
    repository = new EnterpriseIdentityRepository(path, { now: () => now })
    repository.createOrganization({ id: 'org-a', name: '深度求索' })
    repository.createUser({
      id: 'user-1', orgId: 'org-a', username: 'alice', displayName: 'Alice', disabled: false,
    })
  })

  afterEach(async () => {
    repository.close()
    await rm(root, { recursive: true, force: true })
  })

  it('persists organizations, users, and role memberships across restart', () => {
    repository.setRoles('user-1', ['administrator', 'auditor'])
    repository.close()

    repository = new EnterpriseIdentityRepository(path, { now: () => now })
    expect(repository.listOrganizations()).toEqual([{ id: 'org-a', name: '深度求索' }])
    expect(repository.listUsers('org-a')).toEqual([{
      id: 'user-1', orgId: 'org-a', username: 'alice', displayName: 'Alice', disabled: false,
      roles: ['administrator', 'auditor'],
    }])
  })

  it('binds multiple external provider identities to one canonical user', () => {
    repository.bindExternalIdentity({ providerId: 'oidc-main', subject: 'oidc-alice', userId: 'user-1' })
    repository.bindExternalIdentity({ providerId: 'ldap-main', subject: 'cn=alice,dc=example', userId: 'user-1' })

    expect(repository.resolveExternalIdentity('oidc-main', 'oidc-alice')?.id).toBe('user-1')
    expect(repository.resolveExternalIdentity('ldap-main', 'cn=alice,dc=example')?.id).toBe('user-1')
  })

  it('stores only a hash of bearer sessions and rejects expired or revoked sessions', () => {
    const token = 'session-secret-with-256-bits-of-randomness'
    repository.createSession({ token, userId: 'user-1', expiresAt: now + 60_000 })
    expect(repository.authenticateSession(token)).toMatchObject({
      userId: 'user-1', orgId: 'org-a', roles: [],
    })

    const raw = new DatabaseSync(path)
    const row = raw.prepare('SELECT token_hash FROM auth_sessions').get() as { token_hash: string }
    raw.close()
    expect(row.token_hash).toBe(sessionTokenHash(token))
    expect(row.token_hash).not.toContain(token)

    now += 60_001
    expect(repository.authenticateSession(token)).toBeUndefined()
    now -= 60_001
    repository.revokeSession(token)
    expect(repository.authenticateSession(token)).toBeUndefined()
  })

  it('persists password verifiers without exposing them in user views', () => {
    repository.setPasswordVerifier('user-1', 'scrypt$parameters$salt$digest')
    expect(repository.passwordLoginRecord('org-a', 'alice')).toEqual({
      userId: 'user-1', disabled: false, verifier: 'scrypt$parameters$salt$digest',
    })
    expect(JSON.stringify(repository.listUsers('org-a'))).not.toContain('scrypt')
  })

  it('stores employee and session visibility policies with named allowed users', () => {
    repository.putResourcePolicy({
      resourceType: 'employee', resourceId: 'support', orgId: 'org-a', creatorUserId: 'user-1',
      visibility: 'restricted', allowedUserIds: ['user-2', 'user-3'],
    })
    expect(repository.resourcePolicy('employee', 'support')).toEqual({
      resourceType: 'employee', resourceId: 'support', orgId: 'org-a', creatorUserId: 'user-1',
      visibility: 'restricted', allowedUserIds: ['user-2', 'user-3'],
    })
  })

  it('persists channel, model, and capability administration records without secret fields', () => {
    repository.putManagedAsset({
      orgId: 'org-a', type: 'channel', id: 'wecom-main', name: '企微主渠道',
      config: { provider: 'wecom-bot', employeeIds: ['support'], defaultEmployeeId: 'support' },
    })
    repository.putManagedAsset({
      orgId: 'org-a', type: 'model', id: 'deepseek-v4', name: 'DeepSeek V4',
      config: { settingsNamespace: 'llm-deepseek' },
    })
    expect(repository.listManagedAssets('org-a')).toEqual([
      expect.objectContaining({ type: 'channel', id: 'wecom-main' }),
      expect.objectContaining({ type: 'model', id: 'deepseek-v4' }),
    ])
    expect(() => { repository.putManagedAsset({
      orgId: 'org-a', type: 'channel', id: 'bad', name: 'Bad', config: { token: 'secret' },
    }) }).toThrow(/secret-bearing field/)
  })

  it('appends ordered attributable audit records and filters them without secret payloads', () => {
    const first: EnterpriseAuditRecord = {
      id: 'audit-1', orgId: 'org-a', actorUserId: 'user-1', action: 'user.manage',
      resourceType: 'user', resourceId: 'user-1', decision: 'allowed', reason: 'administrator',
      correlationId: 'request-1', at: now, details: { changedFields: ['roles'] },
    }
    repository.appendAudit(first)
    repository.appendAudit({
      ...first, id: 'audit-2', action: 'credential.manage', resourceType: 'credential-ref',
      resourceId: 'WE_COM_TOKEN', correlationId: 'request-2', at: now + 1, details: {},
    })

    expect(repository.listAudit({ orgId: 'org-a', action: 'credential.manage', limit: 10 }))
      .toEqual([expect.objectContaining({ id: 'audit-2', correlationId: 'request-2' })])
    expect(JSON.stringify(repository.listAudit({ orgId: 'org-a', limit: 10 }))).not.toContain('secret')
  })

  it('disables users and invalidates all of their sessions', () => {
    repository.createSession({ token: 'token-a', userId: 'user-1', expiresAt: now + 60_000 })
    repository.setUserDisabled('user-1', true)
    expect(repository.authenticateSession('token-a')).toBeUndefined()
    expect(repository.listUsers('org-a')[0]?.disabled).toBe(true)
  })
})
