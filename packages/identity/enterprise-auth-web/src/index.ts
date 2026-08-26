/** Web authentication and central API authorization for DSH Enterprise. */

import type {} from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    enterpriseSecurity: import('./security.ts').EnterpriseSecurity
  }
}

export {
  clearSessionCookie,
  parseSessionCookie,
  serializeSessionCookie,
} from './cookies.ts'
export {
  EnterpriseSecurity,
  classifyApiEndpoint,
  type ApiClassification,
  type EnterpriseSecurityConfig,
  type EnterpriseSecurityOptions,
  type LoginResult,
} from './security.ts'
export {
  EnterpriseAuthHttpHandler,
  type EnterpriseAuthProviders,
} from './http.ts'
export {
  apply,
  inject,
  type BootstrapAdminConfig,
  type EnterpriseAuthWebConfig,
  type OidcPluginConfig,
} from './plugin.ts'
