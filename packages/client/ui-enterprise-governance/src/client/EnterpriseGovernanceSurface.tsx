/** Login gate and administrator governance ledger. */

import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import {
  IconChevronDownOutline14, IconChevronRightOutline14, IconEditOutline16, IconFolderClose16,
  IconFolderOpen16, IconPlusOutline16, IconUserOutline16, Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type {
  EnterpriseGovernanceState, GovernanceDepartment, GovernanceMemory, GovernancePolicy, GovernanceUser,
} from './controller.ts'
import css from './governance.module.css'

export interface EnterpriseGovernanceSurfaceProps {
  state: EnterpriseGovernanceState
  loginLocal(input: { organizationId: string; username: string; password: string }): Promise<void>
  logout(): Promise<void> | void
  createOrganization(input: { id: string; name: string }): Promise<void>
  createUser(input: {
    id: string
    username: string
    displayName: string
    password: string
    roles: readonly string[]
  }): Promise<void>
  createAsset(input: { type: 'channel' | 'model' | 'capability'; id: string; name: string; config: Record<string, unknown> }): Promise<void>
  updateUser(userId: string, input: {
    roles?: readonly string[]
    disabled?: boolean
    username?: string
    displayName?: string
    password?: string
    departmentIds?: readonly string[]
    primaryDepartmentId?: string
    expectedRevision?: number
  }): Promise<void>
  saveDepartment(input: {
    id: string
    name: string
    parentId: string | null
    sortOrder: number
    expectedRevision: number
  }): Promise<void>
  createWorkspace(input: { name: string; idempotencyKey: string }): Promise<void>
  updateWorkspace(workspaceId: string, input: {
    sandboxMode: 'read-only' | 'workspace-write'
    expectedRevision: number
  }): Promise<void>
  proposeMemory(input: {
    id: string
    scope: GovernanceMemory['scope']
    departmentId?: string
    kind: GovernanceMemory['kind']
    summary: string
    sourceDigest?: string
  }): Promise<void>
  reviewMemory(memoryId: string, input: {
    decision: 'approved' | 'rejected' | 'retired'
    reason: string
    expectedRevision: number
  }): Promise<void>
  savePolicy(input: GovernancePolicy): Promise<void>
  filterAudit(input: { actorUserId?: string; action?: string }): Promise<void>
}

export interface EnterpriseGovernanceSettingsSectionProps extends EnterpriseGovernanceSurfaceProps {
  loadAdmin: () => Promise<void>
}

function DepartmentBranch({
  departments, users, parentId, selectedId, expanded, select, toggle, depth = 0,
}: {
  departments: readonly GovernanceDepartment[]
  users: readonly GovernanceUser[]
  parentId: string | null
  selectedId: string | undefined
  expanded: ReadonlySet<string>
  select: (department: GovernanceDepartment) => void
  toggle: (departmentId: string) => void
  depth?: number
}) {
  const children = departments.filter(item => item.parentId === parentId)
    .toSorted((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name))
  if (children.length === 0) return null
  return <ul role="group">
    {children.map((department) => {
      const departmentUsers = users.filter(user => user.departmentIds?.includes(department.id) === true)
      const childCount = departments.filter(item => item.parentId === department.id).length
      const hasChildren = childCount > 0 || departmentUsers.length > 0
      const open = expanded.has(department.id)
      return <li key={department.id} role="treeitem" aria-level={depth + 2}
        aria-expanded={hasChildren ? open : undefined}>
        <div className={`${css.treeRow} ${selectedId === department.id ? css.treeRowSelected : ''}`}>
          {hasChildren
            ? <button className={css.treeToggle} type="button" aria-label={`${open ? '收起' : '展开'}${department.name}`}
              onClick={() => { toggle(department.id) }}>
              {open ? <IconChevronDownOutline14 size={12} /> : <IconChevronRightOutline14 size={12} />}
            </button>
            : <span className={css.treeToggleSpacer} />}
          <button className={css.departmentButton} type="button" aria-label={department.name}
            aria-pressed={selectedId === department.id} onClick={() => { select(department) }}>
            <span className={css.folderIcon} aria-hidden="true">
              {open ? <IconFolderOpen16 size={18} /> : <IconFolderClose16 size={18} />}
            </span>
            <span className={css.treeLabel}>{department.name}</span>
            <small>{departmentUsers.length + childCount}</small>
          </button>
        </div>
        {open && hasChildren && <>
          {departmentUsers.length > 0 && <ul role="group">
            {departmentUsers.map(user => <li key={user.id} role="treeitem" aria-level={depth + 3}
              className={css.memberRow}>
              <span className={css.memberAvatar} aria-hidden="true"><IconUserOutline16 size={14} /></span>
              <span className={css.memberIdentity}>
                <strong>{user.displayName}</strong>
                <small>@{user.username} · {user.roles.join(' / ')}{user.disabled ? ' · 已停用' : ''}</small>
              </span>
            </li>)}
          </ul>}
          <DepartmentBranch departments={departments} users={users} parentId={department.id}
            selectedId={selectedId} expanded={expanded} select={select} toggle={toggle} depth={depth + 1} />
        </>}
      </li>
    })}
  </ul>
}

function OrganizationsSection({ state, saveDepartment }: Pick<
  EnterpriseGovernanceSurfaceProps, 'state' | 'saveDepartment'
>) {
  const organizationId = state.auth?.principal?.orgId ?? state.auth?.organizationId
  const organization = state.organizations.find(item => item.id === organizationId)
  const organizationName = organization?.name ?? organizationId ?? '当前企业'
  const departments = useMemo(
    () => state.departments.filter(item => organizationId === undefined || item.orgId === organizationId),
    [organizationId, state.departments],
  )
  const initial = departments[0]
  const [selectedId, setSelectedId] = useState<string | undefined>(initial?.id)
  const [departmentId, setDepartmentId] = useState(initial?.id ?? '')
  const [departmentName, setDepartmentName] = useState(initial?.name ?? '')
  const [parentId, setParentId] = useState(initial?.parentId ?? '')
  const [sortOrder, setSortOrder] = useState(String(initial?.sortOrder ?? 0))
  const [isCreating, setIsCreating] = useState(initial === undefined)
  const [saving, setSaving] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(departments.map(item => item.id)))
  const selected = departments.find(item => item.id === selectedId)
  const select = (department: GovernanceDepartment): void => {
    setIsCreating(false)
    setSubmitError(null)
    setSelectedId(department.id)
    setDepartmentId(department.id)
    setDepartmentName(department.name)
    setParentId(department.parentId ?? '')
    setSortOrder(String(department.sortOrder))
  }
  const beginCreate = (nextParentId: string | null): void => {
    const siblings = departments.filter(item => item.parentId === nextParentId)
    setIsCreating(true)
    setSubmitError(null)
    setSelectedId(undefined)
    setDepartmentId(`department-${randomUUID()}`)
    setDepartmentName('')
    setParentId(nextParentId ?? '')
    setSortOrder(String(siblings.length))
  }
  const toggle = (departmentIdToToggle: string): void => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(departmentIdToToggle)) next.delete(departmentIdToToggle)
      else next.add(departmentIdToToggle)
      return next
    })
  }
  const selectedWorkspaces = selectedId === undefined
    ? []
    : state.workspaces.filter(workspace => workspace.departmentId === selectedId)
  const selectedUsers = selectedId === undefined
    ? []
    : state.users.filter(user => user.departmentIds?.includes(selectedId) === true)
  useEffect(() => {
    setExpanded(current => new Set([...current, ...departments.map(item => item.id)]))
    if (isCreating || selectedId !== undefined || departments[0] === undefined) return
    const department = departments[0]
    setSelectedId(department.id); setDepartmentId(department.id); setDepartmentName(department.name)
    setParentId(department.parentId ?? ''); setSortOrder(String(department.sortOrder))
  }, [departments, isCreating, selectedId])
  return <section className={css.ledgerSection}>
    <header className={css.directoryHeader}>
      <div><h2>组织架构</h2><p>按部门查看成员，并维护上下级关系。</p></div>
      <div className={css.directoryActions}>
        <span>{departments.length} 个部门 · {state.users.length} 位成员</span>
        <button type="button" onClick={() => { beginCreate(null) }}>新增根部门</button>
      </div>
    </header>
    <div className={css.directoryLayout}>
      <div className={css.treePanel}>
        <ul className={css.organizationTree} role="tree" aria-label="组织架构">
          <li role="treeitem" aria-level={1} aria-expanded="true">
            <div className={css.enterpriseRoot}>
              <span className={css.enterpriseMark} aria-hidden="true">DSH</span>
              <span><strong>{organizationName}</strong><small>企业根节点</small></span>
            </div>
            {departments.length === 0
              ? <p className={css.emptyState}>还没有部门。点击“新增根部门”，输入名称即可创建。</p>
              : <DepartmentBranch departments={departments} users={state.users} parentId={null}
                selectedId={selectedId} expanded={expanded} select={select} toggle={toggle} />}
          </li>
        </ul>
      </div>
      <div className={css.departmentDetail}>
        <div className={css.subsectionHeader}>
          <div><strong>{isCreating ? '新建部门' : selected?.name ?? '选择一个部门'}</strong>
            <span>{isCreating ? '创建后会出现在左侧组织树中' : selected !== undefined ? `内部编号 ${selected.id}` : '从左侧选择部门以查看详情'}</span></div>
          {selected !== undefined && <span>修订 {selected.revision}</span>}
        </div>
        <form className={css.departmentForm} onSubmit={(event) => {
          event.preventDefault()
          if (departmentName.trim() === '') {
            setSubmitError('请输入部门名称')
            return
          }
          const submit = async (): Promise<void> => {
            setSaving(true)
            setSubmitError(null)
            try {
              await saveDepartment({
                id: departmentId, name: departmentName.trim(), parentId: parentId === '' ? null : parentId,
                sortOrder: Number(sortOrder), expectedRevision: selected?.id === departmentId ? selected.revision : 0,
              })
              setSelectedId(departmentId)
              setIsCreating(false)
              setExpanded(current => new Set([...current, departmentId, ...(parentId === '' ? [] : [parentId])]))
            } catch {
              setSubmitError(`${isCreating ? '创建' : '保存'}部门失败，请重试`)
            } finally {
              setSaving(false)
            }
          }
          void submit()
        }}>
          <label>部门名称<input value={departmentName} onChange={(event) => { setDepartmentName(event.target.value) }} /></label>
          <label>上级部门<select value={parentId} onChange={(event) => { setParentId(event.target.value) }}>
            <option value="">企业根节点</option>
            {departments.filter(item => item.id !== departmentId).map(item => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select></label>
          <label>同级排序<input inputMode="numeric" value={sortOrder} onChange={(event) => { setSortOrder(event.target.value) }} /></label>
          {submitError !== null && <div className={css.formError} role="alert">{submitError}</div>}
          <div className={css.formActions}>
            {selected !== undefined && <button type="button" onClick={() => { beginCreate(selected.id) }}>新增下级部门</button>}
            <button type="submit" disabled={saving || departmentId === ''}>
              {saving ? '正在保存…' : isCreating ? '创建部门' : '保存部门'}
            </button>
          </div>
        </form>
        {selected !== undefined && <div className={css.departmentEvidence}>
          <div><span>成员</span><strong>{selectedUsers.length}</strong></div>
          <div><span>共享工作区</span><strong>{selectedWorkspaces.length}</strong></div>
        </div>}
        {selectedWorkspaces.map(workspace => <div key={workspace.workspaceId} className={css.workspaceLine}>
          <strong>{workspace.name}</strong><span>{workspace.sandboxMode === 'read-only' ? '只读沙盒' : '工作区可写'}</span>
        </div>)}
      </div>
    </div>
  </section>
}

function LoginGate({ state, loginLocal }: Pick<EnterpriseGovernanceSurfaceProps, 'state' | 'loginLocal'>) {
  const [organizationId, setOrganizationId] = useState(state.auth?.organizationId ?? '')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  useEffect(() => {
    if (organizationId === '' && state.auth?.organizationId !== undefined) {
      setOrganizationId(state.auth.organizationId)
    }
  }, [organizationId, state.auth?.organizationId])
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    const secret = password
    setPassword('')
    void loginLocal({ organizationId, username, password: secret })
  }
  return (
    <section className={css.loginGate} aria-label="企业登录">
      <div className={css.loginPanel}>
        <div className={css.loginIdentity}><span aria-hidden="true">DSH</span><strong>Enterprise</strong></div>
        <h1>登录企业工作台</h1>
        <p>身份将用于员工可见范围、Host API 授权与操作审计。</p>
        <form onSubmit={submit}>
          <label>组织<input value={organizationId} onChange={(event) => { setOrganizationId(event.target.value) }} /></label>
          <label>用户名<input autoComplete="username" value={username} onChange={(event) => { setUsername(event.target.value) }} /></label>
          <label>密码<input type="password" autoComplete="current-password" value={password} onChange={(event) => { setPassword(event.target.value) }} /></label>
          <div className={css.errorSlot}>
            {state.error !== null && <div className={css.error} role="alert">{state.error}</div>}
          </div>
          <button type="submit" disabled={state.phase === 'loading'}>{state.phase === 'loading' ? '正在验证…' : '登录'}</button>
        </form>
        {state.auth?.providers.filter(provider => provider.kind !== 'local').map(provider => (
          <a key={provider.id} className={css.ssoButton} href={`/auth/login/${encodeURIComponent(provider.id)}`}>
            {provider.label}
          </a>
        ))}
      </div>
    </section>
  )
}

