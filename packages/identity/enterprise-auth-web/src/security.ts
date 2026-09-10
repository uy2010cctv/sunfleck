/** Enterprise authentication, API classification, authorization, and audit. */

import { randomBytes, randomUUID } from 'node:crypto'
import type {
  EnterpriseAction, EnterpriseAuthorizationDecision, EnterprisePrincipal, EnterpriseResource,
} from '@deepseek-ai/dsh-enterprise-governance'
import { authorizeEnterprise } from '@deepseek-ai/dsh-enterprise-governance'
import {
  type EnterpriseIdentityStore,
  type EnterprisePrincipalView,
  type EnterpriseWorkspaceGrant,
} from '@deepseek-ai/dsh-enterprise-identity'
import { verifyPassword } from '@deepseek-ai/dsh-enterprise-sso'
import type { SsoMappedIdentity } from '@deepseek-ai/dsh-enterprise-sso'
import { parseSessionCookie, serializeSessionCookie } from './cookies.ts'

export interface EnterpriseSecurityConfig {
  readonly organizationId: string
  readonly sessionCookieName: string
  readonly sessionTtlMs: number
  readonly secureCookies: boolean
  readonly autoProvisionSsoUsers: boolean
}

export interface EnterpriseSecurityOptions {
  readonly now?: () => number
  readonly randomToken?: () => string
  readonly randomId?: () => string
  /** Resolves resources owned outside the identity repository; null means the owning store confirms absence. */
  readonly resourcePolicyResolver?: (
    resourceType: string,
    resourceId: string,
    principal: EnterprisePrincipal,
  ) => Promise<EnterpriseResource | null | undefined>
}

export interface ApiClassification {
  readonly action: EnterpriseAction
  readonly resourceType: string
  readonly resourceId?: string
}

/** Explicit resource address and safe details for an API audit event. */
export interface EnterpriseApiAuditResource {
  readonly type: string
  readonly id: string
  readonly details?: Readonly<Record<string, unknown>>
}
/** Authorization decision accepted by Host-resolved audit adapters. */
export interface EnterpriseApiAuditDecision {
  readonly allowed: boolean
  readonly reason: string
}

function payloadOf(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return {}
  const record = input as Record<string, unknown>
  const payload = record['payload']
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : record
}

