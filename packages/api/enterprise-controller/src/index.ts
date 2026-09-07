/** Authenticated enterprise Typert Remote controllers. */
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import { registerApp as officialRegisterLarkApp } from '@larksuiteoapi/node-sdk'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { EnterprisePrincipal } from '@deepseek-ai/dsh-enterprise-governance'
import type { EnterpriseRemoteErrorCode } from '@deepseek-ai/dsh-enterprise-auth-web'
import type {} from '@deepseek-ai/dsh-enterprise-postgres'
import type { EmployeePresetDefinition } from '@deepseek-ai/dsh-agent-presets'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import {
  channelAuthorizationUrl,
  channelBindingProfile,
  channelIntentPolicy,
  exchangeChannelAuthorizationCode,
  type ChannelAuthorizationFetch,
} from '@deepseek-ai/dsh-channel-kernel'
import {
  BlockAssembler,
  createUserMessage,
  type GenerateOptions,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import {
  EmployeeDraftRevisionConflictError,
  EnterpriseCatalogError,
} from '@deepseek-ai/dsh-enterprise-catalog'
import {
  ApprovalRevisionConflictError,
  EnterpriseOperationsAuthorizationError,
  EnterpriseOperationsError,
  EnterpriseOperationsService,
  EnterpriseTeamControlService,
  EnterpriseTeamRuntimeError,
  type EnterpriseTeamRuntimeDriver,
  type EnterpriseChannelConfiguration as StoredChannelConfiguration,
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
  EnterpriseEmployeeOptimizePromptRequest,
  EnterpriseEmployeeOptimizePromptResult,
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
  EnterpriseTeamDefinition,
  EnterpriseTeamDefinitionArchiveRequest,
  EnterpriseTeamDefinitionListRequest,
  EnterpriseTeamDefinitionLookup,
  EnterpriseTeamDefinitionPage,
  EnterpriseTeamDefinitionSaveRequest,
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
  EnterpriseTeamAutonomyGrant,
  EnterpriseTeamAutonomyGrantPage,
  EnterpriseTeamAutonomyListRequest,
  EnterpriseTeamAutonomyRevokeRequest,
  EnterpriseTeamAutonomySaveRequest,
  EnterpriseTeamDecision,
  EnterpriseTeamDecisionListRequest,
  EnterpriseTeamDecisionPage,
  EnterpriseTeamDecisionRespondRequest,
  EnterpriseTeamRun,
  EnterpriseTeamRunCancelRequest,
  EnterpriseTeamRunListRequest,
  EnterpriseTeamRunLookup,
  EnterpriseTeamRunPage,
  EnterpriseTeamRunStartRequest,
} from './contract/team-control.ts'
import type {
  EnterpriseChannelArchiveRequest,
  EnterpriseChannelBeginBotInstallRequest,
  EnterpriseChannelBeginBindingRequest,
  EnterpriseChannelBotInstallResult,
  EnterpriseChannelBindingSession,
  EnterpriseChannelCompleteBindingRequest,
  EnterpriseChannelCompleteBotInstallRequest,
  EnterpriseChannelConfiguration,
  EnterpriseChannelIntent,
  EnterpriseChannelListRequest,
  EnterpriseChannelLookup,
  EnterpriseChannelPage,
  EnterpriseChannelPollBotInstallRequest,
  EnterpriseChannelPollBotInstallResult,
  EnterpriseChannelSaveRequest,
} from './contract/channels.ts'
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
import {
  EnterpriseWorkStartService,
} from './work-start.ts'
import type {
  EnterpriseWorkPrepareRequest,
  EnterpriseWorkPreparation,
  EnterpriseWorkStartRequest,
  EnterpriseWorkStartValue,
} from './contract/work.ts'

export type * from './contract/index.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Enterprise employee Remote namespace owner. */
    enterpriseEmployeeController: EnterpriseEmployeeController
    /** Enterprise capability-asset Remote namespace owner. */
    enterpriseAssetController: EnterpriseAssetController
    /** Enterprise fixed-team Remote namespace owner. */
    enterpriseTeamController: EnterpriseTeamController
    /** Enterprise team-definition Remote namespace owner. */
    enterpriseTeamDefinitionController: EnterpriseTeamDefinitionController
    /** Enterprise operations Remote namespace owner. */
    enterpriseOperationController: EnterpriseOperationController
    /** Enterprise TeamRun Remote namespace owner. */
    enterpriseTeamRunController: EnterpriseTeamRunController
    /** Enterprise TeamDecision Remote namespace owner. */
    enterpriseTeamDecisionController: EnterpriseTeamDecisionController
    /** Enterprise Team autonomy Remote namespace owner. */
    enterpriseTeamAutonomyController: EnterpriseTeamAutonomyController
    /** Enterprise channel-configuration Remote namespace owner. */
    enterpriseChannelController: EnterpriseChannelController
    /** Goal-first authenticated enterprise work start. */
    enterpriseWorkController: EnterpriseWorkController
    /** Optional Host-only provider app installer. Browser code never receives its credentials. */
    enterpriseChannelBotInstaller: EnterpriseChannelBotInstaller
    /** Optional provider that appends authoritative Team events to root Session logs. */
    enterpriseTeamRuntimeDriver: EnterpriseTeamRuntimeDriver
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
            : event.resourceType === 'channel' ? 'channelId'
              : event.resourceType === 'fixed-team' || event.resourceType === 'team-definition' ? 'teamId' : 'commandId'
      const input = event.resourceId === undefined ? {} : { [field]: event.resourceId }
      return ctx.enterpriseSecurity.auditApiAsync(
        event.principal, event.endpoint, input,
        {
          allowed: event.decision.allowed,
          reason: event.decision.reason ?? (event.decision.allowed ? 'role' : 'insufficient-role'),
        },
        event.correlationId,
      )
    },
  })
}

function teamControl(ctx: Context): EnterpriseTeamControlService {
  const runtime = ctx.get('enterpriseTeamRuntimeDriver')
  if (runtime === undefined) throw new Error('enterprise Team runtime driver is required')
  return new EnterpriseTeamControlService(ctx.enterprisePostgres.teamControl, runtime, {
    authorize: (actor, endpoint, input) => ctx.enterpriseSecurity.authorizeApiAsync(actor, endpoint, input),
    authorizeWorkspace: async (actor, workspaceId) =>
      (await ctx.enterpriseSecurity.authorizeApiAsync(actor, 'session.create', { workspaceId })).allowed,
    audit: (event) => {
      const input = event.endpoint.startsWith('enterpriseTeamDecision')
        ? { decisionId: event.resource.id }
        : event.endpoint.startsWith('enterpriseTeamAutonomy')
          ? { teamId: event.details['teamId'] }
          : event.resource.type === 'team-definition'
            ? { teamId: event.resource.id }
            : { runId: event.resource.id }
      return ctx.enterpriseSecurity.auditApiResourceAsync(
        event.principal, event.endpoint, input,
        {
          allowed: event.decision.allowed,
          reason: event.decision.reason ?? (event.decision.allowed ? 'role' : 'insufficient-role'),
        },
        event.correlationId,
        { ...event.resource, details: event.details },
      )
    },
  })
}

function cordis(ctx: Context): EnterpriseCordisService {
  return ctx.enterpriseCordis
}

function employeePresetDefinition(release: EnterpriseEmployeeRelease): EmployeePresetDefinition {
  const profile = release.snapshot.profile
  const required = (field: string): string => {
    const value = profile[field]
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`employee release ${release.releaseId} has no ${field}`)
    }
    return value.trim()
  }
  const optional = (field: string): string | undefined => {
    const value = profile[field]
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
  }
  const capabilities = Array.isArray(profile['capabilities'])
    ? profile['capabilities'].filter((value): value is string => typeof value === 'string' && value.trim() !== '')
    : []
  const description = optional('description')
  const position = optional('position')
  const department = optional('department')
  return {
    name: required('name'), prompt: required('prompt'),
    ...description === undefined ? {} : { description },
    ...position === undefined ? {} : { position },
    ...department === undefined ? {} : { department },
    capabilities,
  }
}

/** Employee Draft/Release Remote service. */
interface EmployeePromptLlm {
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>
}

export async function optimizeEmployeePromptWithLlm(
  llm: EmployeePromptLlm,
  request: EnterpriseEmployeeOptimizePromptRequest,
): Promise<EnterpriseEmployeeOptimizePromptResult> {
  const prompt = request.prompt.trim()
  if (prompt === '' || prompt.length > 20_000 || request.provider.trim() === '' || request.model.trim() === '') {
    throw new Error('employee prompt optimization requires a model route and a prompt up to 20000 characters')
  }
  const assembler = new BlockAssembler()
  for await (const chunk of llm.stream({
    provider: request.provider,
    model: request.model,
    system: 'You improve enterprise digital-employee responsibility prompts. Preserve the input language. Return only the improved prompt, with clear responsibilities, operating rules, boundaries, and expected outputs. Do not use Markdown fences or commentary.',
    messages: [createUserMessage({
      source: { kind: 'plugin', plugin: 'enterprise-employee-prompt-optimizer' },
      content: [{ type: 'text', text: prompt }],
    })],
    temperature: 0.2,
    maxTokens: 2_000,
  })) assembler.push(chunk)
  const finish = assembler.finish
  if (finish.kind === 'error' || finish.kind === 'aborted') {
    throw new Error(finish.failure.message)
  }
  const blocks = assembler.blocks()
  if (blocks.some(block => block.type === 'tool-call')) throw new Error('prompt optimizer returned an unexpected tool call')
  const optimized = blocks.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n').trim()
  if (optimized === '') throw new Error('prompt optimizer returned no text')
  return { prompt: optimized }
}

