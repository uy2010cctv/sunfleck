/** Browser plugin wiring the enterprise workbench into DSH's additive slots. */

import type { Context } from '@deepseek-ai/cordis'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { EnterpriseChannelConfiguration } from '@deepseek-ai/dsh-api-enterprise-controller/types'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { EnterpriseTrigger } from './EnterpriseTrigger.tsx'
import { EnterpriseWorkbench } from './EnterpriseWorkbench.tsx'
import type { EnterpriseWorkbenchInjected } from './EnterpriseWorkbench.tsx'
import { en, NS, zh, type EnterpriseWorkbenchKey } from './locales.ts'
import { EnterpriseWorkbenchController, type EnterpriseWorkbenchState } from './store.ts'
import {
  CHANNEL_BINDING_BROADCAST_CHANNEL, CHANNEL_BINDING_CALLBACK_PARAM,
  CHANNEL_BOT_INSTALL_CALLBACK_PARAM, channelBindingCallbackUri, channelBotInstallCallbackUri,
  isOfficialChannelBindingState,
} from './channelBindingProfiles.ts'
import './tokens.css'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Enterprise digital-employee workbench copy. */
    'enterprise.workbench': EnterpriseWorkbenchKey
  }
}

/** Business face handed to the sidebar trigger. */
interface EnterpriseTriggerInjected {
  hooks: { enterprise: SnapshotStore<EnterpriseWorkbenchState> }
  toggle: () => void
}

const CALLBACK_CODE_MAX_BYTES = 2048

interface BindingCallbackWindow {
  readonly location: Pick<Location, 'origin' | 'pathname' | 'search'>
  readonly history: Pick<History, 'replaceState'>
  readonly opener: { postMessage: (message: unknown, targetOrigin: string) => void } | null
  readonly close: () => void
}

function boundedCallbackValue(value: string | null, limit: number): value is string {
  return value !== null && value.trim().length > 0 && new TextEncoder().encode(value).byteLength <= limit
}

/** Complete one marked provider callback and remove authorization material from browser history. */
export async function completeChannelBindingCallback(
  remote: Pick<ClientRemote['enterpriseChannel'], 'completeBinding'>,
  browser: BindingCallbackWindow,
): Promise<boolean> {
  const query = new URLSearchParams(browser.location.search)
  if (query.get(CHANNEL_BINDING_CALLBACK_PARAM) !== '1') return false
  const canonicalPath = `${browser.location.pathname}?${CHANNEL_BINDING_CALLBACK_PARAM}=1`
  const code = query.get('code')
  const state = query.get('state')
  const publish = (message: Readonly<Record<string, string>>): void => {
    if (typeof BroadcastChannel === 'function') {
      const channel = new BroadcastChannel(CHANNEL_BINDING_BROADCAST_CHANNEL)
      try { channel.postMessage(message) } finally { channel.close() }
    }
  }
  const redactFailure = (): void => {
    browser.history.replaceState(null, '', `${canonicalPath}&binding_error=1`)
  }
  if (!isOfficialChannelBindingState(state)) {
    redactFailure()
    return true
  }
  const attemptId = state
  const fail = (): true => {
    redactFailure()
    const message = { type: 'dsh-channel-binding-failed', attemptId: state, status: 'failed' }
    publish(message)
    browser.opener?.postMessage(message, browser.location.origin)
    return true
  }
  if (query.has('error') || !boundedCallbackValue(code, CALLBACK_CODE_MAX_BYTES)) return fail()
  const idempotencyKey = `channel-binding-complete:${state}`
  browser.history.replaceState(null, '', canonicalPath)
  try {
    const response = await remote.completeBinding({
      code, state,
      redirectUri: channelBindingCallbackUri(browser.location),
      idempotencyKey,
    })
    const wrapped = response as typeof response | { readonly result: typeof response }
    const result = 'result' in wrapped ? wrapped.result : wrapped
    if (!result.ok) throw new Error(result.error.message)
    const channel: EnterpriseChannelConfiguration = result.value
    const message = {
      type: 'dsh-channel-binding-complete', attemptId, channelId: channel.channelId,
    }
    publish(message)
    browser.opener?.postMessage(message, browser.location.origin)
    browser.close()
    return true
  } catch {
    return fail()
  }
}

