/** Enterprise identity, session, resource-policy, and audit persistence. */

export { ENTERPRISE_IDENTITY_SCHEMA_VERSION, migrateEnterpriseIdentity } from './schema.ts'
export {
  inspectEnterpriseMemory,
  memorySourceDigest,
  type EnterpriseMemoryInspection,
  type EnterpriseMemoryPrivacyFinding,
} from './memory-policy.ts'
export {
  EnterpriseIdentityRepository,
  type IdentityAwaitable,
  type EnterpriseIdentityStore,
  sessionTokenHash,
  type AuditQuery,
  type EnterpriseAuditRecord,
  type EnterpriseManagedAsset,
  type EnterpriseOrganization,
  type EnterprisePrincipalView,
  type EnterpriseResourcePolicy,
  type EnterpriseUserInput,
  type EnterpriseUserView,
  type CreateEnterpriseUserOptions,
  type CreateEnterpriseOrganizationInput,
  type UpdateEnterpriseUserProfileInput,
  type EnterpriseDepartment,
  type SaveEnterpriseDepartmentInput,
  type SetUserDepartmentsInput,
  type EnterpriseWorkspaceGrant,
  type SaveEnterpriseWorkspaceGrantInput,
  type EnterpriseMemoryEntry,
  type ProposeEnterpriseMemoryInput,
  type ReviewEnterpriseMemoryInput,
  type ExternalIdentityBinding,
  type RepositoryOptions,
} from './repository.ts'
