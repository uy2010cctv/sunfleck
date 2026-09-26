import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CreateProjectInput, Project, ProjectId } from '@deepseek-ai/dsh-enterprise-project'
import { ProjectWorkspaceProvisioner, type ProjectWorkspaceIdentity } from '../src/project-workspace.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-project-workspace-'))
  roots.push(root)
  const projects = new Map<ProjectId, Project>()
  const create = vi.fn(async (input: CreateProjectInput): Promise<Project> => {
    const id = input.projectId
    if (id === undefined) throw new Error('project id missing')
    const project: Project = { projectId: id, orgId: input.orgId, name: input.name, goal: input.goal,
      workspacePath: input.workspacePath, state: 'active', visibility: 'organization', allowedUserIds: [],
      createdBy: input.createdBy, createdAt: 1 }
    projects.set(id, project)
    return project
  })
  const get = vi.fn(async (id: ProjectId) => projects.get(id))
  const registrations = new Map<string, string>()
  const registry = {
    create: vi.fn(async (path: string) => { registrations.set(path, 'workspace-project'); return { id: 'workspace-project' } }),
    delete: vi.fn(async (id: string) => {
      const entry = [...registrations].find(([, value]) => value === id)
      if (entry === undefined) return false
      registrations.delete(entry[0])
      return true
    }),
    resolveByPath: vi.fn(async (path: string) => {
      const id = registrations.get(path)
      return id === undefined ? undefined : { id }
    }),
  }
  const identity = { prepareProjectWorkspace: vi.fn(async (_input: Parameters<ProjectWorkspaceIdentity['prepareProjectWorkspace']>[0]) => ({})),
    discardPreparedProjectWorkspace: vi.fn(async () => true),
    workspaceGrant: vi.fn(async () => undefined as { kind: string; orgId: string; projectId?: string } | undefined) }
  const provisioner = new ProjectWorkspaceProvisioner(root, { create, get }, registry, identity)
  return { root, projects, create, registry, identity, provisioner }
}

describe('project Workspace provisioning', () => {
  it('registers a named native Workspace and returns it only after the project commits', async () => {
    const f = await fixture()
    const result = await f.provisioner.create({ orgId: 'org', createdBy: 'human', name: 'Q4 Renewal', goal: 'Ship' })
    expect(result.workspaceId).toBe('workspace-project')
    expect(result.project.workspacePath).toContain(f.root)
    expect(f.identity.prepareProjectWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      projectId: result.project.projectId, workspaceId: 'workspace-project', createdBy: 'human',
    }))
    expect(await f.provisioner.workspaceId(result.project)).toBe('workspace-project')
  })

  it('removes a prepared grant, native registration, and empty directory when project creation fails', async () => {
    const f = await fixture()
    f.create.mockRejectedValueOnce(new Error('project insert failed'))
    await expect(f.provisioner.create({ orgId: 'org', createdBy: 'human', name: 'Q4 Renewal', goal: 'Ship' }))
      .rejects.toThrow('project insert failed')
    expect(f.identity.discardPreparedProjectWorkspace).toHaveBeenCalledOnce()
    expect(f.registry.delete).toHaveBeenCalledWith('workspace-project')
    expect(await readdir(f.root)).toEqual([])
  })

  it('detects and removes a committed grant after its preparation readback fails', async () => {
    const f = await fixture()
    let pendingProjectId = ''
    f.identity.prepareProjectWorkspace.mockImplementationOnce(async (input) => {
      pendingProjectId = input.projectId
      throw new Error('grant readback failed')
    })
    f.identity.workspaceGrant.mockImplementationOnce(async () => ({
      kind: 'project', orgId: 'org', projectId: pendingProjectId,
    }))
    await expect(f.provisioner.create({ orgId: 'org', createdBy: 'human', name: 'Q4 Renewal', goal: 'Ship' }))
      .rejects.toThrow('grant readback failed')
    expect(f.identity.discardPreparedProjectWorkspace).toHaveBeenCalledOnce()
    expect(await readdir(f.root)).toEqual([])
  })
})