/** Complete a provider-app installation and announce the automatically created channel. */
export async function completeChannelBotInstallCallback(
  remote: Pick<ClientRemote['enterpriseChannel'], 'completeBotInstall'>,
  browser: BindingCallbackWindow,
): Promise<boolean> {
  const query = new URLSearchParams(browser.location.search)
  if (query.get(CHANNEL_BOT_INSTALL_CALLBACK_PARAM) !== '1') return false
  const canonicalPath = `${browser.location.pathname}?${CHANNEL_BOT_INSTALL_CALLBACK_PARAM}=1`
  const code = query.get('code')
  const state = query.get('state')
  const redact = (failed = false): void => {
    browser.history.replaceState(null, '', `${canonicalPath}${failed ? '&install_error=1' : ''}`)
  }
  if (!isOfficialChannelBindingState(state)) {
    redact(true)
    return true
  }
  const publish = (message: Readonly<Record<string, string>>): void => {
    if (typeof BroadcastChannel === 'function') {
      const channel = new BroadcastChannel(CHANNEL_BINDING_BROADCAST_CHANNEL)
      try { channel.postMessage(message) } finally { channel.close() }
    }
    browser.opener?.postMessage(message, browser.location.origin)
  }
  const fail = (): true => {
    redact(true)
    publish({ type: 'dsh-channel-bot-install-failed', attemptId: state, status: 'failed' })
    return true
  }
  if (query.has('error') || !boundedCallbackValue(code, CALLBACK_CODE_MAX_BYTES)) return fail()
  redact()
  try {
    const response = await remote.completeBotInstall({
      code, state, redirectUri: channelBotInstallCallbackUri(browser.location),
      idempotencyKey: `channel-bot-install-complete:${state}`,
    })
    const wrapped = response as typeof response | { readonly result: typeof response }
    const result = 'result' in wrapped ? wrapped.result : wrapped
    if (!result.ok) throw new Error(result.error.message)
    const channel: EnterpriseChannelConfiguration = result.value
    publish({
      type: 'dsh-channel-bot-install-complete', attemptId: state,
      channelId: channel.channelId, channelName: channel.name,
    })
    browser.close()
    return true
  } catch {
    return fail()
  }
}

export { CHANNEL_BINDING_BROADCAST_CHANNEL, channelBindingCallbackUri, channelBotInstallCallbackUri }

/** Required browser services. */
export const inject = [
  'slots', 'locale', 'connection', 'sessions', 'workspaces', 'remote',
  'remote.agentPresets', 'remote.enterpriseEmployee', 'remote.enterpriseAsset',
  'remote.enterpriseTeam', 'remote.enterpriseOperation', 'remote.session',
  'remote.enterpriseWork',
  'remote.enterpriseTeamDefinition', 'remote.enterpriseTeamRun',
  'remote.enterpriseTeamDecision', 'remote.enterpriseTeamAutonomy',
  'remote.enterpriseChannel',
  'remote.pluginInventory',
  'remote.cordisWorkspace', 'remote.cordisReview', 'remote.cordisGovernance',
]

