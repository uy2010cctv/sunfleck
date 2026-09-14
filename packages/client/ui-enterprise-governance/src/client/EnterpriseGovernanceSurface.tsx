/** Login gate and administrator governance ledger. */
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { FishLogo, IconChevronDownOutline14, IconChevronRightOutline14, IconEditOutline16, IconFolderClose16, IconFolderOpen16, IconPlusOutline16, IconUserOutline16, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { EnterpriseGovernanceState, GovernanceDepartment, GovernanceMemory, GovernancePolicy, GovernanceUser, GovernanceWorkspace } from './controller.ts'
import css from './governance.module.css'
import { defaultGovernanceTranslate, type GovernanceTranslate } from './locales.ts'
export interface EnterpriseGovernanceSurfaceProps {
  t?: GovernanceTranslate
  state: EnterpriseGovernanceState
  loginLocal(input: {
    organizationId: string
    username: string
    password: string
  }): Promise<void>
  logout(): Promise<void> | void
  createOrganization(input: {
    id: string
    name: string
  }): Promise<void>
  createUser(input: {
    id: string
    username: string
    displayName: string
    password: string
    roles: readonly string[]
  }): Promise<void>
  createAsset(input: {
    type: 'channel' | 'model' | 'capability'
    id: string
    name: string
    config: Record<string, unknown>
  }): Promise<void>
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
  setDepartmentManagers?(departmentId: string, managerUserIds: readonly string[], expectedRevision: number): Promise<void>
  createWorkspace(input: {
    name: string
    idempotencyKey: string
  }): Promise<void>
  updateWorkspace(workspaceId: string, input: {
    name?: string
    sandboxMode?: 'read-only' | 'workspace-write'
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
  retryMemoryWriteback?(sourceKey: string): Promise<void>
  savePolicy(input: GovernancePolicy): Promise<void>
  filterAudit(input: {
    actorUserId?: string
    action?: string
  }): Promise<void>
}
export interface EnterpriseGovernanceSettingsSectionProps extends EnterpriseGovernanceSurfaceProps {
  loadAdmin: () => Promise<void>
}
function DepartmentBranch({ departments, users, parentId, selectedId, expanded, select, toggle, t, depth = 0 }: {
  departments: readonly GovernanceDepartment[]
  users: readonly GovernanceUser[]
  parentId: string | null
  selectedId: string | undefined
  expanded: ReadonlySet<string>
  select: (department: GovernanceDepartment) => void
  toggle: (departmentId: string) => void
  t: GovernanceTranslate
  depth?: number
}) {
  const children = departments.filter(item => item.parentId === parentId)
    .toSorted((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name))
  if (children.length === 0)
    return null
  return <ul role="group">
    {children.map((department) => {
      const departmentUsers = users.filter(user => user.departmentIds?.includes(department.id) === true)
      const childCount = departments.filter(item => item.parentId === department.id).length
      const hasChildren = childCount > 0 || departmentUsers.length > 0
      const open = expanded.has(department.id)
      return <li key={department.id} role="treeitem" aria-level={depth + 2} aria-expanded={hasChildren ? open : undefined}>
        <div className={`${css.treeRow} ${selectedId === department.id ? css.treeRowSelected : ''}`}>
          {hasChildren
            ? <button className={css.treeToggle} type="button" aria-label={`${open ? '收起' : '展开'}${department.name}`} onClick={() => { toggle(department.id) }}>
              {open ? <IconChevronDownOutline14 size={12}/> : <IconChevronRightOutline14 size={12}/>}
            </button>
            : <span className={css.treeToggleSpacer}/>}
          <button className={css.departmentButton} type="button" aria-label={department.name} aria-pressed={selectedId === department.id} onClick={() => { select(department) }}>
            <span className={css.folderIcon} aria-hidden="true">
              {open ? <IconFolderOpen16 size={18}/> : <IconFolderClose16 size={18}/>}
            </span>
            <span className={css.treeLabel}>{department.name}</span>
            <small>{departmentUsers.length + childCount}</small>
          </button>
        </div>
        {open && hasChildren && <>
          {departmentUsers.length > 0 && <ul role="group">
            {departmentUsers.map(user => <li key={user.id} role="treeitem" aria-level={depth + 3} className={css.memberRow}>
              <span className={css.memberAvatar} aria-hidden="true"><IconUserOutline16 size={14}/></span>
              <span className={css.memberIdentity}>
                <strong>{user.displayName}</strong>
                <small>@{user.username} · {user.roles.join(' / ')}{user.disabled ? t('common.disabledSuffix') : ''}</small>
              </span>
            </li>)}
          </ul>}
          <DepartmentBranch
            departments={departments} users={users} parentId={department.id} selectedId={selectedId}
            expanded={expanded} select={select} toggle={toggle} t={t} depth={depth + 1}
          />
        </>}
      </li>
    })}
  </ul>
}
function OrganizationsSection({ state, saveDepartment, setDepartmentManagers, t }: Pick<EnterpriseGovernanceSurfaceProps, 'state' | 'saveDepartment' | 'setDepartmentManagers'> & {
  t: GovernanceTranslate
}) {
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
  const [managerIds, setManagerIds] = useState<string[]>([])
  const [managerSaving, setManagerSaving] = useState(false)
  const [managerError, setManagerError] = useState<string | null>(null)
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
      if (next.has(departmentIdToToggle))
        next.delete(departmentIdToToggle)
      else
        next.add(departmentIdToToggle)
      return next
    })
  }
  const selectedWorkspaces = selectedId === undefined
    ? []
    : state.workspaces.filter(workspace => workspace.departmentId === selectedId)
  const selectedUsers = selectedId === undefined
    ? []
    : state.users.filter(user => user.departmentIds?.includes(selectedId) === true)
  const managerSet = selectedId === undefined ? undefined : state.departmentManagers[selectedId]
  useEffect(() => {
    setExpanded(current => new Set([...current, ...departments.map(item => item.id)]))
    if (isCreating || selectedId !== undefined || departments[0] === undefined)
      return
    const department = departments[0]
    setSelectedId(department.id)
    setDepartmentId(department.id)
    setDepartmentName(department.name)
    setParentId(department.parentId ?? '')
    setSortOrder(String(department.sortOrder))
  }, [departments, isCreating, selectedId])
  useEffect(() => {
    setManagerIds([...(managerSet?.managerUserIds ?? [])])
    setManagerError(null)
  }, [managerSet?.revision, selectedId])
  return <section className={css.ledgerSection}>
    <header className={css.directoryHeader}>
      <div><h2>{t('\u7EC4\u7EC7\u67B6\u6784')}</h2><p>{t('\u6309\u90E8\u95E8\u67E5\u770B\u6210\u5458\uFF0C\u5E76\u7EF4\u62A4\u4E0A\u4E0B\u7EA7\u5173\u7CFB\u3002')}</p></div>
      <div className={css.directoryActions}>
        <span>{departments.length}{t('\u4E2A\u90E8\u95E8 \u00B7')}{state.users.length}{t('\u4F4D\u6210\u5458')}</span>
        <button type="button" onClick={() => { beginCreate(null) }}>{t('\u65B0\u589E\u6839\u90E8\u95E8')}</button>
      </div>
    </header>
    <div className={css.directoryLayout}>
      <div className={css.treePanel}>
        <ul className={css.organizationTree} role="tree" aria-label={t('\u7EC4\u7EC7\u67B6\u6784')}>
          <li role="treeitem" aria-level={1} aria-expanded="true">
            <div className={css.enterpriseRoot}>
              <span className={css.enterpriseMark} aria-hidden="true"><FishLogo size={28} /></span>
              <span><strong>{organizationName}</strong><small>{t('\u4F01\u4E1A\u6839\u8282\u70B9')}</small></span>
            </div>
            {departments.length === 0
              ? <p className={css.emptyState}>{t('\u8FD8\u6CA1\u6709\u90E8\u95E8\u3002\u70B9\u51FB\u201C\u65B0\u589E\u6839\u90E8\u95E8\u201D\uFF0C\u8F93\u5165\u540D\u79F0\u5373\u53EF\u521B\u5EFA\u3002')}</p>
              : <DepartmentBranch
                departments={departments} users={state.users} parentId={null} selectedId={selectedId}
                expanded={expanded} select={select} toggle={toggle} t={t}
              />}
          </li>
        </ul>
      </div>
      <div className={css.departmentDetail}>
        <div className={css.subsectionHeader}>
          <div><strong>{isCreating ? t('\u65B0\u5EFA\u90E8\u95E8') : selected?.name ?? t('\u9009\u62E9\u4E00\u4E2A\u90E8\u95E8')}</strong>
            <span>{isCreating ? t('\u521B\u5EFA\u540E\u4F1A\u51FA\u73B0\u5728\u5DE6\u4FA7\u7EC4\u7EC7\u6811\u4E2D') : selected !== undefined ? t('department.internalId', { id: selected.id }) : t('\u4ECE\u5DE6\u4FA7\u9009\u62E9\u90E8\u95E8\u4EE5\u67E5\u770B\u8BE6\u60C5')}</span></div>
          {selected !== undefined && <span>{t('\u4FEE\u8BA2')}{selected.revision}</span>}
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
            }
            catch {
              setSubmitError(`${isCreating ? '创建' : '保存'}部门失败，请重试`)
            }
            finally {
              setSaving(false)
            }
          }
          void submit()
        }}>
          <label>{t('\u90E8\u95E8\u540D\u79F0')}<input value={departmentName} onChange={(event) => { setDepartmentName(event.target.value) }}/></label>
          <label>{t('\u4E0A\u7EA7\u90E8\u95E8')}<select value={parentId} onChange={(event) => { setParentId(event.target.value) }}>
            <option value="">{t('\u4F01\u4E1A\u6839\u8282\u70B9')}</option>
            {departments.filter(item => item.id !== departmentId).map(item => (<option key={item.id} value={item.id}>{item.name}</option>))}
          </select></label>
          <label>{t('\u540C\u7EA7\u6392\u5E8F')}<input inputMode="numeric" value={sortOrder} onChange={(event) => { setSortOrder(event.target.value) }}/></label>
          {submitError !== null && <div className={css.formError} role="alert">{submitError}</div>}
          <div className={css.formActions}>
            {selected !== undefined && <button type="button" onClick={() => { beginCreate(selected.id) }}>{t('\u65B0\u589E\u4E0B\u7EA7\u90E8\u95E8')}</button>}
            <button type="submit" disabled={saving || departmentId === ''}>
              {saving ? t('\u6B63\u5728\u4FDD\u5B58\u2026') : isCreating ? t('\u521B\u5EFA\u90E8\u95E8') : t('\u4FDD\u5B58\u90E8\u95E8')}
            </button>
          </div>
        </form>
        {selected !== undefined && <fieldset className={css.managerEditor} aria-label={t('\u90E8\u95E8\u8D1F\u8D23\u4EBA')} disabled={managerSaving}>
          <legend>{t('\u90E8\u95E8\u8D1F\u8D23\u4EBA')}</legend>
          <p>{t('\u8D1F\u8D23\u4EBA\u53EF\u5BA1\u6838\u90E8\u95E8 Cordis \u6269\u5C55\uFF0C\u5E76\u53D1\u5E03\u672C\u90E8\u95E8\u901A\u8FC7\u9A8C\u8BC1\u7684\u7EC4\u7EC7\u63D2\u4EF6\u3002')}</p>
          <div className={css.managerChoices}>
            {selectedUsers.length === 0
              ? <span className={css.emptyState}>{t('\u8BF7\u5148\u4E3A\u8BE5\u90E8\u95E8\u5206\u914D\u6210\u5458\u3002')}</span>
              : selectedUsers.map(user => <label key={user.id}>
                <input type="checkbox" aria-label={user.displayName} checked={managerIds.includes(user.id)} disabled={user.disabled} onChange={(event) => {
                  setManagerIds(current => event.target.checked
                    ? [...current, user.id] : current.filter(id => id !== user.id))
                }}/>
                <span><strong>{user.displayName}</strong><small>@{user.username}{user.disabled ? t('common.disabledSuffix') : ''}</small></span>
              </label>)}
          </div>
          {managerError !== null && <div className={css.formError} role="alert">{managerError}</div>}
          <div className={css.managerActions}><button type="button" disabled={managerSaving} onClick={() => {
            const save = async (): Promise<void> => {
              setManagerSaving(true)
              setManagerError(null)
              try {
                if (setDepartmentManagers === undefined)
                  throw new Error('department manager service is unavailable')
                await setDepartmentManagers(selected.id, managerIds, managerSet?.revision ?? 0)
              }
              catch {
                setManagerError('保存部门负责人失败，请刷新后重试')
              }
              finally {
                setManagerSaving(false)
              }
            }
            void save()
          }}>{managerSaving ? t('\u6B63\u5728\u4FDD\u5B58\u2026') : t('\u4FDD\u5B58\u90E8\u95E8\u8D1F\u8D23\u4EBA')}</button></div>
        </fieldset>}
        {selected !== undefined && <div className={css.departmentEvidence}>
          <div><span>{t('\u6210\u5458')}</span><strong>{selectedUsers.length}</strong></div>
          <div><span>{t('\u5171\u4EAB\u5DE5\u4F5C\u533A')}</span><strong>{selectedWorkspaces.length}</strong></div>
        </div>}
        {selectedWorkspaces.map(workspace => <div key={workspace.workspaceId} className={css.workspaceLine}>
          <strong>{workspace.name}</strong><span>{workspace.sandboxMode === 'read-only' ? t('\u53EA\u8BFB\u6C99\u76D2') : t('\u5DE5\u4F5C\u533A\u53EF\u5199')}</span>
        </div>)}
      </div>
    </div>
  </section>
}
function LoginGate({ state, loginLocal, t }: Pick<EnterpriseGovernanceSurfaceProps, 'state' | 'loginLocal'> & {
  t: GovernanceTranslate
}) {
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
  return (<section className={css.loginGate} aria-label={t('\u4F01\u4E1A\u767B\u5F55')}>
    <div className={css.loginPanel}>
      <div className={css.loginIdentity}><span aria-hidden="true"><FishLogo size={28} /></span><strong>{t('brand.name')}</strong></div>
      <h1>{t('\u767B\u5F55\u4F01\u4E1A\u5DE5\u4F5C\u53F0')}</h1>
      <p>{t('\u8EAB\u4EFD\u5C06\u7528\u4E8E\u5458\u5DE5\u53EF\u89C1\u8303\u56F4\u3001Host API \u6388\u6743\u4E0E\u64CD\u4F5C\u5BA1\u8BA1\u3002')}</p>
      <form onSubmit={submit}>
        <label>{t('\u7EC4\u7EC7')}<input value={organizationId} onChange={(event) => { setOrganizationId(event.target.value) }}/></label>
        <label>{t('\u7528\u6237\u540D')}<input autoComplete="username" value={username} onChange={(event) => { setUsername(event.target.value) }}/></label>
        <label>{t('\u5BC6\u7801')}<input type="password" autoComplete="current-password" value={password} onChange={(event) => { setPassword(event.target.value) }}/></label>
        <div className={css.errorSlot}>
          {state.error !== null && <div className={css.error} role="alert">{state.error}</div>}
        </div>
        <button type="submit" disabled={state.phase === 'loading'}>{state.phase === 'loading' ? t('\u6B63\u5728\u9A8C\u8BC1\u2026') : t('\u767B\u5F55')}</button>
      </form>
      {state.auth?.providers.filter(provider => provider.kind !== 'local').map(provider => (<a key={provider.id} className={css.ssoButton} href={`/auth/login/${encodeURIComponent(provider.id)}`}>
        {provider.label}
      </a>))}
    </div>
  </section>)
}
const USER_ROLES = [
  ['administrator', 'role.administrator'], ['creator', 'role.creator'], ['operator', 'role.operator'],
  ['auditor', 'role.auditor'], ['member', 'role.member'],
] as const
function roleLabel(role: string, t: GovernanceTranslate): string {
  const key = USER_ROLES.find(item => item[0] === role)?.[1]
  return key === undefined ? role : t(key)
}
function UserDialog({ mode, user, departments, createUser, updateUser, close, t }: {
  mode: 'create' | 'edit'
  user?: GovernanceUser
  departments: readonly GovernanceDepartment[]
  createUser: EnterpriseGovernanceSurfaceProps['createUser']
  updateUser: EnterpriseGovernanceSurfaceProps['updateUser']
  close: () => void
  t: GovernanceTranslate
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
  const title = mode === 'create' ? t('\u65B0\u589E\u7528\u6237') : t('\u7F16\u8F91\u7528\u6237')
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
    if ((mode === 'create' || password !== '') && (password.length < 12 || password.length > 128)) {
      setError('密码需为 12–128 个字符')
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
      }
      else if (user !== undefined) {
        await updateUser(user.id, {
          username: normalizedUsername, displayName: normalizedDisplayName,
          ...(password === '' ? {} : { password }), roles: [role], disabled, departmentIds,
          ...(primaryDepartmentId === '' ? {} : { primaryDepartmentId }),
          expectedRevision: user.departmentRevision ?? 0,
        })
      }
      setPassword('')
      close()
    }
    catch {
      setError(`${mode === 'create' ? '创建' : '保存'}失败，请检查用户名是否重复后重试`)
    }
    finally {
      setSaving(false)
    }
  }
  return <Modal open onClose={() => { if (!saving)
    close() }} title={title} closeLabel={t('\u5173\u95ED')} {...(css.userDialog === undefined ? {} : { className: css.userDialog })} description={mode === 'create'
    ? t('\u521B\u5EFA\u540E\u4F1A\u81EA\u52A8\u5206\u914D\u72EC\u7ACB\u4E2A\u4EBA\u5DE5\u4F5C\u533A\u3002') : t('\u4FEE\u6539\u767B\u5F55\u8EAB\u4EFD\u3001\u89D2\u8272\u3001\u90E8\u95E8\u548C\u8D26\u53F7\u72B6\u6001\u3002\u65B0\u5BC6\u7801\u7559\u7A7A\u65F6\u4FDD\u6301\u539F\u5BC6\u7801\u3002')} footer={<>
    <button className={css.secondaryAction} type="button" disabled={saving} onClick={close}>{t('\u53D6\u6D88')}</button>
    <button className={css.primaryAction} type="submit" form={formId} disabled={saving}>
      {saving ? t('\u6B63\u5728\u4FDD\u5B58\u2026') : mode === 'create' ? t('\u521B\u5EFA\u7528\u6237') : t('\u4FDD\u5B58\u4FEE\u6539')}
    </button>
  </>}>
    <form id={formId} className={css.userForm} onSubmit={(event) => { void submit(event) }}>
      <label>{t('\u7528\u6237\u540D')}<input autoFocus aria-label={t('\u7528\u6237\u540D')} autoComplete="off" maxLength={64} value={username} onChange={(event) => { setUsername(event.target.value) }}/></label>
      <label>{t('\u663E\u793A\u540D\u79F0')}<input aria-label={t('\u663E\u793A\u540D\u79F0')} maxLength={100} value={displayName} onChange={(event) => { setDisplayName(event.target.value) }}/></label>
      <label>{mode === 'create' ? t('\u521D\u59CB\u5BC6\u7801') : t('\u65B0\u5BC6\u7801\uFF08\u7559\u7A7A\u5219\u4E0D\u4FEE\u6539\uFF09')}<input type="password" aria-label={mode === 'create' ? t('\u521D\u59CB\u5BC6\u7801') : t('\u65B0\u5BC6\u7801\uFF08\u7559\u7A7A\u5219\u4E0D\u4FEE\u6539\uFF09')} autoComplete="new-password" minLength={12} maxLength={128} value={password} onChange={(event) => { setPassword(event.target.value) }}/></label>
      <label>{t('\u89D2\u8272')}<select aria-label={t('\u89D2\u8272')} value={role} onChange={(event) => { setRole(event.target.value) }}>
        {USER_ROLES.map(item => <option key={item[0]} value={item[0]}>{t(item[1])} · {item[0]}</option>)}
      </select></label>
      {mode === 'edit' && <>
        <fieldset className={css.departmentChoices}><legend>{t('\u6240\u5C5E\u90E8\u95E8')}</legend>
          {departments.length === 0
            ? <span>{t('\u6682\u65E0\u53EF\u5206\u914D\u90E8\u95E8')}</span>
            : departments.map(department => <label key={department.id}>
              <input type="checkbox" checked={departmentIds.includes(department.id)} onChange={(event) => {
                setDepartmentIds((current) => {
                  const next = event.target.checked
                    ? [...current, department.id]
                    : current.filter(id => id !== department.id)
                  if (!next.includes(primaryDepartmentId))
                    setPrimaryDepartmentId(next[0] ?? '')
                  return next
                })
              }}/>{department.name}
            </label>)}
        </fieldset>
        <label>{t('\u4E3B\u90E8\u95E8')}<select aria-label={t('\u4E3B\u90E8\u95E8')} value={primaryDepartmentId} disabled={departmentIds.length === 0} onChange={(event) => { setPrimaryDepartmentId(event.target.value) }}>
          <option value="">{t('\u672A\u8BBE\u7F6E\u4E3B\u90E8\u95E8')}</option>
          {departments.filter(department => departmentIds.includes(department.id))
            .map(department => <option key={department.id} value={department.id}>{department.name}</option>)}
        </select></label>
        <label>{t('\u8D26\u53F7\u72B6\u6001')}<select aria-label={t('\u8D26\u53F7\u72B6\u6001')} value={disabled ? 'disabled' : 'active'} onChange={(event) => { setDisabled(event.target.value === 'disabled') }}>
          <option value="active">{t('\u6B63\u5E38')}</option><option value="disabled">{t('\u5DF2\u505C\u7528')}</option>
        </select></label>
      </>}
      {error !== null && <div className={css.formError} role="alert">{error}</div>}
    </form>
  </Modal>
}
function UsersSection({ state, createUser, updateUser, t }: Pick<EnterpriseGovernanceSurfaceProps, 'state' | 'createUser' | 'updateUser'> & {
  t: GovernanceTranslate
}) {
  const [dialog, setDialog] = useState<{
    mode: 'create'
  } | {
    mode: 'edit'
    user: GovernanceUser
  } | null>(null)
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
      <div><h2>{t('\u7528\u6237\u7BA1\u7406')}</h2><p>{t('\u7BA1\u7406\u767B\u5F55\u8EAB\u4EFD\u3001\u89D2\u8272\u3001\u90E8\u95E8\u548C\u8D26\u53F7\u72B6\u6001\u3002')}</p></div>
      <span>{state.users.length}{t('\u4F4D\u7528\u6237')}</span>
    </header>
    <div className={css.userToolbar}>
      <input aria-label={t('\u641C\u7D22\u7528\u6237')} placeholder={t('\u641C\u7D22\u59D3\u540D\u6216\u7528\u6237\u540D')} value={query} onChange={(event) => { setQuery(event.target.value) }}/>
      <button type="button" onClick={() => { setDialog({ mode: 'create' }) }}>
        <IconPlusOutline16 size={14}/>{t('\u65B0\u589E\u7528\u6237')}</button>
    </div>
    {actionError !== null && <div className={css.error} role="alert">{actionError}</div>}
    {users.length === 0
      ? <p className={css.emptyState}>{state.users.length === 0 ? t('\u8FD8\u6CA1\u6709\u7528\u6237\u3002\u70B9\u51FB\u201C\u65B0\u589E\u7528\u6237\u201D\u521B\u5EFA\u9996\u4F4D\u6210\u5458\u3002') : t('\u6CA1\u6709\u5339\u914D\u7684\u7528\u6237\u3002')}</p>
      : <div className={`${css.tableWrap} ${css.userTable}`}>
        <table><thead><tr><th>{t('\u7528\u6237')}</th><th>{t('\u90E8\u95E8')}</th><th>{t('\u89D2\u8272')}</th><th>{t('\u72B6\u6001')}</th><th>{t('\u64CD\u4F5C')}</th></tr></thead><tbody>
          {users.map((user) => {
            const primary = user.primaryDepartmentId
            const secondary = (user.departmentIds ?? []).filter(id => id !== primary)
            return <tr key={user.id}>
              <td><div className={css.userIdentity}>
                <span className={css.userAvatar} aria-hidden="true"><IconUserOutline16 size={16}/></span>
                <span><strong>{user.displayName}</strong><small>@{user.username}</small></span>
              </div></td>
              <td><div className={css.departmentSummary}>
                {primary !== undefined && <strong>{t('department.primaryLabel', { name: departmentName(primary) })}</strong>}
                {secondary.length > 0 && <span>{secondary.map(departmentName).join('、')}</span>}
                {primary === undefined && secondary.length === 0 && <span>{t('\u672A\u5206\u914D\u90E8\u95E8')}</span>}
              </div></td>
              <td><span className={css.roleBadge}><strong>{roleLabel(user.roles[0] ?? 'member', t)}</strong>
                <small>{user.roles[0] ?? t('member')}</small></span></td>
              <td><span className={css.statusLabel} data-disabled={user.disabled ? 'true' : 'false'}>
                <i aria-hidden="true"/>{user.disabled ? t('\u5DF2\u505C\u7528') : t('\u6B63\u5E38')}
              </span></td>
              <td><div className={css.rowActions}>
                <button type="button" aria-label={t('user.editAria', { name: user.displayName })} onClick={() => { setDialog({ mode: 'edit', user }) }}><IconEditOutline16 size={14}/>{t('\u7F16\u8F91')}</button>
                <button type="button" disabled={busyUserId === user.id} onClick={() => {
                  const change = async (): Promise<void> => {
                    setBusyUserId(user.id)
                    setActionError(null)
                    try {
                      await updateUser(user.id, { disabled: !user.disabled })
                    }
                    catch {
                      setActionError(`${user.disabled ? '启用' : '停用'}用户失败，请重试`)
                    }
                    finally {
                      setBusyUserId(null)
                    }
                  }
                  void change()
                }}>{busyUserId === user.id ? t('\u5904\u7406\u4E2D\u2026') : user.disabled ? t('\u542F\u7528') : t('\u505C\u7528')}</button>
              </div></td>
            </tr>
          })}</tbody></table>
      </div>}
    {dialog !== null && <UserDialog key={dialog.mode === 'create' ? 'create' : dialog.user.id} mode={dialog.mode} {...(dialog.mode === 'edit' ? { user: dialog.user } : {})} departments={state.departments} createUser={createUser} updateUser={updateUser} t={t} close={() => { setDialog(null) }}/>}
  </section>
}
function WorkspaceRow({ workspace, updateWorkspace, t }: {
  workspace: GovernanceWorkspace
  updateWorkspace: EnterpriseGovernanceSurfaceProps['updateWorkspace']
  t: GovernanceTranslate
}) {
  const [name, setName] = useState(workspace.name)
  const [sandboxMode, setSandboxMode] = useState(workspace.sandboxMode)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setName(workspace.name)
    setSandboxMode(workspace.sandboxMode)
    setError(null)
  }, [workspace.name, workspace.revision, workspace.sandboxMode])
  const dirty = name.trim() !== workspace.name || sandboxMode !== workspace.sandboxMode
  return <form className={css.workspaceRow} onSubmit={(event) => {
    event.preventDefault()
    const save = async (): Promise<void> => {
      setSaving(true)
      setError(null)
      try {
        await updateWorkspace(workspace.workspaceId, {
          name: name.trim(), sandboxMode, expectedRevision: workspace.revision,
        })
      }
      catch {
        setError(t('workspace.error'))
      }
      finally {
        setSaving(false)
      }
    }
    void save()
  }}>
    <div className={css.workspaceIdentity}>
      <label>{t('workspace.nameAria', { name: workspace.name })}<input aria-label={t('workspace.nameAria', { name: workspace.name })} maxLength={100} value={name} onChange={(event) => { setName(event.target.value) }}/></label>
      <span>{workspace.kind === 'personal' ? t('\u4E2A\u4EBA') : t('\u90E8\u95E8\u5171\u4EAB')}</span>
    </div>
    <div className={css.workspaceControls}>
      <label>{t('\u6C99\u76D2\u7B56\u7565')}<select aria-label={t('workspace.sandboxAria', { name: workspace.name })} value={sandboxMode} onChange={(event) => {
        setSandboxMode(event.target.value as GovernanceWorkspace['sandboxMode'])
      }}>
        <option value="read-only">{t('\u53EA\u8BFB\u6C99\u76D2')}</option><option value="workspace-write">{t('\u5DE5\u4F5C\u533A\u53EF\u5199')}</option>
      </select></label>
      <button type="submit" aria-label={t('workspace.saveAria', { name: workspace.name })} disabled={saving || !dirty || name.trim() === ''}>
        {saving ? t('workspace.saving') : t('workspace.save')}
      </button>
    </div>
    <code>{workspace.rootPath}</code>
    {error !== null && <div className={css.formError} role="alert">{error}</div>}
  </form>
}

