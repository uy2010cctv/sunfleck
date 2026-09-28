/** Authenticated enterprise Typert Remote controllers. */
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { isAbsolute } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { registerApp as officialRegisterLarkApp } from '@larksuiteoapi/node-sdk'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { EnterprisePrincipal } from '@deepseek-ai/dsh-enterprise-governance'
import type {} from '@deepseek-ai/dsh-enterprise-auth-web'
import type {} from '@deepseek-ai/dsh-enterprise-postgres'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { brandString } from '@deepseek-ai/dsh-brand'
import type {} from '@deepseek-ai/dsh-workspace'
import { PostgresChannelWorkflowLedger } from '@deepseek-ai/dsh-enterprise-postgres'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import {
  normalizeDevicePublicKey, PostgresDevicePlaneRepository, validateQueuedDeviceAction,
} from '@deepseek-ai/dsh-enterprise-device-plane'
import type {} from '@deepseek-ai/dsh-host-webserver'
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
  CordisPluginArchive,
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
import { composeCollaboration } from './collaboration-runtime.ts'
import { CollaborationError } from './collaboration-service.ts'
import { CollaborationIdentity } from './collaboration-identity.ts'
import { ChannelWorkflowEventService } from './collaboration-workflow-events.ts'
import { ChannelWorkflowHttpHandler } from './collaboration-workflow-http.ts'
import { ChannelWorkflowScheduler } from './collaboration-workflow-scheduler.ts'
import { ChannelGitWorkflowBridge } from './collaboration-git-workflow.ts'
import { ChannelGitHubIngress } from './collaboration-github-ingress.ts'
import { recoverCommittedWorkflowDecision } from './collaboration-workflow-recovery.ts'
import z from '@deepseek-ai/schemastery'
import { composeSessionContext } from './session-context-http.ts'
import { WorkspaceEmployeeDefaultService } from './workspace-employee-default.ts'
import type {
  WorkspaceEmployeeDefaultRequest, WorkspaceEmployeeDefaultSaveRequest, WorkspaceEmployeeDefaultView,
  EnterpriseEmployeeSessionRequest, EnterpriseEmployeeSessionValue,
} from './contract/work.ts'
import { RecorderMemoryRuntimeStore } from './recorder-memory-runtime.ts'
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
  EnterpriseTeamDefinitionDiscardDraftRequest,
  EnterpriseTeamDefinitionDraftLookup,
  EnterpriseTeamDefinitionDraftRequest,
  EnterpriseTeamDefinitionListRequest,
  EnterpriseTeamDefinitionLookup,
  EnterpriseTeamDefinitionPage,
  EnterpriseTeamDefinitionPublishRequest,
  EnterpriseTeamDefinitionRevision,
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
  CordisReviewSubmitSavedRequest,
  CordisReviewTransitionRequest,
  CordisWorkspaceActivateRequest,
  CordisWorkspaceArchiveRequest,
  CordisWorkspacePinGenerationRequest,
  CordisWorkspaceRollbackRequest,
  CordisWorkspaceStopRequest,
  CordisWorkspaceListRequest,
  CordisWorkspaceSaveRequest,
} from './contract/cordis.ts'
import {
  EnterpriseWorkStartService,
} from './work-start.ts'
import {
  employeePresetDeclaration,
  employeePresetDefinition,
  employeePersona,
  type EmployeePresetDefinition,
} from './employee-preset.ts'
import { employeeReleaseProjectionDefinition, installEmployeePersona } from './employee-session.ts'
import type {
  EnterpriseWorkPrepareRequest,
  EnterpriseWorkPreparation,
  EnterpriseWorkStartRequest,
  EnterpriseWorkStartValue,
} from './contract/work.ts'
import type {
  EnterpriseComputerUseRunListRequest,
  EnterpriseComputerUseStartRequest,
  EnterpriseComputerUseTransitionRequest,
  EnterpriseComputerUseRun,
  EnterpriseDeviceActionListRequest,
  EnterpriseDeviceActionView,
  EnterpriseDeviceActionLookup,
  EnterpriseDeviceListRequest,
  EnterpriseDevicePairRequest,
  EnterpriseDevicePermitRequest,
  EnterpriseDeviceView,
  EnterpriseRecorderDeviceView,
  EnterpriseRecorderListRequest,
  EnterpriseRecorderMemoryRuntimeSaveRequest,
  EnterpriseRecorderMemoryRuntimeView,
  EnterpriseRecorderRuntimeRequest,
  EnterpriseRecorderRuntimeSaveRequest,
  EnterpriseRecorderRuntimeView,
  EnterpriseRecorderPairingChallenge,
  EnterpriseRecorderPairingRequest,
} from './contract/devices.ts'
import { DeviceAgentHttpHandler } from './device-agent-http.ts'
import { EmployeeHttpHandler } from './employee-http.ts'
import { serveConsolidation } from './consolidation-http.ts'
import { ProjectHttpHandler, SurfaceHttpHandler } from './surfaces-http.ts'
import { ProjectWorkspaceProvisioner } from './project-workspace.ts'
import { RecorderRuntimeBridge, validateRecorderRuntimeSave } from './recorder-runtime.ts'

export type * from './contract/index.ts'

/** Source of the user message the employee prompt optimizer submits to the caller-selected model. */
export interface EmployeePromptOptimizerSource {
  readonly kind: 'enterprise-employee-prompt-optimizer'
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'enterprise-employee-prompt-optimizer': EmployeePromptOptimizerSource
  }
}

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
    enterpriseDeviceController: EnterpriseDeviceController
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

/** Resolve the request-scoped authenticated enterprise principal.
 * @param ctx - Input value used by this API.
 * @returns Result produced by this API.
*/
function principal(ctx: Context): EnterprisePrincipal {
  return ctx.enterpriseRequestContext.requirePrincipal()
}

/** Authorize and audit one enterprise catalog operation.
 * @param ctx - Input value used by this API.
 * @param endpoint - Input value used by this API.
 * @param input - Input value used by this API.
 * @param operation - Input value used by this API.
 * @param resourceId - Input value used by this API.
 * @param resourceType - Input value used by this API.
 * @returns Result produced by this API.
*/
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

