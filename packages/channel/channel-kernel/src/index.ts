/** Provider-neutral routing and reliability contracts for enterprise message channels. */

import { createHash } from 'node:crypto'

/** Supported GA transport. Personal WeChat is intentionally excluded. */
export type ChannelKind = 'wecom-bot'

/** Provider families sharing the DSH-owned channel envelope. */
export type ChannelProvider = 'wecom' | 'feishu' | 'dingtalk' | 'wechat'

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
