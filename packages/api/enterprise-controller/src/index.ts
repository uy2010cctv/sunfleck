/** Authenticated enterprise Typert Remote controllers. */
import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteFailure, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { EnterprisePrincipal } from '@deepseek-ai/dsh-enterprise-governance'
import type {} from '@deepseek-ai/dsh-enterprise-auth-web'
import type {} from '@deepseek-ai/dsh-enterprise-postgres'
import {
  EmployeeDraftRevisionConflictError,
  EnterpriseCatalogError,
} from '@deepseek-ai/dsh-enterprise-catalog'
import {
  ApprovalRevisionConflictError,
  EnterpriseOperationsAuthorizationError,
  EnterpriseOperationsError,
  EnterpriseOperationsService,
} from '@deepseek-ai/dsh-enterprise-operations'
import {
  EnterpriseCordisError,
  EnterpriseCordisService,
} from '@deepseek-ai/dsh-enterprise-cordis'
import type {
  CordisPackageVersion,
  CordisReviewRequest,
  CordisScopeBinding,
  CordisSessionGeneration,
  CordisWorkspaceProjection,
  DepartmentManagerSet,
  DerivedCordisPackage,
  PublishedCordisReview,
} from '@deepseek-ai/dsh-enterprise-cordis/types'
import type {
  EnterpriseEmployeeDraft,
  EnterpriseEmployeeListRequest,
  EnterpriseEmployeeLookup,
  EnterpriseEmployeePage,
  EnterpriseEmployeePublishRequest,
  EnterpriseEmployeeRelease,
  EnterpriseEmployeeRollbackRequest,
  EnterpriseEmployeeSaveRequest,
} from './contract/employees.ts'
import type {
  EnterpriseAsset,
  EnterpriseAssetArchiveRequest,
  EnterpriseAssetListRequest,
  EnterpriseAssetLookup,
  EnterpriseAssetPage,
  EnterpriseAssetSaveRequest,
  EnterpriseAssetVersion,
} from './contract/assets.ts'
import type {
  EnterpriseTeam,
  EnterpriseTeamListRequest,
  EnterpriseTeamLookup,
  EnterpriseTeamPage,
  EnterpriseTeamSaveRequest,
} from './contract/teams.ts'
import type {
  EnterpriseApproval,
  EnterpriseApprovalCancelRequest,
  EnterpriseApprovalCreateRequest,
  EnterpriseApprovalListRequest,
  EnterpriseApprovalLookup,
  EnterpriseApprovalTransitionRequest,
  EnterprisePage,
  EnterpriseSchedule,
  EnterpriseScheduleListRequest,
  EnterpriseScheduleLookup,
  EnterpriseScheduleSaveRequest,
  EnterpriseScheduleTransitionRequest,
  EnterpriseWorkRecord,
  EnterpriseWorkRecordListRequest,
  EnterpriseWorkRecordLookup,
  EnterpriseWorkRecordUpdateRequest,
} from './contract/operations.ts'
import type {
  CordisDepartmentManagersRequest,
  CordisDepartmentManagersSaveRequest,
  CordisGovernanceDisableRequest,
  CordisGovernanceSetTrustRequest,
  CordisReviewDeriveRequest,
  CordisReviewListRequest,
  CordisReviewPublishRequest,
  CordisReviewSubmitRequest,
  CordisReviewTransitionRequest,
  CordisWorkspaceActivateRequest,
  CordisWorkspacePinGenerationRequest,
  CordisWorkspaceRollbackRequest,
  CordisWorkspaceStopRequest,
  CordisWorkspaceListRequest,
  CordisWorkspaceSaveRequest,
} from './contract/cordis.ts'

export type * from './contract/index.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Enterprise employee Remote namespace owner. */
    enterpriseEmployeeController: EnterpriseEmployeeController
    /** Enterprise capability-asset Remote namespace owner. */
    enterpriseAssetController: EnterpriseAssetController
    /** Enterprise fixed-team Remote namespace owner. */
    enterpriseTeamController: EnterpriseTeamController
    /** Enterprise operations Remote namespace owner. */
    enterpriseOperationController: EnterpriseOperationController
    /** Enterprise Cordis Workspace extension Remote namespace owner. */
    cordisWorkspaceController: CordisWorkspaceController
    /** Enterprise Cordis review and publication Remote namespace owner. */
    cordisReviewController: CordisReviewController
    /** Enterprise Cordis governance Remote namespace owner. */
    cordisGovernanceController: CordisGovernanceController
  }
}