const USER_ROLES = [
  ['administrator', '管理员'], ['creator', '创建者'], ['operator', '运营者'], ['auditor', '审计员'], ['member', '成员'],
] as const

function roleLabel(role: string): string {
  return USER_ROLES.find(item => item[0] === role)?.[1] ?? role
}

function UserDialog({ mode, user, departments, createUser, updateUser, close }: {
  mode: 'create' | 'edit'
  user?: GovernanceUser
  departments: readonly GovernanceDepartment[]
  createUser: EnterpriseGovernanceSurfaceProps['createUser']
  updateUser: EnterpriseGovernanceSurfaceProps['updateUser']
  close: () => void
}) {
  const formId = useId()
  const [username, setUsername] = useState(user?.username ?? '')
  const [displayName, setDisplayName] = useState(user?.displayName ?? '')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState(user?.roles[0] ?? 'member')
  const [disabled, setDisabled] = useState(user?.disabled ?? false)
  const [departmentIds, setDepartmentIds] = useState<string[]>([...(user?.departmentIds ?? [])])
  const [primaryDepartmentId, setPrimaryDepartmentId] = useState(user?.primaryDepartmentId ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const title = mode === 'create' ? '新增用户' : '编辑用户'
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const normalizedUsername = username.trim()
    const normalizedDisplayName = displayName.trim()
    if (!/^\S{2,64}$/u.test(normalizedUsername)) {
      setError('用户名需为 2–64 个不含空格的字符')
      return
    }
    if (normalizedDisplayName.length < 1 || normalizedDisplayName.length > 100) {
      setError('显示名称需为 1–100 个字符')
      return
    }
    if ((mode === 'create' || password !== '') && (password.length < 8 || password.length > 128)) {
      setError('密码需为 8–128 个字符')
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (mode === 'create') {
        await createUser({
          id: `user-${randomUUID()}`, username: normalizedUsername, displayName: normalizedDisplayName,
          password, roles: [role],
        })
      } else if (user !== undefined) {
        await updateUser(user.id, {
          username: normalizedUsername, displayName: normalizedDisplayName,
          ...(password === '' ? {} : { password }), roles: [role], disabled, departmentIds,
          ...(primaryDepartmentId === '' ? {} : { primaryDepartmentId }),
          expectedRevision: user.departmentRevision ?? 0,
        })
      }
      setPassword('')
      close()
    } catch {
      setError(`${mode === 'create' ? '创建' : '保存'}失败，请检查用户名是否重复后重试`)
    } finally {
      setSaving(false)
    }
  }
  return <Modal open onClose={() => { if (!saving) close() }} title={title} closeLabel="关闭"
    {...(css.userDialog === undefined ? {} : { className: css.userDialog })} description={mode === 'create'
      ? '创建后会自动分配独立个人工作区。'
      : '修改登录身份、角色、部门和账号状态。新密码留空时保持原密码。'}
    footer={<>
      <button className={css.secondaryAction} type="button" disabled={saving} onClick={close}>取消</button>
      <button className={css.primaryAction} type="submit" form={formId} disabled={saving}>
        {saving ? '正在保存…' : mode === 'create' ? '创建用户' : '保存修改'}
      </button>
    </>}>
    <form id={formId} className={css.userForm} onSubmit={(event) => { void submit(event) }}>
      <label>用户名<input autoFocus aria-label="用户名" autoComplete="off" maxLength={64}
        value={username} onChange={(event) => { setUsername(event.target.value) }} /></label>
      <label>显示名称<input aria-label="显示名称" maxLength={100}
        value={displayName} onChange={(event) => { setDisplayName(event.target.value) }} /></label>
      <label>{mode === 'create' ? '初始密码' : '新密码（留空则不修改）'}<input type="password"
        aria-label={mode === 'create' ? '初始密码' : '新密码（留空则不修改）'} autoComplete="new-password"
        minLength={8} maxLength={128} value={password} onChange={(event) => { setPassword(event.target.value) }} /></label>
      <label>角色<select aria-label="角色" value={role} onChange={(event) => { setRole(event.target.value) }}>
        {USER_ROLES.map(item => <option key={item[0]} value={item[0]}>{item[1]} · {item[0]}</option>)}
      </select></label>
      {mode === 'edit' && <>
        <fieldset className={css.departmentChoices}><legend>所属部门</legend>
          {departments.length === 0
            ? <span>暂无可分配部门</span>
            : departments.map(department => <label key={department.id}>
              <input type="checkbox" checked={departmentIds.includes(department.id)} onChange={(event) => {
                setDepartmentIds((current) => {
                  const next = event.target.checked
                    ? [...current, department.id]
                    : current.filter(id => id !== department.id)
                  if (!next.includes(primaryDepartmentId)) setPrimaryDepartmentId(next[0] ?? '')
                  return next
                })
              }} />{department.name}
            </label>)}
        </fieldset>
        <label>主部门<select aria-label="主部门" value={primaryDepartmentId}
          disabled={departmentIds.length === 0} onChange={(event) => { setPrimaryDepartmentId(event.target.value) }}>
          <option value="">未设置主部门</option>
          {departments.filter(department => departmentIds.includes(department.id))
            .map(department => <option key={department.id} value={department.id}>{department.name}</option>)}
        </select></label>
        <label>账号状态<select aria-label="账号状态" value={disabled ? 'disabled' : 'active'}
          onChange={(event) => { setDisabled(event.target.value === 'disabled') }}>
          <option value="active">正常</option><option value="disabled">已停用</option>
        </select></label>
      </>}
      {error !== null && <div className={css.formError} role="alert">{error}</div>}
    </form>
  </Modal>
}

