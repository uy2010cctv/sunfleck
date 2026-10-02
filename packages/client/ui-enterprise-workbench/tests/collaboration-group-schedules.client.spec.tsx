// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  it('shows compact titles and opens full details before deleting an exact task', async () => {
    let items = [task]
    const transport = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        items = []
        return Response.json({ id: task.id, deleted: true })
      }
      return Response.json({ items })
    })
    render(<CollaborationGroupSchedules groupId="group-1" canManage t={t} transport={transport} />)
    fireEvent.click(await screen.findByRole('button', { name: '查看定时任务 每天同步' }))
    const dialog = screen.getByRole('dialog', { name: '每天同步' })
    expect(within(dialog).getByText('Nova')).toBeDefined()
    expect(within(dialog).getByText('汇总并发到群里')).toBeDefined()
    expect(within(dialog).getByText('Asia/Shanghai')).toBeDefined()
    fireEvent.click(within(dialog).getByRole('button', { name: '删除定时任务 每天同步' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '确认删除' }))
    await waitFor(() => { expect(screen.queryByText('每天同步')).toBeNull() })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(transport).toHaveBeenCalledWith('/enterprise/surfaces/group-1/schedules/delete',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ id: task.id }) }))
  })

  it('keeps details readable for a member without offering deletion', async () => {
    render(<CollaborationGroupSchedules groupId="group-2" canManage={false} t={t}
      transport={async () => Response.json({ items: [task] })} />)
    const row = await screen.findByRole('button', { name: '查看定时任务 每天同步' })
    expect(row.textContent).toBe('每天同步')
    expect(screen.queryByText('汇总并发到群里')).toBeNull()
    fireEvent.click(row)
    const dialog = screen.getByRole('dialog', { name: '每天同步' })
    expect(within(dialog).getByText('汇总并发到群里')).toBeDefined()
    expect(within(dialog).queryByRole('button', { name: '删除定时任务 每天同步' })).toBeNull()
  })

  it('keeps a read-only empty state for a group member', async () => {
    render(<CollaborationGroupSchedules groupId="group-2" canManage={false} t={t}
      transport={async () => Response.json({ items: [] })} />)
    expect(await screen.findByText('本群还没有定时任务')).toBeDefined()
    expect(screen.queryByRole('button', { name: /删除定时任务/u })).toBeNull()
  })
})