/** Resolve the request-scoped authenticated enterprise principal. */
function principal(ctx: Context): EnterprisePrincipal {
  return ctx.enterpriseRequestContext.requirePrincipal()
}

/** Authorize and audit one enterprise catalog operation. */
async function catalogCall<T>(
  ctx: Context,
  endpoint: string,
  input: unknown,
  resourceType: string,
  resourceId: string,
  operation: (principal: EnterprisePrincipal) => Promise<T>,
): Promise<T> {
  const actor = principal(ctx)
  const decision = await ctx.enterpriseSecurity.authorizeApiAsync(actor, endpoint, input)
  await ctx.enterpriseSecurity.auditApiAsync(actor, endpoint, input, decision, randomUUID())
  if (!decision.allowed) throw enterpriseFailure(new EnterpriseOperationsAuthorizationError(
    'insufficient-role', endpoint as never,
  ), endpoint, resourceType, resourceId)
  try {
    return await operation(actor)
  } catch (error) {
    throw enterpriseFailure(error, endpoint, resourceType, resourceId)
  }
}

/** Build the enterprise operations service over the shared PostgreSQL composition. */
function operations(ctx: Context): EnterpriseOperationsService {
  return new EnterpriseOperationsService(ctx.enterprisePostgres.operations, {
    authorize: (actor, endpoint, input) => ctx.enterpriseSecurity.authorizeApiAsync(actor, endpoint, input),
    audit: (event) => {
      const field = event.resourceType === 'work-record' ? 'sessionId'
        : event.resourceType === 'approval' ? 'approvalId'
          : event.resourceType === 'schedule' ? 'scheduleId'
            : event.resourceType === 'fixed-team' ? 'teamId' : 'commandId'
      const input = event.resourceId === undefined ? {} : { [field]: event.resourceId }
      return ctx.enterpriseSecurity.auditApiAsync(
        event.principal, event.endpoint, input,
        event.decision.allowed
          ? { allowed: true, reason: 'role' }
          : { allowed: false, reason: 'insufficient-role' },
        event.correlationId,
      )
    },
  })
}

function cordis(ctx: Context): EnterpriseCordisService {
  return ctx.enterpriseCordis
}

/** Employee Draft/Release Remote service. */
export class EnterpriseEmployeeController extends TypertRemoteService {
  static inject = ['enterprisePostgres', 'enterpriseSecurity', 'enterpriseRequestContext']
  /** @param ctx - authenticated enterprise Host context. */
  constructor(ctx: Context) { super(ctx, 'enterpriseEmployeeController', { namespace: 'enterpriseEmployee' }) }

  /**
   * Execute one authenticated enterprise operation.
   * @param request - page filters.
   * @returns visible employee Draft page.
   */
  @Remote('list')
  async list(request: EnterpriseEmployeeListRequest): Promise<EnterpriseEmployeePage> {
    return catalogCall(this.ctx, 'enterpriseEmployee.list', request, 'employee', 'catalog', async (principal) => {
      const page = await this.ctx.enterprisePostgres.catalog.listDrafts({
        ...request, orgId: principal.orgId,
        ...(principal.roles.includes('administrator')
          ? { includeAllVisible: true }
          : { viewerUserId: principal.userId }),
      })
      return page as EnterpriseEmployeePage
    })
  }

  /**
   * Execute one authenticated enterprise operation.
   * @param request - employee identity.
   * @returns current mutable Draft.
   */
  @Remote('getDraft')
  async getDraft(request: EnterpriseEmployeeLookup): Promise<EnterpriseEmployeeDraft> {
    return catalogCall(this.ctx, 'enterpriseEmployee.getDraft', request, 'employee', request.presetId, async (principal) => {
      const value = await this.ctx.enterprisePostgres.catalog.getDraft(request.presetId, principal.orgId)
      if (value === undefined) throw new EnterpriseCatalogError('not-found', 'employee', request.presetId)
      return value as EnterpriseEmployeeDraft
    })
  }

