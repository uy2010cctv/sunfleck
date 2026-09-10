/** Enterprise WeCom application adapter contracts.
 *
 * This package deliberately has no HTTP client or server. It owns the
 * provider's wire-format and security boundary; a deployment supplies the
 * webhook transport, durable inbox/outbox, credentials, and worker.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import {
  channelActorKey,
  channelHealth,
  inboundIdempotencyKey,
  retryDelayMs,
  type ChannelHealth,
  type ChannelHealthInput,
} from '@deepseek-ai/dsh-channel-kernel'

/** Only the WeCom enterprise application transport is supported. */
export type WeComApplicationType = 'enterprise-app'

/** Configuration material needed by the WeCom callback protocol. */
export interface WeComAppConfig {
  readonly applicationType: WeComApplicationType
  /** Token configured on the WeCom application callback page. */
  readonly token: string
  /** The 43-character EncodingAESKey without or with a trailing `=`. */
  readonly encodingAesKey: string
  /** CorpId used as the callback receive id. Never log this with credentials. */
  readonly receiveId: string
}

/** Arguments accepted by the WeCom callback signature algorithm. */
export interface WeComSignatureInput {
  readonly token: string
  readonly timestamp: string
  readonly nonce: string
  readonly encrypt: string
  readonly signature: string
}

/** Calculate the SHA-1 callback signature required by WeCom.
 * @param encrypt - Input value used by this API.
 * @param nonce - Input value used by this API.
 * @param timestamp - Input value used by this API.
 * @param token - Input value used by this API.
 * @returns Result produced by this API.
 */
export function computeWeComSignature(token: string, timestamp: string, nonce: string, encrypt: string): string {
  return createHash('sha1').update([token, timestamp, nonce, encrypt].sort().join('')).digest('hex')
}

/** Verify a callback signature using a constant-time comparison.
 * @param input - Input value used by this API.
 * @returns Result produced by this API.
 */
export function verifyWeComSignature(input: WeComSignatureInput): boolean {
  if (!input.token || !input.timestamp || !input.nonce || !input.encrypt
    || !input.signature || !/^[a-f0-9]{40}$/iu.test(input.signature)) return false
  const expected = Buffer.from(computeWeComSignature(input.token, input.timestamp, input.nonce, input.encrypt), 'ascii')
  const supplied = Buffer.from(input.signature.toLowerCase(), 'ascii')
  return expected.length === supplied.length && timingSafeEqual(expected, supplied)
}

/** Decode and validate the exact 256-bit AES key used by WeCom.
 * @param config - Input value used by this API.
 * @returns Result produced by this API.
*/
function aesKey(config: WeComAppConfig): Buffer {
  const applicationType: unknown = config.applicationType
  if (applicationType !== 'enterprise-app') {
    throw new Error('only enterprise WeCom applications are supported')
  }
  if (config.token.length === 0 || config.receiveId.length === 0) {
    throw new Error('WeCom token and receiveId are required')
  }
  const encoded = config.encodingAesKey.endsWith('=') ? config.encodingAesKey : `${config.encodingAesKey}=`
  if (!/^[a-z0-9+/]+=*$/iu.test(encoded)) throw new Error('invalid WeCom EncodingAESKey')
  const key = Buffer.from(encoded, 'base64')
  if (key.length !== 32) throw new Error('WeCom EncodingAESKey must decode to 32 bytes')
  return key
}

/** Remove the WeCom-specific 32-byte-block PKCS#7 padding.
 * @param buffer - Input value used by this API.
 * @returns Result produced by this API.
*/
function unpadWeCom(buffer: Buffer): Buffer {
  if (buffer.length === 0 || buffer.length % 32 !== 0) throw new Error('invalid WeCom AES padding length')
  const padding = buffer[buffer.length - 1]
  if (padding === undefined || padding < 1 || padding > 32 || padding > buffer.length) throw new Error('invalid WeCom AES padding')
  for (let index = buffer.length - padding; index < buffer.length; index++) {
    if (buffer[index] !== padding) throw new Error('invalid WeCom AES padding')
  }
  return buffer.subarray(0, buffer.length - padding)
}

