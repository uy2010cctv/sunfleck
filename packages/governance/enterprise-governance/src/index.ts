/** Enterprise organization, role, visibility, deployment, and audit policy contracts. */

export type EnterpriseRole = 'administrator' | 'creator' | 'operator' | 'auditor' | 'member'

/** Allowed values for `EnterpriseAction`. */
export type EnterpriseAction =
  | 'api.unknown'
  | 'system.inspect'
  | 'user.manage'
  | 'employee.create'
  | 'employee.read'
  | 'employee.update'
  | 'employee.execute'
  | 'memory.read'
  | 'memory.manage'
  | 'capability.manage'
  | 'capability.read'
  | 'model.manage'
  | 'credential.manage'
  | 'audit.read'
  | 'session.read'
  | 'session.create'
  | 'workspace.manage'
  | 'channel.manage'
  | 'channel.read'
  | 'channel.execute'
  | 'operation.read'
  | 'operation.manage'
  | 'approval.manage'
  | 'approval.read'
  | 'schedule.manage'
  | 'schedule.read'
  | 'team.manage'
  | 'team.read'
  | 'team.execute'
  | 'team.decision.respond'
  | 'team.autonomy.manage'
  | 'device.read'
  | 'device.manage'
  | 'device.execute'
  | 'plugin.read'
  | 'plugin.create'
  | 'plugin.review'
  | 'plugin.publish'
  | 'plugin.manage'

/** Data used by `EnterprisePrincipal`. */
export interface EnterprisePrincipal {
  readonly actorType?: 'human' | 'employee'
  readonly userId: string
  readonly orgId: string
  readonly roles: readonly EnterpriseRole[]
  readonly departmentIds?: readonly string[]
  readonly managedDepartmentIds?: readonly string[]
  readonly employeeReleaseId?: string
}

/** Create the least-privileged principal used by one employee background run.
 * @param input - Immutable employee release and optional department assignment.
 * @returns A principal that cannot inherit human roles or managed departments.
 */
export function employeeServicePrincipal(input: {
  readonly orgId: string
  readonly employeeReleaseId: string
  readonly departmentId?: string
}): EnterprisePrincipal {
  return {
    actorType: 'employee', userId: `employee:${input.employeeReleaseId}`, orgId: input.orgId, roles: [],
    employeeReleaseId: input.employeeReleaseId,
    departmentIds: input.departmentId === undefined ? [] : [input.departmentId],
    managedDepartmentIds: [],
  }
}

/** Stable hierarchy scope attached to an enterprise resource. */
export type EnterpriseAccessScope =
  | { readonly type: 'organization' }
  | { readonly type: 'department'; readonly departmentId: string }
  | { readonly type: 'employee'; readonly employeeReleaseId: string; readonly departmentId?: string }
  | { readonly type: 'personal'; readonly userId: string }

/** Data used by `EnterpriseResource`. */
export interface EnterpriseResource {
  readonly orgId: string
  readonly scope?: EnterpriseAccessScope
  readonly creatorUserId?: string
  readonly visibility: 'organization' | 'private' | 'restricted'
  readonly allowedUserIds?: readonly string[]
}

/** Data used by `EnterpriseAuthorizationInput`. */
export interface EnterpriseAuthorizationInput {
  readonly principal: EnterprisePrincipal
  readonly action: EnterpriseAction
  readonly resource?: EnterpriseResource
}

/** Allowed values for `EnterpriseAuthorizationReason`. */
export type EnterpriseAuthorizationReason =
  | 'administrator'
  | 'auditor'
  | 'role'
  | 'creator-owner'
  | 'resource-visible'
  | 'department-member'
  | 'department-manager'
  | 'employee-service'
  | 'personal-owner'
  | 'organization-mismatch'
  | 'scope-mismatch'
  | 'resource-hidden'
  | 'insufficient-role'

/** Data used by `EnterpriseAuthorizationDecision`. */
export interface EnterpriseAuthorizationDecision {
  readonly allowed: boolean
  readonly reason: EnterpriseAuthorizationReason
}

function hasRole(principal: EnterprisePrincipal, role: EnterpriseRole): boolean {
  return principal.roles.includes(role)
}

function resourceVisible(principal: EnterprisePrincipal, resource: EnterpriseResource): boolean {
  if (resource.creatorUserId === principal.userId) return true
  switch (resource.visibility) {
    case 'organization': return true
    case 'private': return false
    case 'restricted': return resource.allowedUserIds?.includes(principal.userId) ?? false
  }
}

