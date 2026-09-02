/** Provider-neutral routing and reliability contracts for enterprise message channels. */

import { createHash } from 'node:crypto'

/** Supported GA transport. Personal WeChat is intentionally excluded. */
export type ChannelKind = 'wecom-bot'

/** Provider families sharing the DSH-owned channel envelope. */
export type ChannelProvider = 'wecom' | 'feishu' | 'dingtalk' | 'wechat'

/** Field names collected by Channel Settings before official authorization. */
export type ChannelBindingField = 'tenantId' | 'accountId' | 'appSecret' | 'callbackUrl'

/** Product boundary proven by an official provider authorization flow. */
export type ChannelBindingBoundary = 'identity-only-delivery-separate' | 'identity-and-handoff-only-no-chat-delivery'

/** Provider-owned authorization entry point and the UI mode used to present it. */
export interface ChannelBindingAuthorization {
  /** HTTPS host owned by the provider. */
  readonly host: string
  /** Whether Channel Settings redirects or presents the provider's QR connection flow. */
  readonly mode: 'redirect' | 'qr-connect'
}

/** Static, credential-free metadata used to render an official channel binding form. */
export interface ChannelBindingProfile {
  /** Provider documentation for the supported authorization flow. */
  readonly officialDocsUrl: string
  /** Provider authorization host and presentation mode. */
  readonly authorization: ChannelBindingAuthorization
  /** Configuration fields required before authorization and code exchange finish. */
  readonly requiredFields: readonly ChannelBindingField[]
  /** Translation keys for provider-specific setup guidance. */
  readonly prerequisiteCopyKeys: readonly string[]
  /** Capability boundary that authorization proves; it is not a delivery receipt. */
  readonly boundary: ChannelBindingBoundary
}

const CHANNEL_BINDING_PROFILES: Readonly<Record<ChannelProvider, ChannelBindingProfile>> = {
  wecom: {
    officialDocsUrl: 'https://developer.work.weixin.qq.com/document/path/98152',
    authorization: { host: 'login.work.weixin.qq.com', mode: 'redirect' },
    requiredFields: ['tenantId', 'accountId', 'appSecret', 'callbackUrl'],
    prerequisiteCopyKeys: [
      'channel.binding.wecom.corpId',
      'channel.binding.wecom.agentId',
      'channel.binding.wecom.appSecret',
    ],
    boundary: 'identity-only-delivery-separate',
  },
  feishu: {
    officialDocsUrl: 'https://open.feishu.cn/document/common-capabilities/sso/web-application-sso/qr-sdk-documentation',
    authorization: { host: 'accounts.feishu.cn', mode: 'redirect' },
    requiredFields: ['accountId', 'appSecret', 'callbackUrl'],
    prerequisiteCopyKeys: ['channel.binding.feishu.appId', 'channel.binding.feishu.appSecret'],
    boundary: 'identity-only-delivery-separate',
  },
  dingtalk: {
    officialDocsUrl: 'https://open.dingtalk.com/document/isvapp/tutorial-enabling-login-to-third-party-websites.md',
    authorization: { host: 'login.dingtalk.com', mode: 'redirect' },
    requiredFields: ['accountId', 'appSecret', 'callbackUrl'],
    prerequisiteCopyKeys: ['channel.binding.dingtalk.clientId', 'channel.binding.dingtalk.clientSecret'],
    boundary: 'identity-only-delivery-separate',
  },
  wechat: {
    officialDocsUrl: 'https://developers.weixin.qq.com/doc/oplatform/developers/dev/auth/web.html',
    authorization: { host: 'open.weixin.qq.com', mode: 'qr-connect' },
    requiredFields: ['accountId', 'appSecret', 'callbackUrl'],
    prerequisiteCopyKeys: ['channel.binding.wechat.appId', 'channel.binding.wechat.appSecret'],
    boundary: 'identity-and-handoff-only-no-chat-delivery',
  },
}
for (const profile of Object.values(CHANNEL_BINDING_PROFILES)) {
  Object.freeze(profile.authorization)
  Object.freeze(profile.requiredFields)
  Object.freeze(profile.prerequisiteCopyKeys)
  Object.freeze(profile)
}
Object.freeze(CHANNEL_BINDING_PROFILES)