function UsersSection({ state, createUser, updateUser }: Pick<
  EnterpriseGovernanceSurfaceProps, 'state' | 'createUser' | 'updateUser'
>) {
  const [dialog, setDialog] = useState<{ mode: 'create' } | { mode: 'edit'; user: GovernanceUser } | null>(null)
  const [query, setQuery] = useState('')
  const [busyUserId, setBusyUserId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const users = state.users.filter(user => normalizedQuery === ''
    || user.displayName.toLocaleLowerCase().includes(normalizedQuery)
    || user.username.toLocaleLowerCase().includes(normalizedQuery))
  const departmentName = (id: string): string => state.departments.find(item => item.id === id)?.name ?? id
  return <section className={css.ledgerSection}>
    <header className={css.userHeader}>
      <div><h2>用户管理</h2><p>管理登录身份、角色、部门和账号状态。</p></div>
      <span>{state.users.length} 位用户</span>
    </header>
    <div className={css.userToolbar}>
      <input aria-label="搜索用户" placeholder="搜索姓名或用户名" value={query}
        onChange={(event) => { setQuery(event.target.value) }} />
      <button type="button" onClick={() => { setDialog({ mode: 'create' }) }}>
        <IconPlusOutline16 size={14} />新增用户
      </button>
    </div>
    {actionError !== null && <div className={css.error} role="alert">{actionError}</div>}
    {users.length === 0
      ? <p className={css.emptyState}>{state.users.length === 0 ? '还没有用户。点击“新增用户”创建首位成员。' : '没有匹配的用户。'}</p>
      : <div className={`${css.tableWrap} ${css.userTable}`}>
        <table><thead><tr><th>用户</th><th>部门</th><th>角色</th><th>状态</th><th>操作</th></tr></thead><tbody>
          {users.map((user) => {
            const primary = user.primaryDepartmentId
            const secondary = (user.departmentIds ?? []).filter(id => id !== primary)
            return <tr key={user.id}>
              <td><div className={css.userIdentity}>
                <span className={css.userAvatar} aria-hidden="true"><IconUserOutline16 size={16} /></span>
                <span><strong>{user.displayName}</strong><small>@{user.username}</small></span>
              </div></td>
              <td><div className={css.departmentSummary}>
                {primary !== undefined && <strong>{departmentName(primary)} · 主部门</strong>}
                {secondary.length > 0 && <span>{secondary.map(departmentName).join('、')}</span>}
                {primary === undefined && secondary.length === 0 && <span>未分配部门</span>}
              </div></td>
              <td><span className={css.roleBadge}><strong>{roleLabel(user.roles[0] ?? 'member')}</strong>
                <small>{user.roles[0] ?? 'member'}</small></span></td>
              <td><span className={css.statusLabel} data-disabled={user.disabled ? 'true' : 'false'}>
                <i aria-hidden="true" />{user.disabled ? '已停用' : '正常'}
              </span></td>
              <td><div className={css.rowActions}>
                <button type="button" aria-label={`编辑用户：${user.displayName}`}
                  onClick={() => { setDialog({ mode: 'edit', user }) }}><IconEditOutline16 size={14} />编辑</button>
                <button type="button" disabled={busyUserId === user.id} onClick={() => {
                  const change = async (): Promise<void> => {
                    setBusyUserId(user.id); setActionError(null)
                    try { await updateUser(user.id, { disabled: !user.disabled }) }
                    catch { setActionError(`${user.disabled ? '启用' : '停用'}用户失败，请重试`) }
                    finally { setBusyUserId(null) }
                  }
                  void change()
                }}>{busyUserId === user.id ? '处理中…' : user.disabled ? '启用' : '停用'}</button>
              </div></td>
            </tr>
          })}</tbody></table>
      </div>}
    {dialog !== null && <UserDialog key={dialog.mode === 'create' ? 'create' : dialog.user.id}
      mode={dialog.mode} {...(dialog.mode === 'edit' ? { user: dialog.user } : {})}
      departments={state.departments} createUser={createUser} updateUser={updateUser}
      close={() => { setDialog(null) }} />}
  </section>
}

function WorkspacesSection({ state, createWorkspace, updateWorkspace }: Pick<
  EnterpriseGovernanceSurfaceProps, 'state' | 'createWorkspace' | 'updateWorkspace'
>) {
  const [name, setName] = useState('')
  return <section className={css.ledgerSection}>
    <header><h2>工作区与沙盒</h2><span>{state.workspaces.length}</span></header>
    <p>个人工作区彼此隔离；部门共享空间只向部门成员开放。Session cwd 是实际沙盒边界，沙盒策略变更对新建 Session 生效。</p>
    <form className={css.workspaceCreate} onSubmit={(event) => {
      event.preventDefault()
      void createWorkspace({ name, idempotencyKey: randomUUID() })
      setName('')
    }}>
      <input aria-label="新工作区名称" placeholder="例如：三季度采购专项" value={name}
        onChange={(event) => { setName(event.target.value) }} />
      <button type="submit" disabled={name.trim() === ''}>新建我的工作区</button>
    </form>
    <div className={css.workspaceList}>{state.workspaces.map(workspace => <div key={workspace.workspaceId}>
      <div><strong>{workspace.name}</strong><span>{workspace.kind === 'personal' ? '个人' : '部门共享'}</span></div>
      <div className={css.workspaceMeta}>
        <select aria-label={`${workspace.name} 沙盒策略`} value={workspace.sandboxMode} onChange={(event) => {
          void updateWorkspace(workspace.workspaceId, {
            sandboxMode: event.target.value as 'read-only' | 'workspace-write', expectedRevision: workspace.revision,
          })
        }}>
          <option value="read-only">只读沙盒</option><option value="workspace-write">工作区可写</option>
        </select>
        <code>{workspace.rootPath}</code>
      </div>
    </div>)}</div>
  </section>
}

function MemorySection({ state, proposeMemory, reviewMemory }: Pick<
  EnterpriseGovernanceSurfaceProps, 'state' | 'proposeMemory' | 'reviewMemory'
>) {
  const [scope, setScope] = useState<GovernanceMemory['scope']>('department')
  const [departmentId, setDepartmentId] = useState(state.departments[0]?.id ?? '')
  const [kind, setKind] = useState<GovernanceMemory['kind']>('business-fact')
  const [summary, setSummary] = useState('')
  const [reviewReasons, setReviewReasons] = useState<Record<string, string>>({})
  const [busyMemoryId, setBusyMemoryId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const proposed = state.memories.filter(memory => memory.status === 'proposed')
  const approved = state.memories.filter(memory => memory.status === 'approved')
  const kindLabel = (value: GovernanceMemory['kind']): string => ({
    'business-fact': '业务规则', process: '工作流程', terminology: '公司术语', decision: '已确认决策',
  })[value]
  const departmentName = (id: string | undefined): string =>
    state.departments.find(department => department.id === id)?.name ?? '未找到部门'
  const scopeLabel = (memory: GovernanceMemory): string => memory.scope === 'organization'
    ? '全企业'
    : departmentName(memory.departmentId)
  useEffect(() => {
    if (departmentId === '' && state.departments[0] !== undefined) setDepartmentId(state.departments[0].id)
  }, [departmentId, state.departments])
  return <section className={css.ledgerSection}>
    <header className={css.memoryHeader}>
      <div><h2>企业记忆</h2><p>让 Agent 记住经过审核的公司知识，并按企业或部门范围安全使用。</p></div>
      <span>{approved.length} 条已启用</span>
    </header>
    <ol className={css.memoryFlow} aria-label="企业记忆生效流程">
      <li><span>1</span><strong>提交业务知识</strong><small>填写可共享的规则、流程、术语或决策</small></li>
      <li><span>2</span><strong>管理员审核</strong><small>确认内容准确、适用范围正确且不含隐私</small></li>
      <li><span>3</span><strong>Agent 可使用</strong><small>审核通过后进入对应企业或部门的 Agent 上下文</small></li>
    </ol>
    <form className={css.memoryComposer} onSubmit={(event) => {
      event.preventDefault()
      if (summary.trim() === '' || (scope === 'department' && departmentId === '')) return
      const submit = async (): Promise<void> => {
        setSubmitting(true); setError(null)
        try {
          await proposeMemory({
            id: randomUUID(), scope, ...(scope === 'department' ? { departmentId } : {}),
            kind, summary: summary.trim(),
          })
          setSummary('')
        } catch { setError('提交审核失败。请确认内容不含姓名、联系方式、密码或其他个人敏感信息后重试。') }
        finally { setSubmitting(false) }
      }
      void submit()
    }}>
      <div className={css.memoryComposerHeader}><strong>新增业务记忆</strong>
        <span>提交后不会立即影响 Agent，需要管理员审核通过。</span></div>
      <div className={css.memoryFields}>
        <label>适用范围<select aria-label="适用范围" value={scope}
          onChange={(event) => { setScope(event.target.value as GovernanceMemory['scope']) }}>
          <option value="organization">全企业 Agent</option><option value="department">指定部门 Agent</option>
        </select><small>决定哪些对话会收到这条知识。</small></label>
        <label>适用部门<select aria-label="适用部门" value={departmentId} disabled={scope !== 'department'}
          onChange={(event) => { setDepartmentId(event.target.value) }}>
          {state.departments.length === 0 && <option value="">请先创建部门</option>}
          {state.departments.map(department => <option key={department.id} value={department.id}>{department.name}</option>)}
        </select></label>
        <label>业务知识类型<select aria-label="业务知识类型" value={kind}
          onChange={(event) => { setKind(event.target.value as GovernanceMemory['kind']) }}>
          <option value="business-fact">业务规则</option><option value="process">工作流程</option>
          <option value="terminology">公司术语</option><option value="decision">已确认决策</option>
        </select></label>
        <label className={css.memorySummaryField}>要让 Agent 记住的内容<textarea aria-label="要让 Agent 记住的内容"
          placeholder="例如：所有采购订单必须在入库前完成审批。" maxLength={1000}
          value={summary} onChange={(event) => { setSummary(event.target.value) }} />
        <small>{summary.length}/1000 · 只写可共享的公司业务信息。</small></label>
      </div>
      <div className={css.memoryPrivacy}><strong>隐私边界</strong><span>不要填写姓名、联系方式、个人偏好、客户原文、密码或密钥。系统只保存审核后的业务摘要，不保存原始对话。</span></div>
      {error !== null && <div className={css.formError} role="alert">{error}</div>}
      <div className={css.memorySubmit}><button type="submit" disabled={submitting || summary.trim() === ''
        || (scope === 'department' && departmentId === '')}>{submitting ? '正在提交…' : '提交审核'}</button></div>
    </form>
    <div className={css.memoryColumns}>
      <section className={css.memoryLane} aria-label="待管理员审核">
        <div className={css.subsectionHeader}>
          <div><strong>待管理员审核</strong><span>确认准确性、适用范围和隐私边界</span></div>
          <span>{proposed.length}</span>
        </div>
        {proposed.length === 0 && <p className={css.emptyState}>暂无待审核内容。新提交的业务知识会出现在这里。</p>}
        {proposed.map(memory => <article key={memory.id} className={css.memoryItem}>
          <div className={css.memoryMeta}><span>{scopeLabel(memory)}</span><span>{kindLabel(memory.kind)}</span></div>
          <strong className={css.memorySummary}>{memory.summary}</strong>
          <small>系统已生成内容指纹 · 原始对话未保存</small>
          <label className={css.memoryReviewReason}>审核说明<input aria-label={`${memory.summary} 审核说明`}
            placeholder="说明核验依据或驳回原因" value={reviewReasons[memory.id] ?? ''}
            onChange={(event) => { setReviewReasons(current => ({ ...current, [memory.id]: event.target.value })) }} /></label>
          <div className={css.memoryActions}>
            <button type="button" disabled={(reviewReasons[memory.id]?.trim() ?? '') === '' || busyMemoryId !== null}
              onClick={() => {
                const review = async (): Promise<void> => {
                  setBusyMemoryId(memory.id); setError(null)
                  try { await reviewMemory(memory.id, {
                    decision: 'approved', reason: reviewReasons[memory.id] ?? '', expectedRevision: memory.revision,
                  }) } catch { setError('审核操作失败，请刷新后重试。') }
                  finally { setBusyMemoryId(null) }
                }
                void review()
              }}>{busyMemoryId === memory.id ? '正在处理…' : '批准并启用'}</button>
            <button type="button" disabled={(reviewReasons[memory.id]?.trim() ?? '') === '' || busyMemoryId !== null}
              onClick={() => {
                const review = async (): Promise<void> => {
                  setBusyMemoryId(memory.id); setError(null)
                  try { await reviewMemory(memory.id, {
                    decision: 'rejected', reason: reviewReasons[memory.id] ?? '', expectedRevision: memory.revision,
                  }) } catch { setError('审核操作失败，请刷新后重试。') }
                  finally { setBusyMemoryId(null) }
                }
                void review()
              }}>驳回</button>
          </div>
        </article>)}
      </section>
      <section className={css.memoryLane} aria-label="Agent 已可使用">
        <div className={css.subsectionHeader}>
          <div><strong>Agent 已可使用</strong><span>以下知识会进入对应范围的 Agent 上下文</span></div>
          <span>{approved.length}</span>
        </div>
        {approved.length === 0 && <p className={css.emptyState}>还没有已启用记忆。审核通过后，Agent 才能使用。</p>}
        {approved.map(memory => <article key={memory.id} className={css.memoryItem}>
          <div className={css.memoryMeta}><span>{scopeLabel(memory)}</span><span>{kindLabel(memory.kind)}</span></div>
          <strong className={css.memorySummary}>{memory.summary}</strong>
          <small>{memory.reviewReason === undefined ? '已通过审核' : `审核说明：${memory.reviewReason}`}</small>
        </article>)}
      </section>
    </div>
  </section>
}

function PoliciesSection({ state, savePolicy }: Pick<
  EnterpriseGovernanceSurfaceProps, 'state' | 'savePolicy'
>) {
  const typeLabel = (type: string): string => ({
    employee: '数字员工', model: '模型', capability: '能力', channel: '渠道',
  })[type] ?? type
  const resources = useMemo(() => {
    const values = new Map<string, { key: string; type: string; id: string; name: string }>()
    for (const asset of state.assets) {
      const key = `${asset.type}:${asset.id}`
      values.set(key, { key, type: asset.type, id: asset.id, name: asset.name })
    }
    for (const policy of state.policies) {
      const key = `${policy.resourceType}:${policy.resourceId}`
      if (!values.has(key)) values.set(key, {
        key, type: policy.resourceType, id: policy.resourceId,
        name: `${typeLabel(policy.resourceType)} · ${policy.resourceId}`,
      })
    }
    return [...values.values()].toSorted((left, right) => left.name.localeCompare(right.name))
  }, [state.assets, state.policies])
  const [selectedKey, setSelectedKey] = useState(resources[0]?.key ?? '')
  const selectedResource = resources.find(resource => resource.key === selectedKey) ?? resources[0]
  const selectedPolicy = selectedResource === undefined ? undefined : state.policies.find(policy =>
    policy.resourceType === selectedResource.type && policy.resourceId === selectedResource.id)
  const [visibility, setVisibility] = useState<GovernancePolicy['visibility']>(selectedPolicy?.visibility ?? 'organization')
  const [allowedUserIds, setAllowedUserIds] = useState<string[]>([...(selectedPolicy?.allowedUserIds ?? [])])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (selectedResource === undefined) {
      setSelectedKey('')
      setVisibility('organization')
      setAllowedUserIds([])
      return
    }
    if (selectedKey !== selectedResource.key) setSelectedKey(selectedResource.key)
    setVisibility(selectedPolicy?.visibility ?? 'organization')
    setAllowedUserIds([...(selectedPolicy?.allowedUserIds ?? [])])
  }, [selectedKey, selectedPolicy, selectedResource])
  const selectResource = (key: string): void => {
    const resource = resources.find(item => item.key === key)
    const policy = resource === undefined ? undefined : state.policies.find(item =>
      item.resourceType === resource.type && item.resourceId === resource.id)
    setSelectedKey(key)
    setVisibility(policy?.visibility ?? 'organization')
    setAllowedUserIds([...(policy?.allowedUserIds ?? [])])
    setError(null)
  }
  const visibilitySummary = (policy: GovernancePolicy): string => {
    if (policy.visibility === 'organization') return '全企业可用'
    if (policy.visibility === 'private') return '仅负责人可用'
    return `指定 ${policy.allowedUserIds.length} 位成员`
  }
  return <section className={css.ledgerSection}>
    <header className={css.permissionHeader}>
      <div><h2>资源访问权限</h2><p>决定企业成员能否看到和使用数字员工、模型、能力与渠道。</p></div>
      <span>{state.policies.length} 条规则</span>
    </header>
    <div className={css.permissionGuide}>
      <strong>这里控制“谁可以使用资源”</strong>
      <span>不会修改模型参数、员工职责或渠道配置；管理员始终保留治理权限。</span>
    </div>
    {resources.length === 0
      ? <div className={css.permissionEmpty}>
        <IconFolderOpen16 size={20} />
        <strong>暂无可授权资源</strong>
        <span>请先在数字员工、模型或渠道管理中完成配置，资源会自动出现在这里。</span>
      </div>
      : <div className={css.permissionLayout}>
        <form className={css.permissionEditor} onSubmit={(event) => {
          event.preventDefault()
          if (selectedResource === undefined || (visibility === 'restricted' && allowedUserIds.length === 0)) return
          const submit = async (): Promise<void> => {
            setSaving(true); setError(null)
            try {
              const creatorUserId = selectedPolicy?.creatorUserId ?? state.auth?.principal?.userId
              await savePolicy({
                resourceType: selectedResource.type, resourceId: selectedResource.id,
                ...(visibility === 'private' && creatorUserId !== undefined ? { creatorUserId } : {}),
                visibility, allowedUserIds: visibility === 'restricted' ? [...allowedUserIds].sort() : [],
              })
            } catch { setError('保存访问权限失败，请重试') }
            finally { setSaving(false) }
          }
          void submit()
        }}>
          <label className={css.resourceSelect}>选择要授权的资源<select aria-label="选择资源" value={selectedResource?.key ?? ''}
            onChange={(event) => { selectResource(event.target.value) }}>
            {resources.map(resource => <option key={resource.key} value={resource.key}>
              {resource.name} · {typeLabel(resource.type)}
            </option>)}
          </select><small>资源编号：{selectedResource?.id}</small></label>
          <fieldset className={css.visibilityChoices}><legend>谁可以使用</legend>
            <label><input type="radio" name="visibility" value="organization" checked={visibility === 'organization'}
              onChange={() => { setVisibility('organization') }} /><span><strong>全企业</strong><small>所有已登录企业成员都可以看到和使用</small></span></label>
            <label><input type="radio" name="visibility" value="private" checked={visibility === 'private'}
              onChange={() => { setVisibility('private') }} /><span><strong>仅负责人</strong><small>资源负责人和管理员可以使用</small></span></label>
            <label><input aria-label="指定成员" type="radio" name="visibility" value="restricted"
              checked={visibility === 'restricted'} onChange={() => { setVisibility('restricted') }} />
            <span><strong>指定成员</strong><small>只允许勾选的成员使用</small></span></label>
          </fieldset>
          {visibility === 'restricted' && <fieldset className={css.allowedUsers}><legend>选择成员</legend>
            {state.users.length === 0
              ? <span>暂无可选择成员</span>
              : state.users.map(user => <label key={user.id}>
                <input type="checkbox" aria-label={`${user.displayName} @${user.username}`} disabled={user.disabled}
                  checked={allowedUserIds.includes(user.id)} onChange={(event) => {
                    setAllowedUserIds(current => event.target.checked
                      ? [...current, user.id]
                      : current.filter(id => id !== user.id))
                  }} />
                <span>{user.displayName}<small>@{user.username}{user.disabled ? ' · 已停用' : ''}</small></span>
              </label>)}
          </fieldset>}
          {visibility === 'restricted' && allowedUserIds.length === 0
            && <p className={css.permissionHint}>至少选择一位成员后才能保存。</p>}
          {error !== null && <div className={css.formError} role="alert">{error}</div>}
          <div className={css.permissionActions}><button type="submit"
            disabled={saving || (visibility === 'restricted' && allowedUserIds.length === 0)}>
            {saving ? '正在保存…' : '保存访问权限'}
          </button></div>
        </form>
        <div className={css.permissionRules}>
          <div className={css.subsectionHeader}><strong>当前规则</strong><span>{state.policies.length}</span></div>
          {state.policies.length === 0
            ? <p className={css.emptyState}>尚未设置规则，资源默认按平台策略处理。</p>
            : state.policies.map((policy) => {
              const resource = resources.find(item => item.type === policy.resourceType && item.id === policy.resourceId)
              return <button key={`${policy.resourceType}:${policy.resourceId}`} type="button"
                aria-label={`编辑权限：${resource?.name ?? policy.resourceId}`}
                onClick={() => { selectResource(`${policy.resourceType}:${policy.resourceId}`) }}>
                <span><strong>{resource?.name ?? policy.resourceId}</strong><small>{typeLabel(policy.resourceType)}</small></span>
                <em>{visibilitySummary(policy)}</em>
              </button>
            })}
        </div>
      </div>}
  </section>
}

