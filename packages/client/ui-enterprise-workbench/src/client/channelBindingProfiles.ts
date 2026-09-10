import type { EnterpriseChannelProvider } from '@deepseek-ai/dsh-api-enterprise-controller/types'

/** Value exported as `CHANNEL_BINDING_CALLBACK_PARAM`. */
export const CHANNEL_BINDING_CALLBACK_PARAM = 'dsh_channel_binding'
/** Value exported as `CHANNEL_BOT_INSTALL_CALLBACK_PARAM`. */
export const CHANNEL_BOT_INSTALL_CALLBACK_PARAM = 'dsh_channel_bot_install'
/** Value exported as `CHANNEL_BINDING_BROADCAST_CHANNEL`. */
export const CHANNEL_BINDING_BROADCAST_CHANNEL = 'dsh-channel-binding'
const CHANNEL_BINDING_SIGNED_STATE = /^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/u

/** Fixed callback URI registered with every provider; correlation lives in signed OAuth state.
 * @param location - Input value used by this API.
 * @returns Result produced by this API.
 */
export function channelBindingCallbackUri(location: Pick<Location, 'origin' | 'pathname'>): string {
  return `${location.origin}${location.pathname}?${CHANNEL_BINDING_CALLBACK_PARAM}=1`
}

/** Fixed callback URI reserved for provider-app installation and automatic channel creation.
 * @param location - Input value used by this API.
 * @returns Result produced by this API.
 */
export function channelBotInstallCallbackUri(location: Pick<Location, 'origin' | 'pathname'>): string {
  return `${location.origin}${location.pathname}?${CHANNEL_BOT_INSTALL_CALLBACK_PARAM}=1`
}

/** Extract the controller-issued nonce.signature state used for cross-window correlation.
 * @param authorizationUrl - Input value used by this API.
 * @returns Result produced by this API.
 */
export function officialChannelBindingState(authorizationUrl: URL): string | null {
  const state = authorizationUrl.searchParams.get('state')
  return isOfficialChannelBindingState(state) ? state : null
}

/** Whether a callback state has the exact controller-issued nonce.signature grammar.
 * @param state - Input value used by this API.
 * @returns Result produced by this API.
 */
export function isOfficialChannelBindingState(state: string | null): state is string {
  return state !== null && CHANNEL_BINDING_SIGNED_STATE.test(state)
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

/** Value exported as `CHANNEL_BINDING_PROFILES`. */
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

/** Parse and pin one server-returned authorization URL to the provider's exact official HTTPS endpoint.
 * @param authorizationUrl - Input value used by this API.
 * @param provider - Input value used by this API.
 * @returns Result produced by this API.
 */
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
