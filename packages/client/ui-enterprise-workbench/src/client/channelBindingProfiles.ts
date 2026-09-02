import type { EnterpriseChannelProvider } from '@deepseek-ai/dsh-api-enterprise-controller/types'

/** Credential-free client metadata sourced from each provider's official binding contract. */
export interface ChannelBindingClientProfile {
  readonly officialDocsUrl: string
  readonly guidanceKey: `channel.binding.guidance.${EnterpriseChannelProvider}`
  readonly actionKey: `channel.binding.action.${EnterpriseChannelProvider}`
  readonly qrKey: `channel.binding.qr.${EnterpriseChannelProvider}`
  readonly identityOnly: boolean
}

export const CHANNEL_BINDING_PROFILES: Readonly<Record<EnterpriseChannelProvider, ChannelBindingClientProfile>> = Object.freeze({
  wecom: Object.freeze({
    officialDocsUrl: 'https://developer.work.weixin.qq.com/document/path/98152',
    guidanceKey: 'channel.binding.guidance.wecom', actionKey: 'channel.binding.action.wecom',
    qrKey: 'channel.binding.qr.wecom', identityOnly: false,
  }),
  feishu: Object.freeze({
    officialDocsUrl: 'https://open.feishu.cn/document/common-capabilities/sso/web-application-sso/qr-sdk-documentation',
    guidanceKey: 'channel.binding.guidance.feishu', actionKey: 'channel.binding.action.feishu',
    qrKey: 'channel.binding.qr.feishu', identityOnly: false,
  }),
  dingtalk: Object.freeze({
    officialDocsUrl: 'https://open.dingtalk.com/document/isvapp/tutorial-enabling-login-to-third-party-websites.md',
    guidanceKey: 'channel.binding.guidance.dingtalk', actionKey: 'channel.binding.action.dingtalk',
    qrKey: 'channel.binding.qr.dingtalk', identityOnly: false,
  }),
  wechat: Object.freeze({
    officialDocsUrl: 'https://developers.weixin.qq.com/doc/oplatform/developers/dev/auth/web.html',
    guidanceKey: 'channel.binding.guidance.wechat', actionKey: 'channel.binding.action.wechat',
    qrKey: 'channel.binding.qr.wechat', identityOnly: true,
  }),
})
