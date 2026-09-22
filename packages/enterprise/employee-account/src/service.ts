/**
 * EmployeeAccounts implementation over the employee store of
 * `@deepseek-ai/dsh-enterprise-identity`. The service adds input validation,
 * id minting, and row-to-domain mapping; every SQL statement stays in the
 * store module.
 *
 * @module @deepseek-ai/dsh-employee-account/service
 */

import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import {
  bindSticky,
  claimInbox,
  createEmployee,
  enqueueInbox,
  getEmployee,
  listEmployees,
  resolveSticky,
  updateEmployeeState,
  type EmployeeAccountRow,
  type InboxRow,
} from '@deepseek-ai/dsh-enterprise-identity'
import { employeeId, inboxItemId, surfaceId } from './ids.ts'
import type { EmployeeId } from './ids.ts'
import type {
  CreateEmployeeAccountInput,
  EmployeeAccount,
  EmployeeAccounts,
  EmployeeInboxItem,
  EmployeeState,
  EnqueueEmployeeInboxInput,
} from './types.ts'

/** Map one stored employee account row to its domain value.
 * @param row - row read from the `employee_accounts` table.
 * @returns the domain account.
 */
function accountFromRow(row: EmployeeAccountRow): EmployeeAccount {
  return {
    id: employeeId(row.id),
    orgId: row.orgId,
    displayName: row.displayName,
    roleCard: row.roleCard,
    ...(row.activeReleaseId === null ? {} : { activeReleaseId: row.activeReleaseId }),
    state: row.state,
    homeWorkspacePath: row.homeWorkspacePath,
  }
}

/** Map one stored inbox row to its domain value.
 * @param row - row read from the `employee_inbox` table.
 * @returns the domain inbox item.
 */
function inboxItemFromRow(row: InboxRow): EmployeeInboxItem {
  return {
    id: inboxItemId(row.id),
    employeeId: employeeId(row.employeeId),
    surfaceId: surfaceId(row.surfaceId),
    originActor: row.originActor,
    payloadText: row.payloadText,
    state: row.state,
  }
}

/** Enterprise employee account service over one migrated identity database. */
export class EmployeeAccountService implements EmployeeAccounts {
  private readonly database: DatabaseSync

  /**
   * @param database - migrated enterprise identity database (`migrateEnterpriseIdentity` already ran); the composition owns its lifecycle.
   */
  constructor(database: DatabaseSync) {
    this.database = database
  }

  create(input: CreateEmployeeAccountInput): EmployeeAccount {
    if (input.displayName.trim() === '') throw new TypeError('employee displayName must not be empty')
    if (input.roleCard.trim() === '') throw new TypeError('employee roleCard must not be empty')
    if (!isAbsolute(input.homeWorkspacePath)) {
      throw new TypeError(`employee homeWorkspacePath must be an absolute path, received ${input.homeWorkspacePath}`)
    }
    const at = Date.now()
    const id = employeeId(randomUUID())
    const row: EmployeeAccountRow = {
      id, orgId: input.orgId, displayName: input.displayName, roleCard: input.roleCard,
      activeReleaseId: input.activeReleaseId ?? null, state: 'active',
      homeWorkspacePath: input.homeWorkspacePath, createdAt: at, updatedAt: at,
    }
    createEmployee(this.database, row)
    return accountFromRow(row)
  }

  get(id: EmployeeId): EmployeeAccount | undefined {
    const row = getEmployee(this.database, id)
    return row === undefined ? undefined : accountFromRow(row)
  }

  list(orgId: string, options?: { includeArchived?: boolean }): EmployeeAccount[] {
    return listEmployees(this.database, orgId, options).map(accountFromRow)
  }

  /**
   * The archived guard duplicates the store's on purpose: this service's callers get an error
   * naming the id and requested state, while the store keeps its own guard for direct store
   * consumers.
   */
  setState(id: EmployeeId, state: EmployeeState): void {
    const current = getEmployee(this.database, id)
    if (current === undefined) throw new Error(`enterprise employee ${id} is missing`)
    if (current.state === 'archived') {
      throw new Error(`enterprise employee ${id} cannot change state to ${state} (current state: archived)`)
    }
    updateEmployeeState(this.database, id, state, Date.now())
  }

  bindSticky(orgId: string, actorKey: string, id: EmployeeId): void {
    const current = getEmployee(this.database, id)
    if (current === undefined) throw new Error(`enterprise employee ${id} is missing`)
    if (current.orgId !== orgId) {
      throw new Error(`enterprise employee ${id} cannot be bound under ${orgId} (belongs to ${current.orgId})`)
    }
    bindSticky(this.database, orgId, actorKey, id, Date.now())
  }

  resolveSticky(orgId: string, actorKey: string): EmployeeId | undefined {
    const bound = resolveSticky(this.database, orgId, actorKey)
    return bound === undefined ? undefined : employeeId(bound)
  }

  enqueue(input: EnqueueEmployeeInboxInput): EmployeeInboxItem {
    const account = getEmployee(this.database, input.employeeId)
    if (account === undefined) throw new Error(`enterprise employee ${input.employeeId} is missing`)
    const row: InboxRow = {
      id: inboxItemId(randomUUID()), orgId: account.orgId, employeeId: input.employeeId,
      surfaceId: input.surfaceId, originActor: input.originActor, payloadText: input.payloadText,
      state: 'queued', attempts: 0, createdAt: Date.now(), deliveredAt: null,
    }
    enqueueInbox(this.database, row)
    return inboxItemFromRow(row)
  }

  claim(employeeId: EmployeeId, limit: number): EmployeeInboxItem[] {
    if (limit < 0) throw new TypeError(`employee claim limit must not be negative, received ${limit}`)
    return claimInbox(this.database, employeeId, limit, Date.now()).map(inboxItemFromRow)
  }
}