  /**
   * Execute one authenticated enterprise operation.
   * @param request - Draft snapshot and CAS revision.
   * @returns saved Draft.
   */
  @Remote('saveDraft')
  async saveDraft(request: EnterpriseEmployeeSaveRequest): Promise<EnterpriseEmployeeDraft> {
    return catalogCall(this.ctx, 'enterpriseEmployee.saveDraft', request, 'employee', request.presetId, async (principal) => {
      const ownerUserId = request.expectedRevision === 0
        ? principal.userId
        : (await this.ctx.enterprisePostgres.catalog.getDraft(request.presetId, principal.orgId))?.ownerUserId
      if (ownerUserId === undefined) throw new EnterpriseCatalogError('not-found', 'employee', request.presetId)
      return this.ctx.enterprisePostgres.catalog.saveDraft({
        ...request, orgId: principal.orgId, ownerUserId,
      }) as Promise<EnterpriseEmployeeDraft>
    })
  }

  /**
   * Execute one authenticated enterprise operation.
   * @param request - Draft identity and CAS revision.
   * @returns immutable Release.
   */
  @Remote('publish')
  async publish(request: EnterpriseEmployeePublishRequest): Promise<EnterpriseEmployeeRelease> {
    return catalogCall(this.ctx, 'enterpriseEmployee.publish', request, 'employee', request.presetId, principal =>
      this.ctx.enterprisePostgres.catalog.publishDraft({
        ...request, orgId: principal.orgId, publishedBy: principal.userId,
      }) as Promise<EnterpriseEmployeeRelease>)
  }

  /**
   * Execute one authenticated enterprise operation.
   * @param request - employee identity.
   * @returns immutable Release history.
   */
  @Remote('listReleases')
  async listReleases(request: EnterpriseEmployeeLookup): Promise<readonly EnterpriseEmployeeRelease[]> {
    return catalogCall(this.ctx, 'enterpriseEmployee.listReleases', request, 'employee', request.presetId, principal =>
      this.ctx.enterprisePostgres.catalog.listReleases(request.presetId, principal.orgId) as
        Promise<readonly EnterpriseEmployeeRelease[]>)
  }

  /**
   * Execute one authenticated enterprise operation.
   * @param request - source Release and target Draft CAS revision.
   * @returns rollback Release.
   */
  @Remote('rollback')
  async rollback(request: EnterpriseEmployeeRollbackRequest): Promise<EnterpriseEmployeeRelease> {
    return catalogCall(this.ctx, 'enterpriseEmployee.rollback', request, 'employee', request.presetId, principal =>
      this.ctx.enterprisePostgres.catalog.rollbackRelease({
        ...request, orgId: principal.orgId, publishedBy: principal.userId,
      }) as Promise<EnterpriseEmployeeRelease>)
  }
}

/** Capability asset Remote service. */
export class EnterpriseAssetController extends TypertRemoteService {
  static inject = ['enterprisePostgres', 'enterpriseSecurity', 'enterpriseRequestContext']
  /** @param ctx - authenticated enterprise Host context. */
  constructor(ctx: Context) { super(ctx, 'enterpriseAssetController', { namespace: 'enterpriseAsset' }) }

  /**
   * Execute one authenticated enterprise operation.
   * @param request - asset page filters.
   * @returns visible asset page.
   */
  @Remote('list')
  async list(request: EnterpriseAssetListRequest): Promise<EnterpriseAssetPage> {
    return catalogCall(this.ctx, 'enterpriseAsset.list', request, 'asset', 'catalog', principal =>
      this.ctx.enterprisePostgres.catalog.listAssets({ ...request, orgId: principal.orgId }) as
        Promise<EnterpriseAssetPage>)
  }

  /**
   * Execute one authenticated enterprise operation.
   * @param request - asset identity.
   * @returns current asset row.
   */
  @Remote('get')
  async get(request: EnterpriseAssetLookup): Promise<EnterpriseAsset> {
    return catalogCall(this.ctx, 'enterpriseAsset.get', request, 'asset', request.assetId, async (principal) => {
      const value = await this.ctx.enterprisePostgres.catalog.getAsset(principal.orgId, request.assetId)
      if (value === undefined) throw new EnterpriseCatalogError('not-found', 'asset', request.assetId)
      return value
    })
  }

