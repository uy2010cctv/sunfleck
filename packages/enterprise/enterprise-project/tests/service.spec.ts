import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { apply, EnterpriseProjectError, EnterpriseProjectRepository, EnterpriseProjectService, projectId } from '../src/index.ts'
import type { EnterpriseProjects, Project } from '../src/index.ts'
import { MemoryProjectDatabase } from './memory-postgres.ts'

function makeService(): EnterpriseProjects {
  return new EnterpriseProjectService(new EnterpriseProjectRepository(new MemoryProjectDatabase()))
}

const baseInput = {
  orgId: 'org-a', name: 'Support', goal: 'Ship support.', workspacePath: '/managed/projects/support',
  createdBy: 'owner-a',
} as const

async function createFixture(service: EnterpriseProjects, visibility: Project['visibility'], overrides: {
  name?: string
  createdBy?: string
  orgId?: string
  allowedUserIds?: string[]
} = {}): Promise<Project> {
  return service.create({
    ...baseInput, visibility, ...(overrides.allowedUserIds === undefined ? {} : { allowedUserIds: overrides.allowedUserIds }),
    name: overrides.name ?? baseInput.name,
    createdBy: overrides.createdBy ?? baseInput.createdBy, orgId: overrides.orgId ?? baseInput.orgId,
  })
}

describe('EnterpriseProjectService.create', () => {
  it('creates an organization-visible project with its creator as the first user member', async () => {
    const service = makeService()
    const created = await createFixture(service, 'organization')

    expect(created.state).toBe('active')
    expect(created.visibility).toBe('organization')
    expect(created.allowedUserIds).toEqual([])
    expect('teamDefinitionId' in created).toBe(false)
    expect('archivedAt' in created).toBe(false)
    await expect(service.listMembers(created.projectId)).resolves.toEqual([{
      projectId: created.projectId, principalType: 'user', principalId: 'owner-a', addedBy: 'owner-a',
      addedAt: created.createdAt,
    }])
    await expect(service.get(created.projectId)).resolves.toEqual(created)
  })

  it('round-trips a team definition binding and restricted allowed ids', async () => {
    const service = makeService()
    const created = await service.create({
      ...baseInput, visibility: 'restricted', teamDefinitionId: 'team-a', allowedUserIds: ['user-b', 'user-c', 'user-b'],
    })

    expect(created.teamDefinitionId).toBe('team-a')
    expect(created.visibility).toBe('restricted')
    expect(created.allowedUserIds).toEqual(['user-b', 'user-c'])
  })

  it('rejects empty names, goals, creators, relative workspaces, and empty allowed ids', async () => {
    const service = makeService()
    await expect(createFixture(service, 'organization', { name: '   ' })).rejects.toThrow(TypeError)
    await expect(service.create({ ...baseInput, goal: '' })).rejects.toThrow(/goal/)
    await expect(service.create({ ...baseInput, createdBy: '  ' })).rejects.toThrow(/createdBy/)
    await expect(service.create({ ...baseInput, workspacePath: 'managed/projects/support' })).rejects.toThrow(/absolute path/)
    await expect(service.create({ ...baseInput, visibility: 'restricted', allowedUserIds: ['user-b', ' '] }))
      .rejects.toThrow(/allowedUserIds/)
  })
})

