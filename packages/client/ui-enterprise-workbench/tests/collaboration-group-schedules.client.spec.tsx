// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { CollaborationGroupSchedules } from '../src/client/CollaborationGroupSchedules.tsx'
import { zh } from '../src/client/collaboration-locales.ts'

const t = makeTranslate(zh)
const task = { id: 'schedule-1', kind: 'daily', title: '每天同步', prompt: '汇总并发到群里',
  scheduledAt: '2026-10-03T01:00:00.000Z', time: '09:00:00.000', timeZone: 'Asia/Shanghai',
  employeeId: 'nova', employeeName: 'Nova' }

afterEach(cleanup)

describe('group room schedules', () => {
  it('shows only this group’s scheduled work and removes an exact task', async () => {
    let items = [task]
    const transport = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        items = []
        return Response.json({ id: task.id, deleted: true })
      }
      return Response.json({ items })
    })
    render(<CollaborationGroupSchedules groupId="group-1" canManage t={t} transport={transport} />)
    expect(await screen.findByText('每天同步')).toBeDefined()
    expect(screen.getByText('Nova')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '删除定时任务 每天同步' }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => { expect(screen.queryByText('每天同步')).toBeNull() })
    expect(transport).toHaveBeenCalledWith('/enterprise/surfaces/group-1/schedules/delete',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ id: task.id }) }))
  })

  it('keeps a read-only empty state for a group member', async () => {
    render(<CollaborationGroupSchedules groupId="group-2" canManage={false} t={t}
      transport={async () => Response.json({ items: [] })} />)
    expect(await screen.findByText('本群还没有定时任务')).toBeDefined()
    expect(screen.queryByRole('button', { name: /删除定时任务/u })).toBeNull()
  })
})
