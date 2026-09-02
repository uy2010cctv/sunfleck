import { describe, expect, it } from 'vitest'
import {
  channelActorKey,
  channelAuditEvent,
  channelHealth,
  channelEnvelopeIdempotencyKey,
  channelIntentPolicy,
  normalizeChannelEnvelope,
  admitInbound,
  inboundIdempotencyKey,
  parseChannelCommand,
  retryDelayMs,
  resolveChannelActor,
  routeInbound,
  sessionRecoveryAction,
} from '../src/index.ts'

const binding = {
  channelId: 'wecom-sales',
  kind: 'wecom-bot' as const,
  employeeIds: ['sales', 'support'],
  defaultEmployeeId: 'sales',
}

describe('channel command and routing', () => {
  it('parses employee discovery and explicit switch commands', () => {
    expect(parseChannelCommand('/员工')).toEqual({ kind: 'list-employees' })
    expect(parseChannelCommand('  /切换 support  ')).toEqual({ kind: 'switch-employee', employeeId: 'support' })
    expect(parseChannelCommand('/switch sales')).toEqual({ kind: 'switch-employee', employeeId: 'sales' })
    expect(parseChannelCommand('查询订单')).toEqual({ kind: 'message' })
  })

  it('keeps a sticky employee ahead of intent and falls back to the channel default', () => {
    expect(routeInbound({ binding, text: '我要查售后', stickyEmployeeId: 'sales', intentEmployeeId: 'support' }))
      .toEqual({ kind: 'deliver', employeeId: 'sales', reason: 'sticky' })
    expect(routeInbound({ binding, text: '我要查售后', intentEmployeeId: 'support' }))
      .toEqual({ kind: 'deliver', employeeId: 'support', reason: 'intent' })
    expect(routeInbound({ binding, text: '你好' }))
      .toEqual({ kind: 'deliver', employeeId: 'sales', reason: 'default' })
  })

  it('lists allowed employees, switches explicitly, and rejects employees outside the binding', () => {
    expect(routeInbound({ binding, text: '/员工' }))
      .toEqual({ kind: 'list-employees', employeeIds: ['sales', 'support'] })
    expect(routeInbound({ binding, text: '/切换 support' }))
      .toEqual({ kind: 'switch-employee', employeeId: 'support' })
    expect(routeInbound({ binding, text: '/切换 finance' }))
      .toEqual({ kind: 'blocked', reason: 'employee-not-bound', employeeId: 'finance' })
  })

  it('fails closed when no routable employee exists', () => {
    expect(routeInbound({ binding: { ...binding, employeeIds: [], defaultEmployeeId: undefined }, text: '你好' }))
      .toEqual({ kind: 'blocked', reason: 'no-employee' })
  })
})

