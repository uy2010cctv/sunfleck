// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  EnterpriseGovernanceSettingsSection, EnterpriseGovernanceSurface,
} from '../src/client/EnterpriseGovernanceSurface.tsx'
import type { EnterpriseGovernanceState } from '../src/client/controller.ts'

afterEach(cleanup)

function state(value: Partial<EnterpriseGovernanceState>): EnterpriseGovernanceState {
  return {
    phase: 'ready', error: null,
    auth: {
      authenticated: false, organizationId: 'default-enterprise',
      providers: [{ id: 'local', kind: 'local', label: 'Local account' }],
    },
    organizations: [], users: [], assets: [], policies: [], audit: [],
    ...value,
  }
}

describe('enterprise governance UI', () => {
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
      savePolicy: vi.fn(), filterAudit: vi.fn(),
    }
    const loading: EnterpriseGovernanceState = {
      phase: 'loading', error: null, organizations: [], users: [], assets: [], policies: [], audit: [],
    }
    const { rerender } = render(<EnterpriseGovernanceSurface state={loading} {...props} />)
    expect(screen.getByLabelText('组织')).toHaveProperty('value', '')
    rerender(<EnterpriseGovernanceSurface state={state({ auth: {
      authenticated: false, organizationId: 'default-enterprise', providers: [],
    } })} {...props} />)
    expect(screen.getByLabelText('组织')).toHaveProperty('value', 'default-enterprise')
  })

  it('blocks the application with a labelled login form while unauthenticated', () => {
    const loginLocal = vi.fn(() => Promise.resolve())
    render(<EnterpriseGovernanceSurface
      state={state({})}
      loginLocal={loginLocal}
      logout={vi.fn()}
      createOrganization={vi.fn()}
      createAsset={vi.fn()}
      createUser={vi.fn()}
      updateUser={vi.fn()}
      savePolicy={vi.fn()}
      filterAudit={vi.fn()}
    />)
    expect(screen.getByLabelText('组织')).toHaveProperty('value', 'default-enterprise')
    fireEvent.change(screen.getByLabelText('组织'), { target: { value: 'org-a' } })
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'admin' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'enterprise-password' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))
    expect(loginLocal).toHaveBeenCalledWith({
      organizationId: 'org-a', username: 'admin', password: 'enterprise-password',
    })
  })

  it('shows governance ledger sections on the administrator Settings page', () => {
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
      savePolicy={vi.fn()}
      filterAudit={vi.fn()}
    />)
    expect(screen.getByRole('main', { name: '企业治理' })).toBeDefined()
    expect(screen.getByRole('heading', { name: '用户与角色' })).toBeDefined()
    expect(screen.getByRole('heading', { name: '资产权限' })).toBeDefined()
    expect(screen.getByRole('heading', { name: '审计日志' })).toBeDefined()
  })
})
