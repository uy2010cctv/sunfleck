/** Web authentication and central API authorization for DSH Enterprise. */

import type {} from '@deepseek-ai/cordis'
import type {} from './remote-error-codes.ts'

export type { EnterpriseRemoteErrorCode, EnterpriseRemoteErrorDetails } from './remote-error-codes.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    enterpriseSecurity: import('./security.ts').EnterpriseSecurity
    enterpriseRequestContext: import('./request-context.ts').EnterpriseRequestContext
  }
}

export { EnterpriseRequestContext } from './request-context.ts'
export {
  EnterpriseWorkspaceProvisioner,
  type EnterpriseWorkspaceProvisionerOptions,
  type EnterpriseWorkspaceRegistry,
} from './workspace-provisioner.ts'

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
  type EnterpriseAuthHttpOptions,
  type EnterpriseAuthProviders,
} from './http.ts'
export {
  apply,
  inject,
  type BootstrapAdminConfig,
  type EnterpriseAuthWebConfig,
  type OidcPluginConfig,
} from './plugin.ts'
