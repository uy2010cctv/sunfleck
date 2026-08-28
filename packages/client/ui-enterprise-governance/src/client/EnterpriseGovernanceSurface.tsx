/** Login gate and administrator governance ledger. */

import { useEffect, useState, type FormEvent } from 'react'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type {
  EnterpriseGovernanceState, GovernanceDepartment, GovernanceMemory, GovernancePolicy,
} from './controller.ts'
import css from './governance.module.css'

export interface EnterpriseGovernanceSurfaceProps {
  state: EnterpriseGovernanceState
  loginLocal(input: { organizationId: string; username: string; password: string }): Promise<void>
  logout(): Promise<void> | void
  createOrganization(input: { id: string; name: string }): Promise<void>
  createUser(input: { id: string; username: string; displayName: string; roles: readonly string[] }): Promise<void>
  createAsset(input: { type: 'channel' | 'model' | 'capability'; id: string; name: string; config: Record<string, unknown> }): Promise<void>
  updateUser(userId: string, input: {
    roles?: readonly string[]
    disabled?: boolean
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
  departments, parentId, selectedId, select, depth = 0,
}: {
  departments: readonly GovernanceDepartment[]
  parentId: string | null
  selectedId: string | undefined
  select: (department: GovernanceDepartment) => void
  depth?: number
}) {
  const children = departments.filter(item => item.parentId === parentId)
  if (children.length === 0) return null
  return <ul role={depth === 0 ? 'tree' : 'group'} aria-label={depth === 0 ? '部门组织架构' : undefined}>
    {children.map(department => <li key={department.id} role="treeitem" aria-level={depth + 1}>
      <button type="button" aria-label={department.name} aria-pressed={selectedId === department.id}
        onClick={() => { select(department) }}>
        <span>{department.name}</span><small>{department.id}</small>
      </button>
      <DepartmentBranch departments={departments} parentId={department.id} selectedId={selectedId}
        select={select} depth={depth + 1} />
    </li>)}
  </ul>
}

function OrganizationsSection({ state, createOrganization, saveDepartment }: Pick<
  EnterpriseGovernanceSurfaceProps, 'state' | 'createOrganization' | 'saveDepartment'
>) {
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [selectedId, setSelectedId] = useState<string | undefined>(state.departments[0]?.id)
  const [departmentId, setDepartmentId] = useState('')
  const [departmentName, setDepartmentName] = useState('')
  const [parentId, setParentId] = useState('')
  const [sortOrder, setSortOrder] = useState('0')
  const selected = state.departments.find(item => item.id === selectedId)
  const select = (department: GovernanceDepartment): void => {
    setSelectedId(department.id)
    setDepartmentId(department.id)
    setDepartmentName(department.name)
    setParentId(department.parentId ?? '')
    setSortOrder(String(department.sortOrder))
  }
  const selectedWorkspaces = state.workspaces.filter(workspace => workspace.departmentId === selectedId)
  const selectedUsers = state.users.filter(user => user.departmentIds?.includes(selectedId ?? '') === true)
  useEffect(() => {
    if (selectedId !== undefined || state.departments[0] === undefined) return
    const department = state.departments[0]
    setSelectedId(department.id); setDepartmentId(department.id); setDepartmentName(department.name)
    setParentId(department.parentId ?? ''); setSortOrder(String(department.sortOrder))
  }, [selectedId, state.departments])
  return <section className={css.ledgerSection}>
    <header><h2>组织与部门</h2><span>{state.departments.length}</span></header>
    <form className={css.inlineForm} onSubmit={(event) => {
      event.preventDefault()
      void createOrganization({ id, name })
    }}>
      <input aria-label="组织 ID" placeholder="organization-id" value={id} onChange={(event) => { setId(event.target.value) }} />
      <input aria-label="组织名称" placeholder="organization name" value={name} onChange={(event) => { setName(event.target.value) }} />
      <button type="submit">新增组织</button>
    </form>
    <div className={css.organizationStrip}>{state.organizations.map(org => (
      <div key={org.id}><strong>{org.name}</strong><span>{org.id}</span></div>
    ))}</div>
    <div className={css.directoryLayout}>
      <div className={css.treePanel}>
        <div className={css.subsectionHeader}><strong>部门组织架构</strong><span>{state.departments.length}</span></div>
        {state.departments.length === 0
          ? <p className={css.emptyState}>先建立第一个部门，随后可在树中继续添加下级部门。</p>
          : <DepartmentBranch departments={state.departments} parentId={null} selectedId={selectedId} select={select} />}
      </div>
      <div className={css.departmentDetail}>
        <div className={css.subsectionHeader}>
          <strong>{selected?.name ?? '新建部门'}</strong>
          {selected !== undefined && <span>修订 {selected.revision}</span>}
        </div>
        <form className={css.departmentForm} onSubmit={(event) => {
          event.preventDefault()
          void saveDepartment({
            id: departmentId, name: departmentName, parentId: parentId === '' ? null : parentId,
            sortOrder: Number(sortOrder), expectedRevision: selected?.id === departmentId ? selected.revision : 0,
          })
        }}>
          <label>部门 ID<input value={departmentId} onChange={(event) => { setDepartmentId(event.target.value) }} /></label>
          <label>部门名称<input value={departmentName} onChange={(event) => { setDepartmentName(event.target.value) }} /></label>
          <label>上级部门<select value={parentId} onChange={(event) => { setParentId(event.target.value) }}>
            <option value="">企业根节点</option>
            {state.departments.filter(item => item.id !== departmentId).map(item => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select></label>
          <label>排序<input inputMode="numeric" value={sortOrder} onChange={(event) => { setSortOrder(event.target.value) }} /></label>
          <div className={css.formActions}>
            <button type="button" onClick={() => {
              setSelectedId(undefined); setDepartmentId(''); setDepartmentName(''); setParentId(''); setSortOrder('0')
            }}>新建根部门</button>
            <button type="submit">{selected?.id === departmentId ? '保存部门' : '创建部门'}</button>
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

function UsersSection({ state, createUser, updateUser }: Pick<
  EnterpriseGovernanceSurfaceProps, 'state' | 'createUser' | 'updateUser'
>) {
  const [id, setId] = useState('')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  return (
    <section className={css.ledgerSection}>
      <header><h2>用户与角色</h2><span>{state.users.length}</span></header>
      <form className={css.inlineForm} onSubmit={(event) => {
        event.preventDefault()
        void createUser({ id, username, displayName, roles: ['member'] })
      }}>
        <input aria-label="用户 ID" placeholder="user-id" value={id} onChange={(event) => { setId(event.target.value) }} />
        <input aria-label="新用户名" placeholder="username" value={username} onChange={(event) => { setUsername(event.target.value) }} />
        <input aria-label="显示名" placeholder="display name" value={displayName} onChange={(event) => { setDisplayName(event.target.value) }} />
        <button type="submit">新增成员</button>
      </form>
      <div className={css.tableWrap}>
        <table><thead><tr><th>用户</th><th>部门</th><th>角色</th><th>状态</th><th>动作</th></tr></thead><tbody>
          {state.users.map(user => <tr key={user.id}>
            <td><strong>{user.displayName}</strong><span>{user.username} · {user.id}</span></td>
            <td><select multiple aria-label={`${user.displayName} 部门`} value={[...(user.departmentIds ?? [])]}
              onChange={(event) => {
                const departmentIds = [...event.currentTarget.selectedOptions].map(option => option.value)
                const primaryDepartmentId = departmentIds.includes(user.primaryDepartmentId ?? '')
                  ? user.primaryDepartmentId : departmentIds[0]
                void updateUser(user.id, {
                  departmentIds, ...(primaryDepartmentId === undefined ? {} : { primaryDepartmentId }),
                  expectedRevision: user.departmentRevision ?? 0,
                })
              }}>
              {state.departments.map(department => <option key={department.id} value={department.id}>
                {department.name}{department.id === user.primaryDepartmentId ? '（主）' : ''}
              </option>)}
            </select>
            <select aria-label={`${user.displayName} 主部门`} value={user.primaryDepartmentId ?? ''}
              disabled={(user.departmentIds?.length ?? 0) === 0} onChange={(event) => {
                void updateUser(user.id, {
                  departmentIds: user.departmentIds ?? [],
                  ...(event.target.value === '' ? {} : { primaryDepartmentId: event.target.value }),
                  expectedRevision: user.departmentRevision ?? 0,
                })
              }}>
              <option value="">未设置主部门</option>
              {state.departments.filter(department => user.departmentIds?.includes(department.id) === true)
                .map(department => <option key={department.id} value={department.id}>{department.name}</option>)}
            </select></td>
            <td><select aria-label={`${user.displayName} 角色`} value={user.roles[0] ?? 'member'} onChange={(event) => {
              void updateUser(user.id, { roles: [event.target.value] })
            }}>
              <option value="administrator">administrator</option><option value="creator">creator</option>
              <option value="operator">operator</option><option value="auditor">auditor</option><option value="member">member</option>
            </select></td>
            <td>{user.disabled ? '已停用' : '正常'}</td>
            <td><button type="button" onClick={() => { void updateUser(user.id, { disabled: !user.disabled }) }}>
              {user.disabled ? '启用' : '停用'}
            </button></td>
          </tr>)}</tbody></table>
      </div>
    </section>
  )
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

function GovernanceSections(props: EnterpriseGovernanceSurfaceProps) {
  return <>
    {props.state.error !== null && <div className={css.error} role="alert">{props.state.error}</div>}
    <div id="governance-organizations"><OrganizationsSection state={props.state}
      createOrganization={input => props.createOrganization(input)} saveDepartment={input => props.saveDepartment(input)} /></div>
    <div id="governance-users"><UsersSection {...props} /></div>
    <div id="governance-workspaces"><WorkspacesSection state={props.state}
      createWorkspace={input => props.createWorkspace(input)}
      updateWorkspace={(id, input) => props.updateWorkspace(id, input)} /></div>
    <div id="governance-memory"><MemorySection state={props.state} proposeMemory={input => props.proposeMemory(input)}
      reviewMemory={(id, input) => props.reviewMemory(id, input)} /></div>
    <div id="governance-policies"><PoliciesSection {...props} /></div>
    <div id="governance-audit"><AuditSection state={props.state} filterAudit={input => props.filterAudit(input)} /></div>
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
