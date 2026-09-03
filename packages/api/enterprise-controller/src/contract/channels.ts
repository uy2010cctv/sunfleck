/** Channel providers supported by the enterprise configuration control surface. */
export type EnterpriseChannelProvider = 'wecom' | 'feishu' | 'dingtalk' | 'wechat'
/** Persisted lifecycle for one governed channel configuration. */
export type EnterpriseChannelState = 'draft' | 'active' | 'paused' | 'archived'
/** Provider-filtered collaboration intents visible to administrators. */
export type EnterpriseChannelIntent = 'notify' | 'handoff' | 'team-start' | 'decision-response' | 'status'

/** Secret-free administrator projection of one channel account and DSH route. */
export interface EnterpriseChannelConfiguration {
  readonly orgId: string
  readonly channelId: string
  readonly name: string
  readonly provider: EnterpriseChannelProvider
  readonly tenantId?: string
  readonly accountId: string
  readonly credentialRef?: string
  readonly credentialStatus: 'configured' | 'missing'
  readonly defaultEmployeeReleaseId?: string
  readonly inboundEnabled: boolean
  readonly allowedIntents: readonly EnterpriseChannelIntent[]
  readonly transportStatus: 'unverified'
  readonly state: EnterpriseChannelState
  readonly bindingStatus: 'unbound' | 'verified'
  readonly boundProviderIdentityId?: string
  readonly boundProviderIdentityName?: string
  readonly verifiedTenantId?: string
  readonly bindingVerifiedBy?: string
  readonly bindingVerifiedAt?: number
  readonly createdBy: string
  readonly revision: number
  readonly createdAt: number
  readonly updatedAt: number
}

/** Organization-scoped channel configuration collection. */
export interface EnterpriseChannelPage { readonly items: readonly EnterpriseChannelConfiguration[] }
/** Filters accepted by the channel catalog. */
export interface EnterpriseChannelListRequest { readonly includeArchived?: boolean }
/** Stable identity of one channel configuration. */
export interface EnterpriseChannelLookup { readonly channelId: string }
/** Revision-fenced channel configuration write without secret values. */
export interface EnterpriseChannelSaveRequest {
  readonly channelId: string
  readonly name: string
  readonly provider: EnterpriseChannelProvider
  readonly tenantId?: string
  readonly accountId: string
  readonly credentialRef?: string
  readonly defaultEmployeeReleaseId?: string
  readonly inboundEnabled: boolean
  readonly state: Exclude<EnterpriseChannelState, 'archived'>
  readonly expectedRevision: number
  readonly idempotencyKey: string
}
/** Revision-fenced request for terminal channel archival. */
export interface EnterpriseChannelArchiveRequest {
  readonly channelId: string
  readonly expectedRevision: number
  readonly idempotencyKey: string
}

/** Process-bound, secret-free entry point for one official provider authorization. */
export interface EnterpriseChannelBindingSession {
  readonly bindingId: string
  readonly channelId: string
  readonly provider: EnterpriseChannelProvider
  readonly authorizationUrl: string
  readonly officialDocumentationUrl: string
  readonly expiresAt: number
}

/** Revision-fenced request to begin an official provider authorization. */
export interface EnterpriseChannelBeginBindingRequest {
  readonly channelId: string
  readonly expectedRevision: number
  readonly redirectUri: string
}

/** Official provider-app installation readiness before any channel row exists. */
export type EnterpriseChannelBotInstallResult = {
  readonly status: 'setup-required' | 'unsupported'
  readonly provider: EnterpriseChannelProvider
  readonly officialDocumentationUrl: string
} | {
  readonly status: 'ready'
  readonly provider: EnterpriseChannelProvider
  readonly authorizationUrl: string
  readonly expiresAt: number
}

/** Start provider-owned installation of the DSH Bot; successful callback creates the channel. */
export interface EnterpriseChannelBeginBotInstallRequest {
  readonly provider: EnterpriseChannelProvider
  readonly redirectUri: string
}

/** One-time completion of provider-app installation; all channel fields come from the Host installer. */
export interface EnterpriseChannelCompleteBotInstallRequest {
  readonly code: string
  readonly state: string
  readonly redirectUri: string
  readonly idempotencyKey: string
}

/** One-time provider callback completion request. */
export interface EnterpriseChannelCompleteBindingRequest {
  readonly code: string
  readonly state: string
  readonly redirectUri: string
  readonly idempotencyKey: string
}
