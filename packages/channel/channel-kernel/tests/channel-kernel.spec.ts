import { describe, expect, it } from 'vitest'
import {
  channelActorKey,
  channelAuthorizationUrl,
  channelAuditEvent,
  channelBindingProfile,
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
  exchangeChannelAuthorizationCode,
} from '../src/index.ts'

const binding = {
  channelId: 'wecom-sales',
  kind: 'wecom-bot' as const,
  employeeIds: ['sales', 'support'],
  defaultEmployeeId: 'sales',
}

describe('official channel authorization binding', () => {
  it('describes provider prerequisites and keeps personal WeChat at the identity boundary', () => {
    expect(channelBindingProfile('wecom')).toMatchObject({
      officialDocsUrl: 'https://developer.work.weixin.qq.com/document/path/98152',
      authorization: { host: 'login.work.weixin.qq.com', mode: 'redirect' },
      requiredFields: ['tenantId', 'accountId', 'appSecret', 'callbackUrl'],
      prerequisiteCopyKeys: ['channel.binding.wecom.corpId', 'channel.binding.wecom.agentId', 'channel.binding.wecom.appSecret'],
      boundary: 'identity-only-delivery-separate',
    })
    expect(channelBindingProfile('feishu').authorization.host).toBe('accounts.feishu.cn')
    expect(channelBindingProfile('dingtalk').officialDocsUrl).toBe('https://open.dingtalk.com/document/isvapp/tutorial-enabling-login-to-third-party-websites.md')
    expect(channelBindingProfile('wechat')).toMatchObject({
      authorization: { host: 'open.weixin.qq.com', mode: 'qr-connect' },
      boundary: 'identity-and-handoff-only-no-chat-delivery',
    })
  })

  it('builds exact official authorization URLs for all four providers', () => {
    const callbackUrl = 'https://dsh.example.com/settings/channels/callback?source=设置页'
    const state = 'signed.state-value'
    expect(channelAuthorizationUrl({ provider: 'wecom', tenantId: 'corp 1', accountId: 'agent/2', callbackUrl, state }))
      .toBe('https://login.work.weixin.qq.com/wwlogin/sso/login?login_type=CorpApp&appid=corp+1&agentid=agent%2F2&redirect_uri=https%3A%2F%2Fdsh.example.com%2Fsettings%2Fchannels%2Fcallback%3Fsource%3D%E8%AE%BE%E7%BD%AE%E9%A1%B5&state=signed.state-value')
    expect(channelAuthorizationUrl({ provider: 'feishu', accountId: 'cli 1', callbackUrl, state }))
      .toBe('https://accounts.feishu.cn/open-apis/authen/v1/authorize?client_id=cli+1&redirect_uri=https%3A%2F%2Fdsh.example.com%2Fsettings%2Fchannels%2Fcallback%3Fsource%3D%E8%AE%BE%E7%BD%AE%E9%A1%B5&response_type=code&state=signed.state-value')
    expect(channelAuthorizationUrl({ provider: 'dingtalk', accountId: 'ding-1', tenantId: 'corp-1', callbackUrl, state }))
      .toBe('https://login.dingtalk.com/oauth2/auth?client_id=ding-1&redirect_uri=https%3A%2F%2Fdsh.example.com%2Fsettings%2Fchannels%2Fcallback%3Fsource%3D%E8%AE%BE%E7%BD%AE%E9%A1%B5&response_type=code&scope=openid+corpid&state=signed.state-value&prompt=consent')
    expect(channelAuthorizationUrl({ provider: 'wechat', accountId: 'wx-app', callbackUrl, state }))
      .toBe('https://open.weixin.qq.com/connect/qrconnect?appid=wx-app&redirect_uri=https%3A%2F%2Fdsh.example.com%2Fsettings%2Fchannels%2Fcallback%3Fsource%3D%E8%AE%BE%E7%BD%AE%E9%A1%B5&response_type=code&scope=snsapi_login&state=signed.state-value#wechat_redirect')
  })

  it('accepts loopback HTTP callbacks but rejects unsafe callbacks and missing provider fields', () => {
    expect(channelAuthorizationUrl({ provider: 'feishu', accountId: 'app', callbackUrl: 'http://127.0.0.1:3081/callback', state: 'signed' }))
      .toContain('redirect_uri=http%3A%2F%2F127.0.0.1%3A3081%2Fcallback')
    expect(() => channelAuthorizationUrl({ provider: 'feishu', accountId: 'app', callbackUrl: 'http://example.com/callback', state: 'signed' }))
      .toThrow(/HTTPS callback/u)
    expect(() => channelAuthorizationUrl({ provider: 'wecom', accountId: 'agent', callbackUrl: 'https://example.com/callback', state: 'signed' }))
      .toThrow(/tenantId/u)
    expect(() => channelAuthorizationUrl({ provider: 'wechat', accountId: 'app', callbackUrl: 'https://example.com/callback', state: ' ' }))
      .toThrow(/state/u)
  })

  it('exchanges WeCom code through app token and identity APIs without returning credentials', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const fetchImpl = async (input: string | URL, init?: RequestInit): Promise<Response> => {
      const url = input.toString()
      requests.push({ url, init })
      if (url.includes('/gettoken')) return new Response(JSON.stringify({ errcode: 0, access_token: 'secret-token' }))
      return new Response(JSON.stringify({ errcode: 0, userid: 'zhangsan' }))
    }
    const result = await exchangeChannelAuthorizationCode({
      provider: 'wecom', tenantId: 'corp-1', accountId: 'agent-1', appSecret: 'app-secret',
      code: 'one-time-code', callbackUrl: 'https://dsh.example.com/callback',
    }, fetchImpl)
    expect(result).toEqual({ providerIdentityId: 'zhangsan', verifiedTenantId: 'corp-1' })
    expect(requests[0]?.url).toContain('corpsecret=app-secret')
    expect(requests[1]?.url).toContain('access_token=secret-token')
    expect(requests.every(request => request.init?.signal instanceof AbortSignal)).toBe(true)
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(JSON.stringify(result)).not.toContain('token')
  })

  it.each([
    {
      provider: 'feishu' as const,
      token: { code: 0, data: { access_token: 'feishu-token' } },
      identity: { code: 0, data: { open_id: 'ou_1', name: '飞书用户', tenant_key: 'tenant-1' } },
      expected: { providerIdentityId: 'ou_1', providerIdentityName: '飞书用户', verifiedTenantId: 'tenant-1' },
    },
    {
      provider: 'dingtalk' as const,
      token: { accessToken: 'ding-token', corpId: 'corp-2', expireIn: 7_200, refreshToken: 'refresh-token' },
      identity: { openId: 'ding-user', nick: '钉钉用户', unionId: 'union-user' },
      expected: { providerIdentityId: 'ding-user', providerIdentityName: '钉钉用户', verifiedTenantId: 'corp-2' },
    },
    {
      provider: 'wechat' as const,
      token: { access_token: 'wechat-token', openid: 'wx-user' },
      identity: { openid: 'wx-user', nickname: '微信用户' },
      expected: { providerIdentityId: 'wx-user', providerIdentityName: '微信用户' },
    },
  ])('exchanges $provider code and returns identity only', async ({ provider, token, identity, expected }) => {
    let call = 0
    const fetchImpl = async (): Promise<Response> => new Response(JSON.stringify(call++ === 0 ? token : identity))
    const result = await exchangeChannelAuthorizationCode({
      provider, accountId: 'app-1', appSecret: 'app-secret', code: 'code-1',
      callbackUrl: 'https://dsh.example.com/callback',
    }, fetchImpl)
    expect(result).toEqual(expected)
    expect(Object.keys(result)).not.toContain('accessToken')
    expect(Object.keys(result)).not.toContain('refreshToken')
  })

  it('rejects an empty one-time authorization code before fetching', async () => {
    let fetched = false
    await expect(exchangeChannelAuthorizationCode({
      provider: 'feishu', accountId: 'app-1', appSecret: 'secret', code: ' ',
      callbackUrl: 'https://dsh.example.com/callback',
    }, async () => {
      fetched = true
      return new Response('{}')
    })).rejects.toThrow(/code is required/u)
    expect(fetched).toBe(false)
  })

  it('aborts a never-settling provider fetch at timeoutMs', async () => {
    const operation = exchangeChannelAuthorizationCode({
      provider: 'feishu', accountId: 'app-1', appSecret: 'secret', code: 'code-1',
      callbackUrl: 'https://dsh.example.com/callback', timeoutMs: 20,
    }, (_input, init) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal
      if (!(signal instanceof AbortSignal)) throw new Error('missing abort signal')
      signal.addEventListener('abort', () => {
        reject(signal.reason instanceof Error ? signal.reason : new Error('authorization fetch aborted'))
      }, { once: true })
    }))
    let guard: ReturnType<typeof setTimeout> | undefined
    const boundedOperation = Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        guard = setTimeout(() => {
          reject(new Error('abort deadline elapsed without signal'))
        }, 500)
      }),
    ])
    await expect(boundedOperation).rejects.toThrow(/timeout/u)
    clearTimeout(guard)
  })

  it('rejects HTTP, provider JSON errors, and oversized authorization responses', async () => {
    const input = {
      provider: 'feishu' as const, accountId: 'app-1', appSecret: 'secret', code: 'code-1',
      callbackUrl: 'https://dsh.example.com/callback',
    }
    await expect(exchangeChannelAuthorizationCode(input, async () => new Response('upstream', { status: 502 })))
      .rejects.toThrow(/502/u)
    await expect(exchangeChannelAuthorizationCode(input, async () => new Response(JSON.stringify({ code: 10003, msg: 'invalid code' }))))
      .rejects.toThrow(/10003/u)
    await expect(exchangeChannelAuthorizationCode(input, async () => new Response('x'.repeat(70_000))))
      .rejects.toThrow(/too large/u)
  })
})

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