function AuditSection({ state, filterAudit }: Pick<EnterpriseGovernanceSurfaceProps, 'state' | 'filterAudit'>) {
  const [actorUserId, setActorUserId] = useState('')
  const [action, setAction] = useState('')
  return <section className={css.ledgerSection}>
    <header><h2>审计日志</h2><span>{state.audit.length}</span></header>
    <form className={css.auditFilter} onSubmit={(event) => { event.preventDefault(); void filterAudit({ actorUserId, action }) }}>
      <input aria-label="审计执行者" placeholder="actor user id" value={actorUserId} onChange={(event) => { setActorUserId(event.target.value) }} />
      <input aria-label="审计动作" placeholder="action" value={action} onChange={(event) => { setAction(event.target.value) }} />
      <button type="submit">查询审计</button>
    </form>
    <div className={css.tableWrap}><table><thead><tr><th>操作</th><th>执行者</th><th>决策</th><th>时间</th></tr></thead><tbody>
      {state.audit.map(event => <tr key={event.id}>
        <td><strong>{event.action}</strong><span>{event.resourceType} · {event.resourceId}</span></td>
        <td>{event.actorUserId}</td><td>{event.decision}</td>
        <td>{new Date(event.at).toLocaleString()}</td>
      </tr>)}</tbody></table></div>
  </section>
}

