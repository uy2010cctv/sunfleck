import { describe, expect, it } from 'vitest'
import {
  ENTERPRISE_PROJECT_SCHEMA_VERSION,
  EnterpriseProjectRepository,
  migrateEnterpriseProject,
  projectId,
} from '../src/index.ts'
import { MemoryProjectDatabase, memberRow, projectRow } from './memory-postgres.ts'

function repository(database: MemoryProjectDatabase, now?: () => number): EnterpriseProjectRepository {
  return new EnterpriseProjectRepository(database, now === undefined ? {} : { now })
}

function createInput(overrides: { orgId?: string; createdBy?: string; visibility?: 'private' } = {}): Parameters<
  EnterpriseProjectRepository['createProject']
>[0] {
  return {
    projectId: projectId('project-a'), orgId: overrides.orgId ?? 'org-a', name: 'Support', goal: 'Ship support.',
    workspacePath: '/managed/projects/support', visibility: overrides.visibility ?? 'organization',
    allowedUserIds: [], createdBy: overrides.createdBy ?? 'owner-a',
  }
}

describe('enterprise project schema', () => {
  it('creates the project tables and stamps version one on a fresh database', async () => {
    const database = new MemoryProjectDatabase()
    await migrateEnterpriseProject(database)
    await migrateEnterpriseProject(database)

    expect(ENTERPRISE_PROJECT_SCHEMA_VERSION).toBe(1)
    expect(database.schemaVersion).toBe('1')
  })

  it('keeps the version on an already current database and rejects future versions', async () => {
    const current = new MemoryProjectDatabase('1')
    await migrateEnterpriseProject(current)
    expect(current.schemaVersion).toBe('1')

    const future = new MemoryProjectDatabase('2')
    await expect(migrateEnterpriseProject(future)).rejects.toThrow('schema version 2 is not supported')
  })
})