/** Return credential-free official authorization metadata for one provider. */
export function channelBindingProfile(provider: ChannelProvider): ChannelBindingProfile {
  return CHANNEL_BINDING_PROFILES[provider]
}

/** Input used to construct an official provider authorization URL. */
export interface ChannelAuthorizationUrlInput {
  /** Channel provider being bound. */
  readonly provider: ChannelProvider
  /** Enterprise tenant id; required for WeCom and enables DingTalk corpid scope. */
  readonly tenantId?: string
  /** Provider application or agent id. */
  readonly accountId?: string
  /** Callback registered with the provider; trimmed and serialized to its canonical URL. */
  readonly callbackUrl: string
  /** Non-empty, caller-signed anti-CSRF state. */
  readonly state: string
}

function requiredAuthorizationValue(value: string | undefined, field: string): string {
  const normalized = value?.trim() ?? ''
  if (normalized === '') throw new Error(`${field} is required`)
  return normalized
}

function validatedCallbackUrl(callbackUrl: string): string {
  const normalized = callbackUrl.trim()
  let parsed: URL
  try {
    parsed = new URL(normalized)
  } catch {
    throw new Error('a valid HTTPS callback URL is required')
  }
  const loopbackHttp = parsed.protocol === 'http:' && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost')
  if (parsed.protocol !== 'https:' && !loopbackHttp) throw new Error('HTTPS callback is required outside loopback development')
  if (parsed.username !== '' || parsed.password !== '') throw new Error('callback URL credentials are not allowed')
  if (normalized.includes('#')) throw new Error('callback URL fragment is not allowed')
  return parsed.toString()
}

/** Build the exact provider-owned OAuth URL without logging or persisting configuration. */
export function channelAuthorizationUrl(input: ChannelAuthorizationUrlInput): string {
  const accountId = requiredAuthorizationValue(input.accountId, 'accountId')
  const callbackUrl = validatedCallbackUrl(input.callbackUrl)
  const state = requiredAuthorizationValue(input.state, 'state')
  const parameters = new URLSearchParams()

  switch (input.provider) {
    case 'wecom': {
      parameters.set('login_type', 'CorpApp')
      parameters.set('appid', requiredAuthorizationValue(input.tenantId, 'tenantId'))
      parameters.set('agentid', accountId)
      parameters.set('redirect_uri', callbackUrl)
      parameters.set('state', state)
      return `https://login.work.weixin.qq.com/wwlogin/sso/login?${parameters}`
    }
    case 'feishu':
      parameters.set('client_id', accountId)
      parameters.set('redirect_uri', callbackUrl)
      parameters.set('response_type', 'code')
      parameters.set('state', state)
      return `https://accounts.feishu.cn/open-apis/authen/v1/authorize?${parameters}`
    case 'dingtalk':
      parameters.set('client_id', accountId)
      parameters.set('redirect_uri', callbackUrl)
      parameters.set('response_type', 'code')
      parameters.set('scope', input.tenantId === undefined ? 'openid' : 'openid corpid')
      parameters.set('state', state)
      parameters.set('prompt', 'consent')
      return `https://login.dingtalk.com/oauth2/auth?${parameters}`
    case 'wechat':
      parameters.set('appid', accountId)
      parameters.set('redirect_uri', callbackUrl)
      parameters.set('response_type', 'code')
      parameters.set('scope', 'snsapi_login')
      parameters.set('state', state)
      return `https://open.weixin.qq.com/connect/qrconnect?${parameters}#wechat_redirect`
  }
}

/** Ephemeral credentials and authorization code supplied for one exchange operation. */
export interface ChannelAuthorizationCodeInput {
  /** Channel provider that issued the code. */
  readonly provider: ChannelProvider
  /** Enterprise tenant id, required by WeCom. */
  readonly tenantId?: string
  /** Provider application or agent id. */
  readonly accountId: string
  /** Application secret, used only during this call and never returned. */
  readonly appSecret: string
  /** One-time authorization code. */
  readonly code: string
  /** Callback used during authorization; trimmed and serialized to its canonical URL. */
  readonly callbackUrl: string
  /** Per-request timeout in milliseconds; defaults to ten seconds and is capped at sixty seconds. */
  readonly timeoutMs?: number
}

