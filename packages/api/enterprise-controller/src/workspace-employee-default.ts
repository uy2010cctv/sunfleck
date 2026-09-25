/** Workspace-owned default employee policy; selection remains overridable by each member. */
import type { EnterprisePrincipal } from '@deepseek-ai/dsh-enterprise-governance'

/** Stored default; a null employee keeps the revision after clearing. */
export interface WorkspaceEmployeeDefault {
  readonly workspaceId: string
  readonly orgId: string
  readonly employeeId: string | null
  readonly revision: number
}

/** Caller-visible default with hidden or stale identities suppressed. */
export interface WorkspaceEmployeeDefaultView {
  readonly workspaceId: string
  readonly employeeId: string | null
  readonly revision: number
  readonly unavailable: boolean
  readonly manageable: boolean
}

/** Inputs needed to resolve and change one workspace default. */
export interface WorkspaceEmployeeDefaultDependencies {
  readonly grant: (workspaceId: string) => Promise<{
    workspaceId: string
    orgId: string
    kind: 'personal' | 'department'
    ownerUserId?: string
    departmentId?: string
  } | undefined>
  readonly mayUseWorkspace: (principal: EnterprisePrincipal, workspaceId: string) => Promise<boolean>
  readonly departmentManagers: (orgId: string, departmentId: string) => Promise<readonly string[]>
  readonly publishedEmployee: (employeeId: string, orgId: string) => Promise<{ presetId: string; orgId: string } | undefined>
  readonly mayUseEmployee: (principal: EnterprisePrincipal, employeeId: string) => Promise<boolean>
  readonly read: (workspaceId: string) => Promise<WorkspaceEmployeeDefault | undefined>
  readonly save: (input: WorkspaceEmployeeDefault & { expectedRevision: number }) => Promise<WorkspaceEmployeeDefault>
}

/** Applies workspace membership and employee visibility before exposing or changing a default. */
export class WorkspaceEmployeeDefaultService {
  constructor(private readonly deps: WorkspaceEmployeeDefaultDependencies) {}

  /** Read a caller-safe default, including its edit capability and CAS revision.
   * @param principal - Authenticated Workspace member.
   * @param workspaceId - Workspace whose default is requested.
   * @returns a visible choice or a suppressed unavailable choice.
   */
  async read(principal: EnterprisePrincipal, workspaceId: string): Promise<WorkspaceEmployeeDefaultView> {
    const grant = await this.authorizedGrant(principal, workspaceId)
    const row = await this.deps.read(workspaceId)
    const employeeId = row?.employeeId ?? null
    const available = employeeId === null || await this.employeeAvailable(principal, employeeId)
    return {
      workspaceId, employeeId: available ? employeeId : null, revision: row?.revision ?? 0,
      unavailable: !available, manageable: await this.canManage(principal, grant),
    }
  }

  /** Set or clear the selected employee with a revision check in the repository.
   * @param principal - Authenticated editor.
   * @param request - Workspace, employee choice, and expected revision.
   * @returns the saved caller-visible choice.
   */
  async save(principal: EnterprisePrincipal, request: {
    workspaceId: string
    employeeId: string | null
    expectedRevision: number
  }): Promise<WorkspaceEmployeeDefaultView> {
    const grant = await this.authorizedGrant(principal, request.workspaceId)
    if (!await this.canManage(principal, grant)) throw new Error('workspace default requires its owner or department manager')
    if (request.employeeId !== null && !await this.employeeAvailable(principal, request.employeeId)) {
      throw new Error('employee is not published or visible')
    }
    await this.deps.save({
      workspaceId: request.workspaceId, orgId: principal.orgId, employeeId: request.employeeId,
      expectedRevision: request.expectedRevision, revision: request.expectedRevision + 1,
    })
    return this.read(principal, request.workspaceId)
  }

  private async authorizedGrant(principal: EnterprisePrincipal, workspaceId: string): Promise<NonNullable<Awaited<ReturnType<WorkspaceEmployeeDefaultDependencies['grant']>>>> {
    const grant = await this.deps.grant(workspaceId)
    if (grant === undefined || grant.orgId !== principal.orgId || !await this.deps.mayUseWorkspace(principal, workspaceId)) {
      throw new Error('workspace is not available')
    }
    return grant
  }

  private async canManage(principal: EnterprisePrincipal, grant: NonNullable<Awaited<ReturnType<WorkspaceEmployeeDefaultDependencies['grant']>>>): Promise<boolean> {
    if (principal.roles.includes('administrator')) return true
    if (grant.kind === 'personal') return grant.ownerUserId === principal.userId
    return grant.departmentId !== undefined
      && (await this.deps.departmentManagers(principal.orgId, grant.departmentId)).includes(principal.userId)
  }

  private async employeeAvailable(principal: EnterprisePrincipal, employeeId: string): Promise<boolean> {
    const published = await this.deps.publishedEmployee(employeeId, principal.orgId)
    return published?.orgId === principal.orgId && await this.deps.mayUseEmployee(principal, employeeId)
  }
}