/** Build the enterprise operations service over the shared PostgreSQL composition.
 * @param ctx - Input value used by this API.
 * @returns Result produced by this API.
*/
function operations(ctx: Context): EnterpriseOperationsService {
  return new EnterpriseOperationsService(ctx.enterprisePostgres.operations, {
    authorize: (actor, endpoint, input) => ctx.enterpriseSecurity.authorizeApiAsync(actor, endpoint, input),
    audit: (event) => {
      const field = event.resourceType === 'work-record' ? 'sessionId'
        : event.resourceType === 'approval' ? 'approvalId'
          : event.resourceType === 'schedule' ? 'scheduleId'
            : event.resourceType === 'channel' ? 'channelId'
              : event.resourceType === 'work-start-reservation' ? 'idempotencyKey'
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

class EmployeePresetSyncError extends Error {
  constructor(readonly presetId: string, options: ErrorOptions) {
    super('employee release is published, but its Agent Preset update failed; retry Publish to reconcile it', options)
    this.name = 'EmployeePresetSyncError'
  }
}

/** Employee Draft/Release Remote service. */
interface EmployeePromptLlm {
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>
}

/** Executes `optimizeEmployeePromptWithLlm`.
 * @param llm - Input value used by this API.
 * @param request - Input value used by this API.
 * @returns Result produced by this API.
 */
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
      source: { kind: 'enterprise-employee-prompt-optimizer' },
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

/** Authenticated Device Plane pairing and heartbeat service. */
export class EnterpriseDeviceController extends TypertRemoteService {
  static inject = ['enterprisePostgres', 'enterpriseSecurity', 'enterpriseRequestContext']
  constructor(ctx: Context) { super(ctx, 'enterpriseDeviceController', { namespace: 'enterpriseDevice' }) }

  /**
   * List devices paired to the authenticated user.
   * @param request - Device visibility filters.
   * @returns Paired devices with derived online status.
   */
  @Remote('list') async list(request: EnterpriseDeviceListRequest): Promise<EnterpriseDeviceView[]> {
    return catalogCall(this.ctx, 'enterpriseDevice.list', request, 'device', 'catalog', async (actor) => {
      const devices = await this.repository().listDevices(actor.orgId, actor.userId)
      return devices
        .filter(device => request.includeRevoked === true || device.status !== 'revoked')
        .map(device => ({
          deviceId: device.deviceId, deviceName: device.deviceName, platform: device.platform,
          status: device.status,
          ...(device.lastHeartbeatAt === undefined ? {} : { lastHeartbeatAt: device.lastHeartbeatAt }),
        }))
    })
  }

  /**
   * List recent Computer Use runs owned by the authenticated user.
   * @param request - Optional bounded result limit.
   * @returns Recent run snapshots in update order.
   */
  @Remote('listRuns') async listRuns(request: EnterpriseComputerUseRunListRequest): Promise<EnterpriseComputerUseRun[]> {
    return catalogCall(this.ctx, 'enterpriseDevice.listRuns', request, 'computer-use-run', 'recent', async actor =>
      this.repository().listRuns(actor.orgId, actor.userId, request.limit ?? 20))
  }

  /**
   * List recent Computer Use actions owned by the authenticated user.
   * @param request - Optional bounded result limit.
   * @returns Recent actions and retained evidence metadata.
   */
  @Remote('listActions') async listActions(request: EnterpriseDeviceActionListRequest): Promise<EnterpriseDeviceActionView[]> {
    return catalogCall(this.ctx, 'enterpriseDevice.listActions', request, 'computer-use-action', 'recent', async actor =>
      this.repository().listActions(actor.orgId, actor.userId, request.limit ?? 50))
  }

  /**
   * Read one action result owned by the authenticated user.
   * @param request - Stable operation lookup.
   * @returns Current action state and retained evidence metadata.
   */
  @Remote('getAction') async getAction(request: EnterpriseDeviceActionLookup): Promise<EnterpriseDeviceActionView> {
    return catalogCall(this.ctx, 'enterpriseDevice.getAction', request, 'computer-use-action', request.operationId,
      async (actor) => {
        const action = await this.repository().action(actor.orgId, actor.userId, request.operationId)
        if (action === undefined) throw new Error('computer use action not found')
        return action
      })
  }

  /**
   * Pair a local device identity with the authenticated user.
   * @param request - Local device name, platform, and public key.
   * @returns The server-assigned device identity.
   */
  @Remote('pair') async pair(request: EnterpriseDevicePairRequest): Promise<{ deviceId: string }> {
    return catalogCall(this.ctx, 'enterpriseDevice.pair', request, 'device', 'new', async (actor) => {
      const deviceName = request.deviceName.trim()
      if (deviceName === '' || deviceName.length > 120) throw new Error('device name must contain 1 to 120 characters')
      const deviceId = `device-${randomUUID()}`
      const device = await this.repository().pairDevice({
        deviceId, orgId: actor.orgId, userId: actor.userId, deviceName,
        platform: request.platform, publicKey: normalizeDevicePublicKey(request.publicKey), status: 'online',
      })
      return { deviceId: device.deviceId }
    })
  }

  /** Create one ten-minute recorder binding code for the authenticated user.
   * @param request - Empty recorder-pairing request owned by the authenticated principal.
   * @returns One plaintext code and its expiry; only the hash remains durable.
   */
  @Remote('createRecorderPairing') async createRecorderPairing(
    request: EnterpriseRecorderPairingRequest,
  ): Promise<EnterpriseRecorderPairingChallenge> {
    return catalogCall(this.ctx, 'enterpriseDevice.createRecorderPairing', request, 'recorder-pairing', 'new', async (actor) => {
      const code = String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, '0')
      const challenge = {
        pairingId: `recorder-pairing-${randomUUID()}`,
        orgId: actor.orgId,
        userId: actor.userId,
        codeHash: createHash('sha256').update(code).digest('hex'),
        expiresAt: Date.now() + 10 * 60_000,
      }
      await this.repository().saveRecorderPairing(challenge)
      return { pairingId: challenge.pairingId, code, expiresAt: challenge.expiresAt }
    })
  }

  /** List recorder devices owned by the authenticated user.
   * @param request - Recorder status filter.
   * @returns Redacted recorder devices for the authenticated principal.
   */
  @Remote('listRecorders') async listRecorders(request: EnterpriseRecorderListRequest): Promise<EnterpriseRecorderDeviceView[]> {
    return catalogCall(this.ctx, 'enterpriseDevice.listRecorders', request, 'recorder-device', 'catalog', async (actor) => {
      const recorders = await this.repository().listRecorders(actor.orgId, actor.userId)
      return recorders
        .filter(recorder => request.includeRevoked === true || recorder.status !== 'revoked')
        .map(recorder => ({
          recorderId: recorder.recorderId, deviceName: recorder.deviceName, status: recorder.status,
          ...(recorder.lastSeenAt === undefined ? {} : { lastSeenAt: recorder.lastSeenAt }),
        }))
    })
  }

  /** Read saved recorder model configuration and fresh runtime health.
   * @param request - Empty authenticated runtime lookup.
   * @returns Redacted ASR/CAM configuration and verified readiness.
   */
  @Remote('getRecorderRuntime') async getRecorderRuntime(
    request: EnterpriseRecorderRuntimeRequest,
  ): Promise<EnterpriseRecorderRuntimeView> {
    return catalogCall(this.ctx, 'enterpriseDevice.getRecorderRuntime', request, 'recorder-runtime', 'singleton', () =>
      this.recorderRuntime().status())
  }

  /** Save recorder model configuration after resolving Host-owned Credential references.
   * @param request - Revision-aware ASR/CAM configuration.
   * @returns Saved redacted configuration and current readiness.
   */
  @Remote('saveRecorderRuntime') async saveRecorderRuntime(
    request: EnterpriseRecorderRuntimeSaveRequest,
  ): Promise<EnterpriseRecorderRuntimeView> {
    return catalogCall(this.ctx, 'enterpriseDevice.saveRecorderRuntime', request, 'recorder-runtime', 'singleton', async () => {
      const validated = validateRecorderRuntimeSave(request)
      const credentials: { asrCredential?: string; camCredential?: string } = {}
      if (validated.asr.mode === 'online') {
        const reference = validated.asr.credentialRef
        if (reference === undefined) throw new Error('ASR Credential reference is not configured')
        const value = (await this.ctx.credentials.resolve(credentialRef(reference)))?.value
        if (!value) throw new Error('ASR Credential reference is not configured')
        credentials.asrCredential = value
      }
      if (validated.cam.enabled && validated.cam.mode === 'online') {
        const reference = validated.cam.credentialRef
        if (reference === undefined) throw new Error('CAM Credential reference is not configured')
        const value = (await this.ctx.credentials.resolve(credentialRef(reference)))?.value
        if (!value) throw new Error('CAM Credential reference is not configured')
        credentials.camCredential = value
      }
      return this.recorderRuntime().save(validated, credentials)
    })
  }

  /** Start or hot-reload the saved recorder model configuration.
   * @param request - Empty authenticated start request.
   * @returns Fresh runtime health after startup settles.
   */
  @Remote('startRecorderRuntime') async startRecorderRuntime(
    request: EnterpriseRecorderRuntimeRequest,
  ): Promise<EnterpriseRecorderRuntimeView> {
    return catalogCall(this.ctx, 'enterpriseDevice.startRecorderRuntime', request, 'recorder-runtime', 'singleton', () =>
      this.recorderRuntime().start())
  }

  /** Read the recorder-memory model route and the caller's dedicated processing Session id.
   * @param request - Empty authenticated runtime lookup.
   * @returns Persisted model route and dedicated Session id.
   */
  @Remote('getRecorderMemoryRuntime') async getRecorderMemoryRuntime(
    request: EnterpriseRecorderRuntimeRequest,
  ): Promise<EnterpriseRecorderMemoryRuntimeView> {
    return catalogCall(this.ctx, 'enterpriseDevice.getRecorderRuntime', request, 'recorder-memory-runtime', 'singleton', actor =>
      this.recorderMemoryRuntime().view(actor.userId))
  }

  /** Save the recorder-memory model route after verifying it exists in the active model catalog.
   * @param request - Revision-aware provider, model, and timeout.
   * @returns Persisted model route and dedicated Session id.
   */
  @Remote('saveRecorderMemoryRuntime') async saveRecorderMemoryRuntime(
    request: EnterpriseRecorderMemoryRuntimeSaveRequest,
  ): Promise<EnterpriseRecorderMemoryRuntimeView> {
    return catalogCall(this.ctx, 'enterpriseDevice.saveRecorderRuntime', request, 'recorder-memory-runtime', 'singleton', async (actor) => {
      const provider = request.provider.trim()
      const model = request.model.trim()
      const availableProvider = this.ctx.llm.listProviders().some(candidate => candidate.id === provider)
      if (!availableProvider) throw new Error(`recorder memory provider ${JSON.stringify(provider)} is not configured`)
      const availableModel = (await this.ctx.llm.listModels(provider)).some(candidate => candidate.id === model)
      if (!availableModel) throw new Error(`recorder memory model ${JSON.stringify(model)} is not configured for ${provider}`)
      return this.recorderMemoryRuntime().save({ ...request, provider, model }, actor.userId)
    })
  }

  private recorderRuntime(): RecorderRuntimeBridge {
    return new RecorderRuntimeBridge({
      baseUrl: process.env['DSH_RECORDER_ADMIN_URL'] ?? 'http://127.0.0.1:18765',
      adminToken: process.env['DSH_RECORDER_ADMIN_TOKEN'] ?? '',
    })
  }

  private recorderMemoryRuntime(): RecorderMemoryRuntimeStore {
    return new RecorderMemoryRuntimeStore(
      process.env['DSH_RECORDER_MEMORY_CONFIG'] ?? dshHomePath('storages', 'recorder-memory-runtime.json'),
      {
        provider: process.env['DSH_RECORDER_MEMORY_PROVIDER']?.trim() || 'deepseek-official',
        model: process.env['DSH_RECORDER_MEMORY_MODEL']?.trim() || 'deepseek-flash',
        timeoutMs: Number(process.env['DSH_RECORDER_MEMORY_TIMEOUT_MS'] ?? '12000'),
      },
    )
  }

  /**
   * Refresh the online status of an owned device.
   * @param request - Owned device identity.
   */
  @Remote('heartbeat') async heartbeat(request: { deviceId: string }): Promise<void> {
    await catalogCall(this.ctx, 'enterpriseDevice.heartbeat', request, 'device', request.deviceId, async (actor) => {
      const device = await this.repository().device(request.deviceId)
      if (device === undefined || device.orgId !== actor.orgId || device.userId !== actor.userId) throw new Error('device principal mismatch')
      await this.repository().heartbeat({ ...device, status: 'online' })
    })
  }
  /**
   * Start one governed Computer Use run.
   * @param request - Device, workspace, session, and confirmation mode.
   * @returns The new run identity.
   */
  @Remote('startRun') async startRun(request: EnterpriseComputerUseStartRequest): Promise<{ runId: string }> {
    return catalogCall(this.ctx, 'enterpriseDevice.startRun', request, 'computer-use-run', request.deviceId, async (actor) => {
      await this.requireDevice(actor, request.deviceId)
      const [workspace, session] = await Promise.all([
        this.ctx.enterpriseSecurity.authorizeApiAsync(actor, 'session.create', { workspaceId: request.workspaceId }),
        this.ctx.enterpriseSecurity.authorizeApiAsync(actor, 'sessions.history', { sessionId: request.sessionId }),
      ])
      if (!workspace.allowed || !session.allowed) throw new Error('computer use workspace or session is forbidden')
      const runId = `computer-use-${randomUUID()}`
      await this.repository().saveRun({ runId, orgId: actor.orgId, userId: actor.userId, deviceId: request.deviceId,
        workspaceId: request.workspaceId, sessionId: request.sessionId, mode: request.mode, status: 'active' })
      return { runId }
    })
  }
  /**
   * Validate and queue one short-lived device operation action.
   * @param request - Governed adapter operation and required capability.
   * @returns The permit and queued action identities.
   */
  @Remote('issuePermit') async issuePermit(request: EnterpriseDevicePermitRequest): Promise<{ permitId: string; actionId: string }> {
    return catalogCall(this.ctx, 'enterpriseDevice.issuePermit', request, 'computer-use-permit', request.operationId, async (actor) => {
      await this.requireDevice(actor, request.deviceId)
      const run = await this.repository().run(request.runId)
      if (run === undefined || run.orgId !== actor.orgId || run.userId !== actor.userId
        || run.deviceId !== request.deviceId || run.status !== 'active') {
        throw new Error('computer use run is unavailable')
      }
      validateQueuedDeviceAction({
        mode: run.mode, capability: request.capability, adapter: request.adapter, operation: request.operation,
      })
      const permitId = `permit-${randomUUID()}`
      const queued = await this.repository().enqueueAction({
        permitId, orgId: actor.orgId, userId: actor.userId, deviceId: request.deviceId,
        runId: request.runId, operationId: request.operationId, capability: request.capability, consumed: false,
      }, Date.now() + 60_000, { adapter: request.adapter, operation: request.operation })
      return { permitId, actionId: queued.actionId }
    })
  }
  /**
   * Consume a permit exactly once before local execution.
   * @param request - Operation ownership tuple.
   */
  @Remote('consumePermit') async consumePermit(request: Pick<EnterpriseDevicePermitRequest, 'deviceId' | 'runId' | 'operationId'>): Promise<void> {
    await catalogCall(this.ctx, 'enterpriseDevice.consumePermit', request, 'computer-use-permit', request.operationId, async (actor) => {
      if (!(await this.repository().consumePermit({ orgId: actor.orgId, userId: actor.userId, ...request }))) {
        throw new Error('operation permit is missing, expired, consumed, or belongs to another principal')
      }
    })
  }
  /**
   * Pause, resume, or stop a Computer Use run using optimistic concurrency.
   * @param request - Target state and expected run revision.
   * @returns The transitioned run snapshot.
   */
  @Remote('transitionRun') async transitionRun(request: EnterpriseComputerUseTransitionRequest): Promise<EnterpriseComputerUseRun> {
    return catalogCall(this.ctx, 'enterpriseDevice.transitionRun', request, 'computer-use-run', request.runId, async (actor) => {
      const value = await this.repository().transitionRun({ orgId: actor.orgId, userId: actor.userId, ...request })
      if (value === undefined) throw new Error('computer use run revision conflict or principal mismatch')
      return value
    })
  }
  private async requireDevice(actor: EnterprisePrincipal, deviceId: string): Promise<void> {
    const device = await this.repository().device(deviceId)
    if (device === undefined || device.orgId !== actor.orgId || device.userId !== actor.userId || device.status !== 'online') throw new Error('device principal mismatch')
  }
  private repository(): PostgresDevicePlaneRepository { return this.ctx.enterprisePostgres.devicePlane }
}

/** Enterprise employee Draft and Release Remote service. */
export class EnterpriseEmployeeController extends TypertRemoteService {
  static inject = ['enterprisePostgres', 'enterpriseSecurity', 'enterpriseRequestContext', 'agentPresets', 'loader', 'llm']
  /** Disposers of the Agent preset declarations this controller registered, keyed by preset id. */
  private readonly employeePresetDisposers = new Map<string, Promise<() => Promise<void>>>()
  private readonly employeePresetOrgs = new Map<string, string>()
  private readonly restoration: Promise<void>
  /** @param ctx - authenticated enterprise Host context. */
  constructor(ctx: Context) {
    super(ctx, 'enterpriseEmployeeController', { namespace: 'enterpriseEmployee' })
    ctx.effect(() => ctx.agentPresets.registerAccessPolicy(id => this.canUsePreset(id)), 'enterprise employee preset access')
    this.restoration = ctx.loader.await().then(() => this.restorePublishedPresets())
    void this.restoration.catch((error: unknown) => { ctx.logger.error(`employee preset restoration failed: ${String(error)}`) })
    ctx.effect(() => async () => {
      await this.restoration.catch(() => undefined)
      for (const pending of this.employeePresetDisposers.values()) {
        const dispose = await pending.catch(() => undefined)
        if (dispose !== undefined) await dispose()
      }
    }, 'enterprise employee preset declarations')
  }

  private async canUsePreset(id: string): Promise<boolean> {
    const principal = this.ctx.enterpriseRequestContext.current()
    if (principal === undefined) return true
    await this.restoration
    const orgId = this.employeePresetOrgs.get(id)
    if (orgId === undefined) return true
    if (orgId !== principal.orgId) return false
    return (await this.ctx.enterpriseSecurity.authorizeApiAsync(
      principal, 'enterpriseEmployee.getDraft', { presetId: id },
    )).allowed
  }

  private async restorePublishedPresets(): Promise<void> {
    const releases = await this.ctx.enterprisePostgres.catalog.listLatestReleases()
    for (const release of releases) {
      this.employeePresetOrgs.set(release.presetId, release.orgId)
      await this.registerEmployeePreset(release.presetId, employeePresetDefinition(release))
    }
  }

  /** Install or replace the released employee's Agent preset declaration.
   *
   * The declaration is held in the registry this process owns; startup restores the latest
   * published release after Loader settlement. A live session keeps the composition it mounted —
   * the registry retires the replaced revision only once its last reader releases it.
   * @param release - the immutable Release just published.
  */
  private async configurePublishedEmployee(release: EnterpriseEmployeeRelease): Promise<void> {
    this.employeePresetOrgs.set(release.presetId, release.orgId)
    const input = employeePresetDefinition(release)
    try {
      await this.registerEmployeePreset(release.presetId, input)
    } catch {
      try {
        await this.registerEmployeePreset(release.presetId, input)
      } catch (error) {
        throw new EmployeePresetSyncError(release.presetId, { cause: error })
      }
    }
  }

  /** Register one declaration, replacing this controller's previous registration for the id.
   * @param presetId - the preset identity the release publishes under.
   * @param input - the validated employee identity from the release snapshot.
  */
  private async registerEmployeePreset(presetId: string, input: EmployeePresetDefinition): Promise<void> {
    const previous = this.employeePresetDisposers.get(presetId)
    if (previous !== undefined) {
      // A rejected registration created no definition, so it also has nothing to dispose.
      const disposer = await previous.catch(() => undefined)
      if (disposer !== undefined) await disposer()
    }
    const registration = this.ctx.agentPresets.register(
      await employeePresetDeclaration(this.ctx, presetId, input))
    this.employeePresetDisposers.set(presetId, registration)
    await registration
    const declared = await this.ctx.agentPresets.resolve(presetId)
    if (declared.broken !== undefined) throw new Error(`agent preset ${presetId} failed to activate: ${declared.broken}`)
  }

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
      const visible = await Promise.all(page.items.map(async item =>
        (await this.ctx.enterpriseSecurity.authorizeApiAsync(
          principal, 'enterpriseEmployee.getDraft', { presetId: item.presetId },
        )).allowed ? item : undefined))
      return {
        ...page,
        items: visible.filter((item): item is typeof page.items[number] => item !== undefined),
      } as EnterpriseEmployeePage
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
   * Improve one unsaved responsibility prompt through a caller-selected configured model.
   * @param request - employee prompt and selected model route.
   * @returns the optimized prompt without saving a Draft.
   */
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
      await this.restoration
      const release = await this.ctx.enterprisePostgres.catalog.publishDraft({
        ...request, orgId: principal.orgId, publishedBy: principal.userId,
      }) as EnterpriseEmployeeRelease
      await this.configurePublishedEmployee(release)
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
  /**
   * Start the provider authorization flow for one authenticated installation.
   * @param input - signed pending installation state and provider callback details.
   * @returns provider authorization URL and expiry matching the pending installation.
   */
  begin(input: PendingChannelBotInstall & { readonly state: string }): Promise<{
    readonly authorizationUrl: string
    readonly expiresAt: number
  }>
  /**
   * Exchange a completed provider authorization for verified Bot metadata.
   * @param input - signed pending installation state and provider authorization code.
   * @returns verified Bot metadata and the credential reference to persist.
   */
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
   * List channel configurations visible to the authenticated principal's hierarchy scope.
   * @param request - optional archived-record filter.
   * @returns secret-free channel configuration projections.
   */
  @Remote('list')
  async list(request: EnterpriseChannelListRequest): Promise<EnterpriseChannelPage> {
    return this.run('enterpriseChannel.list', 'catalog', async () => {
      const page = await operations(this.ctx).listChannelConfigurations(principal(this.ctx))
      const values = request.includeArchived ? page.items : page.items.filter(item => item.state !== 'archived')
      const actor = principal(this.ctx)
      const visible = await Promise.all(values.map(async item =>
        (await this.ctx.enterpriseSecurity.authorizeApiAsync(
          actor, 'enterpriseChannel.get', { channelId: item.channelId },
        )).allowed ? this.present(item) : undefined))
      return { items: visible.filter((item): item is EnterpriseChannelConfiguration => item !== undefined) }
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
   * @param request - provider and redirect URI for the installation session.
   * @returns setup instructions or an expiring provider authorization session.
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

  /**
   * Poll an official Device Authorization Grant and create the channel after provider confirmation.
   * @param request - installation identity, idempotency key, and optional verification code.
   * @returns pending, verification-required, or completed installation state.
   */
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

  /**
   * Complete a signed provider-app installation and create the governed channel automatically.
   * @param request - signed installation callback, authorization code, and idempotency key.
   * @returns the created secret-free channel configuration.
   */
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
    if (request.expectedRevision === 0)
      throw enterpriseFailure(new EnterpriseOperationsError('invalid-state', 'team', request.teamId),
        'enterpriseTeam.save', 'fixed-team', request.teamId)
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
   * Read an owner-visible draft without substituting it for the active charter.
   * @param request - team identity for the requested draft.
   * @returns the owner-visible draft revision.
   */
  @Remote('getDraft')
  async getDraft(request: EnterpriseTeamDefinitionDraftLookup): Promise<EnterpriseTeamDefinitionRevision> {
    return this.run('enterpriseTeamDefinition.getDraft', request.teamId, async () => {
      const value = await operations(this.ctx).getTeamDefinitionDraft(principal(this.ctx), request)
      if (value === undefined) throw new EnterpriseOperationsError('not-found', 'team-definition', request.teamId)
      return value as EnterpriseTeamDefinitionRevision
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
      operations(this.ctx).saveTeamDefinitionDraft(principal(this.ctx), {
        ...request, state: request.state === 'needs-charter' ? 'needs-charter' : 'draft',
      }) as Promise<EnterpriseTeamDefinition>)
  }

  /**
   * Save a draft without changing the active Team Definition used by TeamRuns.
   * @param request - team identity, draft payload, and write guards.
   * @returns the definition containing the saved draft.
   */
  @Remote('draft')
  async draft(request: EnterpriseTeamDefinitionDraftRequest): Promise<EnterpriseTeamDefinition> {
    return this.run('enterpriseTeamDefinition.draft', request.teamId, () =>
      operations(this.ctx).saveTeamDefinitionDraft(principal(this.ctx), request) as Promise<EnterpriseTeamDefinition>)
  }

  /**
   * Validate and publish the currently selected draft for new TeamRuns.
   * @param request - team identity and expected draft revision.
   * @returns the definition with its newly active charter.
   */
  @Remote('publish')
  async publish(request: EnterpriseTeamDefinitionPublishRequest): Promise<EnterpriseTeamDefinition> {
    return this.run('enterpriseTeamDefinition.publish', request.teamId, () =>
      operations(this.ctx).publishTeamDefinitionDraft(principal(this.ctx), request) as Promise<EnterpriseTeamDefinition>)
  }

  /**
   * Discard a draft while retaining both the active definition and historical TeamRuns.
   * @param request - team identity and expected draft revision.
   * @returns the retained active definition revision.
   */
  @Remote('discardDraft')
  async discardDraft(request: EnterpriseTeamDefinitionDiscardDraftRequest): Promise<EnterpriseTeamDefinitionRevision> {
    return this.run('enterpriseTeamDefinition.discardDraft', request.teamId, () =>
      operations(this.ctx).discardTeamDefinitionDraft(principal(this.ctx), request) as Promise<EnterpriseTeamDefinitionRevision>)
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

  /** Archive one owner-private Plugin while retaining its immutable versions.
   * @param request - Workspace, Plugin, and idempotency key.
   * @returns archived Plugin state.
   */
  @Remote('archive') async archive(request: CordisWorkspaceArchiveRequest): Promise<CordisPluginArchive> {
    return catalogCall(this.ctx, 'cordisWorkspace.archive', request, 'cordis-plugin', request.pluginId, actor =>
      cordis(this.ctx).archivePersonal({ principal: actor, ...request }))
  }

  /** Restore one archived owner-private Plugin without activating it.
   * @param request - Workspace, Plugin, and idempotency key.
   * @returns restored Plugin state.
   */
  @Remote('restore') async restore(request: CordisWorkspaceArchiveRequest): Promise<CordisPluginArchive> {
    return catalogCall(this.ctx, 'cordisWorkspace.restore', request, 'cordis-plugin', request.pluginId, actor =>
      cordis(this.ctx).restorePersonal({ principal: actor, ...request }))
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

  /** Submit an owned saved version from a department Workspace for review.
   * @param request - saved Package and Workspace identity.
   * @returns pending review.
   */
  @Remote('submitSaved') async submitSaved(request: CordisReviewSubmitSavedRequest): Promise<CordisReviewRequest> {
    return catalogCall(this.ctx, 'cordisReview.submitSaved', request, 'cordis-plugin', request.packageId, actor =>
      cordis(this.ctx).submitSavedDepartment({ principal: actor, ...request }))
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
  static inject = ['enterprisePostgres', 'enterpriseSecurity', 'enterpriseRequestContext', 'sessionController', 'agentPresets', 'sessionProjections']
  private readonly work: EnterpriseWorkStartService
  private readonly workspaceDefaults: WorkspaceEmployeeDefaultService
  private readonly employeePersonas = new Map<string, () => Promise<void>>()
  private readonly employeeActors = new Map<string, { orgId: string; userId: string; employeeId: string }>()
  constructor(ctx: Context) {
    super(ctx, 'enterpriseWorkController', { namespace: 'enterpriseWork' })
    ctx.sessionProjections.register(employeeReleaseProjectionDefinition)
    ctx.on('agent/created', async ({ agent }) => {
      const selected = ctx.sessionProjections.stateOf(agent.session, 'enterpriseEmployeeRelease')
      if (selected === null || selected === undefined) return
      const ownerUserId = await ctx.enterprisePostgres.identity.sessionOwnerUserId(String(agent.id))
      if (ownerUserId !== selected.ownerUserId) throw new Error('selected employee Session owner mismatch')
      const workspace = await ctx.enterprisePostgres.identity.sessionWorkspaceGrant(String(agent.id))
      if (workspace?.orgId !== selected.orgId) throw new Error('selected employee Workspace mismatch')
      const release = await ctx.enterprisePostgres.catalog.getRelease(selected.releaseId, selected.orgId)
      if (release?.presetId !== selected.employeeId) throw new Error('selected employee release is unavailable')
      await this.mountEmployee(agent, release)
      this.employeeActors.set(String(agent.id), {
        orgId: selected.orgId, userId: selected.ownerUserId, employeeId: selected.employeeId,
      })
    })
    ctx.on('agent/disposed', ({ agent }) => {
      void this.removeEmployee(agent.id).catch((error: unknown) => {
        ctx.logger.error(`employee scope disposal failed: ${String(error)}`)
      })
    })
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
      workspaceEmployeeDefault: async id => (await ctx.enterprisePostgres.identity.workspaceEmployeeDefault(id))?.employeeId ?? null,
      createSession: async ({ sessionId, workspaceId }) =>
        session.create({ sessionId, workspaceId, agentPreset: ctx.agentPresets.defaultId }),
      bindSession: (actor, sessionId, workspaceId) => ctx.enterpriseSecurity.bindSessionWorkspaceAsync(actor, sessionId, workspaceId),
      bindEmployee: (actor, sessionId, releaseId) => this.bindReleasedEmployee(actor, sessionId, releaseId),
      upsertRecord: async (input) => { await operations(ctx).upsertWorkRecord(input.principal, {
        sessionId: input.sessionId, employeeReleaseId: input.employeeReleaseId, source: 'console', businessState: 'active',
        sourceReferences: input.sourceReferences, expectedRevision: 0, idempotencyKey: input.idempotencyKey,
      }) },
      reserveWorkStart: ({ principal: actor, ...input }) => operations(ctx).reserveWorkStart(actor, input),
      getWorkStart: ({ principal: actor, ...input }) => operations(ctx).getWorkStart(actor, input),
      completeWorkStart: ({ principal: actor, ...input }) => operations(ctx).completeWorkStart(actor, input),
    })
    this.workspaceDefaults = new WorkspaceEmployeeDefaultService({
      grant: async (id) => {
        const grant = await ctx.enterprisePostgres.identity.workspaceGrant(id)
        if (grant === undefined || grant.kind === 'project') return undefined
        return { workspaceId: grant.workspaceId, orgId: grant.orgId, kind: grant.kind,
          ...(grant.ownerUserId === undefined ? {} : { ownerUserId: grant.ownerUserId }),
          ...(grant.departmentId === undefined ? {} : { departmentId: grant.departmentId }) }
      },
      mayUseWorkspace: async (actor, id) => (await ctx.enterpriseSecurity.authorizeApiAsync(actor, 'session.create', { workspaceId: id })).allowed,
      departmentManagers: async (orgId, departmentId) =>
        (await ctx.enterprisePostgres.cordis.departmentManagers(orgId, departmentId))?.managerUserIds ?? [],
      publishedEmployee: async (id, orgId) => {
        const draft = await ctx.enterprisePostgres.catalog.getDraft(id, orgId)
        if (draft?.status !== 'published') return undefined
        const releases = await ctx.enterprisePostgres.catalog.listReleases(id, orgId)
        return releases.length === 0 ? undefined : { presetId: id, orgId }
      },
      mayUseEmployee: async (actor, id) => (await ctx.enterpriseSecurity.authorizeApiAsync(
        actor, 'enterpriseEmployee.getDraft', { presetId: id },
      )).allowed,
      read: id => ctx.enterprisePostgres.identity.workspaceEmployeeDefault(id),
      save: input => ctx.enterprisePostgres.identity.saveWorkspaceEmployeeDefault(input),
    })
  }
  private async removeEmployee(sessionId: string): Promise<void> {
    this.employeeActors.delete(sessionId)
    const dispose = this.employeePersonas.get(sessionId)
    this.employeePersonas.delete(sessionId)
    if (dispose !== undefined) await dispose()
  }
  /** Actor used by employee-private memory for a live, release-bound Session.
   * @param sessionId - Session identity.
   * @returns the selected employee and Session owner, if active.
   */
  employeeActor(sessionId: string): { orgId: string; userId: string; employeeId: string } | undefined {
    return this.employeeActors.get(sessionId)
  }
  private async bindReleasedEmployee(actor: EnterprisePrincipal, sessionId: string, releaseId: string): Promise<void> {
    const release = await this.ctx.enterprisePostgres.catalog.getRelease(releaseId, actor.orgId)
    if (release === undefined) throw new Error('employee release is not available')
    if (!(await this.ctx.enterpriseSecurity.authorizeApiAsync(actor, 'enterpriseEmployee.getDraft', { presetId: release.presetId })).allowed) {
      throw new Error('employee is not available')
    }
    const sessionController = this.ctx.get('sessionController') as {
      resolveAgent(sessionId: SessionId): Promise<
        { agent: Parameters<Context['agentPresets']['select']>[0] } | { error: Error }
      >
    } | undefined
    if (sessionController === undefined) throw new Error('session controller is unavailable')
    const resolved = await sessionController.resolveAgent(SessionId(sessionId))
    if ('error' in resolved) throw resolved.error
    const agent = resolved.agent
    const boundary = this.ctx.sessionProjections.stateOf(agent.session, 'turnBoundary')
    if (boundary !== undefined && (boundary.openTurnStartSeq !== null || boundary.lastTurn > 0)) {
      throw new Error('employee selection is locked after the first turn')
    }
    await this.mountEmployee(agent, release)
    agent.session.append('enterprise-employee/selected', {
      employeeId: release.presetId, releaseId: release.releaseId, releaseVersion: release.version,
      orgId: actor.orgId, ownerUserId: actor.userId,
    })
    this.employeeActors.set(sessionId, {
      orgId: actor.orgId, userId: actor.userId, employeeId: release.presetId,
    })
  }
  private async mountEmployee(agent: { id: string; ctx: Context }, release: Pick<EnterpriseEmployeeRelease, 'releaseId' | 'version'> & {
    readonly snapshot: { readonly profile: Readonly<Record<string, unknown>> }
  }): Promise<void> {
    await this.removeEmployee(agent.id)
    this.employeePersonas.set(agent.id, await installEmployeePersona(
      agent.ctx, employeePersona(employeePresetDefinition(release)),
    ))
  }
  /** Read the caller-visible default employee for one authorized Workspace.
   * @param request - Workspace identity.
   * @returns the visible employee choice and revision.
   */
  @Remote('workspaceDefault') async workspaceDefault(request: WorkspaceEmployeeDefaultRequest): Promise<WorkspaceEmployeeDefaultView> {
    return catalogCall(this.ctx, 'enterpriseWork.workspaceDefault', request, 'workspace', request.workspaceId,
      actor => this.workspaceDefaults.read(actor, request.workspaceId))
  }
  /** Set or clear a Workspace default under its manager policy and CAS revision.
   * @param request - Workspace, employee choice, and expected revision.
   * @returns the new caller-visible choice.
   */
  @Remote('saveWorkspaceDefault') async saveWorkspaceDefault(request: WorkspaceEmployeeDefaultSaveRequest): Promise<WorkspaceEmployeeDefaultView> {
    return catalogCall(this.ctx, 'enterpriseWork.saveWorkspaceDefault', request, 'workspace', request.workspaceId,
      actor => this.workspaceDefaults.save(actor, request))
  }
  /** Select a published employee for one owned blank Session and record the release used.
   * @param request - Owned Session and employee identity.
   * @returns the Workspace and immutable release mounted in that Session.
   */
  @Remote('selectEmployee') async selectEmployee(request: EnterpriseEmployeeSessionRequest): Promise<EnterpriseEmployeeSessionValue> {
    return catalogCall(this.ctx, 'enterpriseWork.selectEmployee', request, 'employee', request.employeeId, async (actor) => {
      if (!await this.ctx.enterpriseSecurity.sessionOwnedBy(actor, request.sessionId)) throw new Error('session is not available')
      const grant = await this.ctx.enterprisePostgres.identity.sessionWorkspaceGrant(request.sessionId)
      if (grant === undefined || grant.orgId !== actor.orgId ||
        !(await this.ctx.enterpriseSecurity.authorizeApiAsync(actor, 'session.create', { workspaceId: grant.workspaceId })).allowed) {
        throw new Error('workspace is not available')
      }
      if (!(await this.ctx.enterpriseSecurity.authorizeApiAsync(actor, 'enterpriseEmployee.getDraft', { presetId: request.employeeId })).allowed) {
        throw new Error('employee is not available')
      }
      const draft = await this.ctx.enterprisePostgres.catalog.getDraft(request.employeeId, actor.orgId)
      if (draft?.status !== 'published') throw new Error('employee is not published')
      const release = (await this.ctx.enterprisePostgres.catalog.listReleases(request.employeeId, actor.orgId))
        .sort((a, b) => b.version - a.version)[0]
      if (release === undefined) throw new Error('employee has no published release')
      await this.bindReleasedEmployee(actor, request.sessionId, release.releaseId)
      return {
        sessionId: request.sessionId, employeeId: request.employeeId, workspaceId: grant.workspaceId,
        employeeReleaseId: release.releaseId, releaseVersion: release.version,
      }
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
): RemoteError {
  let code = 'internal'
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
  } else if (error instanceof EmployeePresetSyncError) {
    code = 'enterprise-invalid-state'; message = error.message
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
  return new RemoteError(code as never, message, { endpoint, resourceType, resourceId } as never)
}

async function enterpriseRequest(req: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    bytes += buffer.byteLength
    if (bytes > 64 * 1024) throw new Error('device agent payload too large')
    chunks.push(buffer)
  }
  const host = typeof req.headers.host === 'string' ? req.headers.host : 'dsh.internal'
  return new Request(`http://${host}${req.url ?? '/device-agent/v1'}`, {
    method: req.method ?? 'GET',
    headers: Object.fromEntries(Object.entries(req.headers).filter((entry): entry is [string, string] =>
      typeof entry[1] === 'string')),
    ...(chunks.length === 0 ? {} : { body: Buffer.concat(chunks) }),
  })
}

async function writeResponse(res: ServerResponse, response: Response): Promise<void> {
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()))
  if (response.body === null) { res.end(); return }
  for await (const chunk of response.body) res.write(chunk)
  res.end()
}

/** One composed HTTP plane resolution: the service value, or the fail-loud response to answer with. */
type ResolvedPlane<T> =
  | { readonly service: T; readonly unavailable?: undefined }
  | { readonly service?: undefined; readonly unavailable: Response }

/** Resolve one lazily composed service; an absent plane yields the fail-loud 503 response. */
function resolvePlane<T>(service: T | undefined, error: string): ResolvedPlane<T> {
  return service === undefined
    ? { unavailable: Response.json({ error }, { status: 503 }) }
    : { service }
}

/** Route one parsed HTTP request through its handler, folding transport failures to 400. */
async function serveRoute(
  res: ServerResponse,
  request: Request,
  route: (request: Request) => Promise<Response>,
): Promise<void> {
  try { await writeResponse(res, await route(request)) }
  catch (error) { console.error('[serveRoute]', request.method, new URL(request.url).pathname, error); await writeResponse(res, Response.json({ error: 'invalid-request' }, { status: 400 })) }
}

/** Install all enterprise Remote namespace owners.
 * @param ctx - Enterprise Host context.
 * @param config - Validated room context and handoff limits.
*/
export function apply(ctx: Context, config: Config): void {
  if (!isAbsolute(config.projectWorkspaceRoot)) throw new Error('project Workspace root must be absolute')
  const workflowIdentity = new CollaborationIdentity(ctx.credentials, ctx.enterprisePostgres.roomEvents, {
    human: async (actor, roomId) => {
      try { await collaboration.service.detail(actor, roomId); return true }
      catch { return false }
    },
    employee: () => Promise.resolve(false),
    service: async (orgId, serviceId, roomId) => {
      if (serviceId !== 'channel-workflow') return false
      return (await ctx.enterprisePostgres.collaboration.get(orgId, roomId))?.kind === 'channel'
    },
  })
  const workflowEvents = new ChannelWorkflowEventService({
    workflowLeaseMs: config.workflowLeaseMs,
    ledger: orgId => new PostgresChannelWorkflowLedger(ctx.enterprisePostgres.database, orgId),
    sign: (actor, row, content, stepId, sourceEventId, targetEmployeeIds) => workflowIdentity.signService({
      orgId: actor.orgId, serviceId: 'channel-workflow',
    }, row.id, { type: 'workflow', content, stepId,
      ...(sourceEventId === undefined || !/^[0-9a-f]{64}$/u.test(sourceEventId) ? {} : { sourceEventId }),
      ...(targetEmployeeIds === undefined ? {} : { targetEmployeeIds }) }),
    append: (actor, row, event, requestId) => ctx.enterprisePostgres.roomEvents.append({
      orgId: row.orgId, surfaceId: row.id, event, authorKind: 'service',
      authorId: 'channel-workflow', requestId, requestedByUserId: actor.userId,
    }),
    dispatchBot: async (actor, row, event, employeeId) => {
      if (!row.memberEmployeeIds.includes(employeeId)) throw new Error('workflow employee left the room')
      await collaboration.service.dispatchSignedEvent(actor, row.id, event.event.id)
    },
    createApproval: async (actor, row, summary, idempotencyKey) => {
      if (summary.trim() === '') throw new Error('workflow approval summary is empty')
      const digest = createHash('sha256').update(idempotencyKey).digest('hex')
      const approval = await ctx.enterprisePostgres.operations.createApprovalRequest({
        orgId: row.orgId, approvalId: `channel-workflow-${digest}`, kind: 'business',
        subjectType: 'channel-workflow', subjectId: row.id, requestedBy: actor.userId,
        idempotencyKey: `channel-workflow-${digest}`,
      })
      return { decisionId: approval.approvalId }
    },
  })
  const dispatchWorkflowTrigger = async (actor: EnterprisePrincipal,
    row: NonNullable<Awaited<ReturnType<typeof ctx.enterprisePostgres.collaboration.get>>>,
    event: Awaited<ReturnType<typeof ctx.enterprisePostgres.roomEvents.append>>): Promise<void> => {
    const database = ctx.enterprisePostgres.database
    const claim = await PostgresChannelWorkflowLedger.claimRoomTriggerForEvent(database,
      row.orgId, row.id, event.event.id, Date.now(), config.roomDispatchLeaseMs)
    if (claim === undefined) return
    try {
      const complete = await workflowEvents.onRoomEvent(actor, row, event, claim.revisions)
      if (complete) await PostgresChannelWorkflowLedger.completeRoomTrigger(database, claim)
      else await PostgresChannelWorkflowLedger.releaseRoomTrigger(database, claim)
    } catch (error) {
      await PostgresChannelWorkflowLedger.releaseRoomTrigger(database, claim)
      throw error
    }
  }
  const collaboration = composeCollaboration(ctx, {
    operations: () => operations(ctx), teams: () => teamControl(ctx),
    limits: { roomContextCharacters: config.roomContextCharacters,
      roomContextEvents: config.roomContextEvents, maxBotHops: config.maxBotHops,
      roomDispatchPollMs: config.roomDispatchPollMs, roomDispatchLeaseMs: config.roomDispatchLeaseMs },
    roomEventCommitted: dispatchWorkflowTrigger,
  })
  const requireWorkflowManager = async (orgId: string, channelId: string, userId: string): Promise<{
    actor: EnterprisePrincipal
    room: NonNullable<Awaited<ReturnType<typeof ctx.enterprisePostgres.collaboration.get>>>
  }> => {
    const user = (await ctx.enterprisePostgres.identity.listUsers(orgId))
      .find(value => value.id === userId && !value.disabled)
    const room = await ctx.enterprisePostgres.collaboration.get(orgId, channelId)
    if (user === undefined || room?.kind !== 'channel') throw new Error('channel workflow manager unavailable')
    const actor: EnterprisePrincipal = { orgId, userId: user.id, roles: user.roles }
    await collaboration.service.detail(actor, room.id)
    const allowed = await ctx.enterpriseSecurity.authorizeResourceAsync(actor, 'employee.create',
      { orgId, visibility: 'organization' })
    if (!allowed.allowed) throw new Error('channel workflow manager permission revoked')
    return { actor, room }
  }
  const gitBridge = new ChannelGitWorkflowBridge({
    subscriptions: () => PostgresChannelWorkflowLedger.gitSubscriptions(ctx.enterprisePostgres.database),
    eligible: async (subscription) => {
      try {
        await requireWorkflowManager(subscription.orgId, subscription.channelId, subscription.createdBy)
        return true
      } catch (error) {
        if (error instanceof CollaborationError && error.status === 404
          || error instanceof Error && (error.message === 'channel workflow manager unavailable'
            || error.message === 'channel workflow manager permission revoked')) return false
        throw error
      }
    },
    publish: async (subscription, delivery) => {
      const { actor, room } = await requireWorkflowManager(subscription.orgId,
        subscription.channelId, subscription.createdBy)
      const content = delivery.tag !== undefined
        ? `Git tag ${delivery.tag} pushed to ${delivery.repository}`
        : delivery.gitEvent === 'review_submitted' ? `Git review submitted in ${delivery.repository}`
          : delivery.gitEvent === 'patch_merged' ? `Git patch merged in ${delivery.repository}`
            : `Verified GitHub ${delivery.eventName} webhook from ${delivery.source}`
      const event = await workflowIdentity.signService({ orgId: actor.orgId, serviceId: 'channel-workflow' },
        room.id, { type: 'workflow', content, stepId: `git:${delivery.deliveryKey}` })
      const saved = await ctx.enterprisePostgres.roomEvents.append({ orgId: actor.orgId,
        surfaceId: room.id, event, authorKind: 'service', authorId: 'channel-workflow',
        requestId: `git:${delivery.deliveryKey}` })
      return saved.event.id
    },
    run: async (subscription, trigger, signedSourceEventId, revisions) => {
      const { actor, room } = await requireWorkflowManager(subscription.orgId,
        subscription.channelId, subscription.createdBy)
      return workflowEvents.onExternal(actor, room, trigger, signedSourceEventId, revisions)
    },
  })
  if (config.channelGitHubSecretRef !== '') {
    const secretRef = credentialRef(config.channelGitHubSecretRef)
    if (config.channelGitHubSource.trim() !== config.channelGitHubSource
      || config.channelGitHubSource === '') throw new Error('channel GitHub source must be non-empty and trimmed')
    const githubIngress = new ChannelGitHubIngress({
      source: config.channelGitHubSource, maxBodyBytes: config.channelGitHubMaxBodyBytes,
      resolveSecret: async () => (await ctx.credentials.resolve(secretRef))?.value,
      handle: delivery => gitBridge.onVerifiedDelivery(delivery),
    })
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact', path: '/enterprise/channel-workflows/github',
      handler: async (req, res) => {
        const headers = new Headers()
        for (const [name, value] of Object.entries(req.headers)) {
          if (typeof value === 'string') headers.set(name, value)
          else if (Array.isArray(value)) for (const part of value) headers.append(name, part)
        }
        const url = `http://localhost${req.url ?? '/enterprise/channel-workflows/github'}`
        const request = new Request(url, { method: req.method ?? 'GET', headers,
          body: Readable.toWeb(req) as ReadableStream<Uint8Array>, duplex: 'half' } as RequestInit & { duplex: 'half' })
        await writeResponse(res, await githubIngress.fetch(request))
      },
    }), 'enterprise-channel-workflow: verified durable GitHub ingress')
  }
  const workflowHttp = new ChannelWorkflowHttpHandler({
    security: ctx.enterpriseSecurity,
    detail: (actor, id) => collaboration.service.detail(actor, id),
    ledger: orgId => new PostgresChannelWorkflowLedger(ctx.enterprisePostgres.database, orgId),
    resolveDecision: async (actor, channelId, decisionId, input) => {
      const before = await operations(ctx).getApproval(actor, { approvalId: decisionId })
      if (before?.subjectType !== 'channel-workflow' || before.subjectId !== channelId) {
        throw new CollaborationError('approval-not-found', 404)
      }
      const updated = await operations(ctx).transitionApproval(actor, {
        approvalId: decisionId, state: input.approved ? 'approved' : 'rejected',
        reviewerUserId: actor.userId, expectedRevision: input.expectedRevision,
        idempotencyKey: input.idempotencyKey,
      })
      const room = await ctx.enterprisePostgres.collaboration.get(actor.orgId, channelId)
      if (room === undefined) throw new CollaborationError('not-found', 404)
      await commitWorkflowDecision(actor, room, decisionId, input.approved)
      return updated
    },
  })
  async function commitWorkflowDecision(actor: EnterprisePrincipal,
    room: NonNullable<Awaited<ReturnType<typeof ctx.enterprisePostgres.collaboration.get>>>,
    decisionId: string, approved: boolean): Promise<void> {
    await recordHumanWorkflowDecision(actor, room, decisionId, approved)
    await workflowEvents.onDecision(actor, room, decisionId, approved)
  }
  async function recordHumanWorkflowDecision(actor: EnterprisePrincipal,
    room: NonNullable<Awaited<ReturnType<typeof ctx.enterprisePostgres.collaboration.get>>>,
    decisionId: string, approved: boolean): Promise<void> {
    const signed = await workflowIdentity.signHuman(actor, room.id, {
      type: 'workflow', content: `${approved ? 'Approved' : 'Rejected'} workflow decision ${decisionId}`,
      stepId: `decision:${decisionId}`,
    })
    await ctx.enterprisePostgres.roomEvents.append({ orgId: actor.orgId, surfaceId: room.id,
      event: signed, authorKind: 'human', authorId: actor.userId,
      requestId: `decision:${decisionId}` })
  }
  const deviceAgent = new DeviceAgentHttpHandler(ctx.enterprisePostgres.devicePlane)
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix', path: '/device-agent/v1',
    handler: async (req, res) => {
      try { await writeResponse(res, await deviceAgent.fetch(await enterpriseRequest(req))) }
      catch { await writeResponse(res, Response.json({ error: 'invalid-request' }, { status: 400 })) }
    },
  }), 'enterprise-device: signed device agent route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix', path: '/enterprise/employees',
    handler: async (req, res) => {
      // Composed plugins provide the first two keys (employee-http `inject`); without
      // them the employee plane is absent and every route fails loud. The memory
      // plane is part of this package's own `enterprisePostgres` inject.
      const accounts = ctx.get('employeeAccounts')
      const surfaces = ctx.get('surfaces')
      if (accounts === undefined || surfaces === undefined) {
        await writeResponse(res, Response.json({ error: 'employee-plane-unavailable' }, { status: 503 }))
        return
      }
      const employeeHttp = new EmployeeHttpHandler(
        accounts, surfaces, ctx.enterprisePostgres.identity, ctx.enterpriseSecurity,
      )
      try { await writeResponse(res, await employeeHttp.fetch(await enterpriseRequest(req))) }
      catch { await writeResponse(res, Response.json({ error: 'invalid-request' }, { status: 400 })) }
    },
  }), 'enterprise-employee: authenticated employee dm routes')
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix', path: '/enterprise/session-context',
    handler: async (req, res) => {
      await serveRoute(res, await enterpriseRequest(req), request => composeSessionContext(ctx).fetch(request))
    },
  }), 'enterprise: authorized native Session details')
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix', path: '/enterprise/surfaces',
    handler: async (req, res) => {
      await serveRoute(res, await enterpriseRequest(req), request => collaboration.fetch(request))
    },
  }), 'enterprise-surface: authenticated collaboration surface routes')
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix', path: '/enterprise/channel-workflows',
    handler: async (req, res) => {
      await serveRoute(res, await enterpriseRequest(req), request => workflowHttp.fetch(request))
    },
  }), 'enterprise-channel-workflow: authenticated YAML and decision routes')
  const workflowScheduler = new ChannelWorkflowScheduler({
    dueOrganizations: now => PostgresChannelWorkflowLedger.dueOrganizations(ctx.enterprisePostgres.database, now),
    ledger: orgId => new PostgresChannelWorkflowLedger(ctx.enterprisePostgres.database, orgId),
    deliver: async (orgId, due) => {
      const ledger = new PostgresChannelWorkflowLedger(ctx.enterprisePostgres.database, orgId)
      const current = (await ledger.list(due.channelId)).find(value => value.id === due.workflowId)
      if (current?.revision !== due.revision) return
      const user = (await ctx.enterprisePostgres.identity.listUsers(orgId))
        .find(value => value.id === due.createdBy && !value.disabled)
      if (user === undefined) throw new Error('workflow manager unavailable')
      const actor: EnterprisePrincipal = { orgId, userId: user.id, roles: user.roles }
      const room = await ctx.enterprisePostgres.collaboration.get(orgId, due.channelId)
      if (room?.kind !== 'channel') return
      await collaboration.service.detail(actor, room.id)
      const permission = await ctx.enterpriseSecurity.authorizeResourceAsync(actor, 'employee.create',
        { orgId, visibility: 'organization' })
      if (!permission.allowed) throw new Error('workflow manager permission revoked')
      const signed = await workflowIdentity.signService({ orgId, serviceId: 'channel-workflow' }, room.id,
        { type: 'workflow', content: `Scheduled workflow ${due.scheduleId}`,
          stepId: `schedule:${due.sourceEventId}` })
      const event = await ctx.enterprisePostgres.roomEvents.append({ orgId, surfaceId: room.id,
        event: signed, authorKind: 'service', authorId: 'channel-workflow',
        requestId: `schedule:${due.sourceEventId}` })
      if (!await workflowEvents.onExternal(actor, room,
        { type: 'schedule', scheduleId: due.scheduleId }, event.event.id)) {
        throw new Error('channel workflow trigger remains active in another worker')
      }
    },
    onError: (error, orgId, due) => {
      ctx.logger.warn(`channel workflow schedule failed: org=${orgId} room=${due.channelId} source=${due.sourceEventId}: ${String(error)}`)
    },
  })
  ctx.effect(() => {
    let active = true
    let pending: Promise<void> | undefined
    const tick = (): void => {
      if (!active || pending !== undefined) return
      pending = workflowScheduler.tick(Date.now(), config.workflowBatchLimit).then(async () => {
        for (const claim of await PostgresChannelWorkflowLedger.claimRoomTriggers(
          ctx.enterprisePostgres.database, Date.now(), config.workflowBatchLimit,
          config.roomDispatchLeaseMs)) {
          try {
            const room = await ctx.enterprisePostgres.collaboration.get(claim.orgId, claim.channelId)
            const event = await ctx.enterprisePostgres.roomEvents.getByEventId(
              claim.orgId, claim.channelId, claim.eventId)
            const user = (await ctx.enterprisePostgres.identity.listUsers(claim.orgId))
              .find(value => value.id === claim.authorId && !value.disabled)
            if (room?.kind !== 'channel' || event === undefined || user === undefined) {
              await PostgresChannelWorkflowLedger.completeRoomTrigger(ctx.enterprisePostgres.database, claim)
              continue
            }
            const actor: EnterprisePrincipal = { orgId: claim.orgId, userId: user.id, roles: user.roles }
            try { await collaboration.service.detail(actor, room.id) }
            catch {
              await PostgresChannelWorkflowLedger.completeRoomTrigger(ctx.enterprisePostgres.database, claim)
              continue
            }
            const complete = await workflowEvents.onRoomEvent(actor, room, event, claim.revisions)
            if (complete) await PostgresChannelWorkflowLedger.completeRoomTrigger(ctx.enterprisePostgres.database, claim)
            else await PostgresChannelWorkflowLedger.releaseRoomTrigger(ctx.enterprisePostgres.database, claim)
          } catch (error) {
            await PostgresChannelWorkflowLedger.releaseRoomTrigger(ctx.enterprisePostgres.database, claim)
            ctx.logger.warn(`channel workflow trigger recovery failed: ${claim.eventId}: ${String(error)}`)
          }
        }
        for (const decision of await PostgresChannelWorkflowLedger.decisionsReady(
          ctx.enterprisePostgres.database, config.workflowBatchLimit)) {
          try {
            await recoverCommittedWorkflowDecision(decision, {
              reviewer: async (value) => {
                const room = await ctx.enterprisePostgres.collaboration.get(value.orgId, value.channelId)
                const reviewer = (await ctx.enterprisePostgres.identity.listUsers(value.orgId))
                  .find(user => user.id === value.reviewerUserId && !user.disabled)
                if (room?.kind !== 'channel' || reviewer === undefined) return undefined
                const actor: EnterprisePrincipal = { orgId: value.orgId, userId: reviewer.id, roles: reviewer.roles }
                try { await collaboration.service.detail(actor, room.id) }
                catch { return undefined }
                return { actor, room }
              },
              manager: async (value) => {
                const room = await ctx.enterprisePostgres.collaboration.get(value.orgId, value.channelId)
                if (room?.kind !== 'channel') return undefined
                const users = await ctx.enterprisePostgres.identity.listUsers(value.orgId)
                for (const user of users.filter(entry => !entry.disabled && room.memberUserIds.includes(entry.id))) {
                  const actor: EnterprisePrincipal = { orgId: value.orgId, userId: user.id, roles: user.roles }
                  const allowed = await ctx.enterpriseSecurity.authorizeResourceAsync(actor, 'employee.create',
                    { orgId: value.orgId, visibility: 'organization' })
                  if (!allowed.allowed) continue
                  try { await collaboration.service.detail(actor, room.id) }
                  catch { continue }
                  return { actor, room }
                }
                return undefined
              },
              hasHumanRecord: async value => (await ctx.enterprisePostgres.roomEvents.findByRequest(
                value.orgId, value.channelId, 'human', value.reviewerUserId,
                `decision:${value.approvalId}`)) !== undefined,
              recordHuman: ({ actor, room }, value) => recordHumanWorkflowDecision(actor, room,
                value.approvalId, value.state === 'approved'),
              recordService: async ({ actor, room }, value) => {
                const signed = await workflowIdentity.signService({ orgId: value.orgId,
                  serviceId: 'channel-workflow' }, room.id, {
                  type: 'workflow', stepId: `decision-recovery:${value.approvalId}`,
                  content: `${value.state} workflow decision ${value.approvalId} recorded by ${value.reviewerUserId}`,
                })
                await ctx.enterprisePostgres.roomEvents.append({ orgId: value.orgId, surfaceId: room.id,
                  event: signed, authorKind: 'service', authorId: 'channel-workflow',
                  requestedByUserId: actor.userId, requestId: `decision-recovery:${value.approvalId}` })
              },
              resume: ({ actor, room }, value) => workflowEvents.onDecision(actor, room,
                value.approvalId, value.state === 'approved'),
            })
          } catch (error) {
            if (error instanceof Error && error.message === 'workflow decision not found') continue
            ctx.logger.warn(`channel workflow decision recovery failed: ${decision.approvalId}: ${String(error)}`)
          }
        }
      })
        .catch((error: unknown) => { ctx.logger.error(`channel workflow poll failed: ${String(error)}`) })
        .finally(() => { pending = undefined })
    }
    const timer = setInterval(tick, config.workflowPollIntervalMs)
    tick()
    return async () => { active = false; clearInterval(timer); await pending }
  }, 'enterprise-channel-workflow: durable schedule polling')
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix', path: '/enterprise/channels',
    handler: async (req, res) => {
      const plane = resolvePlane(ctx.get('surfaces'), 'surface-plane-unavailable')
      if (plane.service === undefined) { await writeResponse(res, plane.unavailable); return }
      await serveRoute(res, await enterpriseRequest(req), request =>
        new SurfaceHttpHandler(plane.service, ctx.enterpriseSecurity).fetchInbound(request))
    },
  }), 'enterprise-channel: token-authenticated channel inbound route')
  // The composed project plugin provides `enterpriseProjects`; without it the
  // project plane is absent and every route fails loud with a 503. The
  // memory-consolidation service is resolved per request because it mounts in a
  // sibling plugin: with it, project distillation rides the project routes
  // (manual route and post-archive trigger); without it, the manual distill
  // route answers 503 and the archive trigger skips.
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix', path: '/enterprise/projects',
    handler: async (req, res) => {
      const plane = resolvePlane(ctx.get('enterpriseProjects'), 'project-plane-unavailable')
      if (plane.service === undefined) { await writeResponse(res, plane.unavailable); return }
      const workspace = new ProjectWorkspaceProvisioner(config.projectWorkspaceRoot, plane.service, {
        create: async (path, title) => ctx.workspaceRegistry.create(path, title),
        delete: async id => ctx.workspaceRegistry.delete(brandString<WorkspaceId>(id)),
        resolveByPath: async path => ctx.workspaceRegistry.resolveByPath(path),
      }, ctx.enterprisePostgres.identity, (id) => {
        try { ctx.emit('workspace/visibility-changed', brandString<WorkspaceId>(id)) }
        catch (error) { ctx.logger.warn(`project Workspace refresh failed: ${String(error)}`) }
      })
      await serveRoute(res, await enterpriseRequest(req), request =>
        new ProjectHttpHandler(plane.service, ctx.enterpriseSecurity, {
          consolidation: ctx.get('memoryConsolidation'),
          workspace,
        }).fetch(request))
    },
  }), 'enterprise-project: authenticated project routes')
  // The memory-context plugin provides `memoryConsolidation`; without it the
  // consolidation plane is absent and every route fails loud with a 503.
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix', path: '/enterprise/consolidation',
    handler: async (req, res) => {
      await serveRoute(res, await enterpriseRequest(req), request =>
        serveConsolidation(ctx.get('memoryConsolidation'), ctx.enterpriseSecurity, request))
    },
  }), 'enterprise-consolidation: authenticated memory-consolidation trigger route')
  new EnterpriseDeviceController(ctx)
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