  /**
   * Execute one authenticated enterprise operation.
   * @param request - new immutable asset content and CAS revision.
   * @returns created version.
   */
  @Remote('saveVersion')
  async saveVersion(request: EnterpriseAssetSaveRequest): Promise<EnterpriseAssetVersion> {
    return catalogCall(this.ctx, 'enterpriseAsset.saveVersion', request, 'asset', request.assetId, principal =>
      this.ctx.enterprisePostgres.catalog.saveAssetVersion({
        ...request, orgId: principal.orgId, createdBy: principal.userId,
      }) as Promise<EnterpriseAssetVersion>)
  }

  /**
   * Execute one authenticated enterprise operation.
   * @param request - asset identity.
   * @returns immutable version history.
   */
  @Remote('listVersions')
  async listVersions(request: EnterpriseAssetLookup): Promise<readonly EnterpriseAssetVersion[]> {
    return catalogCall(this.ctx, 'enterpriseAsset.listVersions', request, 'asset', request.assetId, principal =>
      this.ctx.enterprisePostgres.catalog.listAssetVersions(principal.orgId, request.assetId) as
        Promise<readonly EnterpriseAssetVersion[]>)
  }

  /**
   * Execute one authenticated enterprise operation.
   * @param request - asset identity and CAS revision.
   * @returns archived asset row.
   */
  @Remote('archive')
  async archive(request: EnterpriseAssetArchiveRequest): Promise<EnterpriseAsset> {
    return catalogCall(this.ctx, 'enterpriseAsset.archive', request, 'asset', request.assetId, principal =>
      this.ctx.enterprisePostgres.catalog.archiveAsset(
        principal.orgId, request.assetId, request.expectedRevision, request.idempotencyKey,
      ) as Promise<EnterpriseAsset>)
  }
}

/** Fixed team Remote service. */
export class EnterpriseTeamController extends TypertRemoteService {
  static inject = ['enterprisePostgres', 'enterpriseSecurity', 'enterpriseRequestContext']
  /** @param ctx - authenticated enterprise Host context. */
  constructor(ctx: Context) { super(ctx, 'enterpriseTeamController', { namespace: 'enterpriseTeam' }) }

  /**
   * Execute one authenticated enterprise operation.
   * @param request - page cursor and size.
   * @returns visible team page.
   */
  @Remote('list')
  async list(request: EnterpriseTeamListRequest): Promise<EnterpriseTeamPage> {
    return this.runOperations('enterpriseTeam.list', 'team', 'catalog', () =>
      operations(this.ctx).listFixedTeams(principal(this.ctx), request) as Promise<EnterpriseTeamPage>)
  }

  /**
   * Execute one authenticated enterprise operation.
   * @param request - team identity.
   * @returns current team.
   */
  @Remote('get')
  async get(request: EnterpriseTeamLookup): Promise<EnterpriseTeam> {
    return this.runOperations('enterpriseTeam.get', 'team', request.teamId, async () => {
      const value = await operations(this.ctx).getFixedTeam(principal(this.ctx), request)
      if (value === undefined) throw new Error('enterprise team not found')
      return value as EnterpriseTeam
    })
  }

  /**
   * Execute one authenticated enterprise operation.
   * @param request - team composition and CAS revision.
   * @returns saved team.
   */
  @Remote('save')
  async save(request: EnterpriseTeamSaveRequest): Promise<EnterpriseTeam> {
    return this.runOperations('enterpriseTeam.save', 'team', request.teamId, () =>
      operations(this.ctx).saveFixedTeam(principal(this.ctx), request) as Promise<EnterpriseTeam>)
  }

  private async runOperations<T>(
    endpoint: string, resourceType: string, resourceId: string, operation: () => Promise<T>,
  ): Promise<T> {
    try { return await operation() }
    catch (error) { throw enterpriseFailure(error, endpoint, resourceType, resourceId) }
  }
}

/** Work record, approval, and schedule Remote service. */
export class EnterpriseOperationController extends TypertRemoteService {
  static inject = ['enterprisePostgres', 'enterpriseSecurity', 'enterpriseRequestContext']
  /** @param ctx - authenticated enterprise Host context. */
  constructor(ctx: Context) { super(ctx, 'enterpriseOperationController', { namespace: 'enterpriseOperation' }) }