describe('channel identity and delivery reliability', () => {
  it('normalizes one provider-neutral TeamRun envelope with a stable operation id', () => {
    const envelope = normalizeChannelEnvelope({
      provider: 'wecom', tenantId: 'tenant-a', accountId: 'bot-a', threadId: 'thread-a',
      messageId: 'message-a', direction: 'inbound', intent: 'team-start', canonicalUserId: 'user-a',
      teamId: 'team-a', runId: 'run-a', payloadDigest: 'a'.repeat(64), occurredAt: 1,
    })
    expect(envelope.operationId).toBe(channelEnvelopeIdempotencyKey(envelope))
    expect(envelope).not.toHaveProperty('payload')
  })

  it('keeps enterprise channels bidirectional and personal WeChat notification-only', () => {
    expect(channelIntentPolicy('wecom', 'team-start')).toEqual({ allowed: true, mutation: true })
    expect(channelIntentPolicy('feishu', 'decision-response')).toEqual({ allowed: true, mutation: true })
    expect(channelIntentPolicy('dingtalk', 'status')).toEqual({ allowed: true, mutation: false })
    expect(channelIntentPolicy('wechat', 'notify')).toEqual({ allowed: true, mutation: false })
    expect(channelIntentPolicy('wechat', 'handoff')).toEqual({ allowed: true, mutation: false })
    expect(channelIntentPolicy('wechat', 'team-start')).toEqual({ allowed: false, mutation: true })
    expect(channelIntentPolicy('wechat', 'decision-response')).toEqual({ allowed: false, mutation: true })
  })

  it('rejects malformed identifiers, digests, and personal-WeChat mutations', () => {
    expect(() => normalizeChannelEnvelope({
      provider: 'wechat', tenantId: 'tenant-a', accountId: 'personal-a', threadId: 'thread-a',
      messageId: 'message-a', direction: 'inbound', intent: 'decision-response',
      payloadDigest: 'bad', occurredAt: 1,
    })).toThrow(/personal WeChat|payload digest/u)
  })

  it('merges channel aliases under a canonical enterprise user when available', () => {
    expect(channelActorKey({ channelId: 'wx', channelUserId: 'wx-7', canonicalUserId: 'user-9' }))
      .toBe('enterprise:user-9')
    expect(channelActorKey({ channelId: 'wx', channelUserId: 'wx-7' }))
      .toBe('channel:wx:wx-7')
    expect(resolveChannelActor({ channelId: 'wecom', channelUserId: 'wc-8' }, [{
      canonicalUserId: 'user-9',
      aliases: [
        { channelId: 'wx', channelUserId: 'wx-7' },
        { channelId: 'wecom', channelUserId: 'wc-8' },
      ],
    }])).toEqual({ actorKey: 'enterprise:user-9', canonicalUserId: 'user-9' })
  })

  it('builds a stable provider-scoped inbound idempotency key', () => {
    const message = { channelId: 'wx-main', accountId: 'account-a', externalMessageId: 'msg-42' }
    expect(inboundIdempotencyKey(message)).toBe(inboundIdempotencyKey(message))
    expect(inboundIdempotencyKey({ ...message, accountId: 'account-b' })).not.toBe(inboundIdempotencyKey(message))
  })

  it('admits an inbound provider message exactly once through a durable claim seam', async () => {
    const claimed = new Set<string>()
    const store = {
      claim: (key: string) => Promise.resolve(claimed.has(key) ? false : Boolean(claimed.add(key))),
    }
    const message = { channelId: 'wx-main', accountId: 'account-a', externalMessageId: 'msg-42' }
    const first = await admitInbound(message, store)
    const duplicate = await admitInbound(message, store)
    expect(first).toEqual({ admitted: true, key: inboundIdempotencyKey(message) })
    expect(duplicate).toEqual({ admitted: false, key: first.key })
  })

  it('uses capped exponential outbound retry without accepting invalid attempts', () => {
    expect(retryDelayMs(1)).toBe(1_000)
    expect(retryDelayMs(4)).toBe(8_000)
    expect(retryDelayMs(20)).toBe(60_000)
    expect(() => retryDelayMs(0)).toThrow(/positive integer/)
  })

  it('reports token expiry and stale-channel reconnect requirements', () => {
    const now = Date.UTC(2026, 7, 26, 10)
    expect(channelHealth({ now, tokenExpiresAt: now + 10 * 60_000, tokenWarningMs: 30 * 60_000 }))
      .toEqual({ state: 'token-expiring', tokenExpiresAt: now + 10 * 60_000 })
    expect(channelHealth({ now, lastInboundAt: now - 70 * 60_000, staleAfterMs: 60 * 60_000 }))
      .toEqual({ state: 'reconnect-required', staleForMs: 70 * 60_000 })
    expect(channelHealth({ now, lastInboundAt: now - 1_000 })).toEqual({ state: 'healthy' })
  })

  it('chooses deterministic session self-heal actions', () => {
    expect(sessionRecoveryAction('healthy')).toBe('none')
    expect(sessionRecoveryAction('disconnected')).toBe('resume')
    expect(sessionRecoveryAction('missing')).toBe('recreate')
    expect(sessionRecoveryAction('corrupt')).toBe('quarantine')
  })

  it('audits channel messages without retaining raw message content or credentials', () => {
    const event = channelAuditEvent({
      direction: 'inbound',
      channelId: 'wx-main',
      accountId: 'account-a',
      externalMessageId: 'msg-42',
      actorKey: 'enterprise:user-9',
      employeeId: 'support',
      content: '客户私密消息',
      at: 1_787_739_600_000,
    })
    expect(event).toMatchObject({
      type: 'channel/message', direction: 'inbound', channelId: 'wx-main',
      actorKey: 'enterprise:user-9', employeeId: 'support', contentLength: 6,
    })
    expect(event.contentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(event)).not.toContain('客户私密消息')
  })
})
