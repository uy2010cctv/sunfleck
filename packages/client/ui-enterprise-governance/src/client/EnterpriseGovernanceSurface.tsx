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
    sourceDigest: string
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
  const [sourceDigest, setSourceDigest] = useState('')
  const [reviewReason, setReviewReason] = useState('')
  const proposed = state.memories.filter(memory => memory.status === 'proposed')
  const approved = state.memories.filter(memory => memory.status === 'approved')
  useEffect(() => {
    if (departmentId === '' && state.departments[0] !== undefined) setDepartmentId(state.departments[0].id)
  }, [departmentId, state.departments])
  return <section className={css.ledgerSection}>
    <header><h2>组织记忆与 Agent 感知</h2><span>{approved.length}</span></header>
    <p>只沉淀经过脱敏和审核的业务事实、流程、术语与决策；不保存个人偏好或原始对话正文。</p>
    <form className={css.memoryForm} onSubmit={(event) => {
      event.preventDefault()
      void proposeMemory({
        id: randomUUID(), scope, ...(scope === 'department' ? { departmentId } : {}),
        kind, summary, sourceDigest,
      })
      setSummary(''); setSourceDigest('')
    }}>
      <select aria-label="记忆范围" value={scope} onChange={(event) => { setScope(event.target.value as GovernanceMemory['scope']) }}>
        <option value="department">部门记忆</option><option value="organization">企业记忆</option>
      </select>
      <select aria-label="记忆部门" value={departmentId} disabled={scope !== 'department'}
        onChange={(event) => { setDepartmentId(event.target.value) }}>
        {state.departments.map(department => <option key={department.id} value={department.id}>{department.name}</option>)}
      </select>
      <select aria-label="记忆类型" value={kind} onChange={(event) => { setKind(event.target.value as GovernanceMemory['kind']) }}>
        <option value="business-fact">业务事实</option><option value="process">流程</option>
        <option value="terminology">术语</option><option value="decision">决策</option>
      </select>
      <textarea aria-label="业务记忆摘要" placeholder="只写可共享的业务信息，不写姓名、联系方式、偏好或凭据。"
        value={summary} onChange={(event) => { setSummary(event.target.value) }} />
      <input aria-label="来源证据摘要" placeholder="SHA-256" value={sourceDigest}
        onChange={(event) => { setSourceDigest(event.target.value) }} />
      <button type="submit">提交审核</button>
    </form>
    <div className={css.memoryColumns}>
      <div>
        <div className={css.subsectionHeader}><strong>待审核</strong><span>{proposed.length}</span></div>
        <label className={css.reviewReason}>审核原因<input aria-label="记忆审核原因" value={reviewReason}
          onChange={(event) => { setReviewReason(event.target.value) }} /></label>
        {proposed.map(memory => <article key={memory.id} className={css.memoryItem}>
          <div><span>{memory.scope === 'organization' ? '企业' : '部门'} · {memory.kind}</span><strong>{memory.summary}</strong></div>
          <small>证据 {memory.sourceDigest.slice(0, 12)}… · 未保存原文</small>
          <div className={css.memoryActions}>
            <button type="button" disabled={reviewReason.trim() === ''} onClick={() => {
              void reviewMemory(memory.id, { decision: 'approved', reason: reviewReason, expectedRevision: memory.revision })
            }}>批准记忆</button>
            <button type="button" disabled={reviewReason.trim() === ''} onClick={() => {
              void reviewMemory(memory.id, { decision: 'rejected', reason: reviewReason, expectedRevision: memory.revision })
            }}>驳回记忆</button>
          </div>
        </article>)}
      </div>
      <div>
        <div className={css.subsectionHeader}><strong>企业感知流</strong><span>{approved.length}</span></div>
        {approved.length === 0 && <p className={css.emptyState}>审核通过的企业和部门业务记忆会出现在这里。</p>}
        {approved.map(memory => <article key={memory.id} className={css.memoryItem}>
          <div><span>{memory.scope === 'organization' ? '全企业' : '部门'} · {memory.kind}</span><strong>{memory.summary}</strong></div>
          <small>[{memory.id}]</small>
        </article>)}
      </div>
    </div>
  </section>
}

function PoliciesSection({ state, savePolicy, createAsset }: Pick<
  EnterpriseGovernanceSurfaceProps, 'state' | 'savePolicy' | 'createAsset'
>) {
  const [resourceType, setResourceType] = useState('employee')
  const [resourceId, setResourceId] = useState('')
  const [name, setName] = useState('')
  const [visibility, setVisibility] = useState<GovernancePolicy['visibility']>('organization')
  return (
    <section className={css.ledgerSection}>
      <header><h2>资产权限</h2><span>{state.policies.length}</span></header>
      <p>统一管理数字员工、模型、能力资产与渠道的可见范围。</p>
      <form className={css.inlineForm} onSubmit={(event) => {
        event.preventDefault()
        if (resourceType === 'channel' || resourceType === 'model' || resourceType === 'capability') {
          void createAsset({ type: resourceType, id: resourceId, name, config: {} })
        }
        void savePolicy({ resourceType, resourceId, visibility, allowedUserIds: [] })
      }}>
        <select aria-label="资产类型" value={resourceType} onChange={(event) => { setResourceType(event.target.value) }}>
          <option value="employee">数字员工</option><option value="model">模型</option>
          <option value="capability">能力资产</option><option value="channel">渠道</option>
        </select>
        <input aria-label="资产 ID" placeholder="resource-id" value={resourceId} onChange={(event) => { setResourceId(event.target.value) }} />
        <input aria-label="资产名称" placeholder="asset name" value={name} onChange={(event) => { setName(event.target.value) }} />
        <select aria-label="可见范围" value={visibility} onChange={(event) => { setVisibility(event.target.value as GovernancePolicy['visibility']) }}>
          <option value="organization">全组织</option><option value="private">仅创建者</option><option value="restricted">指定用户</option>
        </select>
        <button type="submit">保存策略</button>
      </form>
      <div className={css.policyList}>{state.assets.map(asset => (
        <div key={`${asset.type}:${asset.id}`}><strong>{asset.name}</strong><span>{asset.type} · {asset.id}</span></div>
      ))}</div>
      <div className={css.policyList}>{state.policies.map(policy => (
        <div key={`${policy.resourceType}:${policy.resourceId}`}>
          <strong>{policy.resourceId}</strong><span>{policy.resourceType} · {policy.visibility}</span>
        </div>
      ))}</div>
    </section>
  )
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
  { id: 'policies', label: '资产权限' },
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
    <div className={css.tabBar} role="tablist" aria-label="企业管理分区">
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
    {panel('policies', <PoliciesSection {...props} />)}
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