/** Mount the enterprise trigger, overlay, and live projection subscriptions. */
export function apply(ctx: Context): void {
  if (typeof window !== 'undefined') {
    void completeChannelBindingCallback(ctx.remote.enterpriseChannel, window)
    void completeChannelBotInstallCallback(ctx.remote.enterpriseChannel, window)
  }
  const controller = new EnterpriseWorkbenchController({
    agentPresets: ctx.remote.agentPresets,
    session: ctx.remote.session,
    enterpriseEmployees: ctx.remote.enterpriseEmployee,
    enterpriseAssets: ctx.remote.enterpriseAsset,
    enterpriseTeams: ctx.remote.enterpriseTeam,
    enterpriseTeamDefinitions: ctx.remote.enterpriseTeamDefinition,
    enterpriseTeamRuns: ctx.remote.enterpriseTeamRun,
    enterpriseTeamDecisions: ctx.remote.enterpriseTeamDecision,
    enterpriseTeamAutonomy: ctx.remote.enterpriseTeamAutonomy,
    enterpriseChannels: ctx.remote.enterpriseChannel,
    enterpriseOperations: ctx.remote.enterpriseOperation,
    enterpriseWork: ctx.remote.enterpriseWork,
    pluginInventory: ctx.remote.pluginInventory,
    cordisWorkspace: ctx.remote.cordisWorkspace,
    cordisReview: ctx.remote.cordisReview,
    cordisGovernance: ctx.remote.cordisGovernance,
  }, ctx.sessions, ctx.workspaces)

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'enterprise-workbench: dictionaries')

  ctx.effect(() => {
    const recompute = (): void => { controller.recompute() }
    const disposers = [
      ctx.sessions.list.subscribe(recompute),
      ctx.workspaces.list.subscribe(recompute),
      ctx.on('connection/reset', () => {
        if (controller.store.getSnapshot().open) void controller.refresh()
      }),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'enterprise-workbench: projection subscriptions')

  const triggerInjected = (): EnterpriseTriggerInjected => ({
    hooks: { enterprise: controller.store },
    toggle: () => { controller.toggle() },
  })
  const workbenchInjected = (): EnterpriseWorkbenchInjected => ({
    hooks: { enterprise: controller.store },
    close: () => { controller.close() },
    refresh: () => controller.refresh(),
    setPage: (page) => { controller.setPage(page) },
    setEmployeeFilters: (filters) => { controller.setEmployeeFilters(filters) },
    refreshEmployees: async () => { await controller.refreshEmployees() },
    loadMoreEmployees: async () => { await controller.loadMoreEmployees() },
    createEmployeeDraft: () => { controller.createEmployeeDraft() },
    openEmployeeDraft: id => controller.openEmployeeDraft(id),
    patchEmployeeDraft: (patch) => { controller.patchEmployeeDraft(patch) },
    saveEmployeeDraft: () => controller.saveEmployeeDraft(),
    publishEmployee: () => controller.publishEmployee(),
    rollbackEmployee: releaseId => controller.rollbackEmployee(releaseId),
    closeEmployeeEditor: () => { controller.closeEmployeeEditor() },
    startEmployee: id => controller.startEmployee(id),
    prepareWork: input => controller.prepareWork(input),
    startPreparedWork: input => controller.startPreparedWork(input),
    openRecord: (id) => { controller.openRecord(id) },
    updateWorkRecord: (record, state) => controller.updateWorkRecord(record, state),
    transitionApproval: (approval, state, reason) => controller.transitionApproval(approval, state, reason),
    cancelApproval: (approval, reason) => controller.cancelApproval(approval, reason),
    saveSchedule: input => controller.saveSchedule(input),
    transitionSchedule: (schedule, state) => controller.transitionSchedule(schedule, state),
    saveAssetVersion: input => controller.saveAssetVersion(input),
    archiveAsset: asset => controller.archiveAsset(asset),
    saveTeam: input => controller.saveTeam(input),
    saveTeamDefinition: input => controller.saveTeamDefinition(input),
    startTeamRun: input => controller.startTeamRun(input),
    cancelTeamRun: run => controller.cancelTeamRun(run),
    respondTeamDecision: (decision, answer) => controller.respondTeamDecision(decision, answer),
    saveChannelConfiguration: input => controller.saveChannelConfiguration(input),
    archiveChannelConfiguration: channel => controller.archiveChannelConfiguration(channel),
    beginChannelBinding: (channel, redirectUri) => controller.beginChannelBinding(channel, redirectUri),
    beginChannelBotInstall: (provider, redirectUri) => controller.beginChannelBotInstall(provider, redirectUri),
    pollChannelBotInstall: installId => controller.pollChannelBotInstall(installId),
    refreshChannels: () => controller.refreshChannels(),
    setExtensionWorkspace: (workspaceId) => { controller.setExtensionWorkspace(workspaceId) },
    refreshExtensions: () => controller.refreshExtensions(),
    stopExtension: (binding, reason) => controller.stopExtension(binding, reason),
    rollbackExtension: (binding, packageId, reason) => controller.rollbackExtension(binding, packageId, reason),
    reviewExtension: (review, action, reason) => controller.reviewExtension(review, action, reason),
    retryMutation: () => controller.retryMutation(),
    resolveMutationConflict: () => controller.resolveMutationConflict(),
    dismissMutationError: () => { controller.dismissMutationError() },
    adoptServerEmployeeConflict: () => { controller.adoptServerEmployeeConflict() },
    keepLocalEmployeeConflict: () => { controller.keepLocalEmployeeConflict() },
    optimizeEmployeePrompt: () => controller.optimizeEmployeePrompt(),
  })

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'enterprise-workbench',
    order: -20,
    locale: NS,
    inject: triggerInjected,
  }, EnterpriseTrigger))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'enterprise-workbench',
    order: 0,
    locale: NS,
    inject: workbenchInjected,
  }, EnterpriseWorkbench))
}

export type { EnterpriseTriggerProps } from './EnterpriseTrigger.tsx'
export type { EnterpriseWorkbenchProps, EnterpriseWorkbenchInjected } from './EnterpriseWorkbench.tsx'
export {
  deriveEnterpriseView, EnterpriseWorkbenchController,
  type EmployeeOperationalState, type EnterpriseEmployeeView,
  type EnterpriseMetrics, type EnterpriseView, type EnterpriseWorkbenchState,
  type EnterpriseWorkRecord, type WorkRecordState,
} from './store.ts'