describe('EnterpriseProjectService.list', () => {
  it('returns every organization project without a viewer', async () => {
    const service = makeService()
    const organization = await createFixture(service, 'organization')
    const secret = await createFixture(service, 'private', { name: 'Secret', createdBy: 'owner-secret' })

    const listed = await service.list('org-a')
    expect(listed.map(project => project.projectId).sort()).toEqual(
      [organization.projectId, secret.projectId].sort(),
    )
    expect(await service.list('org-other')).toEqual([])
  })

  it('applies the visibility union of organization, private creator, and restricted allowlist', async () => {
    const service = makeService()
    const organization = await createFixture(service, 'organization')
    const secret = await createFixture(service, 'private', { name: 'Secret', createdBy: 'owner-secret' })
    const restricted = await createFixture(service, 'restricted', { allowedUserIds: ['user-b'] })

    const creatorView = await service.list('org-a', { userId: 'owner-secret' })
    expect(creatorView.map(project => project.projectId).sort())
      .toEqual([organization.projectId, secret.projectId].sort())

    const allowedView = await service.list('org-a', { userId: 'user-b' })
    expect(allowedView.map(project => project.projectId).sort())
      .toEqual([organization.projectId, restricted.projectId].sort())

    const outsiderView = await service.list('org-a', { userId: 'user-outsider' })
    expect(outsiderView.map(project => project.projectId)).toEqual([organization.projectId])
  })

  it('lets an administrator see every project and never leaks other organizations', async () => {
    const service = makeService()
    const home = await createFixture(service, 'private')
    await createFixture(service, 'private', { orgId: 'org-b' })

    const administrator = await service.list('org-a', { userId: 'auditor', roles: ['administrator'] })
    expect(administrator.map(project => project.projectId)).toEqual([home.projectId])
    expect(await service.list('org-b', { userId: 'auditor' })).toEqual([])
  })
})

describe('EnterpriseProjectService.members', () => {
  it('adds and removes user and employee members in addition order', async () => {
    const service = makeService()
    const project = await createFixture(service, 'organization')
    const creator = {
      projectId: project.projectId, principalType: 'user' as const, principalId: 'owner-a',
      addedBy: 'owner-a', addedAt: project.createdAt,
    }
    await service.addMember(project.projectId, {
      principalType: 'employee', principalId: 'employee-a', addedBy: 'owner-a',
    })
    const user = await service.addMember(project.projectId, {
      principalType: 'user', principalId: 'user-b', addedBy: 'owner-a',
    })

    const listed = await service.listMembers(project.projectId)
    expect(listed.map(row => `${row.principalType}:${row.principalId}`).sort())
      .toEqual(['employee:employee-a', 'user:owner-a', 'user:user-b'].sort())
    await service.removeMember(project.projectId, 'employee', 'employee-a')
    await expect(service.listMembers(project.projectId)).resolves.toEqual([creator, user])

    await expect(service.addMember(project.projectId, {
      principalType: 'user', principalId: 'user-b', addedBy: 'owner-a',
    })).rejects.toMatchObject({ code: 'conflict', resourceType: 'project-member' })
  })

  it('removes the last member and rejects removing an unknown member', async () => {
    const service = makeService()
    const project = await createFixture(service, 'organization')

    await service.removeMember(project.projectId, 'user', 'owner-a')
    await expect(service.listMembers(project.projectId)).resolves.toEqual([])
    await expect(service.removeMember(project.projectId, 'user', 'owner-a')).rejects.toMatchObject({
      code: 'not-found', resourceType: 'project-member',
    })
  })

  it('rejects membership mutations on unknown and archived projects while reads keep working', async () => {
    const service = makeService()
    const project = await createFixture(service, 'organization')
    await service.archive(project.projectId, 'owner-a')

    await expect(service.addMember(project.projectId, {
      principalType: 'user', principalId: 'user-b', addedBy: 'owner-a',
    })).rejects.toMatchObject({ code: 'invalid-state', resourceType: 'project' })
    await expect(service.removeMember(project.projectId, 'user', 'owner-a')).rejects.toMatchObject({
      code: 'invalid-state', resourceType: 'project',
    })
    await expect(service.addMember(projectId('project-missing'), {
      principalType: 'user', principalId: 'user-b', addedBy: 'owner-a',
    })).rejects.toBeInstanceOf(EnterpriseProjectError)
    await expect(service.listMembers(project.projectId)).resolves.toEqual([{
      projectId: project.projectId, principalType: 'user', principalId: 'owner-a',
      addedBy: 'owner-a', addedAt: project.createdAt,
    }])
  })
})