  /**
   * Execute one authenticated enterprise operation.
   * @param request - work-record page filters.
   * @returns visible work-record page.
   */
  @Remote('listWorkRecords') async listWorkRecords(request: EnterpriseWorkRecordListRequest): Promise<EnterprisePage<EnterpriseWorkRecord>> {
    return this.run('enterpriseOperation.workRecords.list', 'work-record', 'catalog', () =>
      operations(this.ctx).listWorkRecords(principal(this.ctx), request) as Promise<EnterprisePage<EnterpriseWorkRecord>>)
  }
  /**
   * Execute one authenticated enterprise operation.
   * @param request - composite work-record identity.
   * @returns current work record.
   */
  @Remote('getWorkRecord') async getWorkRecord(request: EnterpriseWorkRecordLookup): Promise<EnterpriseWorkRecord> {
    return this.run('enterpriseOperation.workRecords.get', 'work-record', request.sessionId, async () => {
      const value = await operations(this.ctx).getWorkRecord(principal(this.ctx), request)
      if (value === undefined) throw new Error('enterprise work record not found')
      return value as EnterpriseWorkRecord
    })
  }
  /**
   * Execute one authenticated enterprise operation.
   * @param request - work-record state and CAS revision.
   * @returns saved work record.
   */
  @Remote('updateWorkRecord') async updateWorkRecord(request: EnterpriseWorkRecordUpdateRequest): Promise<EnterpriseWorkRecord> {
    return this.run('enterpriseOperation.workRecords.update', 'work-record', request.sessionId, () =>
      operations(this.ctx).upsertWorkRecord(principal(this.ctx), request) as Promise<EnterpriseWorkRecord>)
  }
  /**
   * Execute one authenticated enterprise operation.
   * @param request - approval page filters.
   * @returns visible approval page.
   */
  @Remote('listApprovals') async listApprovals(request: EnterpriseApprovalListRequest): Promise<EnterprisePage<EnterpriseApproval>> {
    return this.run('enterpriseOperation.approvals.list', 'approval', 'catalog', () =>
      operations(this.ctx).listApprovals(principal(this.ctx), request) as Promise<EnterprisePage<EnterpriseApproval>>)
  }
  /**
   * Execute one authenticated enterprise operation.
   * @param request - approval identity.
   * @returns current approval.
   */
  @Remote('getApproval') async getApproval(request: EnterpriseApprovalLookup): Promise<EnterpriseApproval> {
    return this.run('enterpriseOperation.approvals.get', 'approval', request.approvalId, async () => {
      const value = await operations(this.ctx).getApproval(principal(this.ctx), request)
      if (value === undefined) throw new Error('enterprise approval not found')
      return value
    })
  }
  /**
   * Execute one authenticated enterprise operation.
   * @param request - new approval request.
   * @returns created approval.
   */
  @Remote('createApproval') async createApproval(request: EnterpriseApprovalCreateRequest): Promise<EnterpriseApproval> {
    if (request.expectedRevision !== 0) throw enterpriseFailure(new Error('revision conflict'), 'enterpriseOperation.approvals.create', 'approval', request.approvalId)
    const { expectedRevision: _ignored, ...input } = request
    return this.run('enterpriseOperation.approvals.create', 'approval', request.approvalId, () =>
      operations(this.ctx).createApprovalRequest(principal(this.ctx), {
        ...input, requestedBy: principal(this.ctx).userId,
      }) as Promise<EnterpriseApproval>)
  }
  /**
   * Execute one authenticated enterprise operation.
   * @param request - approval decision and CAS revision.
   * @returns transitioned approval.
   */
  @Remote('transitionApproval') async transitionApproval(request: EnterpriseApprovalTransitionRequest): Promise<EnterpriseApproval> {
    return this.run('enterpriseOperation.approvals.transition', 'approval', request.approvalId, () =>
      operations(this.ctx).transitionApproval(principal(this.ctx), {
        ...request, reviewerUserId: principal(this.ctx).userId,
      }) as Promise<EnterpriseApproval>)
  }
  /**
   * Execute one authenticated enterprise operation.
   * @param request - cancellation reason and CAS revision.
   * @returns cancelled approval.
   */
  @Remote('cancelApproval') async cancelApproval(request: EnterpriseApprovalCancelRequest): Promise<EnterpriseApproval> {
    return this.run('enterpriseOperation.approvals.cancel', 'approval', request.approvalId, () =>
      operations(this.ctx).transitionApproval(principal(this.ctx), {
        ...request, state: 'cancelled',
      }) as Promise<EnterpriseApproval>)
  }
  /**
   * Execute one authenticated enterprise operation.
   * @param request - schedule page filters.
   * @returns visible schedule page.
   */
  @Remote('listSchedules') async listSchedules(request: EnterpriseScheduleListRequest): Promise<EnterprisePage<EnterpriseSchedule>> {
    return this.run('enterpriseOperation.schedules.list', 'schedule', 'catalog', async () => {
      const value = await operations(this.ctx).listSchedules(principal(this.ctx), { ...request, limit: request.limit ?? 50 })
      return (Array.isArray(value) ? { items: value } : value) as EnterprisePage<EnterpriseSchedule>
    })
  }
  /**
   * Execute one authenticated enterprise operation.
   * @param request - schedule identity.
   * @returns current schedule.
   */
  @Remote('getSchedule') async getSchedule(request: EnterpriseScheduleLookup): Promise<EnterpriseSchedule> {
    return this.run('enterpriseOperation.schedules.get', 'schedule', request.scheduleId, async () => {
      const value = await operations(this.ctx).getSchedule(principal(this.ctx), request)
      if (value === undefined) throw new Error('enterprise schedule not found')
      return value as EnterpriseSchedule
    })
  }
  /**
   * Execute one authenticated enterprise operation.
   * @param request - schedule definition and CAS revision.
   * @returns saved schedule.
   */
  @Remote('saveSchedule') async saveSchedule(request: EnterpriseScheduleSaveRequest): Promise<EnterpriseSchedule> {
    return this.run('enterpriseOperation.schedules.save', 'schedule', request.scheduleId, () =>
      operations(this.ctx).saveSchedule(principal(this.ctx), request) as Promise<EnterpriseSchedule>)
  }
  /**
   * Execute one authenticated enterprise operation.
   * @param request - schedule state and CAS revision.
   * @returns transitioned schedule.
   */
  @Remote('transitionSchedule') async transitionSchedule(request: EnterpriseScheduleTransitionRequest): Promise<EnterpriseSchedule> {
    return this.run('enterpriseOperation.schedules.transition', 'schedule', request.scheduleId, () =>
      operations(this.ctx).transitionSchedule(principal(this.ctx), request) as Promise<EnterpriseSchedule>)
  }