/** Add the WeCom-specific 32-byte-block PKCS#7 padding.
 * @param buffer - Input value used by this API.
 * @returns Result produced by this API.
*/
function padWeCom(buffer: Buffer): Buffer {
  const padding = 32 - (buffer.length % 32)
  return Buffer.concat([buffer, Buffer.alloc(padding, padding)])
}

/** Decode a UTF-8 field without silently replacing malformed bytes.
 * @param buffer - Input value used by this API.
 * @param field - Input value used by this API.
 * @returns Result produced by this API.
*/
function decodeUtf8(buffer: Buffer, field: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    throw new Error(`invalid UTF-8 in WeCom ${field}`)
  }
}

/** Decrypted callback payload in the provider's documented envelope. */
export interface WeComDecryptedPayload {
  readonly message: string
  readonly receiveId: string
}

/** Decrypt and authenticate a WeCom AES-CBC callback payload.
 * @param config - Input value used by this API.
 * @param encrypted - Input value used by this API.
 * @returns Result produced by this API.
 */
export function decryptWeComPayload(encrypted: string, config: WeComAppConfig): WeComDecryptedPayload {
  if (!encrypted) throw new Error('WeCom encrypted payload is required')
  const key = aesKey(config)
  let cipherText: Buffer
  try {
    if (!/^[a-z0-9+/]+={0,2}$/iu.test(encrypted) || encrypted.length % 4 !== 0) throw new Error('invalid base64')
    cipherText = Buffer.from(encrypted, 'base64')
  } catch {
    throw new Error('invalid WeCom encrypted payload')
  }
  if (cipherText.length === 0 || cipherText.length % 16 !== 0) throw new Error('invalid WeCom encrypted payload length')
  const decipher = createDecipheriv('aes-256-cbc', key, key.subarray(0, 16))
  decipher.setAutoPadding(false)
  const plain = unpadWeCom(Buffer.concat([decipher.update(cipherText), decipher.final()]))
  if (plain.length < 20) throw new Error('invalid WeCom plaintext envelope')
  const messageLength = plain.readUInt32BE(16)
  const messageEnd = 20 + messageLength
  if (messageEnd > plain.length) throw new Error('invalid WeCom message length')
  const message = decodeUtf8(plain.subarray(20, messageEnd), 'message')
  const receiveId = decodeUtf8(plain.subarray(messageEnd), 'receiveId')
  if (receiveId !== config.receiveId) throw new Error('WeCom receive id does not match configured application')
  return { message, receiveId }
}

/** Encrypt an XML/JSON callback response using the same WeCom envelope.
 * @param config - Input value used by this API.
 * @param message - Input value used by this API.
 * @returns Result produced by this API.
 */
export function encryptWeComPayload(message: string, config: WeComAppConfig): string {
  const key = aesKey(config)
  const messageBytes = Buffer.from(message, 'utf8')
  const receiveId = Buffer.from(config.receiveId, 'utf8')
  const envelope = Buffer.alloc(20 + messageBytes.length + receiveId.length)
  envelope.fill(0, 0, 16)
  /* The random prefix is intentionally generated independently of message ids. */
  randomBytes(16).copy(envelope, 0)
  envelope.writeUInt32BE(messageBytes.length, 16)
  messageBytes.copy(envelope, 20)
  receiveId.copy(envelope, 20 + messageBytes.length)
  const cipher = createCipheriv('aes-256-cbc', key, key.subarray(0, 16))
  cipher.setAutoPadding(false)
  return Buffer.concat([cipher.update(padWeCom(envelope)), cipher.final()]).toString('base64')
}

/** Query fields supplied to the provider's callback URL challenge. */
export interface WeComUrlChallenge {
  readonly timestamp: string
  readonly nonce: string
  readonly signature: string
  readonly echostr: string
}

/** Verify and decrypt the callback URL challenge.
 * @param challenge - Input value used by this API.
 * @param config - Input value used by this API.
 * @returns Result produced by this API.
 */