const SCOPED_READ_ACTIONS = new Set<EnterpriseAction>([
  'employee.read', 'employee.execute', 'memory.read', 'channel.read',
])
const DEPARTMENT_MANAGE_ACTIONS = new Set<EnterpriseAction>([
  'employee.update', 'memory.manage', 'channel.manage',
])

function authorizeScope(
  principal: EnterprisePrincipal,
  action: EnterpriseAction,
  resource: EnterpriseResource,
): EnterpriseAuthorizationDecision | undefined {
  const scope = resource.scope
  if (scope === undefined || scope.type === 'organization') return undefined
  if (scope.type === 'personal') {
    if (principal.actorType === 'employee' || principal.userId !== scope.userId) {
      return { allowed: false, reason: 'scope-mismatch' }
    }
    return action === 'memory.read' || action === 'memory.manage'
      ? { allowed: true, reason: 'personal-owner' }
      : undefined
  }
  if (scope.type === 'department') {
    if (principal.managedDepartmentIds?.includes(scope.departmentId) === true
      && DEPARTMENT_MANAGE_ACTIONS.has(action)) {
      return { allowed: true, reason: 'department-manager' }
    }
    if (principal.departmentIds?.includes(scope.departmentId) === true && SCOPED_READ_ACTIONS.has(action)) {
      return resourceVisible(principal, resource)
        ? { allowed: true, reason: 'department-member' }
        : { allowed: false, reason: 'resource-hidden' }
    }
    return { allowed: false, reason: 'scope-mismatch' }
  }
  if (principal.actorType === 'employee' && principal.employeeReleaseId === scope.employeeReleaseId) {
    return action === 'employee.execute' || action === 'channel.execute' || action === 'memory.read'
      ? { allowed: true, reason: 'employee-service' }
      : { allowed: false, reason: 'insufficient-role' }
  }
  if (principal.actorType === 'employee') return { allowed: false, reason: 'scope-mismatch' }
  if (resource.creatorUserId === principal.userId) return undefined
  if (scope.departmentId !== undefined) {
    if (principal.managedDepartmentIds?.includes(scope.departmentId) === true
      && DEPARTMENT_MANAGE_ACTIONS.has(action)) {
      return { allowed: true, reason: 'department-manager' }
    }
    if (principal.departmentIds?.includes(scope.departmentId) !== true) {
      return { allowed: false, reason: 'scope-mismatch' }
    }
  }
  return undefined
}

/** Authorize one enterprise action; organization mismatch always wins over role.
 * @param input - Input value used by this API.
 * @returns Result produced by this API.
 */
export function authorizeEnterprise(input: EnterpriseAuthorizationInput): EnterpriseAuthorizationDecision {
  const { principal, action, resource } = input
  if (resource !== undefined && resource.orgId !== principal.orgId) {
    return { allowed: false, reason: 'organization-mismatch' }
  }
  if (principal.actorType === 'employee' && resource === undefined) {
    return { allowed: false, reason: 'insufficient-role' }
  }
  if (hasRole(principal, 'administrator')) return { allowed: true, reason: 'administrator' }
  if (resource !== undefined) {
    const scopeDecision = authorizeScope(principal, action, resource)
    if (scopeDecision !== undefined) return scopeDecision
  }

  if ((action === 'device.read' || action === 'device.manage') && resource === undefined
    && principal.roles.some(role => role === 'creator' || role === 'operator' || role === 'member')) {
    return { allowed: true, reason: 'role' }
  }

  if (hasRole(principal, 'auditor')) {
    return action === 'audit.read' || action === 'employee.read' || action === 'session.read' || action === 'operation.read'
      || action === 'capability.read' || action === 'approval.read' || action === 'schedule.read' || action === 'team.read'
      || action === 'plugin.read'
      ? { allowed: true, reason: 'auditor' }
      : { allowed: false, reason: 'insufficient-role' }
  }

  if (hasRole(principal, 'operator') && (action === 'operation.manage' || action === 'approval.manage' || action === 'schedule.manage')) {
    return { allowed: true, reason: 'role' }
  }
  if (hasRole(principal, 'operator') && action === 'team.execute') {
    return { allowed: true, reason: 'role' }
  }
  if (hasRole(principal, 'creator') && (action === 'team.manage' || action === 'schedule.manage' || action === 'capability.manage')) {
    return { allowed: true, reason: 'role' }
  }
  if (hasRole(principal, 'creator') && action === 'team.execute') {
    return { allowed: true, reason: 'role' }
  }

  if (action === 'employee.create' && hasRole(principal, 'creator')) {
    return { allowed: true, reason: 'role' }
  }
  if (action === 'plugin.read' || action === 'plugin.create' || action === 'plugin.review' || action === 'plugin.publish') {
    const canCompose = principal.roles.some(role => role === 'creator' || role === 'operator' || role === 'member')
    return canCompose ? { allowed: true, reason: 'role' } : { allowed: false, reason: 'insufficient-role' }
  }
  if (action === 'employee.update' && hasRole(principal, 'creator')
    && resource?.creatorUserId === principal.userId) {
    return { allowed: true, reason: 'creator-owner' }
  }
  if (action === 'workspace.manage' && resource?.creatorUserId === principal.userId) {
    return { allowed: true, reason: 'creator-owner' }
  }
  if (action === 'team.execute'
    && resource?.creatorUserId === principal.userId) {
    return { allowed: true, reason: 'creator-owner' }
  }
  if ((action === 'device.read' || action === 'device.manage' || action === 'device.execute')
    && resource?.creatorUserId === principal.userId) {
    return { allowed: true, reason: 'creator-owner' }
  }

  if (action === 'employee.read' || action === 'employee.execute' || action === 'memory.read'
    || action === 'channel.read' || action === 'session.read' || action === 'session.create'
    || action === 'capability.read' || action === 'approval.read' || action === 'schedule.read' || action === 'team.read') {
    const canOperate = principal.roles.some(role => role === 'creator' || role === 'operator' || role === 'member')
    if (!canOperate) return { allowed: false, reason: 'insufficient-role' }
    if (resource === undefined || resourceVisible(principal, resource)) {
      return { allowed: true, reason: 'resource-visible' }
    }
    return { allowed: false, reason: 'resource-hidden' }
  }

  return { allowed: false, reason: 'insufficient-role' }
}

