import type { EnterpriseChannelProvider } from '@deepseek-ai/dsh-api-enterprise-controller/types'

export const CHANNEL_BINDING_CALLBACK_PARAM = 'dsh_channel_binding'
export const CHANNEL_BINDING_BROADCAST_CHANNEL = 'dsh-channel-binding'

/** Canonical callback registered with providers for one unpredictable browser attempt. */
export function channelBindingCallbackUri(
  location: Pick<Location, 'origin' | 'pathname'>,
  attemptId: string,
): string {
  return `${location.origin}${location.pathname}?${CHANNEL_BINDING_CALLBACK_PARAM}=${encodeURIComponent(attemptId)}`
}

/** Credential-free client metadata sourced from each provider's official binding contract. */
export interface ChannelBindingClientProfile {
  readonly officialDocsUrl: string
  readonly guidanceKey: `channel.binding.guidance.${EnterpriseChannelProvider}`
  readonly actionKey: `channel.binding.action.${EnterpriseChannelProvider}`
  readonly qrKey: `channel.binding.qr.${EnterpriseChannelProvider}`
  readonly authorizationHost: string
  readonly authorizationPath: string
  readonly identityOnly: boolean
}

export const CHANNEL_BINDING_PROFILES: Readonly<Record<EnterpriseChannelProvider, ChannelBindingClientProfile>> = Object.freeze({
  wecom: Object.freeze({
    officialDocsUrl: 'https://developer.work.weixin.qq.com/document/path/98152',
    guidanceKey: 'channel.binding.guidance.wecom', actionKey: 'channel.binding.action.wecom',
    qrKey: 'channel.binding.qr.wecom', authorizationHost: 'login.work.weixin.qq.com',
    authorizationPath: '/wwlogin/sso/login', identityOnly: false,
  }),
  feishu: Object.freeze({
    officialDocsUrl: 'https://open.feishu.cn/document/common-capabilities/sso/web-application-sso/qr-sdk-documentation',
    guidanceKey: 'channel.binding.guidance.feishu', actionKey: 'channel.binding.action.feishu',
    qrKey: 'channel.binding.qr.feishu', authorizationHost: 'accounts.feishu.cn',
    authorizationPath: '/open-apis/authen/v1/authorize', identityOnly: false,
  }),
  dingtalk: Object.freeze({
    officialDocsUrl: 'https://open.dingtalk.com/document/isvapp/tutorial-enabling-login-to-third-party-websites.md',
    guidanceKey: 'channel.binding.guidance.dingtalk', actionKey: 'channel.binding.action.dingtalk',
    qrKey: 'channel.binding.qr.dingtalk', authorizationHost: 'login.dingtalk.com',
    authorizationPath: '/oauth2/auth', identityOnly: false,
  }),
  wechat: Object.freeze({
    officialDocsUrl: 'https://developers.weixin.qq.com/doc/oplatform/developers/dev/auth/web.html',
    guidanceKey: 'channel.binding.guidance.wechat', actionKey: 'channel.binding.action.wechat',
    qrKey: 'channel.binding.qr.wechat', authorizationHost: 'open.weixin.qq.com',
    authorizationPath: '/connect/qrconnect', identityOnly: true,
  }),
})

/** Parse and pin one server-returned authorization URL to the provider's exact official HTTPS endpoint. */
export function officialChannelAuthorizationUrl(
  provider: EnterpriseChannelProvider,
  authorizationUrl: string,
): URL | null {
  let parsed: URL
  try {
    parsed = new URL(authorizationUrl)
  } catch {
    return null
  }
  const profile = CHANNEL_BINDING_PROFILES[provider]
  if (parsed.protocol !== 'https:' || parsed.host !== profile.authorizationHost
    || parsed.pathname !== profile.authorizationPath
    || parsed.username !== '' || parsed.password !== '') return null
  return parsed
}
