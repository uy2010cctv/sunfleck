/** Enterprise authentication, API classification, authorization, and audit. */

import { randomBytes, randomUUID } from 'node:crypto'
import type {
  EnterpriseAction, EnterpriseAuthorizationDecision, EnterprisePrincipal, EnterpriseResource,
} from '@deepseek-ai/dsh-enterprise-governance'
import { authorizeEnterprise } from '@deepseek-ai/dsh-enterprise-governance'
import {
  type EnterpriseIdentityRepository,
  type EnterprisePrincipalView,
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
}

export interface ApiClassification {
  readonly action: EnterpriseAction
  readonly resourceType: string
  readonly resourceId?: string
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

const SESSION_READ = new Set([
  'host.describe', 'host.listDirectory', 'events.mux', 'events.host',
  'session.list', 'session.search', 'session.history', 'session.models', 'session.attachment',
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
  if (endpoint.startsWith('enterpriseAdmin.')) return { action: 'user.manage', resourceType: 'enterprise-admin' }
  if (endpoint === 'enterpriseAudit.list') return { action: 'audit.read', resourceType: 'audit' }
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

  constructor(
    readonly repository: EnterpriseIdentityRepository,
    readonly config: EnterpriseSecurityConfig,
    options: EnterpriseSecurityOptions = {},
  ) {
    this.now = options.now ?? Date.now
    this.randomToken = options.randomToken ?? (() => randomBytes(32).toString('base64url'))
    this.randomId = options.randomId ?? randomUUID
  }

  loginLocal(orgId: string, username: string, password: string): LoginResult | undefined {
    const record = this.repository.passwordLoginRecord(orgId, username)
    if (record === undefined || record.disabled || !verifyPassword(password, record.verifier)) return undefined
    return this.issueSession(record.userId)
  }

  issueSession(userId: string): LoginResult {
    const user = this.repository.listUsers(this.config.organizationId).find(candidate => candidate.id === userId)
    if (user === undefined || user.disabled) throw new Error('enterprise session user is unavailable')
    const token = this.randomToken()
    this.repository.createSession({ token, userId, expiresAt: this.now() + this.config.sessionTtlMs })
    const principal = this.repository.authenticateSession(token)
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

  loginExternal(identity: SsoMappedIdentity): LoginResult {
    if (identity.organizationId !== this.config.organizationId) {
      throw new Error('SSO identity belongs to a different enterprise organization')
    }
    let user = this.repository.resolveExternalIdentity(identity.providerId, identity.subject)
    if (user === undefined) {
      if (!this.config.autoProvisionSsoUsers) throw new Error('SSO identity is not bound to an enterprise user')
      if (this.repository.findUser(identity.organizationId, identity.username) !== undefined) {
        throw new Error('SSO username already belongs to an unbound enterprise user')
      }
      const userId = this.randomId()
      this.repository.createUser({
        id: userId,
        orgId: identity.organizationId,
        username: identity.username,
        displayName: identity.displayName,
        disabled: false,
      })
      this.repository.setRoles(userId, identity.roles)
      this.repository.bindExternalIdentity({ providerId: identity.providerId, subject: identity.subject, userId })
      user = this.repository.resolveExternalIdentity(identity.providerId, identity.subject)
    } else {
      this.repository.setRoles(user.id, identity.roles)
    }
    if (user === undefined || user.disabled) throw new Error('SSO enterprise user is unavailable')
    return this.issueSession(user.id)
  }

  authenticateCookie(cookieHeader: string): EnterprisePrincipalView | undefined {
    const token = parseSessionCookie(cookieHeader, this.config.sessionCookieName)
    return token === undefined ? undefined : this.repository.authenticateSession(token)
  }

  logout(cookieHeader: string): void {
    const token = parseSessionCookie(cookieHeader, this.config.sessionCookieName)
    if (token !== undefined) this.repository.revokeSession(token)
  }

  authorizeApi(principal: EnterprisePrincipal, endpoint: string, input: unknown): EnterpriseAuthorizationDecision {
    const classification = classifyApiEndpoint(endpoint, input)
    if (classification === undefined) return { allowed: false, reason: 'insufficient-role' }
    let resource: EnterpriseResource | undefined
    if (classification.resourceId !== undefined) {
      resource = this.repository.resourcePolicy(classification.resourceType, classification.resourceId) ?? {
        orgId: principal.orgId,
        visibility: 'organization',
      }
    }
    return authorizeEnterprise({ principal, action: classification.action, ...resource === undefined ? {} : { resource } })
  }

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
    this.repository.appendAudit({
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
    })
  }
}
