// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { CollaborationGroupDetails } from '../src/client/CollaborationGroupDetails.tsx'
import { CollaborationController, type CollaborationDetail } from '../src/client/collaboration-store.ts'
import { zh } from '../src/client/collaboration-locales.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const detail: CollaborationDetail = { id: 'room', kind: 'group', name: '产品协作', workspaceId: 'workspace', memberCount: 2,
  members: [{ employeeId: 'bot', displayName: '研究员' }], memberUserIds: ['admin', 'member'],
  humanMembers: [{ userId: 'admin', displayName: 'Kris' }, { userId: 'member', displayName: '同事' }],
  topics: [], dutyEmployeeIds: ['bot'], adminUserId: 'admin', viewerUserId: 'admin', viewerIsAdmin: true }
function setup() {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([])))
  const controller = new CollaborationController(vi.fn(), vi.fn(), vi.fn())
  return controller
}
function mount(controller: CollaborationController, value = detail) {
  return render(<CollaborationGroupDetails detail={value} controller={controller} t={makeTranslate(zh)} />)
}
describe('room management controls', () => {
  it('has one member selection entry per roster without a second inline add form', () => {
    const controller = setup()
    mount(controller)
    expect(screen.queryByRole('heading', { name: '添加成员' })).toBeNull()
    expect(screen.getByRole('button', { name: '添加成员' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '添加数字员工' })).toBeTruthy()
    controller.dispose()
  })
  it('lets a non-administrator confirm leaving a channel and keeps the room when the operation fails', async () => {
    const controller = setup()
    const leave = vi.spyOn(controller, 'leaveRoom').mockResolvedValue(false)
    mount(controller, { ...detail, kind: 'channel', viewerUserId: 'member', viewerIsAdmin: false })
    fireEvent.click(screen.getByRole('button', { name: '离开频道' }))
    expect(screen.getByRole('dialog', { name: '离开频道' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '确认离开' }))
    await waitFor(() => { expect(leave).toHaveBeenCalledWith('room') })
    expect(screen.getByRole('alert').textContent).toContain('未完成')
    expect(screen.getByRole('dialog', { name: '离开频道' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '解散频道' })).toBeNull()
    controller.dispose()
  })
  it('retains rename text on failure and closes the shared dialog only after success', async () => {
    const controller = setup()
    const rename = vi.spyOn(controller, 'rename').mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    mount(controller, { ...detail, kind: 'channel' })
    fireEvent.click(screen.getByRole('button', { name: '修改名称' }))
    const dialog = screen.getByRole('dialog', { name: '修改名称' })
    fireEvent.change(within(dialog).getByRole('textbox', { name: '频道名称' }), { target: { value: '新频道名' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(within(dialog).getByRole('alert')).toBeTruthy() })
    expect((within(dialog).getByRole('textbox') as HTMLInputElement).value).toBe('新频道名')
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(rename).toHaveBeenCalledWith('room', '新频道名')
    controller.dispose()
  })
  it('loads eligible members, filters existing members and adds only checked results', async () => {
    const controller = setup()
    vi.spyOn(controller, 'getMemberOptions').mockResolvedValue({ people: [{ id: 'admin', name: 'Kris' }, { id: 'new', name: '新同事' }], employees: [] })
    const add = vi.spyOn(controller, 'addMembers').mockResolvedValue(true)
    mount(controller)
    fireEvent.click(screen.getByRole('button', { name: '添加成员' }))
    const dialog = screen.getByRole('dialog', { name: '添加成员' })
    expect(await within(dialog).findByLabelText('新同事')).toBeTruthy()
    expect(within(dialog).queryByLabelText('Kris')).toBeNull()
    fireEvent.click(within(dialog).getByLabelText('新同事'))
    fireEvent.click(within(dialog).getByRole('button', { name: '添加' }))
    await waitFor(() => { expect(add).toHaveBeenCalledWith('room', [], ['new']) })
    expect(screen.queryByRole('dialog')).toBeNull()
    controller.dispose()
  })
  it('distinguishes candidate load failure from an empty eligible roster and retries', async () => {
    const controller = setup()
    const options = vi.spyOn(controller, 'getMemberOptions').mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ people: [], employees: [] })
    mount(controller)
    fireEvent.click(screen.getByRole('button', { name: '添加数字员工' }))
    const dialog = screen.getByRole('dialog', { name: '添加数字员工' })
    expect(await within(dialog).findByRole('alert')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '重试' }))
    await waitFor(() => { expect(within(dialog).getByText(zh.noMembersToAdd)).toBeTruthy() })
    expect(options).toHaveBeenCalledTimes(2)
    expect(within(dialog).queryByRole('alert')).toBeNull()
    controller.dispose()
  })
  it.each(['group', 'channel'] as const)('confirms archiving a %s and blocks Escape while the request is pending', async (kind) => {
    const controller = setup()
    let settle: ((value: boolean) => void) | undefined
    const archive = vi.spyOn(controller, 'dissolveRoom').mockImplementation(() => new Promise((resolve) => { settle = resolve }))
    mount(controller, { ...detail, kind })
    fireEvent.click(screen.getByRole('button', { name: kind === 'channel' ? '解散频道' : '解散该群' }))
    expect(archive).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: '确认解散' }))
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect((within(dialog).getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(true)
    settle?.(true)
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(archive).toHaveBeenCalledWith('room')
    controller.dispose()
  })
  it('sets channel duty explicitly from current employees', async () => {
    const controller = setup()
    const duty = vi.spyOn(controller, 'setDuty').mockResolvedValue(true)
    mount(controller, { ...detail, kind: 'channel', dutyEmployeeIds: [] })
    fireEvent.click(screen.getByRole('button', { name: '设置当值员工' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByLabelText('研究员'))
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(duty).toHaveBeenCalledWith('room', ['bot']) })
    controller.dispose()
  })
  it('searches member options and retains selection when adding fails', async () => {
    const controller = setup()
    vi.spyOn(controller, 'getMemberOptions').mockResolvedValue({ people: [], employees: [{ id: 'new', name: '编辑员工' }] })
    const add = vi.spyOn(controller, 'addMembers').mockResolvedValue(false)
    mount(controller)
    fireEvent.click(screen.getByRole('button', { name: '添加数字员工' }))
    const dialog = screen.getByRole('dialog')
    await within(dialog).findByLabelText('编辑员工')
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '无人匹配' } })
    expect(within(dialog).getByText('没有匹配的成员')).toBeTruthy()
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '编辑' } })
    fireEvent.click(within(dialog).getByLabelText('编辑员工'))
    fireEvent.click(within(dialog).getByRole('button', { name: '添加' }))
    await within(dialog).findByRole('alert')
    expect((within(dialog).getByLabelText('编辑员工') as HTMLInputElement).checked).toBe(true)
    expect(add).toHaveBeenCalledWith('room', ['new'], [])
    controller.dispose()
  })
})