/** Verified identity projection that intentionally excludes provider tokens. */
export interface ChannelAuthorizationIdentity {
  /** Provider-scoped stable user identity. */
  readonly providerIdentityId: string
  /** Provider display name when the official identity API supplies it. */
  readonly providerIdentityName?: string
  /** Tenant id only when verified by provider context or response. */
  readonly verifiedTenantId?: string
}

/** Minimal injected fetch contract used to isolate provider network I/O in tests. */
export type ChannelAuthorizationFetch = (input: string | URL, init?: RequestInit) => Promise<Response>

const MAX_AUTHORIZATION_RESPONSE_BYTES = 64 * 1024
const MAX_AUTHORIZATION_TIMEOUT_MS = 60_000

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // A provider body may already be closed or non-cancellable; preserve the bounded-size error.
  }
}

async function boundedJson(response: Response, provider: ChannelProvider): Promise<Record<string, unknown>> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_AUTHORIZATION_RESPONSE_BYTES) {
    await cancelResponseBody(response)
    throw new Error(`${provider} authorization response is too large`)
  }
  const reader = response.body?.getReader()
  const chunks: Uint8Array[] = []
  let receivedBytes = 0
  if (reader !== undefined) {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      receivedBytes += value.byteLength
      if (receivedBytes > MAX_AUTHORIZATION_RESPONSE_BYTES) {
        await reader.cancel()
        throw new Error(`${provider} authorization response is too large`)
      }
      chunks.push(value)
    }
  }
  const bytes = new Uint8Array(receivedBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  const body = new TextDecoder().decode(bytes)
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    const prefix = response.ok ? `${provider} authorization response` : `${provider} authorization request failed with HTTP ${response.status}; response`
    throw new Error(`${prefix} is not valid JSON`)
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    const prefix = response.ok ? `${provider} authorization response` : `${provider} authorization request failed with HTTP ${response.status}; response`
    throw new Error(`${prefix} must be an object`)
  }
  const record = value as Record<string, unknown>
  const errorCode = record.errcode ?? record.code ?? record.error
  const hasErrorCode = (typeof errorCode === 'number' && errorCode !== 0)
    || (typeof errorCode === 'string' && errorCode !== '' && errorCode !== '0')
  const providerMessage = optionalResponseString(record.msg ?? record.errmsg ?? record.message ?? record.error_description)
  const errorDetails = hasErrorCode
    ? `provider code ${String(errorCode)}${providerMessage === undefined ? '' : `: ${providerMessage}`}`
    : providerMessage === undefined ? undefined : `provider message ${providerMessage}`
  if (!response.ok) {
    throw new Error(`${provider} authorization request failed with HTTP ${response.status}${errorDetails === undefined ? '' : `; ${errorDetails}`}`)
  }
  if (hasErrorCode) {
    throw new Error(`${provider} authorization failed with ${errorDetails}`)
  }
  return record
}

