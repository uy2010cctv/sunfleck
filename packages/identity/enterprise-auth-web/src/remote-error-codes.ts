/** Enterprise Remote failure vocabulary shared by the authenticated Gateway and enterprise controllers. */

/** Stable enterprise Remote codes carried across Host and Client faces. */
export type EnterpriseRemoteErrorCode =
  | 'enterprise-conflict'
  | 'enterprise-forbidden'
  | 'enterprise-idempotency-conflict'
  | 'enterprise-internal'
  | 'enterprise-invalid-binding'
  | 'enterprise-invalid-cursor'
  | 'enterprise-invalid-state'
  | 'enterprise-not-found'
  | 'enterprise-runtime-unknown'
  | 'enterprise-unauthorized'
  | 'enterprise-unavailable'

/** Structured, non-secret context common to enterprise Remote failures. */
export interface EnterpriseRemoteErrorDetails {
  readonly endpoint?: string
  readonly resourceType?: string
  readonly resourceId?: string
  readonly reason?: string
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'enterprise-conflict': EnterpriseRemoteErrorDetails
    'enterprise-forbidden': EnterpriseRemoteErrorDetails
    'enterprise-idempotency-conflict': EnterpriseRemoteErrorDetails
    'enterprise-internal': EnterpriseRemoteErrorDetails
    'enterprise-invalid-binding': EnterpriseRemoteErrorDetails
    'enterprise-invalid-cursor': EnterpriseRemoteErrorDetails
    'enterprise-invalid-state': EnterpriseRemoteErrorDetails
    'enterprise-not-found': EnterpriseRemoteErrorDetails
    'enterprise-runtime-unknown': EnterpriseRemoteErrorDetails
    'enterprise-unauthorized': EnterpriseRemoteErrorDetails
    'enterprise-unavailable': EnterpriseRemoteErrorDetails
  }
}