export class EnterpriseEmployeeController extends TypertRemoteService {
  static inject = ['enterprisePostgres', 'enterpriseSecurity', 'enterpriseRequestContext', 'agentPresets', 'llm']
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

  /** Improve one unsaved responsibility prompt through a caller-selected configured model. */
  @Remote('optimizePrompt')
  async optimizePrompt(
    request: EnterpriseEmployeeOptimizePromptRequest,
  ): Promise<EnterpriseEmployeeOptimizePromptResult> {
    return catalogCall(this.ctx, 'enterpriseEmployee.optimizePrompt', request, 'employee', 'prompt-optimizer', () =>
      optimizeEmployeePromptWithLlm(this.ctx.llm, request))
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
    return catalogCall(this.ctx, 'enterpriseEmployee.publish', request, 'employee', request.presetId, async (principal) => {
      const release = await this.ctx.enterprisePostgres.catalog.publishDraft({
        ...request, orgId: principal.orgId, publishedBy: principal.userId,
      }) as EnterpriseEmployeeRelease
      await this.ctx.agentPresets.configureEmployee(request.presetId, employeePresetDefinition(release))
      return release
    })
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

const CHANNEL_INTENTS = ['notify', 'handoff', 'team-start', 'decision-response', 'status'] as const

const CHANNEL_BOT_INSTALL_DOCUMENTATION: Readonly<Record<StoredChannelConfiguration['provider'], string>> = Object.freeze({
  wecom: 'https://github.com/WecomTeam/wecom-openclaw-plugin',
  feishu: 'https://open.feishu.cn/document/isv-guides/publish-your-app/publishing-guidelines',
  dingtalk: 'https://open.dingtalk.com/document/isvapp/enterprise-authorized-application-activation-event-1.md',
  wechat: 'https://docs.openclaw.ai/channels/wechat',
})

const CHANNEL_BINDING_TTL_MS = 10 * 60_000
const MAX_PENDING_CHANNEL_BINDINGS = 256
const MAX_PENDING_CHANNEL_BINDINGS_PER_ORG = 64
const MAX_PENDING_CHANNEL_BINDINGS_PER_ACTOR = 16
const MAX_CHANNEL_REDIRECT_URI_BYTES = 2_048
const MAX_CHANNEL_AUTHORIZATION_CODE_BYTES = 2_048
const MAX_CHANNEL_BINDING_IDEMPOTENCY_KEY_BYTES = 128
const MAX_CHANNEL_PROVIDER_RESPONSE_BYTES = 64 * 1_024
const CHANNEL_BINDING_STATE_PATTERN = /^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/u
const CHANNEL_BINDING_STATE_PLACEHOLDER = `${'A'.repeat(43)}.${'A'.repeat(43)}`
const CHANNEL_BINDING_HMAC_KEY = randomBytes(32)

interface PendingChannelBinding {
  readonly orgId: string
  readonly actorUserId: string
  readonly channelId: string
  readonly provider: StoredChannelConfiguration['provider']
  readonly tenantId?: string
  readonly accountId: string
  readonly credentialRef: string
  readonly expectedRevision: number
  readonly redirectUri: string
  readonly nonce: string
  readonly expiresAt: number
}

interface PendingChannelBotInstall {
  readonly orgId: string
  readonly actorUserId: string
  readonly provider: StoredChannelConfiguration['provider']
  readonly redirectUri: string
  readonly nonce: string
  readonly expiresAt: number
}

/** Verified Bot metadata returned only by a Host provider adapter after official authorization. */
export interface EnterpriseInstalledChannelBot {
  readonly provider: StoredChannelConfiguration['provider']
  readonly tenantId?: string
  readonly tenantName?: string
  readonly accountId: string
  readonly botName: string
  readonly credentialRef: string
  readonly providerIdentityId: string
}

/** Host-only seam implemented by approved WeCom, Feishu, or DingTalk provider-app adapters. */
export interface EnterpriseChannelBotInstaller {
  begin(input: PendingChannelBotInstall & { readonly state: string }): Promise<{
    readonly authorizationUrl: string
    readonly expiresAt: number
  }>
  complete(input: PendingChannelBotInstall & {
    readonly state: string
    readonly code: string
  }): Promise<EnterpriseInstalledChannelBot>
}

type RegisterLarkApp = typeof officialRegisterLarkApp
type RegisterLarkAppResult = Awaited<ReturnType<RegisterLarkApp>>

interface LarkRegistrationAttempt {
  status: 'pending' | 'complete' | 'failed'
  result?: RegisterLarkAppResult
  controller: AbortController
}

interface NativeQrRegistrationAttempt {
  readonly provider: 'wecom' | 'wechat'
  readonly deviceCode: string
  pollBaseUrl: string
}

/** Runtime seams for deterministic channel-binding tests and Host fetch injection. */
export interface EnterpriseChannelControllerOptions {
  readonly now?: () => number
  readonly fetch?: ChannelAuthorizationFetch
  readonly registerLarkApp?: RegisterLarkApp
}

function canonicalChannelBindingEnvelope(pending: PendingChannelBinding): string {
  return JSON.stringify([
    pending.nonce, pending.orgId, pending.actorUserId, pending.channelId, pending.provider,
    pending.tenantId ?? null, pending.accountId, pending.credentialRef, pending.expectedRevision,
    pending.redirectUri, pending.expiresAt,
  ])
}

function channelBindingSignature(pending: PendingChannelBinding): string {
  return createHmac('sha256', CHANNEL_BINDING_HMAC_KEY)
    .update(canonicalChannelBindingEnvelope(pending)).digest('base64url')
}

function validChannelBindingState(state: string, pending: PendingChannelBinding): boolean {
  if (!CHANNEL_BINDING_STATE_PATTERN.test(state)) return false
  const [nonce = '', signature = ''] = state.split('.')
  if (nonce !== pending.nonce) return false
  const supplied = Buffer.from(signature, 'base64url')
  const expected = Buffer.from(channelBindingSignature(pending), 'base64url')
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

function canonicalChannelBotInstallEnvelope(pending: PendingChannelBotInstall): string {
  return JSON.stringify([
    'bot-install', pending.nonce, pending.orgId, pending.actorUserId, pending.provider,
    pending.redirectUri, pending.expiresAt,
  ])
}

function channelBotInstallSignature(pending: PendingChannelBotInstall): string {
  return createHmac('sha256', CHANNEL_BINDING_HMAC_KEY)
    .update(canonicalChannelBotInstallEnvelope(pending)).digest('base64url')
}

function validChannelBotInstallState(state: string, pending: PendingChannelBotInstall): boolean {
  if (!CHANNEL_BINDING_STATE_PATTERN.test(state)) return false
  const [nonce = '', signature = ''] = state.split('.')
  if (nonce !== pending.nonce) return false
  const supplied = Buffer.from(signature, 'base64url')
  const expected = Buffer.from(channelBotInstallSignature(pending), 'base64url')
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

function boundedRemoteString(value: string, maximumBytes: number): boolean {
  return value.trim() !== '' && Buffer.byteLength(value, 'utf8') <= maximumBytes
}

function canonicalRedirectFromAuthorizationUrl(authorizationUrl: string): string {
  const redirectUri = new URL(authorizationUrl).searchParams.get('redirect_uri')
  if (redirectUri === null) throw new Error('provider authorization URL omitted redirect URI')
  return redirectUri
}

function bindingAuthorizationUrl(
  value: Pick<StoredChannelConfiguration, 'provider' | 'tenantId' | 'accountId'>,
  callbackUrl: string,
  state: string,
  channelId: string,
): string {
  try {
    return channelAuthorizationUrl({
      provider: value.provider, accountId: value.accountId, callbackUrl, state,
      ...(value.tenantId === undefined ? {} : { tenantId: value.tenantId }),
    })
  } catch {
    throw new EnterpriseOperationsError('invalid-state', 'channel', channelId)
  }
}

function sameChannelIdentity(value: StoredChannelConfiguration, pending: PendingChannelBinding): boolean {
  return value.channelId === pending.channelId
    && value.provider === pending.provider
    && value.tenantId === pending.tenantId
    && value.accountId === pending.accountId
    && value.credentialRef === pending.credentialRef
}

/** Enterprise channel-configuration Remote service. */
export class EnterpriseChannelController extends TypertRemoteService {
  static inject = ['enterprisePostgres', 'enterpriseSecurity', 'enterpriseRequestContext', 'credentials']

  private readonly pendingBindings = new Map<string, PendingChannelBinding>()
  private readonly pendingBotInstalls = new Map<string, PendingChannelBotInstall>()
  private readonly larkRegistrationAttempts = new Map<string, LarkRegistrationAttempt>()
  private readonly nativeQrRegistrationAttempts = new Map<string, NativeQrRegistrationAttempt>()
  private readonly now: () => number
  private readonly fetch: ChannelAuthorizationFetch
  private readonly registerLarkApp: RegisterLarkApp

  /**
   * @param ctx - authenticated enterprise Host context with the Credential seam.
   * @param options - optional Host fetch and clock seams.
   */
  constructor(ctx: Context, options: EnterpriseChannelControllerOptions = {}) {
    super(ctx, 'enterpriseChannelController', { namespace: 'enterpriseChannel' })
    this.now = options.now ?? Date.now
    this.fetch = options.fetch ?? globalThis.fetch
    this.registerLarkApp = options.registerLarkApp ?? officialRegisterLarkApp
  }

  /**
   * List channel configurations visible to the authenticated organization administrator.
   * @param request - optional archived-record filter.
   * @returns secret-free channel configuration projections.
   */
  @Remote('list')
  async list(request: EnterpriseChannelListRequest): Promise<EnterpriseChannelPage> {
    return this.run('enterpriseChannel.list', 'catalog', async () => {
      const page = await operations(this.ctx).listChannelConfigurations(principal(this.ctx))
      const values = request.includeArchived ? page.items : page.items.filter(item => item.state !== 'archived')
      return { items: await Promise.all(values.map(item => this.present(item))) }
    })
  }

  /**
   * Read one organization-scoped channel configuration.
   * @param request - stable channel identity.
   * @returns the secret-free channel configuration projection.
   */
  @Remote('get')
  async get(request: EnterpriseChannelLookup): Promise<EnterpriseChannelConfiguration> {
    return this.run('enterpriseChannel.get', request.channelId, async () => {
      const value = await operations(this.ctx).getChannelConfiguration(principal(this.ctx), request)
      if (value === undefined) throw new EnterpriseOperationsError('not-found', 'channel', request.channelId)
      return this.present(value)
    })
  }

  /**
   * Create or revision-fence an administrator-managed channel configuration.
   * @param request - provider account, Credential reference, route, and lifecycle state.
   * @returns the saved secret-free channel configuration projection.
   */
  @Remote('save')
  async save(request: EnterpriseChannelSaveRequest): Promise<EnterpriseChannelConfiguration> {
    return this.run('enterpriseChannel.save', request.channelId, async () => {
      if (request.state === 'active') {
        if (request.credentialRef === undefined
          || !(await this.ctx.credentials.describe(credentialRef(request.credentialRef))).configured) {
          throw new EnterpriseOperationsError('invalid-state', 'channel', request.channelId)
        }
      }
      const value = await operations(this.ctx).saveChannelConfiguration(principal(this.ctx), request)
      return this.present(value)
    })
  }

  /**
   * Terminally archive one channel configuration.
   * @param request - channel identity, expected revision, and idempotency key.
   * @returns the archived secret-free channel configuration projection.
   */
  @Remote('archive')
  async archive(request: EnterpriseChannelArchiveRequest): Promise<EnterpriseChannelConfiguration> {
    return this.run('enterpriseChannel.archive', request.channelId, async () =>
      this.present(await operations(this.ctx).archiveChannelConfiguration(principal(this.ctx), request)))
  }

  /**
   * Start installation of a provider-hosted DSH Bot before a channel exists.
   * Self-hosted builds fail visibly until an approved provider app installer is deployed.
   */
  @Remote('beginBotInstall')
  async beginBotInstall(request: EnterpriseChannelBeginBotInstallRequest): Promise<EnterpriseChannelBotInstallResult> {
    return catalogCall(this.ctx, 'enterpriseChannel.beginBotInstall', { provider: request.provider }, 'channel', request.provider, async (actor) => {
      if (!boundedRemoteString(request.redirectUri, MAX_CHANNEL_REDIRECT_URI_BYTES)) {
        throw new EnterpriseOperationsError('invalid-state', 'channel', request.provider)
      }
      const installer = this.ctx.get('enterpriseChannelBotInstaller')
      if (installer === undefined && request.provider === 'dingtalk') return {
        status: 'setup-required', provider: request.provider,
        officialDocumentationUrl: CHANNEL_BOT_INSTALL_DOCUMENTATION[request.provider],
      }
      this.prunePendingBindings()
      const orgPending = [...this.pendingBotInstalls.values()].filter(pending => pending.orgId === actor.orgId)
      const actorPending = orgPending.filter(pending => pending.actorUserId === actor.userId)
      if (this.pendingBotInstalls.size >= MAX_PENDING_CHANNEL_BINDINGS
        || orgPending.length >= MAX_PENDING_CHANNEL_BINDINGS_PER_ORG
        || actorPending.length >= MAX_PENDING_CHANNEL_BINDINGS_PER_ACTOR) {
        throw new EnterpriseOperationsError('invalid-state', 'channel', request.provider)
      }
      const nonce = randomBytes(32).toString('base64url')
      const pending: PendingChannelBotInstall = {
        orgId: actor.orgId, actorUserId: actor.userId, provider: request.provider,
        redirectUri: request.redirectUri, nonce, expiresAt: this.now() + CHANNEL_BINDING_TTL_MS,
      }
      const state = `${nonce}.${channelBotInstallSignature(pending)}`
      if (request.provider === 'feishu' && installer === undefined) {
        const session = await this.beginLarkRegistration(state, pending)
        this.pendingBotInstalls.set(state, pending)
        return {
          status: 'ready', provider: request.provider, installId: state, completionMode: 'poll',
          authorizationUrl: session.authorizationUrl, expiresAt: pending.expiresAt,
        }
      }
      if ((request.provider === 'wecom' || request.provider === 'wechat') && installer === undefined) {
        const session = await this.beginNativeQrRegistration(state, request.provider)
        this.pendingBotInstalls.set(state, pending)
        return {
          status: 'ready', provider: request.provider, installId: state, completionMode: 'poll',
          authorizationUrl: session.authorizationUrl, expiresAt: pending.expiresAt,
        }
      }
      if (installer === undefined) throw new EnterpriseOperationsError('invalid-state', 'channel', 'bot-install')
      const session = await installer.begin({ ...pending, state })
      const authorization = new URL(session.authorizationUrl)
      if (authorization.protocol !== 'https:' || authorization.searchParams.get('state') !== state
        || session.expiresAt !== pending.expiresAt) {
        throw new EnterpriseOperationsError('invalid-state', 'channel', request.provider)
      }
      this.pendingBotInstalls.set(state, pending)
      return {
        status: 'ready', provider: request.provider, installId: state, completionMode: 'callback',
        authorizationUrl: authorization.href, expiresAt: pending.expiresAt,
      }
    })
  }

  /** Poll an official Device Authorization Grant and create the channel after provider confirmation. */
  @Remote('pollBotInstall')
  async pollBotInstall(request: EnterpriseChannelPollBotInstallRequest): Promise<EnterpriseChannelPollBotInstallResult> {
    return catalogCall(this.ctx, 'enterpriseChannel.pollBotInstall', {}, 'channel', 'bot-install', async (actor) => {
      if (!CHANNEL_BINDING_STATE_PATTERN.test(request.installId)
        || !boundedRemoteString(request.idempotencyKey, MAX_CHANNEL_BINDING_IDEMPOTENCY_KEY_BYTES)) {
        throw new EnterpriseOperationsError('invalid-state', 'channel', 'bot-install')
      }
      this.prunePendingBindings()
      const pending = this.pendingBotInstalls.get(request.installId)
      if (pending === undefined || !validChannelBotInstallState(request.installId, pending)
        || pending.orgId !== actor.orgId || pending.actorUserId !== actor.userId) {
        throw new EnterpriseOperationsError('invalid-state', 'channel', 'bot-install')
      }
      let installed: EnterpriseInstalledChannelBot | undefined
      let secret: string | undefined
      if (pending.provider === 'feishu') {
        const attempt = this.larkRegistrationAttempts.get(request.installId)
        if (attempt === undefined || attempt.status === 'failed') {
          this.failBotInstall(request.installId)
        }
        if (attempt.status === 'pending' || attempt.result === undefined) {
          return { status: 'pending', provider: pending.provider }
        }
        const appId = attempt.result.client_id.trim()
        secret = attempt.result.client_secret
        const credentialName = this.botCredentialName('FEISHU_APP', appId)
        installed = {
          provider: 'feishu', accountId: appId, botName: 'DSH Agent', credentialRef: credentialName,
          providerIdentityId: attempt.result.user_info?.open_id?.trim() || appId,
        }
      } else if (pending.provider === 'wecom' || pending.provider === 'wechat') {
        const polled = await this.pollNativeQrRegistration(request.installId, pending.provider, request.verificationCode)
        if (polled === 'pending') return { status: 'pending', provider: pending.provider }
        if (polled === 'verification-required') return { status: 'verification-required', provider: 'wechat' }
        installed = polled.installed
        secret = polled.secret
      } else {
        throw new EnterpriseOperationsError('invalid-state', 'channel', 'bot-install')
      }
      if (!boundedRemoteString(installed.accountId, 512) || !boundedRemoteString(secret, 4_096)) {
        this.failBotInstall(request.installId)
      }
      await this.ctx.credentials.set(credentialRef(installed.credentialRef), secret)
      const channel = await this.saveInstalledBot(actor, pending, installed, request.idempotencyKey)
      this.pendingBotInstalls.delete(request.installId)
      this.larkRegistrationAttempts.delete(request.installId)
      this.nativeQrRegistrationAttempts.delete(request.installId)
      return { status: 'complete', provider: pending.provider, channel }
    })
  }

  /** Complete a signed provider-app installation and create the governed channel automatically. */
  @Remote('completeBotInstall')
  async completeBotInstall(request: EnterpriseChannelCompleteBotInstallRequest): Promise<EnterpriseChannelConfiguration> {
    return catalogCall(this.ctx, 'enterpriseChannel.completeBotInstall', {}, 'channel', 'bot-install', async (actor) => {
      if (!boundedRemoteString(request.code, MAX_CHANNEL_AUTHORIZATION_CODE_BYTES)
        || !boundedRemoteString(request.idempotencyKey, MAX_CHANNEL_BINDING_IDEMPOTENCY_KEY_BYTES)
        || !boundedRemoteString(request.redirectUri, MAX_CHANNEL_REDIRECT_URI_BYTES)
        || !CHANNEL_BINDING_STATE_PATTERN.test(request.state)) {
        throw new EnterpriseOperationsError('invalid-state', 'channel', 'bot-install')
      }
      this.prunePendingBindings()
      const pending = this.pendingBotInstalls.get(request.state)
      if (pending === undefined || !validChannelBotInstallState(request.state, pending)
        || this.now() >= pending.expiresAt || pending.redirectUri !== request.redirectUri) {
        if (pending !== undefined) this.pendingBotInstalls.delete(request.state)
        throw new EnterpriseOperationsError('invalid-state', 'channel', 'bot-install')
      }
      if (pending.orgId !== actor.orgId || pending.actorUserId !== actor.userId) {
        throw new EnterpriseOperationsAuthorizationError(
          'insufficient-role', 'enterpriseChannel.completeBotInstall' as never,
        )
      }
      const installer = this.ctx.get('enterpriseChannelBotInstaller')
      if (installer === undefined) throw new EnterpriseOperationsError('invalid-state', 'channel', 'bot-install')
      this.pendingBotInstalls.delete(request.state)
      const installed = await installer.complete({ ...pending, state: request.state, code: request.code })
      return this.saveInstalledBot(actor, pending, installed, request.idempotencyKey)
    })
  }

  /**
   * Begin a ten-minute process-bound official provider authorization session.
   * @param request - channel identity, exact revision, and registered callback URI.
   * @returns signed secret-free authorization session metadata.
   */
  @Remote('beginBinding')
  async beginBinding(request: EnterpriseChannelBeginBindingRequest): Promise<EnterpriseChannelBindingSession> {
    const auditInput = { channelId: request.channelId, expectedRevision: request.expectedRevision }
    return catalogCall(this.ctx, 'enterpriseChannel.beginBinding', auditInput, 'channel', request.channelId, async (actor) => {
      if (!boundedRemoteString(request.redirectUri, MAX_CHANNEL_REDIRECT_URI_BYTES)) {
        throw new EnterpriseOperationsError('invalid-state', 'channel', request.channelId)
      }
      const value = await operations(this.ctx).getChannelConfiguration(actor, request)
      if (value === undefined) throw new EnterpriseOperationsError('not-found', 'channel', request.channelId)
      if (value.revision !== request.expectedRevision) {
        throw new EnterpriseOperationsError('conflict', 'channel', request.channelId)
      }
      if (value.state === 'archived' || value.credentialRef === undefined) {
        throw new EnterpriseOperationsError('invalid-state', 'channel', request.channelId)
      }
      if (!(await this.ctx.credentials.describe(credentialRef(value.credentialRef))).configured) {
        throw new EnterpriseOperationsError('invalid-state', 'channel', request.channelId)
      }
      this.prunePendingBindings()
      const orgPending = [...this.pendingBindings.values()].filter(pending => pending.orgId === actor.orgId)
      const actorPending = orgPending.filter(pending => pending.actorUserId === actor.userId)
      if (this.pendingBindings.size >= MAX_PENDING_CHANNEL_BINDINGS
        || orgPending.length >= MAX_PENDING_CHANNEL_BINDINGS_PER_ORG
        || actorPending.length >= MAX_PENDING_CHANNEL_BINDINGS_PER_ACTOR) {
        throw new EnterpriseOperationsError('invalid-state', 'channel', request.channelId)
      }
      const nonce = randomBytes(32).toString('base64url')
      const preliminaryUrl = bindingAuthorizationUrl(
        value, request.redirectUri, CHANNEL_BINDING_STATE_PLACEHOLDER, request.channelId,
      )
      const redirectUri = canonicalRedirectFromAuthorizationUrl(preliminaryUrl)
      if (!boundedRemoteString(redirectUri, MAX_CHANNEL_REDIRECT_URI_BYTES)) {
        throw new EnterpriseOperationsError('invalid-state', 'channel', request.channelId)
      }
      const expiresAt = this.now() + CHANNEL_BINDING_TTL_MS
      const pending: PendingChannelBinding = {
        orgId: actor.orgId, actorUserId: actor.userId, channelId: value.channelId,
        provider: value.provider, accountId: value.accountId,
        ...(value.tenantId === undefined ? {} : { tenantId: value.tenantId }),
        credentialRef: value.credentialRef, expectedRevision: value.revision, redirectUri, nonce, expiresAt,
      }
      const state = `${nonce}.${channelBindingSignature(pending)}`
      const authorizationUrl = bindingAuthorizationUrl(value, redirectUri, state, request.channelId)
      this.pendingBindings.set(state, pending)
      return {
        bindingId: state, channelId: pending.channelId, provider: pending.provider,
        authorizationUrl, officialDocumentationUrl: channelBindingProfile(pending.provider).officialDocsUrl,
        expiresAt,
      }
    })
  }

  /**
   * Consume a pending callback, exchange its code, and persist secret-free identity evidence.
   * @param request - provider callback values and write idempotency key.
   * @returns the verified secret-free channel configuration.
   */
  @Remote('completeBinding')
  async completeBinding(request: EnterpriseChannelCompleteBindingRequest): Promise<EnterpriseChannelConfiguration> {
    return catalogCall(this.ctx, 'enterpriseChannel.completeBinding', {}, 'channel', 'binding', async (actor) => {
      if (!boundedRemoteString(request.code, MAX_CHANNEL_AUTHORIZATION_CODE_BYTES)
        || !boundedRemoteString(request.idempotencyKey, MAX_CHANNEL_BINDING_IDEMPOTENCY_KEY_BYTES)
        || !boundedRemoteString(request.redirectUri, MAX_CHANNEL_REDIRECT_URI_BYTES)
        || !CHANNEL_BINDING_STATE_PATTERN.test(request.state)) {
        throw new EnterpriseOperationsError('invalid-state', 'channel', 'binding')
      }
      this.prunePendingBindings()
      const pending = this.pendingBindings.get(request.state)
      if (pending === undefined || !validChannelBindingState(request.state, pending)
        || this.now() >= pending.expiresAt) {
        if (pending !== undefined) this.pendingBindings.delete(request.state)
        throw new EnterpriseOperationsError('invalid-state', 'channel', 'binding')
      }
      if (pending.orgId !== actor.orgId || pending.actorUserId !== actor.userId) {
        throw new EnterpriseOperationsAuthorizationError(
          'insufficient-role', 'enterpriseChannel.completeBinding' as never,
        )
      }
      const callbackAuthorizationUrl = bindingAuthorizationUrl(
        pending, request.redirectUri, request.state, pending.channelId,
      )
      if (canonicalRedirectFromAuthorizationUrl(callbackAuthorizationUrl) !== pending.redirectUri) {
        throw new EnterpriseOperationsError('invalid-state', 'channel', pending.channelId)
      }
      this.pendingBindings.delete(request.state)
      const current = await operations(this.ctx).getChannelConfiguration(actor, { channelId: pending.channelId })
      if (current === undefined) throw new EnterpriseOperationsError('not-found', 'channel', pending.channelId)
      if (current.revision !== pending.expectedRevision) {
        throw new EnterpriseOperationsError('conflict', 'channel', pending.channelId)
      }
      if (current.state === 'archived' || !sameChannelIdentity(current, pending)) {
        throw new EnterpriseOperationsError('invalid-state', 'channel', pending.channelId)
      }
      let appSecret: string | undefined
      try {
        appSecret = (await this.ctx.credentials.resolve(credentialRef(pending.credentialRef)))?.value
        if (appSecret === undefined) throw new EnterpriseOperationsError('invalid-state', 'channel', pending.channelId)
        const identity = await exchangeChannelAuthorizationCode({
          provider: pending.provider, accountId: pending.accountId,
          ...(pending.tenantId === undefined ? {} : { tenantId: pending.tenantId }),
          appSecret, code: request.code, callbackUrl: pending.redirectUri,
        }, this.fetch)
        const verified = await operations(this.ctx).verifyChannelBinding(actor, {
          channelId: pending.channelId, expectedRevision: pending.expectedRevision,
          idempotencyKey: request.idempotencyKey, ...identity,
        })
        return await this.present(verified)
      } finally {
        appSecret = undefined
      }
    })
  }

  private beginLarkRegistration(
    state: string,
    pending: PendingChannelBotInstall,
  ): Promise<{ authorizationUrl: string }> {
    const controller = new AbortController()
    const attempt: LarkRegistrationAttempt = { status: 'pending', controller }
    this.larkRegistrationAttempts.set(state, attempt)
    return new Promise((resolve, reject) => {
      let qrDelivered = false
      void this.registerLarkApp({
        source: 'dsh', signal: controller.signal, createOnly: true,
        appPreset: { name: 'DSH Agent', desc: 'DSH enterprise Human-Agent collaboration channel' },
        addons: {
          scopes: { tenant: [
            'im:message.p2p_msg:readonly', 'im:message.group_at_msg:readonly', 'im:message:send_as_bot',
          ] },
          events: { items: { tenant: ['im.message.receive_v1'] } },
        },
        onQRCodeReady: ({ url, expireIn }) => {
          if (qrDelivered) return
          try {
            const authorization = new URL(url)
            if (authorization.protocol !== 'https:' || authorization.host !== 'open.feishu.cn'
              || !Number.isFinite(expireIn) || expireIn <= 0) {
              throw new Error('invalid Feishu registration QR')
            }
            qrDelivered = true
            resolve({ authorizationUrl: authorization.href })
          } catch (error) {
            controller.abort()
            attempt.status = 'failed'
            reject(error instanceof Error ? error : new Error(String(error)))
          }
        },
      }).then((result) => {
        attempt.status = 'complete'
        attempt.result = result
      }, (error: unknown) => {
        attempt.status = 'failed'
        if (!qrDelivered) reject(error instanceof Error ? error : new Error(String(error)))
      })
      if (this.now() >= pending.expiresAt) {
        controller.abort()
        attempt.status = 'failed'
        reject(new Error('Feishu registration expired before start'))
      }
    })
  }

  private async beginNativeQrRegistration(
    state: string,
    provider: 'wecom' | 'wechat',
  ): Promise<{ authorizationUrl: string }> {
    if (provider === 'wecom') {
      const platform = process.platform === 'darwin' ? 1 : process.platform === 'win32' ? 2 : process.platform === 'linux' ? 3 : 0
      const body = await this.providerJson(`https://work.weixin.qq.com/ai/qc/generate?source=wecom-cli&plat=${platform}`)
      const data = this.providerRecord(body['data'])
      const deviceCode = this.providerString(data['scode'])
      const authorizationUrl = this.validProviderQrUrl(this.providerString(data['auth_url']), 'work.weixin.qq.com')
      this.nativeQrRegistrationAttempts.set(state, {
        provider, deviceCode, pollBaseUrl: 'https://work.weixin.qq.com/ai/qc/query_result',
      })
      return { authorizationUrl }
    }
    const body = await this.providerJson(
      'https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3',
      { method: 'POST', headers: this.weixinHeaders(true), body: JSON.stringify({ local_token_list: [] }) },
    )
    const deviceCode = this.providerString(body['qrcode'])
    const authorizationUrl = this.validProviderQrUrl(this.providerString(body['qrcode_img_content']), 'liteapp.weixin.qq.com')
    this.nativeQrRegistrationAttempts.set(state, {
      provider, deviceCode, pollBaseUrl: 'https://ilinkai.weixin.qq.com',
    })
    return { authorizationUrl }
  }

  private async pollNativeQrRegistration(
    state: string,
    provider: 'wecom' | 'wechat',
    verificationCode?: string,
  ): Promise<'pending' | 'verification-required' | { installed: EnterpriseInstalledChannelBot; secret: string }> {
    const attempt = this.nativeQrRegistrationAttempts.get(state)
    if (attempt === undefined || attempt.provider !== provider) this.failBotInstall(state)
    if (provider === 'wecom') {
      const url = new URL(attempt.pollBaseUrl)
      url.searchParams.set('scode', attempt.deviceCode)
      const body = await this.providerJson(url.href)
      const data = this.providerRecord(body['data'])
      if (data['status'] !== 'success') return 'pending'
      const botInfo = this.providerRecord(data['bot_info'])
      const accountId = this.providerString(botInfo['botid'])
      return { installed: {
        provider, accountId, botName: 'DSH 企业微信 Bot',
        credentialRef: this.botCredentialName('WECOM_BOT', accountId), providerIdentityId: accountId,
      }, secret: this.providerString(botInfo['secret']) }
    }
    if (verificationCode !== undefined && !/^\d{4,12}$/u.test(verificationCode)) {
      throw new EnterpriseOperationsError('invalid-state', 'channel', 'bot-install')
    }
    const url = new URL('/ilink/bot/get_qrcode_status', attempt.pollBaseUrl)
    url.searchParams.set('qrcode', attempt.deviceCode)
    if (verificationCode !== undefined) url.searchParams.set('verify_code', verificationCode)
    const body = await this.providerJson(url.href, { headers: this.weixinHeaders(false) }, 40_000)
    const status = body['status']
    if (status === 'need_verifycode') return 'verification-required'
    if (status === 'scaned_but_redirect') {
      const host = this.providerString(body['redirect_host'])
      if (!/^[a-z0-9.-]+$/u.test(host) || (host !== 'weixin.qq.com' && !host.endsWith('.weixin.qq.com'))) {
        this.failBotInstall(state)
      }
      attempt.pollBaseUrl = `https://${host}`
      return 'pending'
    }
    if (status !== 'confirmed') {
      if (status === 'expired' || status === 'verify_code_blocked' || status === 'binded_redirect') {
        this.failBotInstall(state)
      }
      return 'pending'
    }
    const accountId = this.providerString(body['ilink_bot_id'])
    const providerIdentityId = typeof body['ilink_user_id'] === 'string' && body['ilink_user_id'].trim() !== ''
      ? body['ilink_user_id'].trim() : accountId
    return { installed: {
      provider, accountId, botName: 'DSH 微信 Bot',
      credentialRef: this.botCredentialName('WEIXIN_BOT', accountId), providerIdentityId,
    }, secret: this.providerString(body['bot_token']) }
  }

  private botCredentialName(kind: string, accountId: string): string {
    return `DSH_${kind}_${createHash('sha256').update(accountId).digest('hex').slice(0, 12).toUpperCase()}`
  }

  private weixinHeaders(includeAuthorization: boolean): Record<string, string> {
    return {
      ...(includeAuthorization ? {
        'content-type': 'application/json', AuthorizationType: 'ilink_bot_token',
        'X-WECHAT-UIN': Buffer.from(String(randomBytes(4).readUInt32BE(0)), 'utf8').toString('base64'),
      } : {}),
      'iLink-App-Id': 'bot', 'iLink-App-ClientVersion': '132104',
    }
  }

  private async providerJson(input: string, init?: RequestInit, timeoutMs = 10_000): Promise<Record<string, unknown>> {
    const response = await this.fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) })
    const raw = await response.text()
    if (!response.ok || Buffer.byteLength(raw, 'utf8') > MAX_CHANNEL_PROVIDER_RESPONSE_BYTES) {
      throw new EnterpriseOperationsError('invalid-state', 'channel', 'bot-install')
    }
    try {
      return this.providerRecord(JSON.parse(raw))
    } catch {
      throw new EnterpriseOperationsError('invalid-state', 'channel', 'bot-install')
    }
  }

  private providerRecord(value: unknown): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new EnterpriseOperationsError('invalid-state', 'channel', 'bot-install')
    }
    return value as Record<string, unknown>
  }

  private providerString(value: unknown): string {
    if (typeof value !== 'string' || !boundedRemoteString(value, 4_096)) {
      throw new EnterpriseOperationsError('invalid-state', 'channel', 'bot-install')
    }
    return value.trim()
  }

  private validProviderQrUrl(value: string, expectedHost: string): string {
    const parsed = new URL(value)
    if (parsed.protocol !== 'https:' || parsed.host !== expectedHost || parsed.username !== '' || parsed.password !== '') {
      throw new EnterpriseOperationsError('invalid-state', 'channel', 'bot-install')
    }
    return parsed.href
  }

  private failBotInstall(state: string): never {
    this.pendingBotInstalls.delete(state)
    this.larkRegistrationAttempts.get(state)?.controller.abort()
    this.larkRegistrationAttempts.delete(state)
    this.nativeQrRegistrationAttempts.delete(state)
    throw new EnterpriseOperationsError('invalid-state', 'channel', 'bot-install')
  }

  private async saveInstalledBot(
    actor: EnterprisePrincipal,
    pending: PendingChannelBotInstall,
    installed: EnterpriseInstalledChannelBot,
    idempotencyKey: string,
  ): Promise<EnterpriseChannelConfiguration> {
    if (installed.provider !== pending.provider
      || (installed.tenantId !== undefined && !boundedRemoteString(installed.tenantId, 512))
      || !boundedRemoteString(installed.accountId, 512)
      || !boundedRemoteString(installed.botName, 512)
      || !boundedRemoteString(installed.credentialRef, 512)
      || !boundedRemoteString(installed.providerIdentityId, 512)) {
      throw new EnterpriseOperationsError('invalid-state', 'channel', 'bot-install')
    }
    if (!(await this.ctx.credentials.describe(credentialRef(installed.credentialRef))).configured) {
      throw new EnterpriseOperationsError('invalid-state', 'channel', 'bot-install')
    }
    const digest = createHash('sha256').update(JSON.stringify([
      actor.orgId, installed.provider, installed.tenantId ?? null, installed.accountId,
    ])).digest('hex').slice(0, 12)
    const saved = await operations(this.ctx).saveChannelConfiguration(actor, {
      channelId: `${installed.provider}-${digest}`, name: installed.botName.trim(),
      provider: installed.provider,
      ...(installed.tenantId === undefined ? {} : { tenantId: installed.tenantId.trim() }),
      accountId: installed.accountId.trim(), credentialRef: installed.credentialRef.trim(),
      inboundEnabled: true, state: 'active', expectedRevision: 0, idempotencyKey,
    })
    const verificationIdempotencyKey = `bot-install-verify:${createHash('sha256')
      .update(idempotencyKey).digest('hex').slice(0, 32)}`
    const verified = await operations(this.ctx).verifyChannelBinding(actor, {
      channelId: saved.channelId, expectedRevision: saved.revision,
      providerIdentityId: installed.providerIdentityId.trim(), providerIdentityName: installed.botName.trim(),
      ...(installed.tenantId === undefined ? {} : { verifiedTenantId: installed.tenantId.trim() }),
      idempotencyKey: verificationIdempotencyKey,
    })
    return this.present(verified)
  }

  private prunePendingBindings(): void {
    const now = this.now()
    for (const [state, pending] of this.pendingBindings) {
      if (now >= pending.expiresAt) this.pendingBindings.delete(state)
    }
    for (const [state, pending] of this.pendingBotInstalls) {
      if (now >= pending.expiresAt) {
        this.pendingBotInstalls.delete(state)
        this.larkRegistrationAttempts.get(state)?.controller.abort()
        this.larkRegistrationAttempts.delete(state)
        this.nativeQrRegistrationAttempts.delete(state)
      }
    }
  }

  private async present(value: StoredChannelConfiguration): Promise<EnterpriseChannelConfiguration> {
    const credentialStatus = value.credentialRef !== undefined
      && (await this.ctx.credentials.describe(credentialRef(value.credentialRef))).configured
      ? 'configured' as const : 'missing' as const
    const allowedIntents = CHANNEL_INTENTS.filter(intent =>
      channelIntentPolicy(value.provider, intent).allowed) as readonly EnterpriseChannelIntent[]
    return { ...value, credentialStatus, allowedIntents, transportStatus: 'unverified' }
  }

  private async run<T>(endpoint: string, resourceId: string, operation: () => Promise<T>): Promise<T> {
    try { return await operation() }
    catch (error) { throw enterpriseFailure(error, endpoint, 'channel', resourceId) }
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

/** Enterprise team-definition Remote service. */
export class EnterpriseTeamDefinitionController extends TypertRemoteService {
  static inject = ['enterprisePostgres', 'enterpriseSecurity', 'enterpriseRequestContext']
  /** @param ctx - authenticated enterprise Host context. */
  constructor(ctx: Context) {
    super(ctx, 'enterpriseTeamDefinitionController', { namespace: 'enterpriseTeamDefinition' })
  }

  /**
   * List definitions visible to the authenticated organization.
   * @param request - page cursor and size.
   * @returns visible definition page.
   */
  @Remote('list')
  async list(request: EnterpriseTeamDefinitionListRequest): Promise<EnterpriseTeamDefinitionPage> {
    return this.run('enterpriseTeamDefinition.list', 'catalog', () =>
      operations(this.ctx).listTeamDefinitions(principal(this.ctx), request) as Promise<EnterpriseTeamDefinitionPage>)
  }

  /**
   * Read one definition from the authenticated organization.
   * @param request - team identity.
   * @returns current definition.
   */
  @Remote('get')
  async get(request: EnterpriseTeamDefinitionLookup): Promise<EnterpriseTeamDefinition> {
    return this.run('enterpriseTeamDefinition.get', request.teamId, async () => {
      const value = await operations(this.ctx).getTeamDefinition(principal(this.ctx), request)
      if (value === undefined) throw new EnterpriseOperationsError('not-found', 'team-definition', request.teamId)
      return value as EnterpriseTeamDefinition
    })
  }

  /**
   * Create or CAS-save one non-archived definition in the authenticated organization.
   * @param request - definition and write guards; revision zero creates it and archive state is rejected.
   * @returns saved definition.
   */
  @Remote('save')
  async save(request: EnterpriseTeamDefinitionSaveRequest): Promise<EnterpriseTeamDefinition> {
    return this.run('enterpriseTeamDefinition.save', request.teamId, () =>
      operations(this.ctx).saveTeamDefinition(principal(this.ctx), request) as Promise<EnterpriseTeamDefinition>)
  }

  /**
   * Archive one definition; only this operation enters the terminal archived state.
   * @param request - team identity and write guards.
   * @returns archived definition.
   */
  @Remote('archive')
  async archive(request: EnterpriseTeamDefinitionArchiveRequest): Promise<EnterpriseTeamDefinition> {
    return this.run('enterpriseTeamDefinition.archive', request.teamId, () =>
      operations(this.ctx).archiveTeamDefinition(principal(this.ctx), request) as Promise<EnterpriseTeamDefinition>)
  }

  private async run<T>(endpoint: string, resourceId: string, operation: () => Promise<T>): Promise<T> {
    try { return await operation() }
    catch (error) { throw enterpriseFailure(error, endpoint, 'team-definition', resourceId) }
  }
}

/** Enterprise TeamRun query and command Remote service. */
export class EnterpriseTeamRunController extends TypertRemoteService {
  static inject = ['enterprisePostgres', 'enterpriseSecurity', 'enterpriseRequestContext', 'enterpriseTeamRuntimeDriver']
  /** @param ctx - authenticated enterprise Host context. */
  constructor(ctx: Context) {
    super(ctx, 'enterpriseTeamRunController', { namespace: 'enterpriseTeamRun' })
    if (ctx.get('enterpriseTeamRuntimeDriver') === undefined) {
      throw new Error('enterprise Team runtime driver is required')
    }
  }

  /**
   * List visible TeamRun projections.
   * @param request - visible run page filters.
   * @returns visible TeamRun page.
   */
  @Remote('list') async list(request: EnterpriseTeamRunListRequest): Promise<EnterpriseTeamRunPage> {
    return this.run('enterpriseTeamRun.list', request.teamId ?? 'catalog', () =>
      teamControl(this.ctx).listRuns(principal(this.ctx), request) as Promise<EnterpriseTeamRunPage>)
  }
  /**
   * Read one visible TeamRun projection.
   * @param request - TeamRun identity.
   * @returns visible TeamRun projection.
   */
  @Remote('get') async get(request: EnterpriseTeamRunLookup): Promise<EnterpriseTeamRun> {
    return this.run('enterpriseTeamRun.get', request.runId, () =>
      teamControl(this.ctx).getRun(principal(this.ctx), request.runId) as Promise<EnterpriseTeamRun>)
  }
  /**
   * Start a runtime-authoritative TeamRun.
   * @param request - browser-safe definition fence, Workspace, prompt, source, and idempotency.
   * @returns started or reconcilable TeamRun.
   */
  @Remote('start') async start(request: EnterpriseTeamRunStartRequest): Promise<EnterpriseTeamRun> {
    return this.run('enterpriseTeamRun.start', request.teamId, () =>
      teamControl(this.ctx).startRun(principal(this.ctx), request) as Promise<EnterpriseTeamRun>)
  }
  /**
   * Cancel a runtime-authoritative TeamRun.
   * @param request - TeamRun CAS and idempotency fields.
   * @returns cancelled or reconcilable TeamRun.
   */
  @Remote('cancel') async cancel(request: EnterpriseTeamRunCancelRequest): Promise<EnterpriseTeamRun> {
    return this.run('enterpriseTeamRun.cancel', request.runId, () =>
      teamControl(this.ctx).cancelRun(principal(this.ctx), request) as Promise<EnterpriseTeamRun>)
  }
  private async run<T>(endpoint: string, resourceId: string, operation: () => Promise<T>): Promise<T> {
    try { return await operation() }
    catch (error) { throw enterpriseFailure(error, endpoint, 'team-run', resourceId) }
  }
}

/** Enterprise TeamDecision query and human-response Remote service. */
export class EnterpriseTeamDecisionController extends TypertRemoteService {
  static inject = ['enterprisePostgres', 'enterpriseSecurity', 'enterpriseRequestContext', 'enterpriseTeamRuntimeDriver']
  /** @param ctx - authenticated enterprise Host context. */
  constructor(ctx: Context) {
    super(ctx, 'enterpriseTeamDecisionController', { namespace: 'enterpriseTeamDecision' })
    if (ctx.get('enterpriseTeamRuntimeDriver') === undefined) {
      throw new Error('enterprise Team runtime driver is required')
    }
  }
  /**
   * List visible runtime-emitted decisions.
   * @param request - visible decision filters.
   * @returns visible decision page.
   */
  @Remote('list') async list(request: EnterpriseTeamDecisionListRequest): Promise<EnterpriseTeamDecisionPage> {
    return this.run('enterpriseTeamDecision.list', request.runId ?? 'catalog', () =>
      teamControl(this.ctx).listDecisions(principal(this.ctx), request) as Promise<EnterpriseTeamDecisionPage>)
  }
  /**
   * Append and project a permitted human answer.
   * @param request - answer, CAS, and idempotency fields.
   * @returns answered decision projection.
   */
  @Remote('respond') async respond(request: EnterpriseTeamDecisionRespondRequest): Promise<EnterpriseTeamDecision> {
    return this.run('enterpriseTeamDecision.respond', request.decisionId, () =>
      teamControl(this.ctx).respondDecision(principal(this.ctx), request) as Promise<EnterpriseTeamDecision>)
  }
  private async run<T>(endpoint: string, resourceId: string, operation: () => Promise<T>): Promise<T> {
    try { return await operation() }
    catch (error) { throw enterpriseFailure(error, endpoint, 'team-decision', resourceId) }
  }
}

/** Enterprise explicit autonomy-grant Remote service. */
export class EnterpriseTeamAutonomyController extends TypertRemoteService {
  static inject = ['enterprisePostgres', 'enterpriseSecurity', 'enterpriseRequestContext']
  /** @param ctx - authenticated enterprise Host context. */
  constructor(ctx: Context) { super(ctx, 'enterpriseTeamAutonomyController', { namespace: 'enterpriseTeamAutonomy' }) }
  /**
   * List visible explicit autonomy grants.
   * @param request - visible autonomy-grant filters.
   * @returns visible grant page.
   */
  @Remote('list') async list(request: EnterpriseTeamAutonomyListRequest): Promise<EnterpriseTeamAutonomyGrantPage> {
    return this.run('enterpriseTeamAutonomy.list', request.teamId ?? 'catalog', () =>
      teamControl(this.ctx).listAutonomyGrants(principal(this.ctx), request) as Promise<EnterpriseTeamAutonomyGrantPage>)
  }
  /**
   * Save an explicit human-authored autonomy grant.
   * @param request - explicit human grant and CAS fields.
   * @returns active grant.
   */
  @Remote('save') async save(request: EnterpriseTeamAutonomySaveRequest): Promise<EnterpriseTeamAutonomyGrant> {
    return this.run('enterpriseTeamAutonomy.save', request.teamId, () =>
      teamControl(this.ctx).saveAutonomyGrant(principal(this.ctx), request) as Promise<EnterpriseTeamAutonomyGrant>)
  }
  /**
   * Revoke an autonomy grant terminally.
   * @param request - grant identity, CAS, and idempotency fields.
   * @returns terminal revoked grant.
   */
  @Remote('revoke') async revoke(request: EnterpriseTeamAutonomyRevokeRequest): Promise<EnterpriseTeamAutonomyGrant> {
    return this.run('enterpriseTeamAutonomy.revoke', request.teamId, () =>
      teamControl(this.ctx).revokeAutonomyGrant(principal(this.ctx), request) as Promise<EnterpriseTeamAutonomyGrant>)
  }
  private async run<T>(endpoint: string, resourceId: string, operation: () => Promise<T>): Promise<T> {
    try { return await operation() }
    catch (error) { throw enterpriseFailure(error, endpoint, 'team-autonomy-grant', resourceId) }
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

  /**
   * List Cordis Packages and active bindings visible to a Workspace.
   * @param request - Workspace identity.
   * @returns visible extension projection.
   */
  @Remote('list') async list(request: CordisWorkspaceListRequest): Promise<CordisWorkspaceProjection> {
    return catalogCall(this.ctx, 'cordisWorkspace.list', request, 'cordis-plugin', 'workspace', actor =>
      cordis(this.ctx).listWorkspace({ principal: actor, workspaceId: request.workspaceId }))
  }

  /**
   * Persist a personal Workspace Package version.
   * @param request - Package draft and idempotency data.
   * @returns immutable Package version.
   */
  @Remote('save') async save(request: CordisWorkspaceSaveRequest): Promise<CordisPackageVersion> {
    return catalogCall(this.ctx, 'cordisWorkspace.save', request, 'cordis-plugin', request.draft.pluginId, actor =>
      cordis(this.ctx).savePersonal({ principal: actor, ...request }))
  }

  /**
   * Activate a personal Workspace Package.
   * @param request - Package, Workspace, and CAS data.
   * @returns updated scope binding.
   */
  @Remote('activate') async activate(request: CordisWorkspaceActivateRequest): Promise<CordisScopeBinding> {
    return catalogCall(this.ctx, 'cordisWorkspace.activate', request, 'cordis-plugin', request.pluginId, actor =>
      cordis(this.ctx).activatePersonal({ principal: actor, ...request }))
  }

  /**
   * Stop an active Workspace extension.
   * @param request - Binding, reason, and CAS data.
   * @returns disabled binding.
   */
  @Remote('stop') async stop(request: CordisWorkspaceStopRequest): Promise<CordisScopeBinding> {
    return catalogCall(this.ctx, 'cordisWorkspace.stop', request, 'cordis-plugin', request.pluginId, actor =>
      cordis(this.ctx).stopBinding({ principal: actor, ...request }))
  }

  /**
   * Roll a Workspace extension back to an immutable version.
   * @param request - Target version and CAS data.
   * @returns updated binding.
   */
  @Remote('rollback') async rollback(request: CordisWorkspaceRollbackRequest): Promise<CordisScopeBinding> {
    return catalogCall(this.ctx, 'cordisWorkspace.rollback', request, 'cordis-plugin', request.pluginId, actor =>
      cordis(this.ctx).rollbackBinding({ principal: actor, ...request }))
  }

  /**
   * Pin the visible extension Generation for a Session.
   * @param request - Workspace and Session identity.
   * @returns immutable Session Generation.
   */
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

  /**
   * List Cordis reviews visible to the caller.
   * @param request - Optional review-status filter.
   * @returns visible review requests.
   */
  @Remote('list') async list(request: CordisReviewListRequest): Promise<readonly CordisReviewRequest[]> {
    return catalogCall(this.ctx, 'cordisReview.list', request, 'cordis-plugin', 'reviews', async (actor) => {
      const rows = await cordis(this.ctx).listReviews({ principal: actor })
      return request.status === undefined ? rows : rows.filter(row => row.status === request.status)
    })
  }

  /**
   * Submit a department Package for manager review.
   * @param request - Draft, Workspace, and source Session data.
   * @returns created review.
   */
  @Remote('submit') async submit(request: CordisReviewSubmitRequest): Promise<CordisReviewRequest> {
    return catalogCall(this.ctx, 'cordisReview.submit', request, 'cordis-plugin', request.draft.pluginId, actor =>
      cordis(this.ctx).submitDepartment({ principal: actor, ...request }))
  }

  /**
   * Derive a manager-edited immutable Package.
   * @param request - Review, draft, and CAS data.
   * @returns derived Package and review revision.
   */
  @Remote('derive') async derive(request: CordisReviewDeriveRequest): Promise<DerivedCordisPackage> {
    return catalogCall(this.ctx, 'cordisReview.derive', request, 'cordis-plugin', request.pluginId, actor =>
      cordis(this.ctx).deriveReview({ principal: actor, ...request }))
  }

  /**
   * Approve a Package for department activation.
   * @param request - Review transition and reason.
   * @returns updated review.
   */
  @Remote('approveDepartment') async approveDepartment(
    request: CordisReviewTransitionRequest,
  ): Promise<CordisReviewRequest> {
    return catalogCall(this.ctx, 'cordisReview.approveDepartment', request, 'cordis-plugin', request.pluginId, actor =>
      cordis(this.ctx).reviewDepartment({ principal: actor, ...request, action: 'approve_department' }))
  }

  /**
   * Return a review to its author.
   * @param request - Review transition and reason.
   * @returns updated review.
   */
  @Remote('return') async returnToAuthor(request: CordisReviewTransitionRequest): Promise<CordisReviewRequest> {
    return catalogCall(this.ctx, 'cordisReview.return', request, 'cordis-plugin', request.pluginId, actor =>
      cordis(this.ctx).reviewDepartment({ principal: actor, ...request, action: 'return_to_author' }))
  }

  /**
   * Publish an approved department Package organization-wide.
   * @param request - Review Package and CAS data.
   * @returns publication result.
   */
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

  /**
   * Read the configured managers for a department.
   * @param request - Department identity.
   * @returns manager set or null.
   */
  @Remote('departmentManagers') async departmentManagers(
    request: CordisDepartmentManagersRequest,
  ): Promise<DepartmentManagerSet | null> {
    return catalogCall(this.ctx, 'cordisGovernance.departmentManagers', request, 'department', request.departmentId,
      actor => cordis(this.ctx).departmentManagers(actor.orgId, request.departmentId).then(value => value ?? null))
  }

  /**
   * Replace the configured managers for a department.
   * @param request - Members and CAS revision.
   * @returns updated manager set.
   */
  @Remote('setDepartmentManagers') async setDepartmentManagers(
    request: CordisDepartmentManagersSaveRequest,
  ): Promise<DepartmentManagerSet> {
    return catalogCall(this.ctx, 'cordisGovernance.setDepartmentManagers', request, 'department', request.departmentId,
      actor => cordis(this.ctx).setDepartmentManagers({ principal: actor, ...request }))
  }

  /**
   * Emergency-disable an enterprise extension.
   * @param request - Binding, reason, and CAS data.
   * @returns disabled binding.
   */
  @Remote('disable') async disable(request: CordisGovernanceDisableRequest): Promise<CordisScopeBinding> {
    return catalogCall(this.ctx, 'cordisGovernance.disable', request, 'cordis-plugin', request.pluginId, actor =>
      cordis(this.ctx).emergencyDisable({ principal: actor, ...request }))
  }

  /**
   * Roll an enterprise extension back to an immutable version.
   * @param request - Target version and CAS data.
   * @returns updated binding.
   */
  @Remote('rollback') async rollback(request: CordisWorkspaceRollbackRequest): Promise<CordisScopeBinding> {
    return catalogCall(this.ctx, 'cordisGovernance.rollback', request, 'cordis-plugin', request.pluginId, actor =>
      cordis(this.ctx).rollbackBinding({ principal: actor, ...request }))
  }

  /**
   * Change the execution trust of an organization extension.
   * @param request - Trust level, reason, and CAS data.
   * @returns updated binding.
   */
  @Remote('setTrust') async setTrust(request: CordisGovernanceSetTrustRequest): Promise<CordisScopeBinding> {
    return catalogCall(this.ctx, 'cordisGovernance.setTrust', request, 'cordis-plugin', request.pluginId, actor =>
      cordis(this.ctx).setTrust({ principal: actor, ...request }))
  }
}

/** Goal-first enterprise work entry point. This slice deliberately does not route models, teams, tools, or budgets. */
export class EnterpriseWorkController extends TypertRemoteService {
  static inject = ['enterprisePostgres', 'enterpriseSecurity', 'enterpriseRequestContext', 'sessionController']
  private readonly work: EnterpriseWorkStartService
  constructor(ctx: Context) {
    super(ctx, 'enterpriseWorkController', { namespace: 'enterpriseWork' })
    const session = ctx.get('sessionController') as {
      create(input: { sessionId: string; workspaceId: string; agentPreset?: string }): Promise<{ sessionId: string }>
    } | undefined
    if (session === undefined) throw new Error('session controller is required for enterprise work start')
    this.work = new EnterpriseWorkStartService({
      workspaceGrant: id => ctx.enterprisePostgres.identity.workspaceGrant(id),
      visibleWorkspace: async (actor, id) => (await ctx.enterpriseSecurity.authorizeApiAsync(actor, 'session.create', { workspaceId: id })).allowed,
      sessionOwnedBy: (actor, id) => ctx.enterpriseSecurity.sessionOwnedBy(actor, id),
      sessionWorkspace: async id => (await ctx.enterprisePostgres.identity.sessionWorkspaceGrant(id))?.workspaceId,
      personalWorkspaces: async (actor) => {
        const grants = await ctx.enterprisePostgres.identity.listWorkspaceGrants({ orgId: actor.orgId, userId: actor.userId })
        return grants
          .filter(item => item.kind === 'personal' && item.ownerUserId === actor.userId)
          .map(item => item.workspaceId)
      },
      releases: async (actor) => {
        const drafts = [] as { presetId: string; status: 'draft' | 'published' }[]
        let cursor: string | undefined
        do {
          const page = await ctx.enterprisePostgres.catalog.listDrafts({
            orgId: actor.orgId, limit: 100,
            ...(actor.roles.includes('administrator')
              ? { includeAllVisible: true }
              : { viewerUserId: actor.userId }),
            ...(cursor === undefined ? {} : { cursor }),
          })
          drafts.push(...page.items)
          cursor = page.nextCursor
        } while (cursor !== undefined)
        return (await Promise.all(drafts.filter(item => item.status === 'published').map(item => ctx.enterprisePostgres.catalog.listReleases(item.presetId, actor.orgId)))).flat() as EnterpriseEmployeeRelease[]
      },
      createSession: async ({ sessionId, workspaceId, agentPresetId }) =>
        session.create({ sessionId, workspaceId, agentPreset: agentPresetId }),
      bindSession: (actor, sessionId, workspaceId) => ctx.enterpriseSecurity.bindSessionWorkspaceAsync(actor, sessionId, workspaceId),
      upsertRecord: async (input) => { await operations(ctx).upsertWorkRecord(input.principal, {
        sessionId: input.sessionId, employeeReleaseId: input.employeeReleaseId, source: 'console', businessState: 'active',
        sourceReferences: input.sourceReferences, expectedRevision: 0, idempotencyKey: input.idempotencyKey,
      }) },
      reserveWorkStart: ({ principal: actor, ...input }) => operations(ctx).reserveWorkStart(actor, input),
      getWorkStart: ({ principal: actor, ...input }) => operations(ctx).getWorkStart(actor, input),
      completeWorkStart: ({ principal: actor, ...input }) => operations(ctx).completeWorkStart(actor, input),
    })
  }
  /**
   * Resolve the workspace and employee that would start enterprise work.
   * @param request - Goal and optional workspace or employee choices.
   * @returns a ready selection or the visible choices needed to continue.
   */
  @Remote('prepare') async prepare(request: EnterpriseWorkPrepareRequest): Promise<EnterpriseWorkPreparation> {
    return catalogCall(this.ctx, 'enterpriseWork.prepare', request, 'work-record', 'work-start', actor => this.work.prepare(actor, request))
  }
  /**
   * Start enterprise work using the prepared, authorized workspace and employee.
   * @param request - Goal, optional selections, and idempotency key.
   * @returns the durable native Session and selected release.
   */
  @Remote('start') async start(request: EnterpriseWorkStartRequest): Promise<EnterpriseWorkStartValue> {
    return catalogCall(this.ctx, 'enterpriseWork.start', request, 'work-record', request.idempotencyKey, actor => this.work.start(actor, request))
  }
}

function enterpriseFailure(
  error: unknown, endpoint: string, resourceType: string, resourceId: string,
): RemoteError<EnterpriseRemoteErrorCode> {
  let code: EnterpriseRemoteErrorCode = 'enterprise-internal'
  let message = 'enterprise repository operation failed'
  if (error instanceof EnterpriseOperationsAuthorizationError) {
    code = 'enterprise-forbidden'; message = 'enterprise request is forbidden'
  } else if (error instanceof Error && error.message === 'authenticated enterprise principal is required') {
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
    code = error.code === 'forbidden' ? 'enterprise-forbidden'
      : error.code === 'idempotency-conflict' ? 'enterprise-idempotency-conflict'
        : error.code === 'cursor-invalid' ? 'enterprise-invalid-cursor'
          : error.code === 'not-found' ? 'enterprise-not-found'
            : error.code === 'conflict' ? 'enterprise-conflict' : 'enterprise-invalid-state'
    message = error.message
  } else if (error instanceof EnterpriseTeamRuntimeError) {
    code = error.outcome === 'unknown' ? 'enterprise-runtime-unknown' : 'enterprise-invalid-state'
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
  return new RemoteError(code, message, { endpoint, resourceType, resourceId })
}

/** Install all enterprise Remote namespace owners. */
export function apply(ctx: Context): void {
  new EnterpriseEmployeeController(ctx)
  new EnterpriseAssetController(ctx)
  new EnterpriseChannelController(ctx)
  new EnterpriseTeamController(ctx)
  new EnterpriseTeamDefinitionController(ctx)
  new EnterpriseOperationController(ctx)
  new EnterpriseWorkController(ctx)
  new EnterpriseTeamRunController(ctx)
  new EnterpriseTeamDecisionController(ctx)
  new EnterpriseTeamAutonomyController(ctx)
  new CordisWorkspaceController(ctx)
  new CordisReviewController(ctx)
  new CordisGovernanceController(ctx)
}

export const inject = ['enterprisePostgres', 'enterpriseSecurity', 'enterpriseRequestContext', 'enterpriseCordis', 'credentials', 'llm']
export { name } from './invariant.ts'