type GovernancePage = 'organizations' | 'users' | 'workspaces' | 'memory' | 'policies' | 'audit'

const GOVERNANCE_TABS: readonly { id: GovernancePage; label: string }[] = [
  { id: 'organizations', label: '组织架构' },
  { id: 'users', label: '用户管理' },
  { id: 'workspaces', label: '工作区' },
  { id: 'memory', label: '企业记忆' },
  { id: 'policies', label: '资源权限' },
  { id: 'audit', label: '审计日志' },
]

function GovernanceSections(props: EnterpriseGovernanceSurfaceProps) {
  const [active, setActive] = useState<GovernancePage>('organizations')
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const selectByKeyboard = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    let next: number | undefined
    if (event.key === 'ArrowRight') next = (index + 1) % GOVERNANCE_TABS.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + GOVERNANCE_TABS.length) % GOVERNANCE_TABS.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = GOVERNANCE_TABS.length - 1
    if (next === undefined) return
    event.preventDefault()
    const tab = GOVERNANCE_TABS[next]
    if (tab === undefined) return
    setActive(tab.id)
    tabRefs.current[next]?.focus()
  }
  const panel = (page: GovernancePage, content: ReactNode) => <div
    id={`governance-panel-${page}`}
    className={css.pagePanel}
    role="tabpanel"
    aria-labelledby={`governance-tab-${page}`}
    hidden={active !== page}
  >{content}</div>

  return <>
    <div className={css.tabBar} role="tablist" aria-label="企业管理分区" data-appearance="tonal">
      {GOVERNANCE_TABS.map((tab, index) => <button
        key={tab.id}
        ref={(element) => { tabRefs.current[index] = element }}
        id={`governance-tab-${tab.id}`}
        className={css.tab}
        type="button"
        role="tab"
        aria-selected={active === tab.id}
        aria-controls={`governance-panel-${tab.id}`}
        tabIndex={active === tab.id ? 0 : -1}
        onClick={() => { setActive(tab.id) }}
        onKeyDown={(event) => { selectByKeyboard(event, index) }}
      >{tab.label}</button>)}
    </div>
    {props.state.error !== null && <div className={css.error} role="alert">{props.state.error}</div>}
    {panel('organizations', <OrganizationsSection state={props.state}
      saveDepartment={input => props.saveDepartment(input)} />)}
    {panel('users', <UsersSection {...props} />)}
    {panel('workspaces', <WorkspacesSection state={props.state}
      createWorkspace={input => props.createWorkspace(input)}
      updateWorkspace={(id, input) => props.updateWorkspace(id, input)} />)}
    {panel('memory', <MemorySection state={props.state} proposeMemory={input => props.proposeMemory(input)}
      reviewMemory={(id, input) => props.reviewMemory(id, input)} />)}
    {panel('policies', <PoliciesSection state={props.state} savePolicy={input => props.savePolicy(input)} />)}
    {panel('audit', <AuditSection state={props.state} filterAudit={input => props.filterAudit(input)} />)}
  </>
}

/** Enterprise administration rendered as a first-class Settings section. */
export function EnterpriseGovernanceSettingsSection(props: EnterpriseGovernanceSettingsSectionProps) {
  useEffect(() => { void props.loadAdmin() }, [props.loadAdmin])
  if (props.state.auth?.authenticated !== true
    || !props.state.auth.principal?.roles.includes('administrator')) return null
  return (
    <main className={css.settingsLedger} aria-label="企业治理">
      <header className={css.ledgerHeader}>
        <div><h1>企业治理</h1><p>身份、权限、资产范围与操作证据。</p></div>
        <button type="button" onClick={() => { void props.logout() }}>退出登录</button>
      </header>
      <GovernanceSections {...props} />
    </main>
  )
}

export function EnterpriseGovernanceSurface(props: EnterpriseGovernanceSurfaceProps) {
  if (props.state.auth?.authenticated !== true) {
    return <LoginGate state={props.state} loginLocal={input => props.loginLocal(input)} />
  }
  return null
}