function recordValue(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function requiredResponseString(value: unknown, provider: ChannelProvider, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${provider} authorization response omitted ${field}`)
  return value
}

function optionalResponseString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function authorizationSignal(timeoutMs: number | undefined): AbortSignal {
  const timeout = timeoutMs ?? 10_000
  if (!Number.isFinite(timeout) || timeout <= 0) throw new RangeError('timeoutMs must be finite positive milliseconds')
  if (!Number.isSafeInteger(timeout)) throw new RangeError('timeoutMs must be a positive integer')
  if (timeout > MAX_AUTHORIZATION_TIMEOUT_MS) throw new RangeError(`timeoutMs must be at most ${MAX_AUTHORIZATION_TIMEOUT_MS}`)
  return AbortSignal.timeout(timeout)
}

function identityResult(
  providerIdentityId: string,
  providerIdentityName?: string,
  verifiedTenantId?: string,
): ChannelAuthorizationIdentity {
  return {
    providerIdentityId,
    ...(providerIdentityName === undefined ? {} : { providerIdentityName }),
    ...(verifiedTenantId === undefined ? {} : { verifiedTenantId }),
  }
}

/**
 * Exchange a one-time code through official provider APIs and return identity only.
 * Access and refresh tokens remain local temporaries and are never returned or retained.
 */
export async function exchangeChannelAuthorizationCode(
  input: ChannelAuthorizationCodeInput,
  fetchImpl: ChannelAuthorizationFetch,
): Promise<ChannelAuthorizationIdentity> {
  const accountId = requiredAuthorizationValue(input.accountId, 'accountId')
  const appSecret = requiredAuthorizationValue(input.appSecret, 'appSecret')
  const code = requiredAuthorizationValue(input.code, 'code')
  const callbackUrl = validatedCallbackUrl(input.callbackUrl)
  const request = (url: string | URL, init?: RequestInit) => fetchImpl(url, {
    ...init,
    signal: authorizationSignal(input.timeoutMs),
  })

  switch (input.provider) {
    case 'wecom': {
      const tenantId = requiredAuthorizationValue(input.tenantId, 'tenantId')
      const tokenUrl = new URL('https://qyapi.weixin.qq.com/cgi-bin/gettoken')
      tokenUrl.search = new URLSearchParams({ corpid: tenantId, corpsecret: appSecret }).toString()
      const tokenBody = await boundedJson(await request(tokenUrl), 'wecom')
      const accessToken = requiredResponseString(tokenBody.access_token, 'wecom', 'access_token')
      const identityUrl = new URL('https://qyapi.weixin.qq.com/cgi-bin/auth/getuserinfo')
      identityUrl.search = new URLSearchParams({ access_token: accessToken, code }).toString()
      const identity = await boundedJson(await request(identityUrl), 'wecom')
      const identityId = requiredResponseString(identity.userid ?? identity.openid, 'wecom', 'userid or openid')
      return identityResult(identityId, undefined, tenantId)
    }
    case 'feishu': {
      const tokenBody = await boundedJson(await request('https://open.feishu.cn/open-apis/authen/v2/oauth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grant_type: 'authorization_code', client_id: accountId, client_secret: appSecret, code, redirect_uri: callbackUrl }),
      }), 'feishu')
      const tokenData = recordValue(tokenBody.data)
      const accessToken = requiredResponseString(tokenBody.access_token ?? tokenData.access_token, 'feishu', 'access_token')
      const identityBody = await boundedJson(await request('https://open.feishu.cn/open-apis/authen/v1/user_info', {
        headers: { authorization: `Bearer ${accessToken}` },
      }), 'feishu')
      const identity = Object.keys(recordValue(identityBody.data)).length === 0 ? identityBody : recordValue(identityBody.data)
      return identityResult(
        requiredResponseString(identity.open_id, 'feishu', 'open_id'),
        optionalResponseString(identity.name),
        optionalResponseString(identity.tenant_key),
      )
    }
    case 'dingtalk': {
      const tokenBody = await boundedJson(await request('https://api.dingtalk.com/v1.0/oauth2/userAccessToken', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId: accountId, clientSecret: appSecret, code, grantType: 'authorization_code' }),
      }), 'dingtalk')
      const accessToken = requiredResponseString(tokenBody.accessToken, 'dingtalk', 'accessToken')
      const verifiedTenantId = optionalResponseString(tokenBody.corpId)
      const identity = await boundedJson(await request('https://api.dingtalk.com/v1.0/contact/users/me', {
        headers: { 'x-acs-dingtalk-access-token': accessToken },
      }), 'dingtalk')
      return identityResult(
        requiredResponseString(identity.openId ?? identity.unionId, 'dingtalk', 'openId or unionId'),
        optionalResponseString(identity.nick),
        verifiedTenantId,
      )
    }
    case 'wechat': {
      const tokenUrl = new URL('https://api.weixin.qq.com/sns/oauth2/access_token')
      tokenUrl.search = new URLSearchParams({ appid: accountId, secret: appSecret, code, grant_type: 'authorization_code' }).toString()
      const tokenBody = await boundedJson(await request(tokenUrl), 'wechat')
      const accessToken = requiredResponseString(tokenBody.access_token, 'wechat', 'access_token')
      const openId = requiredResponseString(tokenBody.openid, 'wechat', 'openid')
      const identityUrl = new URL('https://api.weixin.qq.com/sns/userinfo')
      identityUrl.search = new URLSearchParams({ access_token: accessToken, openid: openId, lang: 'zh_CN' }).toString()
      const identity = await boundedJson(await request(identityUrl), 'wechat')
      const identityId = requiredResponseString(identity.openid, 'wechat', 'openid')
      if (identityId !== openId) throw new Error('wechat identity response does not match authorized openid')
      return identityResult(identityId, optionalResponseString(identity.nickname))
    }
  }
}

/** Provider-neutral intent carried by one channel message. */
export type ChannelEnvelopeIntent = 'notify' | 'handoff' | 'team-start' | 'decision-response' | 'status'

/** Transport metadata and DSH correlation without raw message content. */
export interface ChannelEnvelope {
  readonly provider: ChannelProvider
  readonly tenantId: string
  readonly accountId: string
  readonly threadId: string
  readonly messageId: string
  readonly operationId: string
  readonly direction: 'inbound' | 'outbound'
  readonly intent: ChannelEnvelopeIntent
  readonly canonicalUserId?: string
  readonly teamId?: string
  readonly runId?: string
  readonly payloadDigest: string
  readonly occurredAt: number
}

/** Whether an intent is admitted and whether it can mutate DSH state. */
export interface ChannelIntentPolicy {
  readonly allowed: boolean
  readonly mutation: boolean
}

/** Resolve provider policy; personal WeChat never receives a mutation grant. */
export function channelIntentPolicy(provider: ChannelProvider, intent: ChannelEnvelopeIntent): ChannelIntentPolicy {
  const mutation = intent === 'team-start' || intent === 'decision-response'
  return { allowed: provider !== 'wechat' || !mutation, mutation }
}

/** Hash the provider account and message identity into one stable DSH operation id. */
export function channelEnvelopeIdempotencyKey(
  envelope: Pick<ChannelEnvelope, 'provider' | 'tenantId' | 'accountId' | 'messageId'>,
): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([envelope.provider, envelope.tenantId, envelope.accountId, envelope.messageId]))
    .digest('hex')
  return `channel:${digest}`
}

function channelIdentifier(value: string, field: string): string {
  const normalized = value.trim()
  if (normalized === '') throw new Error(`${field} is required`)
  return normalized
}

/** Validate and normalize one envelope before an adapter submits it to DSH. */
export function normalizeChannelEnvelope(
  input: Omit<ChannelEnvelope, 'operationId'>,
): ChannelEnvelope {
  if (!/^[a-f0-9]{64}$/u.test(input.payloadDigest)) throw new Error('payload digest must be lowercase SHA-256')
  if (!Number.isSafeInteger(input.occurredAt) || input.occurredAt < 0) throw new Error('occurredAt must be non-negative')
  const policy = channelIntentPolicy(input.provider, input.intent)
  if (!policy.allowed || (input.provider === 'wechat' && input.direction === 'inbound')) {
    throw new Error('personal WeChat is limited to outbound notifications and handoff invitations')
  }
  const normalized = {
    ...input,
    tenantId: channelIdentifier(input.tenantId, 'tenantId'),
    accountId: channelIdentifier(input.accountId, 'accountId'),
    threadId: channelIdentifier(input.threadId, 'threadId'),
    messageId: channelIdentifier(input.messageId, 'messageId'),
    ...input.canonicalUserId === undefined ? {} : { canonicalUserId: channelIdentifier(input.canonicalUserId, 'canonicalUserId') },
    ...input.teamId === undefined ? {} : { teamId: channelIdentifier(input.teamId, 'teamId') },
    ...input.runId === undefined ? {} : { runId: channelIdentifier(input.runId, 'runId') },
  }
  return { ...normalized, operationId: channelEnvelopeIdempotencyKey(normalized) }
}

export interface ChannelBinding {
  readonly channelId: string
  readonly kind: ChannelKind
  readonly employeeIds: readonly string[]
  readonly defaultEmployeeId?: string | undefined
}

export type ChannelCommand =
  | { readonly kind: 'list-employees' }
  | { readonly kind: 'switch-employee'; readonly employeeId: string }
  | { readonly kind: 'message' }

export type ChannelRoutingDecision =
  | { readonly kind: 'list-employees'; readonly employeeIds: readonly string[] }
  | { readonly kind: 'switch-employee'; readonly employeeId: string }
  | { readonly kind: 'deliver'; readonly employeeId: string; readonly reason: 'sticky' | 'intent' | 'default' }
  | { readonly kind: 'blocked'; readonly reason: 'employee-not-bound'; readonly employeeId: string }
  | { readonly kind: 'blocked'; readonly reason: 'no-employee' }

export interface ChannelRoutingInput {
  readonly binding: ChannelBinding
  readonly text: string
  readonly stickyEmployeeId?: string
  readonly intentEmployeeId?: string
}

/** Parse the stable cross-channel employee command vocabulary. */
export function parseChannelCommand(text: string): ChannelCommand {
  const normalized = text.trim()
  if (normalized === '/员工' || normalized === '/employees') return { kind: 'list-employees' }
  const switched = /^\/(?:切换|switch)\s+([^\s]+)\s*$/u.exec(normalized)
  if (switched?.[1] !== undefined) return { kind: 'switch-employee', employeeId: switched[1] }
  return { kind: 'message' }
}

/** Route one normalized inbound message without touching transport or Session storage. */
export function routeInbound(input: ChannelRoutingInput): ChannelRoutingDecision {
  const command = parseChannelCommand(input.text)
  if (command.kind === 'list-employees') {
    return { kind: 'list-employees', employeeIds: [...input.binding.employeeIds] }
  }
  if (command.kind === 'switch-employee') {
    return input.binding.employeeIds.includes(command.employeeId)
      ? command
      : { kind: 'blocked', reason: 'employee-not-bound', employeeId: command.employeeId }
  }

  const candidates = [
    ['sticky', input.stickyEmployeeId],
    ['intent', input.intentEmployeeId],
    ['default', input.binding.defaultEmployeeId],
  ] as const
  for (const [reason, employeeId] of candidates) {
    if (employeeId !== undefined && input.binding.employeeIds.includes(employeeId)) {
      return { kind: 'deliver', employeeId, reason }
    }
  }
  return { kind: 'blocked', reason: 'no-employee' }
}

export interface ChannelActorIdentity {
  readonly channelId: string
  readonly channelUserId: string
  readonly canonicalUserId?: string
}

export interface ChannelIdentityAlias {
  readonly channelId: string
  readonly channelUserId: string
}

export interface ChannelIdentityBinding {
  readonly canonicalUserId: string
  readonly aliases: readonly ChannelIdentityAlias[]
}

export interface ResolvedChannelActor {
  readonly actorKey: string
  readonly canonicalUserId?: string
}

/** Resolve a cross-channel canonical actor, falling back to one channel-local identity. */
export function channelActorKey(identity: ChannelActorIdentity): string {
  return identity.canonicalUserId === undefined
    ? `channel:${identity.channelId}:${identity.channelUserId}`
    : `enterprise:${identity.canonicalUserId}`
}

/** Resolve a channel alias through reviewed account bindings, rejecting conflicting ownership. */
export function resolveChannelActor(
  alias: ChannelIdentityAlias,
  bindings: readonly ChannelIdentityBinding[],
): ResolvedChannelActor {
  const matches = bindings.filter(binding => binding.aliases.some(candidate =>
    candidate.channelId === alias.channelId && candidate.channelUserId === alias.channelUserId))
  const owners = [...new Set(matches.map(binding => binding.canonicalUserId))]
  if (owners.length > 1) throw new Error('channel identity alias is bound to multiple enterprise users')
  const canonicalUserId = owners[0]
  return canonicalUserId === undefined
    ? { actorKey: channelActorKey(alias) }
    : { actorKey: channelActorKey({ ...alias, canonicalUserId }), canonicalUserId }
}

export interface ChannelInboundIdentity {
  readonly channelId: string
  readonly accountId: string
  readonly externalMessageId: string
}

/** Hash provider identity fields into a stable, non-guessable inbound idempotency key. */
export function inboundIdempotencyKey(message: ChannelInboundIdentity): string {
  return createHash('sha256')
    .update(JSON.stringify([message.channelId, message.accountId, message.externalMessageId]))
    .digest('hex')
}

export interface InboundIdempotencyStore {
  /** Atomically claim a key; true only for the first committed claimant. */
  claim(key: string): Promise<boolean>
}

export interface InboundAdmission {
  readonly admitted: boolean
  readonly key: string
}

/** Atomically admit one provider message through a deployment-owned durable claim store. */
export async function admitInbound(
  message: ChannelInboundIdentity,
  store: InboundIdempotencyStore,
): Promise<InboundAdmission> {
  const key = inboundIdempotencyKey(message)
  return { admitted: await store.claim(key), key }
}

/** Deterministic capped exponential retry delay; jitter belongs to the durable dispatcher. */
export function retryDelayMs(attempt: number, baseMs = 1_000, maxMs = 60_000): number {
  if (!Number.isSafeInteger(attempt) || attempt < 1) throw new RangeError('attempt must be a positive integer')
  if (!Number.isFinite(baseMs) || baseMs <= 0) throw new RangeError('baseMs must be positive')
  if (!Number.isFinite(maxMs) || maxMs < baseMs) throw new RangeError('maxMs must be at least baseMs')
  return Math.min(maxMs, baseMs * 2 ** Math.min(attempt - 1, 30))
}

export interface ChannelHealthInput {
  readonly now: number
  readonly tokenExpiresAt?: number
  readonly tokenWarningMs?: number
  readonly lastInboundAt?: number
  readonly staleAfterMs?: number
}

export type ChannelHealth =
  | { readonly state: 'healthy' }
  | { readonly state: 'token-expired'; readonly tokenExpiresAt: number }
  | { readonly state: 'token-expiring'; readonly tokenExpiresAt: number }
  | { readonly state: 'reconnect-required'; readonly staleForMs: number }

/** Project token and inbound-heartbeat facts into an operator-facing channel health state. */
export function channelHealth(input: ChannelHealthInput): ChannelHealth {
  if (input.tokenExpiresAt !== undefined && input.tokenExpiresAt <= input.now) {
    return { state: 'token-expired', tokenExpiresAt: input.tokenExpiresAt }
  }
  const warningMs = input.tokenWarningMs ?? 30 * 60_000
  if (input.tokenExpiresAt !== undefined && input.tokenExpiresAt - input.now <= warningMs) {
    return { state: 'token-expiring', tokenExpiresAt: input.tokenExpiresAt }
  }
  const staleAfterMs = input.staleAfterMs ?? 60 * 60_000
  if (input.lastInboundAt !== undefined && input.now - input.lastInboundAt > staleAfterMs) {
    return { state: 'reconnect-required', staleForMs: input.now - input.lastInboundAt }
  }
  return { state: 'healthy' }
}

export type ChannelSessionState = 'healthy' | 'disconnected' | 'missing' | 'corrupt'
export type ChannelRecoveryAction = 'none' | 'resume' | 'recreate' | 'quarantine'

/** Select a fail-closed recovery action; corrupt history is never silently replaced. */
export function sessionRecoveryAction(state: ChannelSessionState): ChannelRecoveryAction {
  switch (state) {
    case 'healthy': return 'none'
    case 'disconnected': return 'resume'
    case 'missing': return 'recreate'
    case 'corrupt': return 'quarantine'
  }
}

export interface ChannelAuditInput {
  readonly direction: 'inbound' | 'outbound'
  readonly channelId: string
  readonly accountId: string
  readonly externalMessageId: string
  readonly actorKey: string
  readonly employeeId?: string
  readonly content: string
  readonly at: number
}

export interface ChannelAuditEvent {
  readonly type: 'channel/message'
  readonly direction: 'inbound' | 'outbound'
  readonly channelId: string
  readonly accountId: string
  readonly externalMessageId: string
  readonly actorKey: string
  readonly employeeId?: string
  readonly contentHash: string
  readonly contentLength: number
  readonly at: number
}

/** Build message audit metadata while excluding raw message bodies and credentials. */
export function channelAuditEvent(input: ChannelAuditInput): ChannelAuditEvent {
  return {
    type: 'channel/message',
    direction: input.direction,
    channelId: input.channelId,
    accountId: input.accountId,
    externalMessageId: input.externalMessageId,
    actorKey: input.actorKey,
    ...input.employeeId === undefined ? {} : { employeeId: input.employeeId },
    contentHash: createHash('sha256').update(input.content).digest('hex'),
    contentLength: input.content.length,
    at: input.at,
  }
}