function WorkspacesSection({ state, createWorkspace, updateWorkspace, t }: Pick<EnterpriseGovernanceSurfaceProps, 'state' | 'createWorkspace' | 'updateWorkspace'> & {
  t: GovernanceTranslate
}) {
  const [name, setName] = useState('')
  return <section className={css.ledgerSection}>
    <header><h2>{t('\u5DE5\u4F5C\u533A\u4E0E\u6C99\u76D2')}</h2><span>{state.workspaces.length}</span></header>
    <p>{t('\u4E2A\u4EBA\u5DE5\u4F5C\u533A\u5F7C\u6B64\u9694\u79BB\uFF1B\u90E8\u95E8\u5171\u4EAB\u7A7A\u95F4\u53EA\u5411\u90E8\u95E8\u6210\u5458\u5F00\u653E\u3002Session cwd \u662F\u5B9E\u9645\u6C99\u76D2\u8FB9\u754C\uFF0C\u6C99\u76D2\u7B56\u7565\u53D8\u66F4\u5BF9\u65B0\u5EFA Session \u751F\u6548\u3002')}</p>
    <form className={css.workspaceCreate} onSubmit={(event) => {
      event.preventDefault()
      void createWorkspace({ name, idempotencyKey: randomUUID() })
      setName('')
    }}>
      <input aria-label={t('\u65B0\u5DE5\u4F5C\u533A\u540D\u79F0')} placeholder={t('\u4F8B\u5982\uFF1A\u4E09\u5B63\u5EA6\u91C7\u8D2D\u4E13\u9879')} value={name} onChange={(event) => { setName(event.target.value) }}/>
      <button type="submit" disabled={name.trim() === ''}>{t('\u65B0\u5EFA\u6211\u7684\u5DE5\u4F5C\u533A')}</button>
    </form>
    <div className={css.workspaceList}>{state.workspaces.map(workspace => <WorkspaceRow
      key={workspace.workspaceId} workspace={workspace} updateWorkspace={updateWorkspace} t={t}
    />)}</div>
  </section>
}
function MemorySection({ state, proposeMemory, reviewMemory, retryMemoryWriteback, t }: Pick<
  EnterpriseGovernanceSurfaceProps,
  'state' | 'proposeMemory' | 'reviewMemory' | 'retryMemoryWriteback'
> & {
  t: GovernanceTranslate
}) {
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
  const writebacks = state.memoryWritebacks
  const writebackActive = writebacks.filter(item => item.state === 'queued' || item.state === 'running').length
  const writebackFailed = writebacks.filter(item => item.state === 'failed')
  const lastWriteback = writebacks.find(item => item.state === 'completed')
  const kindLabel = (value: GovernanceMemory['kind']): string => ({
    'business-fact': '业务规则', process: '工作流程', terminology: '公司术语', decision: '已确认决策',
  })[value]
  const departmentName = (id: string | undefined): string => state.departments.find(department => department.id === id)?.name ?? '未找到部门'
  const scopeLabel = (memory: GovernanceMemory): string => memory.scope === 'organization'
    ? '全企业'
    : departmentName(memory.departmentId)
  useEffect(() => {
    if (departmentId === '' && state.departments[0] !== undefined)
      setDepartmentId(state.departments[0].id)
  }, [departmentId, state.departments])
  return <section className={css.ledgerSection}>
    <header className={css.memoryHeader}>
      <div><h2>{t('\u4F01\u4E1A\u8BB0\u5FC6')}</h2><p>{t('memory.description')}</p></div>
      <span>{approved.length}{t('\u6761\u5DF2\u542F\u7528')}</span>
    </header>
    <div className={css.memoryAutomation} role="status">
      <strong>{t('Agent \u81EA\u52A8\u8BB0\u5FC6\u5DF2\u5F00\u542F')}</strong>
      <span>{t('memory.automationHelp')}</span>
    </div>
    <section className={css.memoryWriteback} aria-label={t('memory.writebackTitle')}>
      <div>
        <strong>{t('memory.writebackTitle')}</strong>
        <span>{t('memory.writebackHelp')}</span>
      </div>
      <div className={css.memoryWritebackStats}>
        <span>{t('memory.writebackActive', { count: writebackActive })}</span>
        <span>{t('memory.writebackFailed', { count: writebackFailed.length })}</span>
        {lastWriteback?.state === 'completed' && <span>{t('memory.writebackLast', {
          activated: lastWriteback.result?.activated ?? 0,
          pending: lastWriteback.result?.pending ?? 0,
          skipped: lastWriteback.result?.skipped ?? 0,
        })}</span>}
      </div>
      {writebackFailed.slice(0, 5).map(item => <article key={item.sourceKey} className={css.memoryWritebackFailure}>
        <div><strong>{t('memory.writebackFailure', { turn: item.turn })}</strong><small>{item.error ?? t('memory.writebackUnknown')}</small></div>
        {retryMemoryWriteback !== undefined && <button type="button" onClick={() => { void retryMemoryWriteback(item.sourceKey) }}>{t('memory.writebackRetry')}</button>}
      </article>)}
    </section>
    <ol className={css.memoryFlow} aria-label={t('\u4F01\u4E1A\u8BB0\u5FC6\u751F\u6548\u6D41\u7A0B')}>
      <li><span>1</span><strong>{t('memory.flowCapture')}</strong><small>{t('\u586B\u5199\u53EF\u5171\u4EAB\u7684\u89C4\u5219\u3001\u6D41\u7A0B\u3001\u672F\u8BED\u6216\u51B3\u7B56')}</small></li>
      <li><span>2</span><strong>{t('memory.flowAutomatic')}</strong><small>{t('memory.flowAutomaticHelp')}</small></li>
      <li><span>3</span><strong>{t('memory.flowExceptions')}</strong><small>{t('memory.flowExceptionsHelp')}</small></li>
    </ol>
    <form className={css.memoryComposer} onSubmit={(event) => {
      event.preventDefault()
      if (summary.trim() === '' || (scope === 'department' && departmentId === ''))
        return
      const submit = async (): Promise<void> => {
        setSubmitting(true)
        setError(null)
        try {
          await proposeMemory({
            id: randomUUID(), scope, ...(scope === 'department' ? { departmentId } : {}),
            kind, summary: summary.trim(),
          })
          setSummary('')
        }
        catch {
          setError(t('memory.saveError'))
        }
        finally {
          setSubmitting(false)
        }
      }
      void submit()
    }}>
      <div className={css.memoryComposerHeader}><strong>{t('\u65B0\u589E\u4E1A\u52A1\u8BB0\u5FC6')}</strong>
        <span>{t('memory.composerHelp')}</span></div>
      <div className={css.memoryFields}>
        <label>{t('\u9002\u7528\u8303\u56F4')}<select aria-label={t('\u9002\u7528\u8303\u56F4')} value={scope} onChange={(event) => { setScope(event.target.value as GovernanceMemory['scope']) }}>
          <option value="organization">{t('\u5168\u4F01\u4E1A Agent')}</option><option value="department">{t('\u6307\u5B9A\u90E8\u95E8 Agent')}</option>
        </select><small>{t('\u51B3\u5B9A\u54EA\u4E9B\u5BF9\u8BDD\u4F1A\u6536\u5230\u8FD9\u6761\u77E5\u8BC6\u3002')}</small></label>
        <label>{t('\u9002\u7528\u90E8\u95E8')}<select aria-label={t('\u9002\u7528\u90E8\u95E8')} value={departmentId} disabled={scope !== 'department'} onChange={(event) => { setDepartmentId(event.target.value) }}>
          {state.departments.length === 0 && <option value="">{t('\u8BF7\u5148\u521B\u5EFA\u90E8\u95E8')}</option>}
          {state.departments.map(department => <option key={department.id} value={department.id}>{department.name}</option>)}
        </select></label>
        <label>{t('\u4E1A\u52A1\u77E5\u8BC6\u7C7B\u578B')}<select aria-label={t('\u4E1A\u52A1\u77E5\u8BC6\u7C7B\u578B')} value={kind} onChange={(event) => { setKind(event.target.value as GovernanceMemory['kind']) }}>
          <option value="business-fact">{t('\u4E1A\u52A1\u89C4\u5219')}</option><option value="process">{t('\u5DE5\u4F5C\u6D41\u7A0B')}</option>
          <option value="terminology">{t('\u516C\u53F8\u672F\u8BED')}</option><option value="decision">{t('\u5DF2\u786E\u8BA4\u51B3\u7B56')}</option>
        </select></label>
        <label className={css.memorySummaryField}>{t('\u8981\u8BA9 Agent \u8BB0\u4F4F\u7684\u5185\u5BB9')}<textarea aria-label={t('\u8981\u8BA9 Agent \u8BB0\u4F4F\u7684\u5185\u5BB9')} placeholder={t('\u4F8B\u5982\uFF1A\u6240\u6709\u91C7\u8D2D\u8BA2\u5355\u5FC5\u987B\u5728\u5165\u5E93\u524D\u5B8C\u6210\u5BA1\u6279\u3002')} maxLength={1000} value={summary} onChange={(event) => { setSummary(event.target.value) }}/>
          <small>{summary.length}{t('/1000 \u00B7 \u53EA\u5199\u53EF\u5171\u4EAB\u7684\u516C\u53F8\u4E1A\u52A1\u4FE1\u606F\u3002')}</small></label>
      </div>
      <div className={css.memoryPrivacy}><strong>{t('\u9690\u79C1\u8FB9\u754C')}</strong><span>{t('memory.privacyHelp')}</span></div>
      {error !== null && <div className={css.formError} role="alert">{error}</div>}
      <div className={css.memorySubmit}><button type="submit" disabled={submitting || summary.trim() === ''
            || (scope === 'department' && departmentId === '')}>{submitting ? t('\u6B63\u5728\u63D0\u4EA4\u2026') : t('memory.save')}</button></div>
    </form>
    <div className={css.memoryColumns}>
      {proposed.length > 0 && <section className={css.memoryLane} aria-label={t('memory.pending')}>
        <div className={css.subsectionHeader}>
          <div><strong>{t('memory.pending')}</strong><span>{t('memory.pendingHelp')}</span></div>
          <span>{proposed.length}</span>
        </div>
        {proposed.length === 0 && <p className={css.emptyState}>{t('memory.noExceptions')}</p>}
        {proposed.map(memory => <article key={memory.id} className={css.memoryItem}>
          <div className={css.memoryMeta}><span>{scopeLabel(memory)}</span><span>{kindLabel(memory.kind)}</span></div>
          <strong className={css.memorySummary}>{memory.summary}</strong>
          <small>{t('\u7CFB\u7EDF\u5DF2\u751F\u6210\u5185\u5BB9\u6307\u7EB9 \u00B7 \u539F\u59CB\u5BF9\u8BDD\u672A\u4FDD\u5B58')}</small>
          <label className={css.memoryReviewReason}>{t('\u5BA1\u6838\u8BF4\u660E')}<input aria-label={t('memory.reviewAria', { summary: memory.summary })} placeholder={t('\u8BF4\u660E\u6838\u9A8C\u4F9D\u636E\u6216\u9A73\u56DE\u539F\u56E0')} value={reviewReasons[memory.id] ?? ''} onChange={(event) => { setReviewReasons(current => ({ ...current, [memory.id]: event.target.value })) }}/></label>
          <div className={css.memoryActions}>
            <button type="button" disabled={busyMemoryId !== null} onClick={() => {
              const review = async (): Promise<void> => {
                setBusyMemoryId(memory.id)
                setError(null)
                try {
                  await reviewMemory(memory.id, {
                    decision: 'approved', reason: reviewReasons[memory.id]?.trim() || t('memory.confirmed'), expectedRevision: memory.revision,
                  })
                }
                catch {
                  setError('审核操作失败，请刷新后重试。')
                }
                finally {
                  setBusyMemoryId(null)
                }
              }
              void review()
            }}>{busyMemoryId === memory.id ? t('\u6B63\u5728\u5904\u7406\u2026') : t('\u6279\u51C6\u5E76\u542F\u7528')}</button>
            <button type="button" disabled={busyMemoryId !== null} onClick={() => {
              const review = async (): Promise<void> => {
                setBusyMemoryId(memory.id)
                setError(null)
                try {
                  await reviewMemory(memory.id, {
                    decision: 'rejected', reason: reviewReasons[memory.id]?.trim() || t('memory.notAdopted'), expectedRevision: memory.revision,
                  })
                }
                catch {
                  setError('审核操作失败，请刷新后重试。')
                }
                finally {
                  setBusyMemoryId(null)
                }
              }
              void review()
            }}>{t('\u9A73\u56DE')}</button>
          </div>
        </article>)}
      </section>}
      <section className={css.memoryLane} aria-label={t('Agent \u5DF2\u53EF\u4F7F\u7528')}>
        <div className={css.subsectionHeader}>
          <div><strong>{t('Agent \u5DF2\u53EF\u4F7F\u7528')}</strong><span>{t('\u4EE5\u4E0B\u77E5\u8BC6\u4F1A\u8FDB\u5165\u5BF9\u5E94\u8303\u56F4\u7684 Agent \u4E0A\u4E0B\u6587')}</span></div>
          <span>{approved.length}</span>
        </div>
        {approved.length === 0 && <p className={css.emptyState}>{t('memory.emptyActive')}</p>}
        {approved.map(memory => <article key={memory.id} className={css.memoryItem}>
          <div className={css.memoryMeta}>
            <span>{scopeLabel(memory)}</span><span>{kindLabel(memory.kind)}</span>
            {memory.reviewReason === 'Agent 自动评估并直接启用' && <span>{t('Agent \u81EA\u52A8\u4FDD\u5B58 \u00B7 \u5DF2\u76F4\u63A5\u751F\u6548')}</span>}
          </div>
          <strong className={css.memorySummary}>{memory.summary}</strong>
          <div className={css.memoryActions}><button type="button" disabled={busyMemoryId !== null} onClick={() => {
            const retire = async (): Promise<void> => {
              setBusyMemoryId(memory.id)
              setError(null)
              try { await reviewMemory(memory.id, { decision: 'retired', reason: t('memory.retireReason'), expectedRevision: memory.revision }) }
              catch { setError(t('memory.retireError')) }
              finally { setBusyMemoryId(null) }
            }
            void retire()
          }}>{t('memory.retire')}</button></div>
          <small>{memory.reviewReason === 'Agent 自动评估并直接启用'
            ? t('\u7531 Agent \u81EA\u52A8\u8BC4\u4F30\u5E76\u76F4\u63A5\u751F\u6548') : memory.reviewReason === undefined ? t('\u5DF2\u901A\u8FC7\u5BA1\u6838') : t('memory.reviewReason', { reason: memory.reviewReason })}</small>
        </article>)}
      </section>
    </div>
  </section>
}
function PoliciesSection({ state, savePolicy, t }: Pick<EnterpriseGovernanceSurfaceProps, 'state' | 'savePolicy'> & {
  t: GovernanceTranslate
}) {
  const typeLabel = (type: string): string => ({
    employee: '数字员工', model: '模型', capability: '能力', channel: '渠道',
  })[type] ?? type
  const resources = useMemo(() => {
    const values = new Map<string, {
      key: string
      type: string
      id: string
      name: string
    }>()
    for (const asset of state.assets) {
      const key = `${asset.type}:${asset.id}`
      values.set(key, { key, type: asset.type, id: asset.id, name: asset.name })
    }
    for (const policy of state.policies) {
      const key = `${policy.resourceType}:${policy.resourceId}`
      if (!values.has(key))
        values.set(key, {
          key, type: policy.resourceType, id: policy.resourceId,
          name: `${typeLabel(policy.resourceType)} · ${policy.resourceId}`,
        })
    }
    return [...values.values()].toSorted((left, right) => left.name.localeCompare(right.name))
  }, [state.assets, state.policies])
  const [selectedKey, setSelectedKey] = useState(resources[0]?.key ?? '')
  const selectedResource = resources.find(resource => resource.key === selectedKey) ?? resources[0]
  const selectedPolicy = selectedResource === undefined
    ? undefined
    : state.policies.find(policy => policy.resourceType === selectedResource.type
      && policy.resourceId === selectedResource.id)
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
    if (selectedKey !== selectedResource.key)
      setSelectedKey(selectedResource.key)
    setVisibility(selectedPolicy?.visibility ?? 'organization')
    setAllowedUserIds([...(selectedPolicy?.allowedUserIds ?? [])])
  }, [selectedKey, selectedPolicy, selectedResource])
  const selectResource = (key: string): void => {
    const resource = resources.find(item => item.key === key)
    const policy = resource === undefined
      ? undefined
      : state.policies.find(item => item.resourceType === resource.type && item.resourceId === resource.id)
    setSelectedKey(key)
    setVisibility(policy?.visibility ?? 'organization')
    setAllowedUserIds([...(policy?.allowedUserIds ?? [])])
    setError(null)
  }
  const visibilitySummary = (policy: GovernancePolicy): string => {
    if (policy.visibility === 'organization')
      return t('\u5168\u4F01\u4E1A\u53EF\u7528')
    if (policy.visibility === 'private')
      return t('\u4EC5\u8D1F\u8D23\u4EBA\u53EF\u7528')
    return t('visibility.restrictedCount', { count: policy.allowedUserIds.length })
  }
  return <section className={css.ledgerSection}>
    <header className={css.permissionHeader}>
      <div><h2>{t('\u8D44\u6E90\u8BBF\u95EE\u6743\u9650')}</h2><p>{t('\u51B3\u5B9A\u4F01\u4E1A\u6210\u5458\u80FD\u5426\u770B\u5230\u548C\u4F7F\u7528\u6570\u5B57\u5458\u5DE5\u3001\u6A21\u578B\u3001\u80FD\u529B\u4E0E\u6E20\u9053\u3002')}</p></div>
      <span>{state.policies.length}{t('\u6761\u89C4\u5219')}</span>
    </header>
    <div className={css.permissionGuide}>
      <strong>{t('\u8FD9\u91CC\u63A7\u5236\u201C\u8C01\u53EF\u4EE5\u4F7F\u7528\u8D44\u6E90\u201D')}</strong>
      <span>{t('\u4E0D\u4F1A\u4FEE\u6539\u6A21\u578B\u53C2\u6570\u3001\u5458\u5DE5\u804C\u8D23\u6216\u6E20\u9053\u914D\u7F6E\uFF1B\u7BA1\u7406\u5458\u59CB\u7EC8\u4FDD\u7559\u6CBB\u7406\u6743\u9650\u3002')}</span>
    </div>
    {resources.length === 0
      ? <div className={css.permissionEmpty}>
        <IconFolderOpen16 size={20}/>
        <strong>{t('\u6682\u65E0\u53EF\u6388\u6743\u8D44\u6E90')}</strong>
        <span>{t('\u8BF7\u5148\u5728\u6570\u5B57\u5458\u5DE5\u3001\u6A21\u578B\u6216\u6E20\u9053\u7BA1\u7406\u4E2D\u5B8C\u6210\u914D\u7F6E\uFF0C\u8D44\u6E90\u4F1A\u81EA\u52A8\u51FA\u73B0\u5728\u8FD9\u91CC\u3002')}</span>
      </div>
      : <div className={css.permissionLayout}>
        <form className={css.permissionEditor} onSubmit={(event) => {
          event.preventDefault()
          if (selectedResource === undefined || (visibility === 'restricted' && allowedUserIds.length === 0))
            return
          const submit = async (): Promise<void> => {
            setSaving(true)
            setError(null)
            try {
              const creatorUserId = selectedPolicy?.creatorUserId ?? state.auth?.principal?.userId
              await savePolicy({
                resourceType: selectedResource.type, resourceId: selectedResource.id,
                ...(visibility === 'private' && creatorUserId !== undefined ? { creatorUserId } : {}),
                visibility, allowedUserIds: visibility === 'restricted' ? [...allowedUserIds].sort() : [],
              })
            }
            catch {
              setError('保存访问权限失败，请重试')
            }
            finally {
              setSaving(false)
            }
          }
          void submit()
        }}>
          <label className={css.resourceSelect}>{t('\u9009\u62E9\u8981\u6388\u6743\u7684\u8D44\u6E90')}<select aria-label={t('\u9009\u62E9\u8D44\u6E90')} value={selectedResource?.key ?? ''} onChange={(event) => { selectResource(event.target.value) }}>
            {resources.map(resource => <option key={resource.key} value={resource.key}>
              {resource.name} · {typeLabel(resource.type)}
            </option>)}
          </select><small>{t('\u8D44\u6E90\u7F16\u53F7\uFF1A')}{selectedResource?.id}</small></label>
          <fieldset className={css.visibilityChoices}><legend>{t('\u8C01\u53EF\u4EE5\u4F7F\u7528')}</legend>
            <label><input type="radio" name="visibility" value="organization" checked={visibility === 'organization'} onChange={() => { setVisibility('organization') }}/><span><strong>{t('\u5168\u4F01\u4E1A')}</strong><small>{t('\u6240\u6709\u5DF2\u767B\u5F55\u4F01\u4E1A\u6210\u5458\u90FD\u53EF\u4EE5\u770B\u5230\u548C\u4F7F\u7528')}</small></span></label>
            <label><input type="radio" name="visibility" value="private" checked={visibility === 'private'} onChange={() => { setVisibility('private') }}/><span><strong>{t('\u4EC5\u8D1F\u8D23\u4EBA')}</strong><small>{t('\u8D44\u6E90\u8D1F\u8D23\u4EBA\u548C\u7BA1\u7406\u5458\u53EF\u4EE5\u4F7F\u7528')}</small></span></label>
            <label><input aria-label={t('\u6307\u5B9A\u6210\u5458')} type="radio" name="visibility" value="restricted" checked={visibility === 'restricted'} onChange={() => { setVisibility('restricted') }}/>
              <span><strong>{t('\u6307\u5B9A\u6210\u5458')}</strong><small>{t('\u53EA\u5141\u8BB8\u52FE\u9009\u7684\u6210\u5458\u4F7F\u7528')}</small></span></label>
          </fieldset>
          {visibility === 'restricted' && <fieldset className={css.allowedUsers}><legend>{t('\u9009\u62E9\u6210\u5458')}</legend>
            {state.users.length === 0
              ? <span>{t('\u6682\u65E0\u53EF\u9009\u62E9\u6210\u5458')}</span>
              : state.users.map(user => <label key={user.id}>
                <input type="checkbox" aria-label={`${user.displayName} @${user.username}`} disabled={user.disabled} checked={allowedUserIds.includes(user.id)} onChange={(event) => {
                  setAllowedUserIds(current => event.target.checked
                    ? [...current, user.id]
                    : current.filter(id => id !== user.id))
                }}/>
                <span>{user.displayName}<small>@{user.username}{user.disabled ? t('common.disabledSuffix') : ''}</small></span>
              </label>)}
          </fieldset>}
          {visibility === 'restricted' && allowedUserIds.length === 0
                    && <p className={css.permissionHint}>{t('\u81F3\u5C11\u9009\u62E9\u4E00\u4F4D\u6210\u5458\u540E\u624D\u80FD\u4FDD\u5B58\u3002')}</p>}
          {error !== null && <div className={css.formError} role="alert">{error}</div>}
          <div className={css.permissionActions}><button type="submit" disabled={saving || (visibility === 'restricted' && allowedUserIds.length === 0)}>
            {saving ? t('\u6B63\u5728\u4FDD\u5B58\u2026') : t('\u4FDD\u5B58\u8BBF\u95EE\u6743\u9650')}
          </button></div>
        </form>
        <div className={css.permissionRules}>
          <div className={css.subsectionHeader}><strong>{t('\u5F53\u524D\u89C4\u5219')}</strong><span>{state.policies.length}</span></div>
          {state.policies.length === 0
            ? <p className={css.emptyState}>{t('\u5C1A\u672A\u8BBE\u7F6E\u89C4\u5219\uFF0C\u8D44\u6E90\u9ED8\u8BA4\u6309\u5E73\u53F0\u7B56\u7565\u5904\u7406\u3002')}</p>
            : state.policies.map((policy) => {
              const resource = resources.find(item => item.type === policy.resourceType && item.id === policy.resourceId)
              return <button key={`${policy.resourceType}:${policy.resourceId}`} type="button" aria-label={t('policy.editAria', { name: resource?.name ?? policy.resourceId })} onClick={() => { selectResource(`${policy.resourceType}:${policy.resourceId}`) }}>
                <span><strong>{resource?.name ?? policy.resourceId}</strong><small>{typeLabel(policy.resourceType)}</small></span>
                <em>{visibilitySummary(policy)}</em>
              </button>
            })}
        </div>
      </div>}
  </section>
}
function AuditSection({ state, filterAudit, t }: Pick<EnterpriseGovernanceSurfaceProps, 'state' | 'filterAudit'> & {
  t: GovernanceTranslate
}) {
  const [actorUserId, setActorUserId] = useState('')
  const [action, setAction] = useState('')
  return <section className={css.ledgerSection}>
    <header><h2>{t('\u5BA1\u8BA1\u65E5\u5FD7')}</h2><span>{state.audit.length}</span></header>
    <form className={css.auditFilter} onSubmit={(event) => { event.preventDefault(); void filterAudit({ actorUserId, action }) }}>
      <input aria-label={t('\u5BA1\u8BA1\u6267\u884C\u8005')} placeholder={t('actor user id')} value={actorUserId} onChange={(event) => { setActorUserId(event.target.value) }}/>
      <input aria-label={t('\u5BA1\u8BA1\u52A8\u4F5C')} placeholder={t('action')} value={action} onChange={(event) => { setAction(event.target.value) }}/>
      <button type="submit">{t('\u67E5\u8BE2\u5BA1\u8BA1')}</button>
    </form>
    <div className={css.tableWrap}><table><thead><tr><th>{t('\u64CD\u4F5C')}</th><th>{t('\u6267\u884C\u8005')}</th><th>{t('\u51B3\u7B56')}</th><th>{t('\u65F6\u95F4')}</th></tr></thead><tbody>
      {state.audit.map(event => <tr key={event.id}>
        <td><strong>{event.action}</strong><span>{event.resourceType} · {event.resourceId}</span></td>
        <td>{event.actorUserId}</td><td>{event.decision}</td>
        <td>{new Date(event.at).toLocaleString()}</td>
      </tr>)}</tbody></table></div>
  </section>
}
type GovernancePage = 'organizations' | 'users' | 'workspaces' | 'memory' | 'policies' | 'audit'
const GOVERNANCE_TABS: readonly {
  id: GovernancePage
  label: string
}[] = [
  { id: 'organizations', label: 'nav.organizations' },
  { id: 'users', label: 'nav.users' },
  { id: 'workspaces', label: 'nav.workspaces' },
  { id: 'memory', label: 'nav.memory' },
  { id: 'policies', label: 'nav.policies' },
  { id: 'audit', label: 'nav.audit' },
]
function GovernanceSections(props: EnterpriseGovernanceSurfaceProps) {
  const t = props.t ?? defaultGovernanceTranslate
  const [active, setActive] = useState<GovernancePage>('organizations')
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const selectByKeyboard = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    let next: number | undefined
    if (event.key === 'ArrowRight')
      next = (index + 1) % GOVERNANCE_TABS.length
    else if (event.key === 'ArrowLeft')
      next = (index - 1 + GOVERNANCE_TABS.length) % GOVERNANCE_TABS.length
    else if (event.key === 'Home')
      next = 0
    else if (event.key === 'End')
      next = GOVERNANCE_TABS.length - 1
    if (next === undefined)
      return
    event.preventDefault()
    const tab = GOVERNANCE_TABS[next]
    if (tab === undefined)
      return
    setActive(tab.id)
    tabRefs.current[next]?.focus()
  }
  const panel = (page: GovernancePage, content: ReactNode) => <div id={`governance-panel-${page}`} className={css.pagePanel} role="tabpanel" aria-labelledby={`governance-tab-${page}`} hidden={active !== page}>{content}</div>
  return <>
    <div className={css.tabBar} role="tablist" aria-label={t('\u4F01\u4E1A\u7BA1\u7406\u5206\u533A')} data-appearance="tonal">
      {GOVERNANCE_TABS.map((tab, index) => <button key={tab.id} ref={(element) => { tabRefs.current[index] = element }} id={`governance-tab-${tab.id}`} className={css.tab} type="button" role="tab" aria-selected={active === tab.id} aria-controls={`governance-panel-${tab.id}`} tabIndex={active === tab.id ? 0 : -1} onClick={() => { setActive(tab.id) }} onKeyDown={(event) => { selectByKeyboard(event, index) }}>{t(tab.label)}</button>)}
    </div>
    {props.state.error !== null && <div className={css.error} role="alert">{props.state.error}</div>}
    {panel('organizations', <OrganizationsSection state={props.state} saveDepartment={input => props.saveDepartment(input)} t={t} {...props.setDepartmentManagers === undefined ? {} : {
      setDepartmentManagers: (
        departmentId: string, managerUserIds: readonly string[], expectedRevision: number,
      ): Promise<void> => {
        if (props.setDepartmentManagers === undefined) return Promise.resolve()
        return props.setDepartmentManagers(departmentId, managerUserIds, expectedRevision)
      },
    }}/>)}
    {panel('users', <UsersSection {...props} t={t}/>)}
    {panel('workspaces', <WorkspacesSection state={props.state} createWorkspace={input => props.createWorkspace(input)} updateWorkspace={(id, input) => props.updateWorkspace(id, input)} t={t}/>)}
    {panel('memory', <MemorySection state={props.state} proposeMemory={input => props.proposeMemory(input)} reviewMemory={(id, input) => props.reviewMemory(id, input)} {...props.retryMemoryWriteback === undefined ? {} : { retryMemoryWriteback: (sourceKey: string) => props.retryMemoryWriteback?.(sourceKey) ?? Promise.resolve() }} t={t}/>)}
    {panel('policies', <PoliciesSection state={props.state} savePolicy={input => props.savePolicy(input)} t={t}/>)}
    {panel('audit', <AuditSection state={props.state} filterAudit={input => props.filterAudit(input)} t={t}/>)}
  </>
}
/** Enterprise administration rendered as a first-class Settings section. */
export function EnterpriseGovernanceSettingsSection(props: EnterpriseGovernanceSettingsSectionProps) {
  const t = props.t ?? defaultGovernanceTranslate
  useEffect(() => { void props.loadAdmin() }, [props.loadAdmin])
  if (props.state.auth?.authenticated !== true
        || !props.state.auth.principal?.roles.includes('administrator'))
    return null
  return (<main className={css.settingsLedger} aria-label={t('\u4F01\u4E1A\u6CBB\u7406')}>
    <header className={css.ledgerHeader}>
      <div><h1>{t('\u4F01\u4E1A\u6CBB\u7406')}</h1><p>{t('\u8EAB\u4EFD\u3001\u6743\u9650\u3001\u8D44\u4EA7\u8303\u56F4\u4E0E\u64CD\u4F5C\u8BC1\u636E\u3002')}</p></div>
      <button type="button" onClick={() => { void props.logout() }}>{t('\u9000\u51FA\u767B\u5F55')}</button>
    </header>
    <GovernanceSections {...props}/>
  </main>)
}
export function EnterpriseGovernanceSurface(props: EnterpriseGovernanceSurfaceProps) {
  const t = props.t ?? defaultGovernanceTranslate
  if (props.state.auth?.authenticated !== true) {
    return <LoginGate state={props.state} loginLocal={input => props.loginLocal(input)} t={t}/>
  }
  return null
}