function stringField(payload: Record<string, unknown>, ...fields: string[]): string | undefined {
  for (const field of fields) if (typeof payload[field] === 'string') return payload[field]
  return undefined
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function workspaceRecord(value: unknown): { workspaceId: string; value: Record<string, unknown> } | undefined {
  if (!record(value) || typeof value['workspaceId'] !== 'string') return undefined
  return { workspaceId: value['workspaceId'], value }
}

function syncValue<T>(value: T | Promise<T>, operation: string): T {
  if (typeof value === 'object' && value !== null && typeof (value as PromiseLike<T>).then === 'function') {
    throw new Error(`${operation} requires the async security method`)
  }
  return value as T
}

const SESSION_READ = new Set([
  'host.describe', 'host.listDirectory', 'events.mux', 'events.host',
  'session.list', 'session.search', 'session.history', 'session.page', 'session.follow', 'session.control',
  'session.models', 'session.attachment',
  'session.modelCatalog',
  'skill.list', 'subagent.list', 'subagent.history', 'workspace.list', 'downloads.sessionLog',
  // Legacy aliases kept for direct callers; the wire RPC registry uses the
  // singular names above.
  'sessions.list', 'sessions.search', 'sessions.history', 'sessions.models', 'sessions.attachment',
  'skills.list', 'subagents.list', 'subagents.history',
])
const SESSION_WRITE = new Set([
  'session.create', 'session.selectModel', 'session.rename', 'session.fork', 'session.prompt',
  'session.updateQueue', 'session.cancel', 'goal.create', 'goal.edit', 'goal.pause', 'goal.resume',
  'goal.complete', 'goal.clear', 'subagent.prompt', 'subagent.interrupt', 'workspace.create',
  'workspace.rename', 'workspace.delete', 'workspace.insertBefore', 'workspace.insertSessionBefore',
  'workspace.archiveSession', 'respond', 'agentPreset.select',
  'sessions.create', 'sessions.selectModel', 'sessions.rename', 'sessions.fork', 'sessions.prompt',
  'sessions.updateQueue', 'sessions.cancel', 'goals.create', 'goals.edit', 'goals.pause', 'goals.resume',
  'goals.complete', 'goals.clear', 'subagents.prompt', 'subagents.interrupt',
])
const MODEL_READ = new Set(['llm.providers', 'llm.models', 'settings.describe', 'agentPreset.list'])
const MODEL_WRITE = new Set([
  'settings.openDocument', 'settings.update', 'settings.replace', 'settings.mutate', 'llm.discoverModels',
  'host.pickDirectory', 'host.createDirectory', 'host.openPath',
])

/** Closed endpoint-to-policy map. Anything not classified is denied. */
export function classifyApiEndpoint(endpoint: string, input: unknown): ApiClassification | undefined {
  const payload = payloadOf(input)
  if (endpoint === 'dynamicCordisRunner.inventory' || endpoint === 'dynamicCordisRunner.syncInspectManifest') {
    return { action: 'system.inspect', resourceType: 'system-inspection' }
  }
  if (endpoint === 'enterpriseWorkspace.list') {
    return { action: 'session.read', resourceType: 'workspace-catalog' }
  }
  if (endpoint === 'enterpriseWorkspace.create') {
    return { action: 'session.create', resourceType: 'workspace-catalog' }
  }
  if (endpoint === 'workspace.follow') return { action: 'session.read', resourceType: 'workspace-catalog' }
  const workspaceId = stringField(payload, 'workspaceId')
  if (endpoint === 'workspace.create') return { action: 'session.create', resourceType: 'workspace-catalog' }
  if (endpoint.startsWith('workspace.') && workspaceId !== undefined) {
    return {
      action: endpoint === 'workspace.list' ? 'session.read' : 'workspace.manage',
      resourceType: 'workspace', resourceId: workspaceId,
    }
  }
  if (endpoint === 'session.create' && workspaceId !== undefined) {
    return { action: 'session.create', resourceType: 'workspace', resourceId: workspaceId }
  }
  const sessionId = stringField(payload, 'sessionId', 'parentSessionId', 'childSessionId')
  if (SESSION_READ.has(endpoint)) return { action: 'session.read', resourceType: 'session', ...sessionId === undefined ? {} : { resourceId: sessionId } }
  if (SESSION_WRITE.has(endpoint)) return { action: 'session.create', resourceType: 'session', ...sessionId === undefined ? {} : { resourceId: sessionId } }
  if (MODEL_READ.has(endpoint)) return { action: 'employee.read', resourceType: 'enterprise-catalog' }
  if (MODEL_WRITE.has(endpoint)) return { action: 'model.manage', resourceType: 'model-settings' }
  if (endpoint === 'agentPreset.read') {
    const resourceId = stringField(payload, 'agentPreset')
    return { action: 'employee.read', resourceType: 'employee', ...resourceId === undefined ? {} : { resourceId } }
  }
  if (endpoint === 'agentPreset.copy') return { action: 'employee.create', resourceType: 'employee' }
  if (endpoint === 'agentPreset.openDocument' || endpoint === 'agentPreset.remove') {
    const resourceId = stringField(payload, 'agentPreset')
    return { action: 'employee.update', resourceType: 'employee', ...resourceId === undefined ? {} : { resourceId } }
  }
  if (endpoint.startsWith('credentials.')) return { action: 'credential.manage', resourceType: 'credential' }
  if (endpoint.startsWith('enterpriseChannel.')) {
    const resourceId = stringField(payload, 'channelId')
    return { action: 'channel.manage', resourceType: 'channel', ...(resourceId === undefined ? {} : { resourceId }) }
  }
  if (endpoint.startsWith('enterpriseAdmin.')) return { action: 'user.manage', resourceType: 'enterprise-admin' }
  if (endpoint === 'enterpriseAudit.list') return { action: 'audit.read', resourceType: 'audit' }
  if (endpoint === 'enterpriseWork.prepare') return { action: 'operation.read', resourceType: 'work-record' }
  if (endpoint === 'enterpriseWork.start') return { action: 'operation.manage', resourceType: 'work-record' }
  if (['enterpriseEmployee.list', 'enterpriseEmployee.getDraft', 'enterpriseEmployee.saveDraft', 'enterpriseEmployee.publish', 'enterpriseEmployee.listReleases', 'enterpriseEmployee.rollback', 'enterpriseEmployee.optimizePrompt'].includes(endpoint)) {
    const resourceId = stringField(payload, 'presetId', 'releaseId')
    const read = endpoint === 'enterpriseEmployee.list' || endpoint === 'enterpriseEmployee.getDraft' || endpoint === 'enterpriseEmployee.listReleases'
    const create = endpoint === 'enterpriseEmployee.saveDraft' && payload['expectedRevision'] === 0
    return { action: read ? 'employee.read' : create ? 'employee.create' : 'employee.update', resourceType: 'employee', ...(resourceId === undefined ? {} : { resourceId }) }
  }
  if (['enterpriseAsset.list', 'enterpriseAsset.get', 'enterpriseAsset.saveVersion', 'enterpriseAsset.listVersions', 'enterpriseAsset.archive'].includes(endpoint)) {
    const resourceId = stringField(payload, 'assetId')
    const read = endpoint === 'enterpriseAsset.list' || endpoint === 'enterpriseAsset.get' || endpoint === 'enterpriseAsset.listVersions'
    return { action: read ? 'capability.read' : 'capability.manage', resourceType: 'enterprise-asset', ...(resourceId === undefined ? {} : { resourceId }) }
  }
  if (['enterpriseTeam.list', 'enterpriseTeam.get', 'enterpriseTeam.save'].includes(endpoint)) {
    const resourceId = stringField(payload, 'teamId')
    return { action: endpoint === 'enterpriseTeam.list' || endpoint === 'enterpriseTeam.get' ? 'team.read' : 'team.manage', resourceType: 'fixed-team', ...(resourceId === undefined ? {} : { resourceId }) }
  }
  if (['enterpriseTeamDefinition.list', 'enterpriseTeamDefinition.get', 'enterpriseTeamDefinition.getDraft', 'enterpriseTeamDefinition.save',
    'enterpriseTeamDefinition.draft', 'enterpriseTeamDefinition.publish', 'enterpriseTeamDefinition.discardDraft',
    'enterpriseTeamDefinition.archive'].includes(endpoint)) {
    const resourceId = stringField(payload, 'teamId')
    const read = endpoint === 'enterpriseTeamDefinition.list' || endpoint === 'enterpriseTeamDefinition.get' || endpoint === 'enterpriseTeamDefinition.getDraft'
    return {
      action: read ? 'team.read' : 'team.manage', resourceType: 'team-definition',
      ...(resourceId === undefined ? {} : { resourceId }),
    }
  }
  if (['enterpriseTeamRun.list', 'enterpriseTeamRun.get', 'enterpriseTeamRun.start', 'enterpriseTeamRun.cancel'].includes(endpoint)) {
    const resourceId = stringField(payload, 'teamId', 'runId')
    const read = endpoint === 'enterpriseTeamRun.list' || endpoint === 'enterpriseTeamRun.get'
    return { action: read ? 'team.read' : 'team.execute', resourceType: endpoint === 'enterpriseTeamRun.start' ? 'team-definition' : 'team-run',
      ...(resourceId === undefined ? {} : { resourceId }) }
  }
  if (['enterpriseTeamDecision.list', 'enterpriseTeamDecision.respond'].includes(endpoint)) {
    const resourceId = stringField(payload, 'decisionId', 'runId')
    return { action: endpoint === 'enterpriseTeamDecision.list' ? 'team.read' : 'team.decision.respond',
      resourceType: 'team-decision', ...(resourceId === undefined ? {} : { resourceId }) }
  }
  if (['enterpriseTeamAutonomy.list', 'enterpriseTeamAutonomy.save', 'enterpriseTeamAutonomy.revoke'].includes(endpoint)) {
    const resourceId = stringField(payload, 'teamId')
    return { action: endpoint === 'enterpriseTeamAutonomy.list' ? 'team.read' : 'team.autonomy.manage',
      resourceType: 'team-definition', ...(resourceId === undefined ? {} : { resourceId }) }
  }
  const cordisPluginId = stringField(payload, 'pluginId')
  if (endpoint === 'cordisGovernance.departmentManagers') {
    const departmentId = stringField(payload, 'departmentId')
    return {
      action: 'plugin.read', resourceType: 'department',
      ...(departmentId === undefined ? {} : { resourceId: departmentId }),
    }
  }
  if (['cordisWorkspace.list', 'cordisWorkspace.pinGeneration', 'cordisReview.list'].includes(endpoint)) {
    return {
      action: 'plugin.read', resourceType: 'cordis-plugin',
      ...(cordisPluginId === undefined ? {} : { resourceId: cordisPluginId }),
    }
  }
  if (['cordisWorkspace.save', 'cordisWorkspace.activate', 'cordisWorkspace.stop', 'cordisWorkspace.rollback',
    'cordisReview.submit'].includes(endpoint)) {
    return {
      action: 'plugin.create', resourceType: 'cordis-plugin',
      ...(cordisPluginId === undefined ? {} : { resourceId: cordisPluginId }),
    }
  }
  if (['cordisReview.derive', 'cordisReview.approveDepartment', 'cordisReview.return'].includes(endpoint)) {
    return {
      action: 'plugin.review', resourceType: 'cordis-plugin',
      ...(cordisPluginId === undefined ? {} : { resourceId: cordisPluginId }),
    }
  }
  if (endpoint === 'cordisReview.publishOrganization') {
    return {
      action: 'plugin.publish', resourceType: 'cordis-plugin',
      ...(cordisPluginId === undefined ? {} : { resourceId: cordisPluginId }),
    }
  }
  if (['cordisGovernance.disable', 'cordisGovernance.rollback', 'cordisGovernance.setTrust',
    'cordisGovernance.setDepartmentManagers'].includes(endpoint)) {
    return {
      action: 'plugin.manage', resourceType: 'cordis-plugin',
      ...(cordisPluginId === undefined ? {} : { resourceId: cordisPluginId }),
    }
  }
  if (['enterpriseOperation.workRecords.list', 'enterpriseOperation.workRecords.get', 'enterpriseOperation.workRecords.update', 'enterpriseOperation.workRecords.upsert',
    'enterpriseOperation.workStarts.reserve', 'enterpriseOperation.workStarts.get', 'enterpriseOperation.workStarts.complete',
    'enterpriseOperation.approvals.list', 'enterpriseOperation.approvals.get', 'enterpriseOperation.approvals.create', 'enterpriseOperation.approvals.transition', 'enterpriseOperation.approvals.cancel',
    'enterpriseOperation.schedules.list', 'enterpriseOperation.schedules.get', 'enterpriseOperation.schedules.create', 'enterpriseOperation.schedules.save', 'enterpriseOperation.schedules.transition', 'enterpriseOperation.schedules.fire',
    'enterpriseOperation.outbox.claim', 'enterpriseOperation.outbox.complete', 'enterpriseOperation.outbox.fail',
    'enterpriseOperation.teams.list', 'enterpriseOperation.teams.get', 'enterpriseOperation.teams.create', 'enterpriseOperation.teams.save',
    'enterpriseOperation.teamDefinitions.list', 'enterpriseOperation.teamDefinitions.get', 'enterpriseOperation.teamDefinitions.getDraft',
    'enterpriseOperation.teamDefinitions.create', 'enterpriseOperation.teamDefinitions.save',
    'enterpriseOperation.teamDefinitions.draft', 'enterpriseOperation.teamDefinitions.publish',
    'enterpriseOperation.teamDefinitions.discardDraft', 'enterpriseOperation.teamDefinitions.archive'].includes(endpoint)) {
    const operation = endpoint.slice('enterpriseOperation.'.length)
    if (operation.startsWith('workRecords.') && (operation.endsWith('.get') || operation.endsWith('.list'))) {
      return { action: 'operation.read', resourceType: 'work-record', ...sessionId === undefined ? {} : { resourceId: sessionId } }
    }
    if (operation.startsWith('workStarts.')) {
      const resourceId = stringField(payload, 'idempotencyKey')
      return {
        action: 'operation.manage', resourceType: 'work-start-reservation',
        ...(resourceId === undefined ? {} : { resourceId }),
      }
    }
    if (operation.startsWith('workRecords.') || operation.startsWith('outbox.')) return { action: 'operation.manage', resourceType: 'work-record', ...sessionId === undefined ? {} : { resourceId: sessionId } }
    if (operation.startsWith('approvals.')) {
      const resourceId = stringField(payload, 'approvalId')
      const read = operation === 'approvals.get' || operation === 'approvals.list'
      return { action: read ? 'approval.read' : 'approval.manage', resourceType: 'approval', ...(resourceId === undefined ? {} : { resourceId }) }
    }
    if (operation.startsWith('schedules.')) {
      const resourceId = stringField(payload, 'scheduleId')
      const read = operation === 'schedules.get' || operation === 'schedules.list'
      return { action: read ? 'schedule.read' : 'schedule.manage', resourceType: 'schedule', ...(resourceId === undefined ? {} : { resourceId }) }
    }
    if (operation.startsWith('teams.')) {
      const resourceId = stringField(payload, 'teamId')
      const read = operation === 'teams.get' || operation === 'teams.list'
      return { action: read ? 'team.read' : 'team.manage', resourceType: 'fixed-team', ...(resourceId === undefined ? {} : { resourceId }) }
    }
    if (operation.startsWith('teamDefinitions.')) {
      const resourceId = stringField(payload, 'teamId')
      const read = operation === 'teamDefinitions.get' || operation === 'teamDefinitions.getDraft' || operation === 'teamDefinitions.list'
      return {
        action: read ? 'team.read' : 'team.manage', resourceType: 'team-definition',
        ...(resourceId === undefined ? {} : { resourceId }),
      }
    }
  }
  return undefined
}

export interface LoginResult {
  readonly principal: EnterprisePrincipalView
  readonly token: string
  readonly cookie: string
}

/** Central single-enterprise security service shared by HTTP, WebSocket, and admin APIs. */
export class EnterpriseSecurity {
  private readonly now: () => number
  private readonly randomToken: () => string
  private readonly randomId: () => string
  private readonly resourcePolicyResolver: EnterpriseSecurityOptions['resourcePolicyResolver']

  constructor(
    readonly repository: EnterpriseIdentityStore,
    readonly config: EnterpriseSecurityConfig,
    options: EnterpriseSecurityOptions = {},
  ) {
    this.now = options.now ?? Date.now
    this.randomToken = options.randomToken ?? (() => randomBytes(32).toString('base64url'))
    this.randomId = options.randomId ?? randomUUID
    this.resourcePolicyResolver = options.resourcePolicyResolver
  }

  /**
   * Authenticate one local account through a synchronous identity adapter.
   * @param orgId - Organization boundary named by the login form.
   * @param username - Organization-local username.
   * @param password - Plaintext presented only to the password verifier.
   * @returns the issued login result, or `undefined` for invalid credentials.
   */
  loginLocal(orgId: string, username: string, password: string): LoginResult | undefined {
    const record = syncValue(this.repository.passwordLoginRecord(orgId, username), 'loginLocal')
    if (record === undefined || record.disabled || !verifyPassword(password, record.verifier)) return undefined
    return this.issueSession(record.userId)
  }

  /**
   * Issue one synchronous persistent login Session for an enabled user.
   * @param userId - Canonical enterprise user id.
   * @returns the issued token, cookie, and principal.
   */
  issueSession(userId: string): LoginResult {
    const user = syncValue(this.repository.listUsers(this.config.organizationId), 'issueSession').find(candidate => candidate.id === userId)
    if (user === undefined || user.disabled) throw new Error('enterprise session user is unavailable')
    const token = this.randomToken()
    syncValue(this.repository.createSession({ token, userId, expiresAt: this.now() + this.config.sessionTtlMs }), 'issueSession')
    const principal = syncValue(this.repository.authenticateSession(token), 'issueSession')
    if (principal === undefined) throw new Error('enterprise session failed to become readable after commit')
    return {
      principal,
      token,
      cookie: serializeSessionCookie({
        name: this.config.sessionCookieName,
        token,
        maxAgeSeconds: Math.floor(this.config.sessionTtlMs / 1000),
        secure: this.config.secureCookies,
      }),
    }
  }

  /**
   * Resolve or provision one synchronous external identity and issue its login Session.
   * @param identity - Validated and mapped external identity.
   * @returns the issued token, cookie, and principal.
   */
  loginExternal(identity: SsoMappedIdentity): LoginResult {
    if (identity.organizationId !== this.config.organizationId) {
      throw new Error('SSO identity belongs to a different enterprise organization')
    }
    let user = syncValue(this.repository.resolveExternalIdentity(identity.providerId, identity.subject), 'loginExternal')
    if (user === undefined) {
      if (!this.config.autoProvisionSsoUsers) throw new Error('SSO identity is not bound to an enterprise user')
      if (syncValue(this.repository.findUser(identity.organizationId, identity.username), 'loginExternal') !== undefined) {
        throw new Error('SSO username already belongs to an unbound enterprise user')
      }
      const userId = this.randomId()
      syncValue(this.repository.createUser({
        id: userId,
        orgId: identity.organizationId,
        username: identity.username,
        displayName: identity.displayName,
        disabled: false,
      }), 'loginExternal')
      syncValue(this.repository.setRoles(userId, identity.roles), 'loginExternal')
      syncValue(this.repository.bindExternalIdentity({ providerId: identity.providerId, subject: identity.subject, userId }), 'loginExternal')
      user = syncValue(this.repository.resolveExternalIdentity(identity.providerId, identity.subject), 'loginExternal')
    } else {
      syncValue(this.repository.setRoles(user.id, identity.roles), 'loginExternal')
    }
    if (user === undefined || user.disabled) throw new Error('SSO enterprise user is unavailable')
    return this.issueSession(user.id)
  }

  /**
   * Authenticate one cookie through a synchronous identity adapter.
   * @param cookieHeader - Incoming Cookie header.
   * @returns the active principal, or `undefined` when unavailable.
   */
  authenticateCookie(cookieHeader: string): EnterprisePrincipalView | undefined {
    const token = parseSessionCookie(cookieHeader, this.config.sessionCookieName)
    return token === undefined ? undefined : syncValue(this.repository.authenticateSession(token), 'authenticateCookie')
  }

  /**
   * Revoke the synchronous login Session named by a cookie header.
   * @param cookieHeader - Incoming Cookie header.
   */
  logout(cookieHeader: string): void {
    const token = parseSessionCookie(cookieHeader, this.config.sessionCookieName)
    if (token !== undefined) syncValue(this.repository.revokeSession(token), 'logout')
  }

  /**
   * Authenticate one local account through the production asynchronous adapter.
   * @param orgId - Organization boundary named by the login form.
   * @param username - Organization-local username.
   * @param password - Plaintext presented only to the password verifier.
   * @returns the issued login result, or `undefined` for invalid credentials.
   */
  async loginLocalAsync(orgId: string, username: string, password: string): Promise<LoginResult | undefined> {
    const record = await this.repository.passwordLoginRecord(orgId, username)
    if (record === undefined || record.disabled || !verifyPassword(password, record.verifier)) return undefined
    return this.issueSessionAsync(record.userId)
  }

  /**
   * Issue one persistent login Session through the asynchronous identity adapter.
   * @param userId - Canonical enterprise user id.
   * @returns the issued token, cookie, and principal.
   */
  async issueSessionAsync(userId: string): Promise<LoginResult> {
    const user = (await this.repository.listUsers(this.config.organizationId)).find(candidate => candidate.id === userId)
    if (user === undefined || user.disabled) throw new Error('enterprise session user is unavailable')
    const token = this.randomToken()
    await this.repository.createSession({ token, userId, expiresAt: this.now() + this.config.sessionTtlMs })
    const principal = await this.repository.authenticateSession(token)
    if (principal === undefined) throw new Error('enterprise session failed to become readable after commit')
    return {
      principal,
      token,
      cookie: serializeSessionCookie({
        name: this.config.sessionCookieName,
        token,
        maxAgeSeconds: Math.floor(this.config.sessionTtlMs / 1000),
        secure: this.config.secureCookies,
      }),
    }
  }

  /**
   * Resolve or provision an external identity through the asynchronous adapter.
   * @param identity - Validated and mapped external identity.
   * @returns the issued token, cookie, and principal.
   */
  async loginExternalAsync(identity: SsoMappedIdentity): Promise<LoginResult> {
    if (identity.organizationId !== this.config.organizationId) {
      throw new Error('SSO identity belongs to a different enterprise organization')
    }
    let user = await this.repository.resolveExternalIdentity(identity.providerId, identity.subject)
    if (user === undefined) {
      if (!this.config.autoProvisionSsoUsers) throw new Error('SSO identity is not bound to an enterprise user')
      if (await this.repository.findUser(identity.organizationId, identity.username) !== undefined) {
        throw new Error('SSO username already belongs to an unbound enterprise user')
      }
      const userId = this.randomId()
      await this.repository.createUser({
        id: userId, orgId: identity.organizationId, username: identity.username,
        displayName: identity.displayName, disabled: false,
      })
      await this.repository.setRoles(userId, identity.roles)
      await this.repository.bindExternalIdentity({ providerId: identity.providerId, subject: identity.subject, userId })
      user = await this.repository.resolveExternalIdentity(identity.providerId, identity.subject)
    } else {
      await this.repository.setRoles(user.id, identity.roles)
    }
    if (user === undefined || user.disabled) throw new Error('SSO enterprise user is unavailable')
    return this.issueSessionAsync(user.id)
  }

  /**
   * Authenticate one cookie through the asynchronous identity adapter.
   * @param cookieHeader - Incoming Cookie header.
   * @returns the active principal, or `undefined` when unavailable.
   */
  async authenticateCookieAsync(cookieHeader: string): Promise<EnterprisePrincipalView | undefined> {
    const token = parseSessionCookie(cookieHeader, this.config.sessionCookieName)
    return token === undefined ? undefined : this.repository.authenticateSession(token)
  }

  /**
   * Revoke the asynchronous login Session named by a cookie header.
   * @param cookieHeader - Incoming Cookie header.
   */
  async logoutAsync(cookieHeader: string): Promise<void> {
    const token = parseSessionCookie(cookieHeader, this.config.sessionCookieName)
    if (token !== undefined) await this.repository.revokeSession(token)
  }

  /**
   * Resolve resource scope and authorize one asynchronous Host API operation.
   * @param principal - Authenticated caller.
   * @param endpoint - Closed Host API endpoint name.
   * @param input - Parsed request payload used only for resource addressing.
   * @returns the authorization decision and stable reason.
   */
  async authorizeApiAsync(principal: EnterprisePrincipal, endpoint: string, input: unknown): Promise<EnterpriseAuthorizationDecision> {
    if (endpoint === 'workspace.delete') return this.authorizeWorkspaceDelete(principal, input)
    if ((endpoint === 'session.create' || endpoint === 'sessions.create')
      && stringField(payloadOf(input), 'workspaceId') === undefined) {
      return { allowed: false, reason: 'insufficient-role' }
    }
    const classification = classifyApiEndpoint(endpoint, input)
    if (classification === undefined) return { allowed: false, reason: 'insufficient-role' }
    let resource: EnterpriseResource | undefined
    if (classification.resourceId !== undefined && classification.action !== 'employee.create') {
      resource = await this.repository.resourcePolicy(classification.resourceType, classification.resourceId)
      if (resource === undefined && this.resourcePolicyResolver !== undefined) {
        const resolved = await this.resourcePolicyResolver(classification.resourceType, classification.resourceId, principal)
        if (resolved === null) return { allowed: false, reason: 'resource-hidden' }
        resource = resolved
      }
      resource ??= { orgId: principal.orgId, visibility: 'organization' }
    }
    return authorizeEnterprise({ principal, action: classification.action, ...resource === undefined ? {} : { resource } })
  }

  /**
   * Project the native Workspace stream to the caller's personal and department grants.
   * Protected default and shared Workspaces explicitly carry `deletable: false`.
   * @param principal - authenticated stream owner.
   * @param frames - native Workspace baseline and increment stream.
   * @returns a principal-scoped Workspace stream.
   */
  async *filterWorkspaceFollow(
    principal: EnterprisePrincipal,
    frames: AsyncIterable<unknown>,
  ): AsyncIterable<unknown> {
    const visible = new Map((await this.repository.listWorkspaceGrants({
      orgId: principal.orgId, userId: principal.userId,
    })).map(grant => [grant.workspaceId, grant]))
    const deletable = this.deletableWorkspaceIds(principal, [...visible.values()])
    const emitted = new Set<string>()
    for await (const frame of frames) {
      if (!record(frame) || typeof frame['type'] !== 'string') continue
      if (frame['type'] === 'baseline') {
        const value = record(frame['value']) ? frame['value'] : {}
        const items = Array.isArray(value['items']) ? value['items'] : []
        const projected: Record<string, unknown>[] = []
        for (const item of items) {
          const workspace = workspaceRecord(item)
          if (workspace === undefined || !visible.has(workspace.workspaceId)) continue
          emitted.add(workspace.workspaceId)
          projected.push({
            ...workspace.value,
            sessionIds: await this.visibleSessionIds(
              principal,
              Array.isArray(workspace.value['sessionIds']) ? workspace.value['sessionIds'] : [],
              visible,
            ),
            deletable: deletable.has(workspace.workspaceId),
          })
        }
        yield {
          ...frame,
          value: {
            ...value,
            items: projected,
            archivedSessionIds: await this.visibleSessionIds(
              principal, Array.isArray(value['archivedSessionIds']) ? value['archivedSessionIds'] : [], visible,
            ),
          },
        }
        continue
      }
      if (frame['type'] === 'upsert') {
        const workspace = workspaceRecord(frame['workspace'])
        if (workspace === undefined) continue
        const grant = visible.get(workspace.workspaceId)
          ?? await this.waitForVisibleWorkspaceGrant(principal, workspace.workspaceId)
        if (grant === undefined) continue
        visible.set(workspace.workspaceId, grant)
        const currentDeletable = this.deletableWorkspaceIds(principal, [...visible.values()])
        emitted.add(workspace.workspaceId)
        yield {
          ...frame,
          workspace: {
            ...workspace.value,
            sessionIds: await this.visibleSessionIds(
              principal,
              Array.isArray(workspace.value['sessionIds']) ? workspace.value['sessionIds'] : [],
              visible,
            ),
            deletable: currentDeletable.has(workspace.workspaceId),
          },
        }
        continue
      }
      if (frame['type'] === 'remove') {
        const workspaceId = frame['workspaceId']
        if (typeof workspaceId !== 'string' || !emitted.delete(workspaceId)) continue
        yield frame
        continue
      }
      if (frame['type'] === 'order') {
        const workspaceIds = Array.isArray(frame['workspaceIds'])
          ? frame['workspaceIds'].filter((id): id is string => typeof id === 'string' && emitted.has(id))
          : []
        yield { ...frame, workspaceIds }
        continue
      }
      if (frame['type'] === 'archived') {
        yield {
          ...frame,
          archivedSessionIds: await this.visibleSessionIds(
            principal, Array.isArray(frame['archivedSessionIds']) ? frame['archivedSessionIds'] : [], visible,
          ),
        }
      }
    }
  }

  /**
   * Project a Session list to rows created by the authenticated user.
   * @param principal - authenticated user whose Session ownership is enforced.
   * @param value - untrusted Session-list projection returned by the Host.
   * @returns the projection with non-owned Session rows removed.
   */
  async filterSessionList(principal: EnterprisePrincipal, value: unknown): Promise<unknown> {
    if (!record(value)) return { items: [] }
    const items = Array.isArray(value['items']) ? value['items'] : []
    const visible: unknown[] = []
    for (const item of items) {
      if (!record(item) || typeof item['sessionId'] !== 'string') continue
      if (await this.sessionOwnedBy(principal, item['sessionId'])) visible.push(item)
    }
    return { ...value, items: visible }
  }

  /**
   * Project Host-wide queue, job, and projection frames to the current user's Sessions.
   * @param principal - authenticated user whose Session ownership is enforced.
   * @param frames - unfiltered Host control-frame stream.
   * @returns a stream containing only frames and Session slices the user owns.
   */
  async *filterSessionControl(
    principal: EnterprisePrincipal,
    frames: AsyncIterable<unknown>,
  ): AsyncIterable<unknown> {
    for await (const frame of frames) {
      if (!record(frame) || typeof frame['type'] !== 'string') continue
      if (frame['type'] === 'baseline') {
        const value = record(frame['value']) ? frame['value'] : {}
        const queues = record(value['queues']) ? value['queues'] : {}
        const jobs = record(value['jobs']) ? value['jobs'] : {}
        const projections = record(value['projections']) ? value['projections'] : {}
        const sessionIds = new Set([...Object.keys(queues), ...Object.keys(jobs), ...Object.keys(projections)])
        const visible = new Set<string>()
        for (const sessionId of sessionIds) {
          if (await this.sessionOwnedBy(principal, sessionId)) visible.add(sessionId)
        }
        const project = (source: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(
          Object.entries(source).filter(([sessionId]) => visible.has(sessionId)),
        )
        yield {
          ...frame,
          value: { ...value, queues: project(queues), jobs: project(jobs), projections: project(projections) },
        }
        continue
      }
      const sessionId = frame['sessionId']
      if (typeof sessionId === 'string' && await this.sessionOwnedBy(principal, sessionId)) yield frame
    }
  }

  /**
   * Decide whether one ordinary Session belongs to the authenticated user.
   * @param principal - authenticated user to compare with the Session owner.
   * @param sessionId - canonical Session identity.
   * @returns whether the Session is owned by that user.
   */
  async sessionOwnedBy(principal: EnterprisePrincipal, sessionId: string): Promise<boolean> {
    return await this.repository.sessionOwnerUserId(sessionId) === principal.userId
  }

  /**
   * Persist the ownership grant for a Workspace created through the native API.
   * @param principal - authenticated creator.
   * @param result - native Workspace create result.
   */
  async recordWorkspaceCreated(principal: EnterprisePrincipal, result: unknown): Promise<void> {
    if (!record(result) || result['created'] !== true) return
    const workspace = workspaceRecord(result['workspace'])
    if (workspace === undefined) throw new Error('enterprise Workspace creation returned an invalid projection')
    await this.repository.saveWorkspaceGrant({
      workspaceId: workspace.workspaceId,
      orgId: principal.orgId,
      name: typeof workspace.value['title'] === 'string' ? workspace.value['title'] : workspace.workspaceId,
      kind: 'personal', ownerUserId: principal.userId,
      rootPath: typeof workspace.value['path'] === 'string' ? workspace.value['path'] : '',
      sandboxMode: 'workspace-write', expectedRevision: 0,
    })
  }

  private async authorizeWorkspaceDelete(
    principal: EnterprisePrincipal,
    input: unknown,
  ): Promise<EnterpriseAuthorizationDecision> {
    const workspaceId = stringField(payloadOf(input), 'workspaceId')
    if (workspaceId === undefined) return { allowed: false, reason: 'insufficient-role' }
    const grants = await this.repository.listWorkspaceGrants({ orgId: principal.orgId, userId: principal.userId })
    return this.deletableWorkspaceIds(principal, grants).has(workspaceId)
      ? { allowed: true, reason: 'creator-owner' }
      : { allowed: false, reason: 'resource-hidden' }
  }

  private deletableWorkspaceIds(
    principal: EnterprisePrincipal,
    grants: readonly EnterpriseWorkspaceGrant[],
  ): Set<string> {
    const personal = grants.filter(grant => grant.kind === 'personal' && grant.ownerUserId === principal.userId)
      .toSorted((left, right) => left.createdAt - right.createdAt || left.workspaceId.localeCompare(right.workspaceId))
    return new Set(personal.slice(1).map(grant => grant.workspaceId))
  }

  private async visibleSessionIds(
    principal: EnterprisePrincipal,
    sessionIds: readonly unknown[],
    visibleWorkspaces: ReadonlyMap<string, EnterpriseWorkspaceGrant>,
  ): Promise<string[]> {
    const visible: string[] = []
    for (const sessionId of sessionIds) {
      if (typeof sessionId !== 'string') continue
      const grant = await this.repository.sessionWorkspaceGrant(sessionId)
      if (grant !== undefined && visibleWorkspaces.has(grant.workspaceId)
        && await this.sessionOwnedBy(principal, sessionId)) {
        visible.push(sessionId)
      }
    }
    return visible
  }

  private async waitForVisibleWorkspaceGrant(
    principal: EnterprisePrincipal,
    workspaceId: string,
  ): Promise<EnterpriseWorkspaceGrant | undefined> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const grant = (await this.repository.listWorkspaceGrants({
        orgId: principal.orgId, userId: principal.userId,
      })).find(candidate => candidate.workspaceId === workspaceId)
      if (grant !== undefined) return grant
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    return undefined
  }

  /**
   * Bind a Session to a workspace only after the principal can create work in that compartment.
   * @param principal - Authenticated Session creator.
   * @param sessionId - Newly created DSH Session id.
   * @param workspaceId - Authorized DSH Workspace id.
   */
  async bindSessionWorkspaceAsync(
    principal: EnterprisePrincipal,
    sessionId: string,
    workspaceId: string,
  ): Promise<void> {
    const decision = await this.authorizeApiAsync(principal, 'session.create', { workspaceId })
    if (!decision.allowed) throw new Error('enterprise session workspace binding is forbidden')
    await this.repository.bindSessionWorkspace({
      sessionId, workspaceId, orgId: principal.orgId, ownerUserId: principal.userId,
    })
  }

  /**
   * Resolve the durable sandbox mode a newly bound Session must snapshot.
   * @param principal - Authenticated Session creator.
   * @param workspaceId - Authorized DSH Workspace id.
   * @returns the grant's bounded sandbox mode.
   */
  async workspaceSandboxModeAsync(
    principal: EnterprisePrincipal,
    workspaceId: string,
  ): Promise<'read-only' | 'workspace-write'> {
    const decision = await this.authorizeApiAsync(principal, 'session.create', { workspaceId })
    if (!decision.allowed) throw new Error('enterprise workspace sandbox mode is forbidden')
    const grant = await this.repository.workspaceGrant(workspaceId)
    if (grant === undefined || grant.orgId !== principal.orgId) throw new Error('enterprise workspace is unavailable')
    return grant.sandboxMode
  }

  /**
   * Append one asynchronous Host API authorization decision to the audit sink.
   * @param principal - Authenticated caller.
   * @param endpoint - Closed Host API endpoint name.
   * @param input - Parsed request payload used only for resource addressing.
   * @param decision - Previously computed authorization decision.
   * @param correlationId - Request-scoped correlation identity.
   */
  async auditApiAsync(
    principal: EnterprisePrincipal,
    endpoint: string,
    input: unknown,
    decision: EnterpriseApiAuditDecision,
    correlationId: string,
  ): Promise<void> {
    const classification = classifyApiEndpoint(endpoint, input) ?? {
      action: 'api.unknown' as const, resourceType: 'api-endpoint', resourceId: endpoint,
    }
    await this.appendApiAudit(principal, endpoint, decision, correlationId, classification.action, {
      type: classification.resourceType, id: classification.resourceId ?? endpoint,
    })
  }

  /**
   * Append an API audit decision with a Host-resolved resource address.
   * @param principal - Authenticated caller.
   * @param endpoint - Closed Host API endpoint name used to classify the action.
   * @param input - Parsed request fields used only for action classification.
   * @param decision - Previously computed authorization decision.
   * @param correlationId - Request or operation correlation identity.
   * @param resource - Explicit resource type, identity, and safe details.
   */
  async auditApiResourceAsync(
    principal: EnterprisePrincipal,
    endpoint: string,
    input: unknown,
    decision: EnterpriseApiAuditDecision,
    correlationId: string,
    resource: EnterpriseApiAuditResource,
  ): Promise<void> {
    const action = classifyApiEndpoint(endpoint, input)?.action ?? 'api.unknown'
    await this.appendApiAudit(principal, endpoint, decision, correlationId, action, resource)
  }

  private async appendApiAudit(
    principal: EnterprisePrincipal,
    endpoint: string,
    decision: EnterpriseApiAuditDecision,
    correlationId: string,
    action: EnterpriseAction,
    resource: EnterpriseApiAuditResource,
  ): Promise<void> {
    await this.repository.appendAudit({
      id: this.randomId(), orgId: principal.orgId, actorUserId: principal.userId,
      action, resourceType: resource.type, resourceId: resource.id,
      decision: decision.allowed ? 'allowed' : 'denied', reason: decision.reason,
      correlationId, at: this.now(), details: { endpoint, ...resource.details },
    })
  }

  /**
   * Resolve resource scope and authorize one synchronous Host API operation.
   * @param principal - Authenticated caller.
   * @param endpoint - Closed Host API endpoint name.
   * @param input - Parsed request payload used only for resource addressing.
   * @returns the authorization decision and stable reason.
   */
  authorizeApi(principal: EnterprisePrincipal, endpoint: string, input: unknown): EnterpriseAuthorizationDecision {
    if ((endpoint === 'session.create' || endpoint === 'sessions.create')
      && stringField(payloadOf(input), 'workspaceId') === undefined) {
      return { allowed: false, reason: 'insufficient-role' }
    }
    const classification = classifyApiEndpoint(endpoint, input)
    if (classification === undefined) return { allowed: false, reason: 'insufficient-role' }
    let resource: EnterpriseResource | undefined
    if (classification.resourceId !== undefined) {
      resource = syncValue(this.repository.resourcePolicy(classification.resourceType, classification.resourceId), 'authorizeApi') ?? {
        orgId: principal.orgId,
        visibility: 'organization',
      }
    }
    return authorizeEnterprise({ principal, action: classification.action, ...resource === undefined ? {} : { resource } })
  }

  /**
   * Append one synchronous Host API authorization decision to the audit sink.
   * @param principal - Authenticated caller.
   * @param endpoint - Closed Host API endpoint name.
   * @param input - Parsed request payload used only for resource addressing.
   * @param decision - Previously computed authorization decision.
   * @param correlationId - Request-scoped correlation identity.
   */
  auditApi(
    principal: EnterprisePrincipal,
    endpoint: string,
    input: unknown,
    decision: EnterpriseAuthorizationDecision,
    correlationId: string,
  ): void {
    const classification = classifyApiEndpoint(endpoint, input) ?? {
      action: 'api.unknown' as const, resourceType: 'api-endpoint', resourceId: endpoint,
    }
    syncValue(this.repository.appendAudit({
      id: this.randomId(),
      orgId: principal.orgId,
      actorUserId: principal.userId,
      action: classification.action,
      resourceType: classification.resourceType,
      resourceId: classification.resourceId ?? endpoint,
      decision: decision.allowed ? 'allowed' : 'denied',
      reason: decision.reason,
      correlationId,
      at: this.now(),
      details: { endpoint },
    }), 'auditApi')
  }
}
