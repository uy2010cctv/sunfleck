import { useCallback } from 'react'
import type { EnterpriseGovernanceController, EnterpriseGovernanceState } from './controller.ts'
import {
  EnterpriseGovernanceSettingsSection, EnterpriseGovernanceSurface,
} from './EnterpriseGovernanceSurface.tsx'
import type { GovernanceTranslate } from './locales.ts'

export function GovernanceSettingsSlot({ useGovernance, controller, t }: {
  useGovernance: <T>(select: (state: EnterpriseGovernanceState) => T) => T
  controller: EnterpriseGovernanceController
  t: GovernanceTranslate
}) {
  const loadAdmin = useCallback(() => controller.loadAdmin(), [controller])
  return <EnterpriseGovernanceSettingsSection
    state={useGovernance(state => state)}
    t={t}
    loadAdmin={loadAdmin}
    loginLocal={input => controller.loginLocal(input)}
    logout={() => controller.logout()}
    createOrganization={input => controller.createOrganization(input)}
    createUser={input => controller.createUser(input)}
    createAsset={input => controller.createAsset(input)}
    updateUser={(id, input) => controller.updateUser(id, input)}
    saveDepartment={input => controller.saveDepartment(input)}
    setDepartmentManagers={(departmentId, managerUserIds, expectedRevision) =>
      controller.setDepartmentManagers(departmentId, managerUserIds, expectedRevision)}
    createWorkspace={input => controller.createWorkspace(input)}
    updateWorkspace={(id, input) => controller.updateWorkspace(id, input)}
    proposeMemory={input => controller.proposeMemory(input)}
    reviewMemory={(id, input) => controller.reviewMemory(id, input)}
    retryMemoryWriteback={sourceKey => controller.retryMemoryWriteback(sourceKey)}
    savePolicy={input => controller.savePolicy(input)}
    filterAudit={input => controller.filterAudit(input)}
  />
}

export function GovernanceAuthGateSlot({ useGovernance, controller, t }: {
  useGovernance: <T>(select: (state: EnterpriseGovernanceState) => T) => T
  controller: EnterpriseGovernanceController
  t: GovernanceTranslate
}) {
  return <EnterpriseGovernanceSurface
    state={useGovernance(state => state)}
    t={t}
    loginLocal={input => controller.loginLocal(input)}
    logout={() => controller.logout()}
    createOrganization={input => controller.createOrganization(input)}
    createUser={input => controller.createUser(input)}
    createAsset={input => controller.createAsset(input)}
    updateUser={(id, input) => controller.updateUser(id, input)}
    saveDepartment={input => controller.saveDepartment(input)}
    setDepartmentManagers={(departmentId, managerUserIds, expectedRevision) =>
      controller.setDepartmentManagers(departmentId, managerUserIds, expectedRevision)}
    createWorkspace={input => controller.createWorkspace(input)}
    updateWorkspace={(id, input) => controller.updateWorkspace(id, input)}
    proposeMemory={input => controller.proposeMemory(input)}
    reviewMemory={(id, input) => controller.reviewMemory(id, input)}
    retryMemoryWriteback={sourceKey => controller.retryMemoryWriteback(sourceKey)}
    savePolicy={input => controller.savePolicy(input)}
    filterAudit={input => controller.filterAudit(input)}
  />
}
