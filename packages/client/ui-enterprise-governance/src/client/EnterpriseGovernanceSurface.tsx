/** Login gate and administrator governance ledger. */

import { useEffect, useState, type FormEvent } from 'react'
import type {
  EnterpriseGovernanceState, GovernancePolicy,
} from './controller.ts'
import css from './governance.module.css'

export interface EnterpriseGovernanceSurfaceProps {
  state: EnterpriseGovernanceState
  loginLocal(input: { organizationId: string; username: string; password: string }): Promise<void>
  logout(): Promise<void> | void
  createOrganization(input: { id: string; name: string }): Promise<void>
  createUser(input: { id: string; username: string; displayName: string; roles: readonly string[] }): Promise<void>
  createAsset(input: { type: 'channel' | 'model' | 'capability'; id: string; name: string; config: Record<string, unknown> }): Promise<void>
  updateUser(userId: string, input: { roles?: readonly string[]; disabled?: boolean }): Promise<void>
  savePolicy(input: GovernancePolicy): Promise<void>
  filterAudit(input: { actorUserId?: string; action?: string }): Promise<void>
}

export interface EnterpriseGovernanceSettingsSectionProps extends EnterpriseGovernanceSurfaceProps {
  loadAdmin: () => Promise<void>
}

function OrganizationsSection({ state, createOrganization }: Pick<
  EnterpriseGovernanceSurfaceProps, 'state' | 'createOrganization'
>) {
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  return <section className={css.ledgerSection}>
    <header><h2>组织与账号边界</h2><span>{state.organizations.length}</span></header>
    <form className={css.inlineForm} onSubmit={(event) => {
      event.preventDefault()
      void createOrganization({ id, name })
    }}>
      <input aria-label="组织 ID" placeholder="organization-id" value={id} onChange={(event) => { setId(event.target.value) }} />
      <input aria-label="组织名称" placeholder="organization name" value={name} onChange={(event) => { setName(event.target.value) }} />
      <button type="submit">新增组织</button>
    </form>
    <div className={css.policyList}>{state.organizations.map(org => (
      <div key={org.id}><strong>{org.name}</strong><span>{org.id}</span></div>
    ))}</div>
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
        <table><thead><tr><th>用户</th><th>角色</th><th>状态</th><th>动作</th></tr></thead><tbody>
          {state.users.map(user => <tr key={user.id}>
            <td><strong>{user.displayName}</strong><span>{user.username} · {user.id}</span></td>
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
    <div id="governance-organizations"><OrganizationsSection state={props.state} createOrganization={input => props.createOrganization(input)} /></div>
    <div id="governance-users"><UsersSection {...props} /></div>
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