export function verifyWeComUrl(challenge: WeComUrlChallenge, config: WeComAppConfig): string {
  if (!verifyWeComSignature({ ...challenge, token: config.token, encrypt: challenge.echostr })) throw new Error('invalid WeCom callback signature')
  return decryptWeComPayload(challenge.echostr, config).message
}

/** Transport-neutral HTTP response for the quick callback acknowledgement. */
export interface WeComFastAck {
  readonly status: 200
  readonly body: 'success'
}

/** Validate only the cheap signature and return the immediate provider ACK.
 * @param callback - Input value used by this API.
 * @param config - Input value used by this API.
 * @returns Result produced by this API.
 */
export function acknowledgeWeComCallback(
  callback: Omit<WeComSignatureInput, 'token'>,
  config: WeComAppConfig,
): WeComFastAck {
  if (!callback.timestamp || !callback.nonce || !callback.encrypt) {
    throw new Error('WeCom callback timestamp, nonce, and encrypt are required')
  }
  if (!verifyWeComSignature({ ...callback, token: config.token })) throw new Error('invalid WeCom callback signature')
  return { status: 200, body: 'success' }
}

/** Supported callback message classes normalized by this adapter. */
export type WeComMessageType = 'text' | 'event' | 'image' | 'voice' | 'video' | 'file' | 'location'

/** Provider fields needed before the payload is admitted to a durable inbox. */
export interface WeComInboundInput {
  readonly channelId: string
  readonly accountId: string
  readonly fromUserId: string
  readonly createTime: number
  readonly msgType: WeComMessageType
  readonly externalMessageId?: string
  readonly agentId?: string
  readonly content?: string
  readonly event?: string
}

/** Normalized inbound message handed to Channel Kernel and Session routing. */
export interface WeComInboundMessage {
  readonly channelId: string
  readonly accountId: string
  readonly externalMessageId: string
  readonly channelUserId: string
  readonly actorKey: string
  readonly idempotencyKey: string
  readonly receivedAt: number
  readonly msgType: WeComMessageType
  readonly agentId?: string
  readonly text: string
  readonly event?: string
}

/** Normalize a provider message without persisting its raw envelope.
 * @param input - Input value used by this API.
 * @returns Result produced by this API.
 */
export function normalizeWeComInbound(input: WeComInboundInput): WeComInboundMessage {
  if (!input.channelId) throw new Error('WeCom channelId is required')
  if (!input.accountId) throw new Error('WeCom accountId is required')
  if (!input.fromUserId) throw new Error('WeCom fromUserId is required')
  if (!Number.isSafeInteger(input.createTime) || input.createTime < 0) throw new Error('WeCom createTime must be a non-negative integer')
  if (!['text', 'event', 'image', 'voice', 'video', 'file', 'location'].includes(input.msgType)) {
    throw new Error('unsupported WeCom message type')
  }
  if (input.content !== undefined && typeof input.content !== 'string') throw new Error('WeCom content must be a string')
  if (input.event !== undefined && typeof input.event !== 'string') throw new Error('WeCom event must be a string')
  const text = input.msgType === 'text' ? (input.content ?? '').trim() : ''
  const externalMessageId = input.externalMessageId?.trim() || createHash('sha256')
    .update(JSON.stringify([input.channelId, input.accountId, input.fromUserId, input.createTime, input.msgType, input.event ?? '', input.content ?? '']))
    .digest('hex')
  const actorKey = channelActorKey({ channelId: input.channelId, channelUserId: input.fromUserId })
  const identity = { channelId: input.channelId, accountId: input.accountId, externalMessageId }
  return {
    ...identity,
    channelUserId: input.fromUserId,
    actorKey,
    idempotencyKey: inboundIdempotencyKey(identity),
    receivedAt: input.createTime * 1_000,
    msgType: input.msgType,
    ...(input.agentId === undefined ? {} : { agentId: input.agentId }),
    text,
    ...(input.event === undefined ? {} : { event: input.event }),
  }
}