  private async run<T>(endpoint: string, resourceType: string, resourceId: string, operation: () => Promise<T>): Promise<T> {
    try { return await operation() }
    catch (error) { throw enterpriseFailure(error, endpoint, resourceType, resourceId) }
  }
}

/** Personal and department Workspace Cordis extension Remote service. */
export class CordisWorkspaceController extends TypertRemoteService {
  static inject = ['enterprisePostgres', 'enterpriseSecurity', 'enterpriseRequestContext']
  constructor(ctx: Context) { super(ctx, 'cordisWorkspaceController', { namespace: 'cordisWorkspace' }) }

  @Remote('list') async list(request: CordisWorkspaceListRequest): Promise<CordisWorkspaceProjection> {
    return catalogCall(this.ctx, 'cordisWorkspace.list', request, 'cordis-plugin', 'workspace', actor =>
      cordis(this.ctx).listWorkspace({ principal: actor, workspaceId: request.workspaceId }))
  }

  @Remote('save') async save(request: CordisWorkspaceSaveRequest): Promise<CordisPackageVersion> {
    return catalogCall(this.ctx, 'cordisWorkspace.save', request, 'cordis-plugin', request.draft.pluginId, actor =>
      cordis(this.ctx).savePersonal({ principal: actor, ...request }))
  }

  @Remote('activate') async activate(request: CordisWorkspaceActivateRequest): Promise<CordisScopeBinding> {
    return catalogCall(this.ctx, 'cordisWorkspace.activate', request, 'cordis-plugin', request.pluginId, actor =>
      cordis(this.ctx).activatePersonal({ principal: actor, ...request }))
  }

