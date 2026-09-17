// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  EnterpriseGovernanceSettingsSection, EnterpriseGovernanceSurface,
} from '../src/client/EnterpriseGovernanceSurface.tsx'
import type { EnterpriseGovernanceState } from '../src/client/controller.ts'
import { EnterpriseAccountCard } from '../src/client/EnterpriseAccountCard.tsx'

afterEach(cleanup)

function state(value: Partial<EnterpriseGovernanceState>): EnterpriseGovernanceState {
  return {
    phase: 'ready', error: null,
    auth: {
      authenticated: false, organizationId: 'default-enterprise',
      providers: [{ id: 'local', kind: 'local', label: 'Local account' }],
    },
    organizations: [], users: [], departments: [], workspaces: [], memories: [], memoryWritebacks: [], assets: [], policies: [], audit: [],
    departmentManagers: {},
    ...value,
  }
}

describe('enterprise governance UI', () => {
  it('shows the current identity below Settings and logs out without double submission', async () => {
    const pending = Promise.withResolvers<undefined>()
    const logout = vi.fn(() => pending.promise)
    render(<EnterpriseAccountCard wide principal={{
      userId: 'operator-1', orgId: 'org-a', displayName: '采购运营负责人超长姓名',
      username: 'operator', roles: ['operator'],
    }} logout={logout} />)

    expect(screen.getByRole('region', { name: '当前用户' })).toBeDefined()
    expect(screen.getByText('采购运营负责人超长姓名')).toBeDefined()
    expect(screen.getByText('@operator · operator')).toBeDefined()
    const button = screen.getByRole('button', { name: '退出登录' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(logout).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: '正在退出…' })).toHaveProperty('disabled', true)
    pending.resolve(undefined)
  })

  it('keeps logout accessible on the collapsed rail and reports a failed attempt', async () => {
    const logout = vi.fn(() => Promise.reject(new Error('offline')))
    const principal = {
      userId: 'member-1', orgId: 'org-a', displayName: 'Member', username: 'member', roles: ['member'],
    }
    const { rerender } = render(<EnterpriseAccountCard wide={false} principal={principal} logout={logout} />)
    fireEvent.click(screen.getByRole('button', { name: '退出登录：Member' }))
    await waitFor(() => { expect(logout).toHaveBeenCalledOnce() })

    rerender(<EnterpriseAccountCard wide principal={principal} logout={logout} />)
    fireEvent.click(screen.getByRole('button', { name: '退出登录' }))
    expect((await screen.findByRole('alert')).textContent).toBe('退出失败，请重试')
  })

  it('renders governance as an embedded Settings page and loads its datasets on entry', () => {
    const loadAdmin = vi.fn(() => Promise.resolve())
    const logout = vi.fn()
    render(<EnterpriseGovernanceSettingsSection
      state={state({ auth: {
        authenticated: true,
        principal: { userId: 'admin-1', orgId: 'org-a', displayName: 'Admin', username: 'admin', roles: ['administrator'] },
        providers: [],
      } })}
      loadAdmin={loadAdmin}
      loginLocal={vi.fn()}
      logout={logout}
      createOrganization={vi.fn()}
      createAsset={vi.fn()}
      createUser={vi.fn()}
      updateUser={vi.fn()}
      saveDepartment={vi.fn()}
      createWorkspace={vi.fn()}
      updateWorkspace={vi.fn()}
      proposeMemory={vi.fn()}
      reviewMemory={vi.fn()}
      savePolicy={vi.fn()}
      filterAudit={vi.fn()}
    />)
    expect(loadAdmin).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog', { name: '企业治理台' })).toBeNull()
    expect(screen.getByRole('heading', { name: '企业治理' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '退出登录' }))
    expect(logout).toHaveBeenCalledTimes(1)
  })

  it('updates the organization field when asynchronous auth status arrives', () => {
    const props = {
      loginLocal: vi.fn(() => Promise.resolve()), logout: vi.fn(), close: vi.fn(),
      createOrganization: vi.fn(), createUser: vi.fn(), createAsset: vi.fn(), updateUser: vi.fn(),
      saveDepartment: vi.fn(), createWorkspace: vi.fn(), proposeMemory: vi.fn(), reviewMemory: vi.fn(),
      updateWorkspace: vi.fn(),
      savePolicy: vi.fn(), filterAudit: vi.fn(),
    }
    const loading: EnterpriseGovernanceState = {
      phase: 'loading', error: null, organizations: [], users: [], departments: [], workspaces: [], memories: [], memoryWritebacks: [],
      assets: [], policies: [], audit: [], departmentManagers: {},
    }
    const { rerender } = render(<EnterpriseGovernanceSurface state={loading} {...props} />)
    expect(screen.getByRole('combobox', { name: '组织' })).toHaveProperty('value', '')
    rerender(<EnterpriseGovernanceSurface state={state({ auth: {
      authenticated: false, organizationId: 'default-enterprise', providers: [],
    }, organizations: [{ id: 'default-enterprise', name: '夏树科技有限公司' }] })} {...props} />)
    expect(screen.getByRole('combobox', { name: '组织' })).toHaveProperty('value', 'default-enterprise')
    expect(screen.getByRole('option', { name: '夏树科技有限公司' })).toBeDefined()
  })

  it('blocks the application with a labelled login form while unauthenticated', () => {
    const loginLocal = vi.fn(() => Promise.resolve())
    render(<EnterpriseGovernanceSurface
      state={state({ organizations: [
        { id: 'default-enterprise', name: '夏树科技有限公司' },
        { id: 'org-a', name: '示例组织' },
      ] })}
      loginLocal={loginLocal}
      logout={vi.fn()}
      createOrganization={vi.fn()}
      createAsset={vi.fn()}
      createUser={vi.fn()}
      updateUser={vi.fn()}
      saveDepartment={vi.fn()}
      createWorkspace={vi.fn()}
      updateWorkspace={vi.fn()}
      proposeMemory={vi.fn()}
      reviewMemory={vi.fn()}
      savePolicy={vi.fn()}
      filterAudit={vi.fn()}
    />)
    const organization = screen.getByRole('combobox', { name: '组织' })
    expect(organization).toHaveProperty('value', 'default-enterprise')
    expect(within(organization).getAllByRole('option')).toHaveLength(2)
    fireEvent.change(organization, { target: { value: 'org-a' } })
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'admin' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'enterprise-password' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))
    expect(loginLocal).toHaveBeenCalledWith({
      organizationId: 'org-a', username: 'admin', password: 'enterprise-password',
    })
  })

  it('paginates enterprise management into accessible top tabs', () => {
    render(<EnterpriseGovernanceSettingsSection
      state={state({
        auth: {
          authenticated: true,
          principal: { userId: 'admin-1', orgId: 'org-a', displayName: 'Admin', username: 'admin', roles: ['administrator'] },
          providers: [],
        },
        users: [{ id: 'admin-1', username: 'admin', displayName: 'Admin', disabled: false, roles: ['administrator'] }],
        policies: [{ resourceType: 'employee', resourceId: 'support', visibility: 'organization', allowedUserIds: [] }],
        audit: [{ id: 'audit-1', action: 'user.manage', actorUserId: 'admin-1', decision: 'allowed', at: 1 }],
      })}
      loadAdmin={vi.fn()}
      loginLocal={vi.fn()}
      logout={vi.fn()}
      createOrganization={vi.fn()}
      createAsset={vi.fn()}
      createUser={vi.fn()}
      updateUser={vi.fn()}
      saveDepartment={vi.fn()}
      createWorkspace={vi.fn()}
      updateWorkspace={vi.fn()}
      proposeMemory={vi.fn()}
      reviewMemory={vi.fn()}
      savePolicy={vi.fn()}
      filterAudit={vi.fn()}
    />)
    expect(screen.getByRole('main', { name: '企业治理' })).toBeDefined()
    const tablist = screen.getByRole('tablist', { name: '企业管理分区' })
    expect(tablist).toBeDefined()
    expect(tablist.getAttribute('data-appearance')).toBe('tonal')
    expect(screen.getAllByRole('tab')).toHaveLength(6)
    const organizations = screen.getByRole('tab', { name: '组织架构' })
    expect(organizations.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('heading', { name: '组织架构' })).toBeDefined()
    expect(screen.queryByRole('heading', { name: '用户与角色' })).toBeNull()

    const users = screen.getByRole('tab', { name: '用户管理' })
    fireEvent.click(users)
    expect(users.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('heading', { name: '用户管理' })).toBeDefined()
    expect(screen.queryByRole('heading', { name: '组织架构' })).toBeNull()

    fireEvent.keyDown(users, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: '工作区' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('heading', { name: '工作区与沙盒' })).toBeDefined()
  })

  it('creates a login-ready user through a focused dialog', async () => {
    const createUser = vi.fn(() => Promise.resolve())
    render(<EnterpriseGovernanceSettingsSection
      state={state({
        auth: {
          authenticated: true,
          principal: { userId: 'admin-1', orgId: 'org-a', displayName: 'Admin', username: 'admin', roles: ['administrator'] },
          providers: [],
        },
      })}
      loadAdmin={vi.fn()} loginLocal={vi.fn()} logout={vi.fn()} createOrganization={vi.fn()}
      createAsset={vi.fn()} createUser={createUser} updateUser={vi.fn()} saveDepartment={vi.fn()}
      createWorkspace={vi.fn()} updateWorkspace={vi.fn()} proposeMemory={vi.fn()} reviewMemory={vi.fn()}
      savePolicy={vi.fn()} filterAudit={vi.fn()}
    />)
    fireEvent.click(screen.getByRole('tab', { name: '用户管理' }))
    fireEvent.click(screen.getByRole('button', { name: '新增用户' }))

    expect(screen.getByRole('dialog', { name: '新增用户' })).toBeDefined()
    expect(screen.queryByLabelText('用户 ID')).toBeNull()
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'buyer' } })
    fireEvent.change(screen.getByLabelText('显示名称'), { target: { value: '采购员' } })
    fireEvent.change(screen.getByLabelText('初始密码'), { target: { value: 'buyer-password' } })
    fireEvent.change(screen.getByLabelText('角色'), { target: { value: 'operator' } })
    fireEvent.click(screen.getByRole('button', { name: '创建用户' }))

    await waitFor(() => { expect(createUser).toHaveBeenCalledOnce() })
    expect(createUser).toHaveBeenCalledWith({
      id: expect.stringMatching(/^user-/), username: 'buyer', displayName: '采购员',
      password: 'buyer-password', roles: ['operator'],
    })
    expect(screen.queryByRole('dialog', { name: '新增用户' })).toBeNull()
  })

  it('explains the verifier minimum before submitting a short local password', async () => {
    const createUser = vi.fn(() => Promise.resolve())
    render(<EnterpriseGovernanceSettingsSection
      state={state({
        auth: {
          authenticated: true,
          principal: { userId: 'admin-1', orgId: 'org-a', displayName: 'Admin', username: 'admin', roles: ['administrator'] },
          providers: [],
        },
      })}
      loadAdmin={vi.fn()} loginLocal={vi.fn()} logout={vi.fn()} createOrganization={vi.fn()}
      createAsset={vi.fn()} createUser={createUser} updateUser={vi.fn()} saveDepartment={vi.fn()}
      createWorkspace={vi.fn()} updateWorkspace={vi.fn()} proposeMemory={vi.fn()} reviewMemory={vi.fn()}
      savePolicy={vi.fn()} filterAudit={vi.fn()}
    />)
    fireEvent.click(screen.getByRole('tab', { name: '用户管理' }))
    fireEvent.click(screen.getByRole('button', { name: '新增用户' }))
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'kris' } })
    fireEvent.change(screen.getByLabelText('显示名称'), { target: { value: 'Kris' } })
    fireEvent.change(screen.getByLabelText('初始密码'), { target: { value: 'short@1234' } })
    fireEvent.click(screen.getByRole('button', { name: '创建用户' }))

    expect(screen.getByRole('alert').textContent).toContain('密码需为 12–128 个字符')
    expect(createUser).not.toHaveBeenCalled()
  })

  it('shows a readable user list and edits identity fields in a dialog', async () => {
    const updateUser = vi.fn(() => Promise.resolve())
    render(<EnterpriseGovernanceSettingsSection
      state={state({
        auth: {
          authenticated: true,
          principal: { userId: 'admin-1', orgId: 'org-a', displayName: 'Admin', username: 'admin', roles: ['administrator'] },
          providers: [],
        },
        departments: [{
          id: 'dept-test', orgId: 'org-a', parentId: null, name: '测试部', sortOrder: 0,
          revision: 1, createdAt: 1, updatedAt: 1,
        }],
        users: [{
          id: 'admin-1', username: 'admin', displayName: 'Enterprise Administrator', disabled: false,
          roles: ['administrator'], departmentIds: ['dept-test'], primaryDepartmentId: 'dept-test',
          departmentRevision: 1,
        }],
      })}
      loadAdmin={vi.fn()} loginLocal={vi.fn()} logout={vi.fn()} createOrganization={vi.fn()}
      createAsset={vi.fn()} createUser={vi.fn()} updateUser={updateUser} saveDepartment={vi.fn()}
      createWorkspace={vi.fn()} updateWorkspace={vi.fn()} proposeMemory={vi.fn()} reviewMemory={vi.fn()}
      savePolicy={vi.fn()} filterAudit={vi.fn()}
    />)
    fireEvent.click(screen.getByRole('tab', { name: '用户管理' }))

    expect(screen.getAllByText('@admin').length).toBeGreaterThan(0)
    expect(screen.getByText('测试部 · 主部门')).toBeDefined()
    expect(screen.queryByLabelText('Enterprise Administrator 部门')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '编辑用户：Enterprise Administrator' }))
    expect(screen.getByRole('dialog', { name: '编辑用户' })).toBeDefined()
    expect(screen.getByLabelText('用户名')).toHaveProperty('value', 'admin')
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'administrator' } })
    fireEvent.change(screen.getByLabelText('显示名称'), { target: { value: '企业管理员' } })
    fireEvent.change(screen.getByLabelText('新密码（留空则不修改）'), { target: { value: 'administrator@123' } })
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))

    await waitFor(() => { expect(updateUser).toHaveBeenCalledOnce() })
    expect(updateUser).toHaveBeenCalledWith('admin-1', {
      username: 'administrator', displayName: '企业管理员', password: 'administrator@123',
      roles: ['administrator'], disabled: false, departmentIds: ['dept-test'],
      primaryDepartmentId: 'dept-test', expectedRevision: 1,
    })
    expect(screen.queryByRole('dialog', { name: '编辑用户' })).toBeNull()
  })

  it('explains resource access and saves permissions without manual IDs', async () => {
    const savePolicy = vi.fn(() => Promise.resolve())
    render(<EnterpriseGovernanceSettingsSection
      state={state({
        auth: {
          authenticated: true,
          principal: { userId: 'admin-1', orgId: 'org-a', displayName: 'Admin', username: 'admin', roles: ['administrator'] },
          providers: [],
        },
        users: [{ id: 'admin-1', username: 'admin', displayName: 'Admin', disabled: false, roles: ['administrator'] }, {
          id: 'buyer-1', username: 'buyer', displayName: '采购员', disabled: false, roles: ['member'],
        }],
        assets: [{ type: 'model', id: 'deepseek-v4', name: 'DeepSeek V4', config: {} }],
        policies: [{
          resourceType: 'model', resourceId: 'deepseek-v4', visibility: 'organization', allowedUserIds: [],
        }],
      })}
      loadAdmin={vi.fn()} loginLocal={vi.fn()} logout={vi.fn()} createOrganization={vi.fn()}
      createAsset={vi.fn()} createUser={vi.fn()} updateUser={vi.fn()} saveDepartment={vi.fn()}
      createWorkspace={vi.fn()} updateWorkspace={vi.fn()} proposeMemory={vi.fn()} reviewMemory={vi.fn()}
      savePolicy={savePolicy} filterAudit={vi.fn()}
    />)
    fireEvent.click(screen.getByRole('tab', { name: '资源权限' }))

    expect(screen.getByRole('heading', { name: '资源访问权限' })).toBeDefined()
    expect(screen.getByText('决定企业成员能否看到和使用数字员工、模型、能力与渠道。')).toBeDefined()
    expect(screen.queryByLabelText('资产 ID')).toBeNull()
    expect(screen.getByLabelText('选择资源')).toHaveProperty('value', 'model:deepseek-v4')
    fireEvent.click(screen.getByLabelText('指定成员'))
    fireEvent.click(screen.getByLabelText('采购员 @buyer'))
    fireEvent.click(screen.getByRole('button', { name: '保存访问权限' }))

    await waitFor(() => { expect(savePolicy).toHaveBeenCalledOnce() })
    expect(savePolicy).toHaveBeenCalledWith({
      resourceType: 'model', resourceId: 'deepseek-v4', visibility: 'restricted', allowedUserIds: ['buyer-1'],
    })
  })

  it('shows an honest next step when no governable resources exist', () => {
    render(<EnterpriseGovernanceSettingsSection
      state={state({ auth: {
        authenticated: true,
        principal: { userId: 'admin-1', orgId: 'org-a', displayName: 'Admin', username: 'admin', roles: ['administrator'] },
        providers: [],
      } })}
      loadAdmin={vi.fn()} loginLocal={vi.fn()} logout={vi.fn()} createOrganization={vi.fn()}
      createAsset={vi.fn()} createUser={vi.fn()} updateUser={vi.fn()} saveDepartment={vi.fn()}
      createWorkspace={vi.fn()} updateWorkspace={vi.fn()} proposeMemory={vi.fn()} reviewMemory={vi.fn()}
      savePolicy={vi.fn()} filterAudit={vi.fn()}
    />)
    fireEvent.click(screen.getByRole('tab', { name: '资源权限' }))
    expect(screen.getByText('暂无可授权资源')).toBeDefined()
    expect(screen.getByText('请先在数字员工、模型或渠道管理中完成配置，资源会自动出现在这里。')).toBeDefined()
    expect(screen.queryByRole('button', { name: '保存访问权限' })).toBeNull()
  })

  it('renders the current enterprise as an expandable department and member tree', () => {
    render(<EnterpriseGovernanceSettingsSection
      state={state({
        auth: {
          authenticated: true,
          principal: { userId: 'admin-1', orgId: 'org-a', displayName: 'Admin', username: 'admin', roles: ['administrator'] },
          providers: [],
        },
        organizations: [{ id: 'org-a', name: '示例企业' }, { id: 'other', name: '其他企业' }],
        departments: [{
          id: 'dept-ops', orgId: 'org-a', parentId: null, name: '运营部', sortOrder: 0,
          revision: 1, createdAt: 1, updatedAt: 1,
        }, {
          id: 'dept-procurement', orgId: 'org-a', parentId: 'dept-ops', name: '采购组', sortOrder: 0,
          revision: 1, createdAt: 1, updatedAt: 1,
        }],
        users: [{
          id: 'admin-1', username: 'admin', displayName: 'Admin', disabled: false, roles: ['administrator'],
          departmentIds: ['dept-ops'], primaryDepartmentId: 'dept-ops', departmentRevision: 1,
        }, {
          id: 'buyer-1', username: 'buyer', displayName: '采购员', disabled: false, roles: ['member'],
          departmentIds: ['dept-procurement'], primaryDepartmentId: 'dept-procurement', departmentRevision: 1,
        }],
      })}
      loadAdmin={vi.fn()} loginLocal={vi.fn()} logout={vi.fn()} createOrganization={vi.fn()}
      createAsset={vi.fn()} createUser={vi.fn()} updateUser={vi.fn()} saveDepartment={vi.fn()}
      createWorkspace={vi.fn()} updateWorkspace={vi.fn()} proposeMemory={vi.fn()} reviewMemory={vi.fn()}
      savePolicy={vi.fn()} filterAudit={vi.fn()}
    />)

    const tree = screen.getByRole('tree', { name: '组织架构' })
    expect(tree).toBeDefined()
    expect(within(tree).getByText('示例企业')).toBeDefined()
    expect(screen.queryByText('其他企业')).toBeNull()
    expect(screen.queryByLabelText('组织 ID')).toBeNull()
    expect(screen.queryByRole('button', { name: '新增组织' })).toBeNull()
    expect(within(tree).getByText('Admin')).toBeDefined()
    expect(within(tree).getByText('@admin · administrator')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '收起运营部' }))
    expect(within(tree).queryByText('@admin · administrator')).toBeNull()
    expect(within(tree).queryByText('采购员')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '展开运营部' }))
    expect(within(tree).getByText('采购员')).toBeDefined()
  })

  it('lets only a platform administrator create a login-ready isolated organization', async () => {
    const createOrganization = vi.fn(() => Promise.resolve())
    render(<EnterpriseGovernanceSettingsSection
      state={state({
        auth: {
          authenticated: true, organizationId: 'org-a', defaultOrganizationId: 'org-a', platformAdministrator: true,
          principal: { userId: 'admin-1', orgId: 'org-a', displayName: 'Admin', username: 'admin', roles: ['administrator'] },
          providers: [],
        },
        organizations: [{ id: 'org-a', name: 'Platform enterprise' }],
      })}
      loadAdmin={vi.fn()} loginLocal={vi.fn()} logout={vi.fn()} createOrganization={createOrganization}
      createAsset={vi.fn()} createUser={vi.fn()} updateUser={vi.fn()} saveDepartment={vi.fn()}
      createWorkspace={vi.fn()} updateWorkspace={vi.fn()} proposeMemory={vi.fn()} reviewMemory={vi.fn()}
      savePolicy={vi.fn()} filterAudit={vi.fn()}
    />)

    fireEvent.click(screen.getByText('创建隔离组织'))
    fireEvent.change(screen.getByLabelText('组织编号'), { target: { value: 'org-b' } })
    fireEvent.change(screen.getByLabelText('组织名称'), { target: { value: '第二组织' } })
    fireEvent.change(screen.getByLabelText('管理员用户名'), { target: { value: 'admin' } })
    fireEvent.change(screen.getByLabelText('管理员显示名称'), { target: { value: '第二组织管理员' } })
    const password = screen.getByLabelText('管理员初始密码') as HTMLInputElement
    fireEvent.change(password, { target: { value: 'short' } })
    expect(screen.getByRole('button', { name: '创建组织' }).hasAttribute('disabled')).toBe(true)
    fireEvent.change(password, { target: { value: 'second-password' } })
    fireEvent.click(screen.getByRole('button', { name: '创建组织' }))

    await waitFor(() => { expect(createOrganization).toHaveBeenCalledOnce() })
    expect(createOrganization).toHaveBeenCalledWith({
      id: 'org-b', name: '第二组织', administratorId: 'org-b:administrator',
      administratorUsername: 'admin', administratorDisplayName: '第二组织管理员', password: 'second-password',
    })
    expect(password.value).toBe('')
  })

  it('assigns multiple department managers from department members', async () => {
    const setDepartmentManagers = vi.fn(() => Promise.resolve())
    render(<EnterpriseGovernanceSettingsSection
      state={state({
        auth: {
          authenticated: true,
          principal: { userId: 'admin-1', orgId: 'org-a', displayName: 'Admin', username: 'admin', roles: ['administrator'] },
          providers: [],
        },
        departments: [{
          id: 'dept-ops', orgId: 'org-a', parentId: null, name: '运营部', sortOrder: 0,
          revision: 1, createdAt: 1, updatedAt: 1,
        }],
        users: [
          { id: 'leader-1', username: 'leader', displayName: '部门主管', disabled: false, roles: ['member'], departmentIds: ['dept-ops'] },
          { id: 'member-1', username: 'member', displayName: '部门成员', disabled: false, roles: ['member'], departmentIds: ['dept-ops'] },
        ],
        departmentManagers: { 'dept-ops': {
          orgId: 'org-a', departmentId: 'dept-ops', managerUserIds: ['leader-1'],
          revision: 1, updatedBy: 'admin-1', updatedAt: 1,
        } },
      })}
      loadAdmin={vi.fn()} loginLocal={vi.fn()} logout={vi.fn()} createOrganization={vi.fn()}
      createAsset={vi.fn()} createUser={vi.fn()} updateUser={vi.fn()} saveDepartment={vi.fn()}
      setDepartmentManagers={setDepartmentManagers}
      createWorkspace={vi.fn()} updateWorkspace={vi.fn()} proposeMemory={vi.fn()} reviewMemory={vi.fn()}
      savePolicy={vi.fn()} filterAudit={vi.fn()}
    />)

    const managers = screen.getByRole('group', { name: '部门负责人' })
    expect(within(managers).getByLabelText('部门主管')).toHaveProperty('checked', true)
    fireEvent.click(within(managers).getByLabelText('部门成员'))
    fireEvent.click(screen.getByRole('button', { name: '保存部门负责人' }))

    await waitFor(() => { expect(setDepartmentManagers).toHaveBeenCalledWith('dept-ops', ['leader-1', 'member-1'], 1) })
  })

  it('creates a department without asking for an internal ID and reports failures', async () => {
    const saveDepartment = vi.fn()
      .mockRejectedValueOnce(new Error('duplicate department'))
      .mockResolvedValueOnce(undefined)
    render(<EnterpriseGovernanceSettingsSection
      state={state({
        auth: {
          authenticated: true,
          principal: { userId: 'admin-1', orgId: 'org-a', displayName: 'Admin', username: 'admin', roles: ['administrator'] },
          providers: [],
        },
        organizations: [{ id: 'org-a', name: '示例企业' }],
      })}
      loadAdmin={vi.fn()} loginLocal={vi.fn()} logout={vi.fn()} createOrganization={vi.fn()}
      createAsset={vi.fn()} createUser={vi.fn()} updateUser={vi.fn()} saveDepartment={saveDepartment}
      createWorkspace={vi.fn()} updateWorkspace={vi.fn()} proposeMemory={vi.fn()} reviewMemory={vi.fn()}
      savePolicy={vi.fn()} filterAudit={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: '新增根部门' }))
    expect(screen.queryByLabelText('部门 ID')).toBeNull()
    fireEvent.change(screen.getByLabelText('部门名称'), { target: { value: '采购部' } })
    fireEvent.click(screen.getByRole('button', { name: '创建部门' }))
    expect((await screen.findByRole('alert')).textContent).toBe('创建部门失败，请重试')
    fireEvent.click(screen.getByRole('button', { name: '创建部门' }))
    await waitFor(() => { expect(saveDepartment).toHaveBeenCalledTimes(2) })
    expect(saveDepartment.mock.calls[1]?.[0]).toEqual({
      id: expect.stringMatching(/^department-/), name: '采购部', parentId: null,
      sortOrder: 0, expectedRevision: 0,
    })
  })

  it('explains how business knowledge becomes Agent memory and hides technical digests', async () => {
    const proposeMemory = vi.fn(() => Promise.resolve())
    render(<EnterpriseGovernanceSettingsSection
      state={state({
        auth: {
          authenticated: true,
          principal: { userId: 'admin-1', orgId: 'org-a', displayName: 'Admin', username: 'admin', roles: ['administrator'] },
          providers: [],
        },
        departments: [{
          id: 'dept-ops', orgId: 'org-a', parentId: null, name: '运营部', sortOrder: 0,
          revision: 1, createdAt: 1, updatedAt: 1,
        }],
      })}
      loadAdmin={vi.fn()} loginLocal={vi.fn()} logout={vi.fn()} createOrganization={vi.fn()}
      createAsset={vi.fn()} createUser={vi.fn()} updateUser={vi.fn()} saveDepartment={vi.fn()}
      createWorkspace={vi.fn()} updateWorkspace={vi.fn()} proposeMemory={proposeMemory} reviewMemory={vi.fn()}
      savePolicy={vi.fn()} filterAudit={vi.fn()}
    />)
    fireEvent.click(screen.getByRole('tab', { name: '企业记忆' }))

    expect(screen.getByRole('heading', { name: '企业记忆' })).toBeDefined()
    expect(screen.getByText('日常业务知识自动生效；这里只处理需要确认的例外，并管理已启用的记忆。')).toBeDefined()
    expect(screen.getByText('员工沉淀知识')).toBeDefined()
    expect(screen.getByText('常规知识自动生效')).toBeDefined()
    expect(screen.getByText('仅异常待确认')).toBeDefined()
    expect(screen.queryByLabelText('来源证据摘要')).toBeNull()
    fireEvent.change(screen.getByLabelText('适用范围'), { target: { value: 'organization' } })
    fireEvent.change(screen.getByLabelText('业务知识类型'), { target: { value: 'process' } })
    fireEvent.change(screen.getByLabelText('要让 Agent 记住的内容'), {
      target: { value: '所有采购订单必须在入库前完成审批。' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存并启用' }))

    await waitFor(() => { expect(proposeMemory).toHaveBeenCalledOnce() })
    expect(proposeMemory).toHaveBeenCalledWith({
      id: expect.any(String), scope: 'organization', kind: 'process',
      summary: '所有采购订单必须在入库前完成审批。',
    })
  })

  it('identifies Agent-evaluated memory that became active automatically', async () => {
    const reviewMemory = vi.fn(() => Promise.resolve())
    render(<EnterpriseGovernanceSettingsSection
      state={state({
        auth: {
          authenticated: true,
          principal: { userId: 'admin-1', orgId: 'org-a', displayName: 'Admin', username: 'admin', roles: ['administrator'] },
          providers: [],
        },
        memories: [{
          id: `agent-memory-${'a'.repeat(64)}`, orgId: 'org-a', scope: 'organization', kind: 'decision',
          status: 'approved', summary: '公司统一使用年度合同模板。', sourceDigest: 'a'.repeat(64),
          privacyFindings: [], createdBy: 'admin-1', reviewedBy: 'admin-1',
          reviewReason: 'Agent 自动评估并直接启用', revision: 2, createdAt: 1, updatedAt: 2,
        }],
      })}
      loadAdmin={vi.fn()} loginLocal={vi.fn()} logout={vi.fn()} createOrganization={vi.fn()}
      createAsset={vi.fn()} createUser={vi.fn()} updateUser={vi.fn()} saveDepartment={vi.fn()}
      createWorkspace={vi.fn()} updateWorkspace={vi.fn()} proposeMemory={vi.fn()} reviewMemory={reviewMemory}
      savePolicy={vi.fn()} filterAudit={vi.fn()}
    />)
    fireEvent.click(screen.getByRole('tab', { name: '企业记忆' }))
    expect(screen.getByText('Agent 自动记忆已开启')).toBeDefined()
    expect(screen.getByText('Agent 自动保存 · 已直接生效')).toBeDefined()
    expect(screen.getByText('由 Agent 自动评估并直接生效')).toBeDefined()
    expect(screen.queryByRole('region', { name: '待确认的例外' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '停用此记忆' }))
    await waitFor(() => { expect(reviewMemory).toHaveBeenCalledWith(`agent-memory-${'a'.repeat(64)}`, expect.objectContaining({ decision: 'retired', expectedRevision: 2 })) })
  })

  it('shows automatic writeback outcomes and lets an operator retry failures', async () => {
    const retry = vi.fn(() => Promise.resolve())
    render(<EnterpriseGovernanceSettingsSection
      state={state({
        auth: { authenticated: true, principal: { userId: 'admin-1', orgId: 'org-a', displayName: 'Admin', username: 'admin', roles: ['administrator'] }, providers: [] },
        memoryWritebacks: [{
          sourceKey: 'session-1:2', sessionId: 'session-1', turn: 2, state: 'failed', attempts: 5,
          nextAttemptAt: 0, error: 'model unavailable', createdAt: 1, updatedAt: 2,
        }, {
          sourceKey: 'session-2:1', sessionId: 'session-2', turn: 1, state: 'completed', attempts: 1,
          nextAttemptAt: 0, result: { outcome: 'completed', activated: 1, pending: 1, skipped: 2 }, createdAt: 2, updatedAt: 3,
        }],
      })}
      loadAdmin={vi.fn()} loginLocal={vi.fn()} logout={vi.fn()} createOrganization={vi.fn()}
      createAsset={vi.fn()} createUser={vi.fn()} updateUser={vi.fn()} saveDepartment={vi.fn()}
      createWorkspace={vi.fn()} updateWorkspace={vi.fn()} proposeMemory={vi.fn()} reviewMemory={vi.fn()}
      retryMemoryWriteback={retry} savePolicy={vi.fn()} filterAudit={vi.fn()}
    />)
    fireEvent.click(screen.getByRole('tab', { name: '企业记忆' }))
    expect(screen.getByText('自动沉淀')).toBeDefined()
    expect(screen.getByText('最近一次：启用 1 · 待确认 1 · 跳过 2')).toBeDefined()
    expect(screen.getByText('model unavailable')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(retry).toHaveBeenCalledWith('session-1:2')
  })

  it('edits the department tree and reviews the enterprise awareness stream', () => {
    const saveDepartment = vi.fn(() => Promise.resolve())
    const reviewMemory = vi.fn(() => Promise.resolve())
    const updateWorkspace = vi.fn(() => Promise.resolve())
    render(<EnterpriseGovernanceSettingsSection
      state={state({
        auth: {
          authenticated: true,
          principal: { userId: 'admin-1', orgId: 'org-a', displayName: 'Admin', username: 'admin', roles: ['administrator'] },
          providers: [],
        },
        departments: [{
          id: 'dept-ops', orgId: 'org-a', parentId: null, name: '运营部', sortOrder: 0,
          revision: 1, createdAt: 1, updatedAt: 1,
        }],
        users: [{
          id: 'admin-1', username: 'admin', displayName: 'Admin', disabled: false, roles: ['administrator'],
          departmentIds: ['dept-ops'], primaryDepartmentId: 'dept-ops', departmentRevision: 1,
        }],
        workspaces: [{
          workspaceId: 'workspace-ops', orgId: 'org-a', name: '运营部 · 共享工作区', kind: 'department',
          departmentId: 'dept-ops', rootPath: '/managed/ops', sandboxMode: 'read-only', revision: 1,
          createdAt: 1, updatedAt: 1,
        }],
        memories: [{
          id: 'memory-1', orgId: 'org-a', scope: 'department', departmentId: 'dept-ops', kind: 'process',
          status: 'proposed', summary: '审批必须保留版本记录。', sourceDigest: 'a'.repeat(64), privacyFindings: [],
          createdBy: 'admin-1', revision: 1, createdAt: 1, updatedAt: 1,
        }],
      })}
      loadAdmin={vi.fn()}
      loginLocal={vi.fn()}
      logout={vi.fn()}
      createOrganization={vi.fn()}
      createAsset={vi.fn()}
      createUser={vi.fn()}
      updateUser={vi.fn()}
      saveDepartment={saveDepartment}
      createWorkspace={vi.fn()}
      updateWorkspace={updateWorkspace}
      proposeMemory={vi.fn()}
      reviewMemory={reviewMemory}
      savePolicy={vi.fn()}
      filterAudit={vi.fn()}
    />)
    expect(screen.getByRole('tree', { name: '组织架构' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '运营部' }))
    expect(screen.getByText('运营部 · 共享工作区')).toBeDefined()
    fireEvent.click(screen.getByRole('tab', { name: '工作区' }))
    fireEvent.change(screen.getByLabelText('运营部 · 共享工作区 名称'), { target: { value: '华东运营协作空间' } })
    fireEvent.change(screen.getByLabelText('运营部 · 共享工作区 沙盒策略'), { target: { value: 'workspace-write' } })
    fireEvent.click(screen.getByRole('button', { name: '保存运营部 · 共享工作区' }))
    expect(updateWorkspace).toHaveBeenCalledWith('workspace-ops', {
      name: '华东运营协作空间', sandboxMode: 'workspace-write', expectedRevision: 1,
    })
    fireEvent.click(screen.getByRole('tab', { name: '企业记忆' }))
    fireEvent.change(screen.getByLabelText('审批必须保留版本记录。 审核说明'), { target: { value: '制度已核验' } })
    fireEvent.click(screen.getByRole('button', { name: '批准并启用' }))
    expect(reviewMemory).toHaveBeenCalledWith('memory-1', {
      decision: 'approved', reason: '制度已核验', expectedRevision: 1,
    })
  })
})