describe('EnterpriseProjectRepository', () => {
  it('creates an active project with its creator as the first member and reads it back', async () => {
    const database = new MemoryProjectDatabase()
    let tick = 100
    const projects = repository(database, () => { tick += 10; return tick })
    const created = await projects.createProject(createInput())

    expect(created).toMatchObject({
      projectId: 'project-a', orgId: 'org-a', name: 'Support', goal: 'Ship support.',
      workspacePath: '/managed/projects/support', state: 'active', visibility: 'organization',
      allowedUserIds: [], createdBy: 'owner-a', createdAt: 110,
    })
    expect('teamDefinitionId' in created).toBe(false)
    expect('archivedAt' in created).toBe(false)
    await expect(projects.getProject(projectId('project-a'))).resolves.toEqual(created)
    await expect(projects.listMembers(projectId('project-a'))).resolves.toEqual([{
      projectId: 'project-a', principalType: 'user', principalId: 'owner-a', addedBy: 'owner-a', addedAt: 110,
    }])
  })

  it('rejects a duplicate project id with a conflict', async () => {
    const projects = repository(new MemoryProjectDatabase())
    await projects.createProject(createInput())
    await expect(projects.createProject(createInput())).rejects.toMatchObject({
      code: 'conflict', resourceType: 'project',
    })
  })

  it('lists projects per organization in creation order and misses unknown ids', async () => {
    const database = new MemoryProjectDatabase()
    let tick = 0
    const projects = repository(database, () => { tick += 10; return tick })
    const first = await projects.createProject(createInput())
    const second = await projects.createProject({ ...createInput(), projectId: projectId('project-b') })
    await projects.createProject({ ...createInput(), projectId: projectId('foreign'), orgId: 'org-b' })

    await expect(projects.listProjects('org-a')).resolves.toEqual([first, second])
    await expect(projects.listProjects('org-missing')).resolves.toEqual([])
    await expect(projects.getProject(projectId('project-missing'))).resolves.toBeUndefined()
  })

  it('archives an active project once and refuses missing or already archived projects', async () => {
    const database = new MemoryProjectDatabase()
    let tick = 200
    const projects = repository(database, () => { tick += 10; return tick })
    await projects.createProject(createInput())
    const archived = await projects.archiveProject(projectId('project-a'))

    expect(archived.state).toBe('archived')
    expect(archived.archivedAt).toBe(220)
    await expect(projects.archiveProject(projectId('project-a'))).rejects.toMatchObject({
      code: 'invalid-state', resourceType: 'project',
    })
    await expect(projects.archiveProject(projectId('project-missing'))).rejects.toMatchObject({
      code: 'not-found', resourceType: 'project',
    })
  })

  it('adds members only to active projects and rejects duplicates', async () => {
    const database = new MemoryProjectDatabase()
    const projects = repository(database)
    await projects.createProject(createInput())

    const member = await projects.insertMember(projectId('project-a'), {
      principalType: 'employee', principalId: 'employee-a', addedBy: 'owner-a',
    })
    expect(member).toMatchObject({ projectId: 'project-a', principalType: 'employee', principalId: 'employee-a' })
    await expect(projects.insertMember(projectId('project-a'), {
      principalType: 'employee', principalId: 'employee-a', addedBy: 'owner-a',
    })).rejects.toMatchObject({ code: 'conflict', resourceType: 'project-member' })
    await expect(projects.insertMember(projectId('project-missing'), {
      principalType: 'user', principalId: 'user-b', addedBy: 'owner-a',
    })).rejects.toMatchObject({ code: 'not-found', resourceType: 'project' })

    await projects.archiveProject(projectId('project-a'))
    await expect(projects.insertMember(projectId('project-a'), {
      principalType: 'user', principalId: 'user-b', addedBy: 'owner-a',
    })).rejects.toMatchObject({ code: 'invalid-state', resourceType: 'project' })
  })

  it('removes members, including the last one, only from active projects', async () => {
    const database = new MemoryProjectDatabase()
    const projects = repository(database)
    await projects.createProject(createInput())

    await projects.insertMember(projectId('project-a'), { principalType: 'user', principalId: 'user-b', addedBy: 'owner-a' })
    await projects.removeMember(projectId('project-a'), 'user', 'user-b')
    await expect(projects.removeMember(projectId('project-a'), 'user', 'user-b')).rejects.toMatchObject({
      code: 'not-found', resourceType: 'project-member',
    })

    await projects.removeMember(projectId('project-a'), 'user', 'owner-a')
    await expect(projects.listMembers(projectId('project-a'))).resolves.toEqual([])

    await expect(projects.removeMember(projectId('project-missing'), 'user', 'owner-a')).rejects.toMatchObject({
      code: 'not-found', resourceType: 'project',
    })
    await projects.archiveProject(projectId('project-a'))
    await expect(projects.removeMember(projectId('project-a'), 'user', 'owner-a')).rejects.toMatchObject({
      code: 'invalid-state', resourceType: 'project',
    })
    await expect(projects.listMembers(projectId('project-missing'))).rejects.toMatchObject({
      code: 'not-found', resourceType: 'project',
    })
  })

  it('surfaces storage failures when a guarded write returns no row', async () => {
    const database = new MemoryProjectDatabase()
    const projects = repository(database)
    database.failNextProjectWrite = true
    await expect(projects.createProject(createInput())).rejects.toThrow('enterprise project insert returned no row')

    await projects.createProject(createInput({ createdBy: 'owner-seed' }))
    database.failNextProjectWrite = true
    await expect(projects.archiveProject(projectId('project-a'))).rejects.toThrow('enterprise project archive returned no row')
  })

  it('validates closed values when parsing stored rows', async () => {
    const database = new MemoryProjectDatabase()
    database.seedProject(projectRow({ state: 'deleted' }))
    database.seedProject(projectRow({ project_id: 'project-v', visibility: 'public' }))
    database.seedProject(projectRow({ project_id: 'project-j', allowed_user_ids: '{"a":1}' }))
    database.seedProject(projectRow({ project_id: 'project-m', allowed_user_ids: '["a",1]' }))
    // A JSONB-returning driver hands back a parsed array instead of text.
    database.seedProject(projectRow({ project_id: 'project-b', allowed_user_ids: ['a', 1] as unknown as string }))
    database.seedProject(projectRow({ project_id: 'project-n', state: 7 as unknown as string }))
    database.seedMember(memberRow({ project_id: 'project-a', principal_type: 'robot' }))
    const projects = repository(database)

    await expect(projects.getProject(projectId('project-a'))).rejects.toThrow(/projects\.state carries "deleted"/)
    await expect(projects.getProject(projectId('project-v'))).rejects.toThrow(/projects\.visibility carries "public"/)
    await expect(projects.getProject(projectId('project-j'))).rejects.toThrow(/allowed_user_ids is not a JSON string array/)
    await expect(projects.getProject(projectId('project-m'))).rejects.toThrow(/allowed_user_ids is not a JSON string array/)
    await expect(projects.getProject(projectId('project-b'))).rejects.toThrow(/allowed_user_ids is not a JSON string array/)
    await expect(projects.getProject(projectId('project-n'))).rejects.toThrow(/projects\.state carries 7/)
    await expect(projects.listMembers(projectId('project-a'))).rejects.toThrow(/principal_type carries "robot"/)
  })

  it('round-trips optional stored fields', async () => {
    const database = new MemoryProjectDatabase()
    database.seedProject(projectRow({
      project_id: 'project-full', team_definition_id: 'team-a',
      visibility: 'restricted', allowed_user_ids: '["user-b","user-c"]',
      archived_at: 99, state: 'archived', created_at: 11,
    }))
    const projects = repository(database)

    await expect(projects.getProject(projectId('project-full'))).resolves.toEqual({
      projectId: 'project-full', orgId: 'org-a', name: 'Support', goal: 'Ship support.',
      workspacePath: '/managed/projects/support', teamDefinitionId: 'team-a', state: 'archived',
      visibility: 'restricted', allowedUserIds: ['user-b', 'user-c'], createdBy: 'owner-a',
      createdAt: 11, archivedAt: 99,
    })
  })
})