/** Allowed values for `EnterpriseDeploymentMode`. */
export type EnterpriseDeploymentMode = 'desktop' | 'lan' | 'public'
/** Allowed values for `EnterpriseDeploymentIssue`. */
export type EnterpriseDeploymentIssue =
  | 'identity-provider-required'
  | 'rbac-required'
  | 'encrypted-credentials-required'
  | 'audit-sink-required'
  | 'tls-required'
  | 'single-port-required'

/** Data used by `EnterpriseDeploymentInput`. */
export interface EnterpriseDeploymentInput {
  readonly mode: EnterpriseDeploymentMode
  readonly authenticatedIdentity: boolean
  readonly rbac: boolean
  readonly encryptedCredentials: boolean
  readonly auditLog: boolean
  readonly tls: boolean
  readonly singlePort: boolean
}

/** Data used by `EnterpriseDeploymentReadiness`. */
export interface EnterpriseDeploymentReadiness {
  readonly ready: boolean
  readonly issues: readonly EnterpriseDeploymentIssue[]
}

/** Evaluate explicit deployment evidence instead of treating intranet reachability as security.
 * @param input - Input value used by this API.
 * @returns Result produced by this API.
 */
export function deploymentReadiness(input: EnterpriseDeploymentInput): EnterpriseDeploymentReadiness {
  const issues: EnterpriseDeploymentIssue[] = []
  if (input.mode !== 'desktop') {
    if (!input.authenticatedIdentity) issues.push('identity-provider-required')
    if (!input.rbac) issues.push('rbac-required')
  }
  if (!input.encryptedCredentials) issues.push('encrypted-credentials-required')
  if (!input.auditLog) issues.push('audit-sink-required')
  if (input.mode === 'public' && !input.tls) issues.push('tls-required')
  if (!input.singlePort) issues.push('single-port-required')
  return { ready: issues.length === 0, issues }
}

/** Data used by `GovernanceAuditInput`. */
export interface GovernanceAuditInput {
  readonly orgId: string
  readonly actorUserId: string
  readonly action: EnterpriseAction
  readonly resourceType: string
  readonly resourceId: string
  readonly decision: 'allowed' | 'denied'
  readonly reason: EnterpriseAuthorizationReason
  readonly correlationId: string
  readonly at: number
}

/** Data used by `GovernanceAuditEvent`. */
export interface GovernanceAuditEvent extends GovernanceAuditInput {
  readonly type: 'governance/action'
}

/** Create an attributable governance decision record with no free-form or secret payload field.
 * @param input - Input value used by this API.
 * @returns Result produced by this API.
 */
export function governanceAuditEvent(input: GovernanceAuditInput): GovernanceAuditEvent {
  return { type: 'governance/action', ...input }
}
