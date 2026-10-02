import { describe, expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ScheduleDeleteResult, ScheduleId } from '@deepseek-ai/dsh-schedule/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { GroupRoomSchedules } from '../src/collaboration-group-schedules.ts'

const actor = { orgId: 'org', userId: 'alice', roles: ['administrator'] as const }
const detail = { id: 'group', kind: 'group' as const, viewerIsAdmin: true,
  members: [{ employeeId: 'nova', displayName: 'Nova', releaseId: 'release-nova' },
    { employeeId: 'frisk', displayName: 'frisk', releaseId: 'release-frisk' }] }
const task = { id: brandString<ScheduleId>('schedule-1'), kind: 'daily' as const, title: 'Daily report', prompt: 'Post the report',
  scheduledAt: '2026-10-03T01:00:00.000Z', time: '09:00:00.000', timeZone: 'Asia/Shanghai' }
const formerTask = { ...task, id: brandString<ScheduleId>('schedule-former') }

function setup(room: Omit<typeof detail, 'kind'> & { kind: 'group' | 'channel' } = detail) {
  const remove = vi.fn(async (): Promise<ScheduleDeleteResult> => ({ id: task.id, deleted: true }))
  const schedules = new GroupRoomSchedules({
    detail: async () => room,
    sessions: async () => [
      { surfaceId: 'group', topicId: '', employeeId: 'nova', sessionId: 'session-nova' },
      { surfaceId: 'group', topicId: '', employeeId: 'former', sessionId: 'session-former' },
    ],
    list: vi.fn(async ({ sessionId }: { sessionId: SessionId }) => sessionId === 'session-nova' ? [task] : [formerTask]),
    delete: remove,
  })
  return { schedules, remove }
}

describe('group-bound Host schedules', () => {
  it('lists only tasks of current employee Sessions in the authorized group', async () => {
    const { schedules } = setup()
    expect(await schedules.list(actor, 'group')).toEqual([{ ...task, employeeId: 'nova', employeeName: 'Nova' }])
  })

  it('deletes an exact group task but never a task from another Session', async () => {
    const { schedules, remove } = setup()
    await expect(schedules.delete(actor, 'group', task.id)).resolves.toEqual({ id: task.id, deleted: true })
    expect(remove).toHaveBeenCalledWith({ sessionId: 'session-nova', id: task.id })
    await expect(schedules.delete(actor, 'group', 'foreign')).rejects.toThrow('schedule-not-found')
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it('does not report success when the task disappears before deletion', async () => {
    const { schedules, remove } = setup()
    remove.mockResolvedValueOnce({ id: task.id, deleted: false, code: 'schedule_not_found' })
    await expect(schedules.delete(actor, 'group', task.id)).rejects.toThrow('schedule-not-found')
  })

  it('rejects channels and group members without management rights', async () => {
    const channel = setup({ ...detail, kind: 'channel' as const }).schedules
    await expect(channel.list(actor, 'group')).rejects.toThrow('group-required')
    const member = setup({ ...detail, viewerIsAdmin: false }).schedules
    await expect(member.delete(actor, 'group', task.id)).rejects.toThrow('forbidden')
  })
})