  @Remote('stop') async stop(request: CordisWorkspaceStopRequest): Promise<CordisScopeBinding> {
    return catalogCall(this.ctx, 'cordisWorkspace.stop', request, 'cordis-plugin', request.pluginId, actor =>
      cordis(this.ctx).stopBinding({ principal: actor, ...request }))
  }

  @Remote('rollback') async rollback(request: CordisWorkspaceRollbackRequest): Promise<CordisScopeBinding> {
    return catalogCall(this.ctx, 'cordisWorkspace.rollback', request, 'cordis-plugin', request.pluginId, actor =>
      cordis(this.ctx).rollbackBinding({ principal: actor, ...request }))
  }

  @Remote('pinGeneration') async pinGeneration(
    request: CordisWorkspacePinGenerationRequest,
  ): Promise<CordisSessionGeneration> {
    return catalogCall(this.ctx, 'cordisWorkspace.pinGeneration', request, 'cordis-plugin', request.sessionId, actor =>
      cordis(this.ctx).pinSessionGeneration({ principal: actor, ...request }))
  }
}

/** Department review, derived modification, and organization publication Remote service. */
export class CordisReviewController extends TypertRemoteService {
  static inject = ['enterprisePostgres', 'enterpriseSecurity', 'enterpriseRequestContext']
  constructor(ctx: Context) { super(ctx, 'cordisReviewController', { namespace: 'cordisReview' }) }

  @Remote('list') async list(request: CordisReviewListRequest): Promise<readonly CordisReviewRequest[]> {
    return catalogCall(this.ctx, 'cordisReview.list', request, 'cordis-plugin', 'reviews', async (actor) => {
      const rows = await cordis(this.ctx).listReviews({ principal: actor })
      return request.status === undefined ? rows : rows.filter(row => row.status === request.status)
    })
  }

  @Remote('submit') async submit(request: CordisReviewSubmitRequest): Promise<CordisReviewRequest> {
    return catalogCall(this.ctx, 'cordisReview.submit', request, 'cordis-plugin', request.draft.pluginId, actor =>
      cordis(this.ctx).submitDepartment({ principal: actor, ...request }))
  }

  @Remote('derive') async derive(request: CordisReviewDeriveRequest): Promise<DerivedCordisPackage> {
    return catalogCall(this.ctx, 'cordisReview.derive', request, 'cordis-plugin', request.pluginId, actor =>
      cordis(this.ctx).deriveReview({ principal: actor, ...request }))
  }

  @Remote('approveDepartment') async approveDepartment(
    request: CordisReviewTransitionRequest,
  ): Promise<CordisReviewRequest> {
    return catalogCall(this.ctx, 'cordisReview.approveDepartment', request, 'cordis-plugin', request.pluginId, actor =>
      cordis(this.ctx).reviewDepartment({ principal: actor, ...request, action: 'approve_department' }))
  }

  @Remote('return') async returnToAuthor(request: CordisReviewTransitionRequest): Promise<CordisReviewRequest> {
    return catalogCall(this.ctx, 'cordisReview.return', request, 'cordis-plugin', request.pluginId, actor =>
      cordis(this.ctx).reviewDepartment({ principal: actor, ...request, action: 'return_to_author' }))
  }

  @Remote('publishOrganization') async publishOrganization(
    request: CordisReviewPublishRequest,
  ): Promise<PublishedCordisReview> {
    return catalogCall(this.ctx, 'cordisReview.publishOrganization', request, 'cordis-plugin', request.pluginId, actor =>
      cordis(this.ctx).publishOrganization({ principal: actor, ...request }))
  }
}

/** Enterprise Cordis manager grants and emergency controls. */
export class CordisGovernanceController extends TypertRemoteService {
  static inject = ['enterprisePostgres', 'enterpriseSecurity', 'enterpriseRequestContext']
  constructor(ctx: Context) { super(ctx, 'cordisGovernanceController', { namespace: 'cordisGovernance' }) }

  @Remote('departmentManagers') async departmentManagers(
    request: CordisDepartmentManagersRequest,
  ): Promise<DepartmentManagerSet | null> {
    return catalogCall(this.ctx, 'cordisGovernance.departmentManagers', request, 'department', request.departmentId,
      actor => cordis(this.ctx).departmentManagers(actor.orgId, request.departmentId).then(value => value ?? null))
  }

