/** Group-local views and administration over the existing Host Schedule service. */
import { brandString } from '@deepseek-ai/dsh-brand'
import type { EnterprisePrincipal } from '@deepseek-ai/dsh-enterprise-governance'
import type { CollaborationSession } from '@deepseek-ai/dsh-enterprise-postgres'
import type { ScheduleDeleteResult, ScheduleId, ScheduleRecord } from '@deepseek-ai/dsh-schedule/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { CollaborationError, type CollaborationDetail } from './collaboration-service.ts'

/** One active task scoped by its employee's current group Session. */
export type GroupRoomSchedule = ScheduleRecord & { readonly employeeId: string; readonly employeeName: string }

/** Authorized room and Host Schedule methods needed by the group task adapter. */
export interface GroupRoomScheduleDependencies {
  readonly detail: (actor: EnterprisePrincipal, roomId: string) => Promise<
    Pick<CollaborationDetail, 'kind' | 'members' | 'viewerIsAdmin'>>
  readonly sessions: (roomId: string) => Promise<readonly CollaborationSession[]>
  readonly list: (request: { readonly sessionId: SessionId }) => Promise<readonly ScheduleRecord[]>
  readonly delete: (request: { readonly sessionId: SessionId; readonly id: ScheduleId }) => Promise<ScheduleDeleteResult>
}

/** Limit group schedule reads and deletion to currently authorized room bindings. */
export class GroupRoomSchedules {
  /** @param deps - Current room membership, bindings, and Host task storage. */
  constructor(private readonly deps: GroupRoomScheduleDependencies) {}

  /** List active tasks for current employee members without exposing unrelated Sessions.
   * @param actor - Authenticated room member.
   * @param roomId - Group id.
   * @returns Tasks with the employee who will run them.
   */
  async list(actor: EnterprisePrincipal, roomId: string): Promise<GroupRoomSchedule[]> {
    const room = await this.deps.detail(actor, roomId)
    if (room.kind !== 'group') throw new CollaborationError('group-required', 404)
    const names = new Map(room.members.map(member => [member.employeeId, member.displayName]))
    const bindings = (await this.deps.sessions(roomId)).filter(binding => binding.surfaceId === roomId
      && binding.topicId === '' && names.has(binding.employeeId))
    const rows = await Promise.all(bindings.map(async binding =>
      (await this.deps.list({ sessionId: brandString<SessionId>(binding.sessionId) }))
        .map(record => ({ ...record, employeeId: binding.employeeId,
          employeeName: names.get(binding.employeeId) ?? binding.employeeId }))))
    return rows.flat().sort((left, right) => left.scheduledAt.localeCompare(right.scheduledAt)
      || left.id.localeCompare(right.id))
  }

  /** Remove one current group's task as its administrator.
   * @param actor - Authenticated group administrator.
   * @param roomId - Group id.
   * @param id - Exact Host task id.
   * @returns The Host deletion receipt.
   */
  async delete(actor: EnterprisePrincipal, roomId: string, id: string): Promise<ScheduleDeleteResult> {
    const room = await this.deps.detail(actor, roomId)
    if (room.kind !== 'group') throw new CollaborationError('group-required', 404)
    if (!room.viewerIsAdmin) throw new CollaborationError('forbidden', 403)
    const memberIds = new Set(room.members.map(member => member.employeeId))
    for (const binding of await this.deps.sessions(roomId)) {
      if (binding.surfaceId !== roomId || binding.topicId !== '' || !memberIds.has(binding.employeeId)) continue
      const sessionId = brandString<SessionId>(binding.sessionId)
      if (!(await this.deps.list({ sessionId })).some(record => record.id === id)) continue
      const result = await this.deps.delete({ sessionId, id: brandString<ScheduleId>(id) })
      if (!result.deleted) throw new CollaborationError('schedule-not-found', 404)
      return result
    }
    throw new CollaborationError('schedule-not-found', 404)
  }
}