/** Token health plus an operator-visible reminder, projected from Channel Kernel. */
export interface WeComTokenHealth {
  readonly health: ChannelHealth
  readonly reminder?: {
    readonly kind: 'token-expiry'
    readonly severity: 'warning' | 'critical'
    readonly expiresAt: number
    readonly remainingMs: number
  }
}

/** Executes `evaluateWeComTokenHealth`.
 * @param input - Input value used by this API.
 * @returns Result produced by this API.
 */
export function evaluateWeComTokenHealth(input: ChannelHealthInput): WeComTokenHealth {
  const health = channelHealth(input)
  if (health.state !== 'token-expiring' && health.state !== 'token-expired') return { health }
  const remainingMs = health.tokenExpiresAt - input.now
  return {
    health,
    reminder: {
      kind: 'token-expiry',
      severity: health.state === 'token-expired' ? 'critical' : 'warning',
      expiresAt: health.tokenExpiresAt,
      remainingMs,
    },
  }
}

/** Provider error facts used by the durable delivery worker. */
export interface WeComDeliveryError {
  readonly status?: number
  readonly code?: string
  readonly retryAfterMs?: number
}

/** Durable attempt state; attempt 1 is the first provider call. */
export interface WeComDeliveryAttemptState {
  readonly attempt: number
  readonly now: number
}

/** Data used by `WeComRetryPolicy`. */
export interface WeComRetryPolicy {
  readonly maxAttempts?: number
  readonly baseMs?: number
  readonly maxMs?: number
}

/** Allowed values for `WeComDeliveryDecision`. */
export type WeComDeliveryDecision =
  | { readonly action: 'retry'; readonly attempt: number; readonly nextAttemptAt: number; readonly delayMs: number; readonly reason: 'transient' | 'provider-retry-after' }
  | { readonly action: 'dead-letter'; readonly attempt: number; readonly reason: 'max-attempts' | 'non-retryable' }

function isTransient(error: WeComDeliveryError): boolean {
  return error.status === undefined
    || (Number.isInteger(error.status) && error.status >= 100 && error.status <= 599 && (
      error.status === 408
      || error.status === 425
      || error.status === 429
      || (error.status >= 500 && error.status <= 599)
    ))
}

/** Calculate the next durable delivery action without retaining provider body text.
 * @param error - Input value used by this API.
 * @param policy - Input value used by this API.
 * @param state - Input value used by this API.
 * @returns Result produced by this API.
 */
export function nextWeComDeliveryAttempt(
  state: WeComDeliveryAttemptState,
  error: WeComDeliveryError,
  policy: WeComRetryPolicy = {},
): WeComDeliveryDecision {
  if (!Number.isSafeInteger(state.attempt) || state.attempt < 1) throw new RangeError('attempt must be a positive integer')
  if (!Number.isFinite(state.now) || state.now < 0) throw new RangeError('now must be non-negative')
  const maxAttempts = policy.maxAttempts ?? 5
  const baseMs = policy.baseMs ?? 1_000
  const maxMs = policy.maxMs ?? 60_000
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) throw new RangeError('maxAttempts must be a positive integer')
  if (!isTransient(error)) return { action: 'dead-letter', attempt: state.attempt, reason: 'non-retryable' }
  if (state.attempt >= maxAttempts) return { action: 'dead-letter', attempt: state.attempt, reason: 'max-attempts' }
  const exponential = retryDelayMs(state.attempt, baseMs, maxMs)
  const providerDelay = error.retryAfterMs !== undefined
    && Number.isFinite(error.retryAfterMs)
    && error.retryAfterMs > 0
    && error.retryAfterMs <= 24 * 60 * 60_000
    ? error.retryAfterMs
    : undefined
  const delayMs = providerDelay === undefined ? exponential : Math.max(exponential, providerDelay)
  return {
    action: 'retry',
    attempt: state.attempt + 1,
    nextAttemptAt: state.now + delayMs,
    delayMs,
    reason: providerDelay === undefined ? 'transient' : 'provider-retry-after',
  }
}