  @Remote('setDepartmentManagers') async setDepartmentManagers(
    request: CordisDepartmentManagersSaveRequest,
  ): Promise<DepartmentManagerSet> {
    return catalogCall(this.ctx, 'cordisGovernance.setDepartmentManagers', request, 'department', request.departmentId,
      actor => cordis(this.ctx).setDepartmentManagers({ principal: actor, ...request }))
  }

  @Remote('disable') async disable(request: CordisGovernanceDisableRequest): Promise<CordisScopeBinding> {
    return catalogCall(this.ctx, 'cordisGovernance.disable', request, 'cordis-plugin', request.pluginId, actor =>
      cordis(this.ctx).emergencyDisable({ principal: actor, ...request }))
  }

  @Remote('rollback') async rollback(request: CordisWorkspaceRollbackRequest): Promise<CordisScopeBinding> {
    return catalogCall(this.ctx, 'cordisGovernance.rollback', request, 'cordis-plugin', request.pluginId, actor =>
      cordis(this.ctx).rollbackBinding({ principal: actor, ...request }))
  }

  @Remote('setTrust') async setTrust(request: CordisGovernanceSetTrustRequest): Promise<CordisScopeBinding> {
    return catalogCall(this.ctx, 'cordisGovernance.setTrust', request, 'cordis-plugin', request.pluginId, actor =>
      cordis(this.ctx).setTrust({ principal: actor, ...request }))
  }
}

function enterpriseFailure(
  error: unknown, endpoint: string, resourceType: string, resourceId: string,
): TypertRemoteFailure {
  let code = 'internal'
  let message = 'enterprise repository operation failed'
  if (error instanceof EnterpriseOperationsAuthorizationError) {
    code = 'enterprise-forbidden'; message = 'enterprise request is forbidden'
  } else if (error instanceof EmployeeDraftRevisionConflictError || error instanceof ApprovalRevisionConflictError) {
    code = 'enterprise-conflict'; message = 'enterprise resource revision changed'
  } else if (error instanceof EnterpriseCatalogError) {
    code = error.code === 'idempotency-conflict' ? 'enterprise-idempotency-conflict'
      : error.code === 'cursor-invalid' ? 'enterprise-invalid-cursor'
        : error.code === 'invalid-binding' ? 'enterprise-invalid-binding'
          : error.code === 'not-found' ? 'enterprise-not-found' : 'enterprise-invalid-state'
    message = error.message
  } else if (error instanceof EnterpriseOperationsError) {
    code = error.code === 'idempotency-conflict' ? 'enterprise-idempotency-conflict'
      : error.code === 'cursor-invalid' ? 'enterprise-invalid-cursor'
        : error.code === 'not-found' ? 'enterprise-not-found'
          : error.code === 'conflict' ? 'enterprise-conflict' : 'enterprise-invalid-state'
    message = error.message
  } else if (error instanceof EnterpriseCordisError) {
    code = error.code.endsWith('required') || error.code === 'organization-mismatch'
      ? 'enterprise-forbidden'
      : error.code === 'revision-conflict' ? 'enterprise-conflict'
        : error.code.endsWith('not-found') ? 'enterprise-not-found' : 'enterprise-invalid-state'
    message = error.message
  } else if (error instanceof Error && /not found|does not exist/iu.test(error.message)) {
    code = 'enterprise-not-found'; message = error.message
  } else if (error instanceof Error && /revision conflict/iu.test(error.message)) {
    code = 'enterprise-conflict'; message = error.message
  }
  return new TypertRemoteFailure({ code, message, details: { endpoint, resourceType, resourceId } })
}

/** Install all enterprise Remote namespace owners. */
export function apply(ctx: Context): void {
  new EnterpriseEmployeeController(ctx)
  new EnterpriseAssetController(ctx)
  new EnterpriseTeamController(ctx)
  new EnterpriseOperationController(ctx)
  new CordisWorkspaceController(ctx)
  new CordisReviewController(ctx)
  new CordisGovernanceController(ctx)
}

export const inject = ['enterprisePostgres', 'enterpriseSecurity', 'enterpriseRequestContext', 'enterpriseCordis']
export { name } from './invariant.ts'