describe('EnterpriseProjectService.archive', () => {
  it('archives an active project once and names the terminal state afterwards', async () => {
    const service = makeService()
    const project = await createFixture(service, 'organization')
    const archived = await service.archive(project.projectId, 'owner-a')

    expect(archived.state).toBe('archived')
    expect(archived.archivedAt).toBeGreaterThanOrEqual(project.createdAt)
    await expect(service.get(project.projectId)).resolves.toMatchObject({ state: 'archived' })
    await expect(service.archive(project.projectId, 'owner-a')).rejects.toMatchObject({
      code: 'invalid-state', resourceType: 'project',
    })
    await expect(service.archive(projectId('project-missing'), 'owner-a')).rejects.toMatchObject({
      code: 'not-found', resourceType: 'project',
    })
  })

  it('rejects an empty archiving actor before touching the store', async () => {
    const service = makeService()
    const project = await createFixture(service, 'organization')
    await expect(service.archive(project.projectId, '  ')).rejects.toThrow(TypeError)
    await expect(service.get(project.projectId)).resolves.toMatchObject({ state: 'active' })
  })
})

describe('EnterpriseProjectService.requireMember', () => {
  it('resolves explicit user and employee members', async () => {
    const service = makeService()
    const project = await createFixture(service, 'organization')
    await service.addMember(project.projectId, { principalType: 'employee', principalId: 'employee-a', addedBy: 'owner-a' })

    await expect(service.requireMember('org-a', project.projectId, { userId: 'owner-a' }))
      .resolves.toEqual(project)
    await expect(service.requireMember('org-a', project.projectId, { userId: 'user-b', employeeId: 'employee-a' }))
      .resolves.toEqual(project)
  })

  it('returns undefined without leaking existence for unknown, cross-org, and non-member callers', async () => {
    const service = makeService()
    const project = await createFixture(service, 'restricted', { allowedUserIds: ['user-b'] })
    await service.addMember(project.projectId, { principalType: 'employee', principalId: 'employee-a', addedBy: 'owner-a' })

    await expect(service.requireMember('org-a', projectId('project-missing'), { userId: 'owner-a' }))
      .resolves.toBeUndefined()
    await expect(service.requireMember('org-b', project.projectId, { userId: 'owner-a' }))
      .resolves.toBeUndefined()
    await expect(service.requireMember('org-a', project.projectId, { userId: 'user-b' }))
      .resolves.toBeUndefined()
    await expect(service.requireMember('org-a', project.projectId, { userId: 'user-outsider' }))
      .resolves.toBeUndefined()
    await expect(service.requireMember('org-a', project.projectId, { userId: 'user-outsider', employeeId: 'employee-a' }))
      .resolves.toEqual(project)
  })

  it('matches user rows only by userId and employee rows only by employeeId', async () => {
    const service = makeService()
    const project = await createFixture(service, 'organization')

    await expect(service.requireMember('org-a', project.projectId, { userId: 'employee-a' }))
      .resolves.toBeUndefined()
    await expect(service.requireMember('org-a', project.projectId, { userId: 'nobody', employeeId: 'owner-a' }))
      .resolves.toBeUndefined()
    await service.addMember(project.projectId, { principalType: 'employee', principalId: 'employee-a', addedBy: 'owner-a' })
    await expect(service.requireMember('org-a', project.projectId, { userId: 'employee-a' }))
      .resolves.toBeUndefined()
  })

  it('stays readable for members after archival', async () => {
    const service = makeService()
    const project = await createFixture(service, 'organization')
    await service.archive(project.projectId, 'owner-a')
    await expect(service.requireMember('org-a', project.projectId, { userId: 'owner-a' }))
      .resolves.toMatchObject({ state: 'archived' })
  })
})

describe('enterprise-project plugin', () => {
  it('provides ctx.enterpriseProjects over the configured database', async () => {
    const database = new MemoryProjectDatabase()
    const ctx = new Context()
    apply(ctx, { database })

    const created = await ctx.enterpriseProjects.create({ ...baseInput })
    expect((await ctx.enterpriseProjects.get(created.projectId))?.name).toBe('Support')
  })
})
