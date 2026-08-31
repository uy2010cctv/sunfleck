import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { EnterpriseIdentityRepository, memorySourceDigest } from '@deepseek-ai/dsh-enterprise-identity'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { apply } from '../src/index.ts'

describe('enterprise memory prompt context', () => {
  let root = ''

  afterEach(async () => {
    if (root !== '') await rm(root, { recursive: true, force: true })
  })

  it('injects approved organization and current-department memory without proposed entries', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-enterprise-memory-context-'))
    const identity = new EnterpriseIdentityRepository(join(root, 'identity.sqlite'))
    identity.createOrganization({ id: 'org-a', name: 'Org A' })
    identity.createUser({ id: 'user-1', orgId: 'org-a', username: 'alice', displayName: 'Alice', disabled: false })
    identity.createUser({ id: 'user-2', orgId: 'org-a', username: 'bob', displayName: 'Bob', disabled: false })
    identity.saveDepartment({ id: 'dept-ops', orgId: 'org-a', name: 'Operations', parentId: null, sortOrder: 0, expectedRevision: 0 })
    identity.setUserDepartments({
      orgId: 'org-a', userId: 'user-1', departmentIds: ['dept-ops'], primaryDepartmentId: 'dept-ops', expectedRevision: 0,
    })
    identity.setUserDepartments({
      orgId: 'org-a', userId: 'user-2', departmentIds: ['dept-ops'], primaryDepartmentId: 'dept-ops', expectedRevision: 0,
    })
    identity.saveWorkspaceGrant({
      workspaceId: 'workspace-1', orgId: 'org-a', name: 'Alice', kind: 'personal', ownerUserId: 'user-1',
      rootPath: '/managed/alice', sandboxMode: 'workspace-write', expectedRevision: 0,
    })
    identity.saveWorkspaceGrant({
      workspaceId: 'workspace-2', orgId: 'org-a', name: 'Bob', kind: 'personal', ownerUserId: 'user-2',
      rootPath: '/managed/bob', sandboxMode: 'workspace-write', expectedRevision: 0,
    })
    identity.bindSessionWorkspace({
      sessionId: 'session-alice', workspaceId: 'workspace-1', orgId: 'org-a', ownerUserId: 'user-1',
    })
    identity.bindSessionWorkspace({
      sessionId: 'session-bob', workspaceId: 'workspace-2', orgId: 'org-a', ownerUserId: 'user-2',
    })
    for (const memory of [
      { id: 'org-memory', scope: 'organization' as const, kind: 'business-fact' as const, summary: '公司使用统一合同编号。' },
      { id: 'dept-memory', scope: 'department' as const, departmentId: 'dept-ops', kind: 'process' as const, summary: '运营审批保留版本记录。' },
      { id: 'alice-memory', scope: 'user' as const, ownerUserId: 'user-1', kind: 'business-fact' as const, summary: 'Alice 使用中文报告。' },
      { id: 'bob-memory', scope: 'user' as const, ownerUserId: 'user-2', kind: 'business-fact' as const, summary: 'Bob uses English reports.' },
      { id: 'proposed-memory', scope: 'organization' as const, kind: 'decision' as const, summary: '尚未批准。' },
    ]) {
      const proposed = identity.proposeMemory({
        ...memory, orgId: 'org-a', sourceDigest: memorySourceDigest(memory.id),
        createdBy: 'ownerUserId' in memory ? memory.ownerUserId : 'user-1',
      })
      if (memory.id !== 'proposed-memory') identity.reviewMemory({
        id: memory.id, orgId: 'org-a', decision: 'approved', reviewedBy: 'user-1', reason: 'verified',
        expectedRevision: proposed.revision,
      })
    }
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: true, persona: '' })
    ctx.provide('enterprisePostgres' as never, { identity } as never)
    apply(ctx, { maxEntries: 20, maxChars: 8_000 })
    const assembly = await ctx.systemPrompt.assemble({
      agent: { id: 'session-alice', session: { header: { cwd: '/managed/alice' } } },
    } as never)
    const rendered = assembly.contexts.find(item => item.name === 'enterprise:memory')?.text ?? ''

    expect(rendered).toContain('[org-memory]')
    expect(rendered).toContain('[dept-memory]')
    expect(rendered).toContain('[alice-memory]')
    expect(rendered).not.toContain('bob-memory')
    expect(rendered).not.toContain('proposed-memory')
    expect(rendered).toMatch(/never infer personal traits/iu)
    const bobAssembly = await ctx.systemPrompt.assemble({
      agent: { id: 'session-bob', session: { header: { cwd: '/managed/bob' } } },
    } as never)
    const bobRendered = bobAssembly.contexts.find(item => item.name === 'enterprise:memory')?.text ?? ''
    expect(bobRendered).toContain('[org-memory]')
    expect(bobRendered).toContain('[dept-memory]')
    expect(bobRendered).toContain('[bob-memory]')
    expect(bobRendered).not.toContain('alice-memory')
    identity.close()
  })
})
