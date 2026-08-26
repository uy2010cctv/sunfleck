import { describe, expect, it } from 'vitest'
import {
  acknowledgeWeComCallback,
  computeWeComSignature,
  decryptWeComPayload,
  encryptWeComPayload,
  evaluateWeComTokenHealth,
  normalizeWeComInbound,
  nextWeComDeliveryAttempt,
  verifyWeComSignature,
  verifyWeComUrl,
  type WeComAppConfig,
} from '../src/index.ts'

const config: WeComAppConfig = {
  applicationType: 'enterprise-app',
  token: 'callback-token',
  encodingAesKey: 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG',
  receiveId: 'ww-corp-id',
}

describe('WeCom callback cryptography', () => {
  it('computes and verifies the provider signature without accepting altered fields', () => {
    const signature = computeWeComSignature(config.token, '1700000000', 'nonce', 'cipher')
    expect(signature).toBe('949a0240a7e10de791e50d2e38a0495cfaa57ccf')
    expect(verifyWeComSignature({ token: config.token, timestamp: '1700000000', nonce: 'nonce', encrypt: 'cipher', signature })).toBe(true)
    expect(verifyWeComSignature({ token: config.token, timestamp: '1700000001', nonce: 'nonce', encrypt: 'cipher', signature })).toBe(false)
  })

  it('encrypts and decrypts the WeCom AES-CBC envelope and validates receive id', () => {
    const encrypted = encryptWeComPayload('审批完成', config)
    expect(decryptWeComPayload(encrypted, config)).toEqual({ message: '审批完成', receiveId: config.receiveId })
    expect(() => decryptWeComPayload(encrypted, { ...config, receiveId: 'other-corp' })).toThrow(/receive id/i)
  })

  it('verifies the URL challenge and returns the decrypted echo string', () => {
    const echo = encryptWeComPayload('echo-ok', config)
    const timestamp = '1700000000'
    const nonce = 'nonce'
    const signature = computeWeComSignature(config.token, timestamp, nonce, echo)
    expect(verifyWeComUrl({ timestamp, nonce, signature, echostr: echo }, config)).toBe('echo-ok')
    expect(() => verifyWeComUrl({ timestamp, nonce, signature: 'bad', echostr: echo }, config)).toThrow(/signature/i)
  })

  it('returns a constant quick ACK only after signature validation', () => {
    const timestamp = '1700000000'
    const nonce = 'nonce'
    const encrypt = encryptWeComPayload('<xml/>', config)
    const signature = computeWeComSignature(config.token, timestamp, nonce, encrypt)
    expect(acknowledgeWeComCallback({ timestamp, nonce, signature, encrypt }, config)).toEqual({ status: 200, body: 'success' })
    expect(() => acknowledgeWeComCallback({ timestamp, nonce, signature: 'bad', encrypt }, config)).toThrow(/signature/i)
  })
})

describe('WeCom inbound normalization and token health', () => {
  it('normalizes text messages to the channel-kernel identity and idempotency contract', () => {
    const message = normalizeWeComInbound({
      channelId: 'wecom-sales', accountId: 'sales-app', externalMessageId: 'msg-42',
      fromUserId: 'zhangsan', agentId: '1000002', createTime: 1700000000,
      msgType: 'text', content: '  查询订单  ',
    })
    expect(message).toMatchObject({
      channelId: 'wecom-sales', accountId: 'sales-app', externalMessageId: 'msg-42',
      channelUserId: 'zhangsan', actorKey: 'channel:wecom-sales:zhangsan',
      text: '查询订单', msgType: 'text', agentId: '1000002',
    })
    expect(message.idempotencyKey).toMatch(/^[a-f0-9]{64}$/)
  })

  it('derives a stable event id when WeCom omits MsgId and rejects empty identities', () => {
    const input = { channelId: 'wecom', accountId: 'app', fromUserId: 'u1', createTime: 7, msgType: 'event' as const, event: 'click' }
    const first = normalizeWeComInbound(input)
    expect(first.externalMessageId).toBe(normalizeWeComInbound(input).externalMessageId)
    expect(() => normalizeWeComInbound({ ...input, fromUserId: '' })).toThrow(/fromUserId/i)
  })

  it('returns a token-expiry reminder while preserving kernel health semantics', () => {
    const now = 1_700_000_000_000
    const result = evaluateWeComTokenHealth({ now, tokenExpiresAt: now + 5 * 60_000, tokenWarningMs: 30 * 60_000 })
    expect(result.health).toEqual({ state: 'token-expiring', tokenExpiresAt: now + 5 * 60_000 })
    expect(result.reminder).toMatchObject({ kind: 'token-expiry', expiresAt: now + 5 * 60_000 })
  })
})

describe('WeCom outbound retry policy', () => {
  it('retries transient failures with provider retry-after and caps attempts', () => {
    expect(nextWeComDeliveryAttempt(
      { attempt: 1, now: 1000 },
      { status: 503, retryAfterMs: 6000 },
      { maxAttempts: 3, baseMs: 1000, maxMs: 5000 },
    )).toEqual({
      action: 'retry', attempt: 2, nextAttemptAt: 7000, delayMs: 6000, reason: 'provider-retry-after',
    })
    expect(nextWeComDeliveryAttempt(
      { attempt: 3, now: 1000 }, { status: 503 }, { maxAttempts: 3 },
    )).toEqual({ action: 'dead-letter', attempt: 3, reason: 'max-attempts' })
    expect(nextWeComDeliveryAttempt(
      { attempt: 1, now: 1000 }, { status: 400 }, { maxAttempts: 3 },
    )).toEqual({ action: 'dead-letter', attempt: 1, reason: 'non-retryable' })
  })

  it('never exposes message content in normalized delivery decisions', () => {
    const decision = nextWeComDeliveryAttempt(
      { attempt: 1, now: 1000 }, { status: 429, retryAfterMs: 2000 }, { maxAttempts: 2 },
    )
    expect(JSON.stringify(decision)).not.toContain('message')
  })
})
