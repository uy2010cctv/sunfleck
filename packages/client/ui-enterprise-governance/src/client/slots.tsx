import { useCallback } from 'react'
import type { EnterpriseGovernanceController, EnterpriseGovernanceState } from './controller.ts'
import {
  EnterpriseGovernanceSettingsSection, EnterpriseGovernanceSurface,
} from './EnterpriseGovernanceSurface.tsx'

export function GovernanceSettingsSlot({ useGovernance, controller }: {
  useGovernance: <T>(select: (state: EnterpriseGovernanceState) => T) => T
  controller: EnterpriseGovernanceController
}) {
  const loadAdmin = useCallback(() => controller.loadAdmin(), [controller])
  return <EnterpriseGovernanceSettingsSection
    state={useGovernance(state => state)}
    loadAdmin={loadAdmin}
    loginLocal={input => controller.loginLocal(input)}
    logout={() => controller.logout()}
    createOrganization={input => controller.createOrganization(input)}
    createUser={input => controller.createUser(input)}
    createAsset={input => controller.createAsset(input)}
    updateUser={(id, input) => controller.updateUser(id, input)}
    savePolicy={input => controller.savePolicy(input)}
    filterAudit={input => controller.filterAudit(input)}
  />
}

export function GovernanceAuthGateSlot({ useGovernance, controller }: {
  useGovernance: <T>(select: (state: EnterpriseGovernanceState) => T) => T
  controller: EnterpriseGovernanceController
}) {
  return <EnterpriseGovernanceSurface
    state={useGovernance(state => state)}
    loginLocal={input => controller.loginLocal(input)}
    logout={() => controller.logout()}
    createOrganization={input => controller.createOrganization(input)}
    createUser={input => controller.createUser(input)}
    createAsset={input => controller.createAsset(input)}
    updateUser={(id, input) => controller.updateUser(id, input)}
    savePolicy={input => controller.savePolicy(input)}
    filterAudit={input => controller.filterAudit(input)}
  />
}