export const inject = [
  'enterprisePostgres', 'enterpriseSecurity', 'enterpriseRequestContext', 'enterpriseCordis',
  'agentPresets', 'agents', 'sessions', 'sessionPersistence', 'sessionProjections',
  'loader', 'credentials', 'llm', 'sessionController', 'webServer',
  'workspaceRegistry', 'attachments',
]
/** Deployment limits for shared-room model context and Bot handoffs. */
export interface Config {
  /** Maximum characters of signed room history sent to a Bot. */
  readonly roomContextCharacters: number
  /** Maximum room events sent to a Bot. */
  readonly roomContextEvents: number
  /** Maximum Bot-to-Bot handoffs from one room event. */
  readonly maxBotHops: number
  /** Milliseconds between pending room delivery scans. */
  readonly roomDispatchPollMs: number
  /** Milliseconds a claimed room delivery remains leased. */
  readonly roomDispatchLeaseMs: number
  /** Milliseconds between scheduled workflow scans. */
  readonly workflowPollIntervalMs: number
  /** Maximum workflows claimed per scan. */
  readonly workflowBatchLimit: number
  /** Milliseconds a claimed workflow remains leased. */
  readonly workflowLeaseMs: number
  /** Credential reference used to verify GitHub webhook signatures. */
  readonly channelGitHubSecretRef: string
  /** Registered GitHub source accepted by channel workflows. */
  readonly channelGitHubSource: string
  /** Maximum accepted GitHub webhook body size in bytes. */
  readonly channelGitHubMaxBodyBytes: number
  /** Absolute parent directory for newly created project Workspaces. */
  readonly projectWorkspaceRoot: string
}
/** Validated deployment options with explicit default limits. */
export const Config: z<Config> = z.object({
  roomContextCharacters: z.natural().min(500).max(32_000).default(6_000),
  roomContextEvents: z.natural().min(1).max(99).default(24),
  maxBotHops: z.natural().min(1).max(8).default(2),
  roomDispatchPollMs: z.natural().min(100).max(60_000).default(5_000),
  roomDispatchLeaseMs: z.natural().min(1000).max(300_000).default(30_000),
  workflowPollIntervalMs: z.natural().min(1000).max(3_600_000).default(30_000),
  workflowBatchLimit: z.natural().min(1).max(100).default(20),
  workflowLeaseMs: z.natural().min(1000).max(600_000).default(120_000),
  channelGitHubSecretRef: z.string().default(''),
  channelGitHubSource: z.string().default('primary-github'),
  channelGitHubMaxBodyBytes: z.natural().min(1).max(10_485_760).default(1_048_576),
  projectWorkspaceRoot: z.string().min(1).default(dshHomePath('enterprise/workspaces/projects')),
})
export { name } from './invariant.ts'
