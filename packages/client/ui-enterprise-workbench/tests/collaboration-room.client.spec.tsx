// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CollaborationRoom, reactionCounts } from '../src/client/CollaborationRoom.tsx'
import { CollaborationController, type RoomEvent } from '../src/client/collaboration-store.ts'
import { zh, type CollaborationKey } from '../src/client/collaboration-locales.ts'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const human: RoomEvent = { sequence: '1', id: 'human', pubkey: 'human-pubkey-very-long', created_at: 1, kind: 9, tags: [['h', 'room']], content: '请调研续约', sig: 'human-signature', author: { kind: 'human', id: 'u1', displayName: '张总' } }
const colleague: RoomEvent = { ...human, sequence: '2', id: 'colleague', content: '我负责复核来源', author: { kind: 'human', id: 'u2', displayName: '陈经理' } }
const research: RoomEvent = { ...human, sequence: '3', id: 'research', pubkey: 'research-pubkey-very-long', content: '交给数据 Bot 核对指标', author: { kind: 'employee', id: 'research-bot', displayName: '研究 Bot' }, sourceSessionId: 'execution-1' }
const data: RoomEvent = { ...research, sequence: '4', id: 'data', content: '指标已核对，交给编辑 Bot', author: { kind: 'employee', id: 'data-bot', displayName: '数据 Bot' }, sourceSessionId: 'execution-2' }
const reaction: RoomEvent = { ...human, sequence: '5', id: 'reaction', kind: 7, tags: [['h', 'room'], ['e', 'research']], content: '👍' }
const handoff: RoomEvent = { ...research, sequence: '6', id: 'handoff', kind: 41001, content: '研究 Bot 将任务交给编辑 Bot' }
function setup(events: RoomEvent[] = [human, colleague, research, data, reaction, handoff]) {
  const controller = new CollaborationController(vi.fn(), vi.fn(), vi.fn())
  controller.state.set({ ...controller.state.getSnapshot(), roomPhase: 'ready', selection: { detail: {
    id: 'room', kind: 'group', name: 'Q4 续约', workspaceId: 'workspace', memberCount: 5,
    members: [{ employeeId: 'research-bot', displayName: '研究 Bot' }, { employeeId: 'data-bot', displayName: '数据 Bot' }], memberUserIds: ['u1', 'u2', 'u3'], dutyEmployeeIds: [], topics: [],
  } }, events })
  const t: TranslateNS<'enterprise.collaboration'> = key => zh[key as CollaborationKey] ?? key
  return { controller, state: controller.state.getSnapshot(), t }
}

describe('shared room UI', () => {
  it('acknowledges visible room events after rendering', async () => {
    const { controller, state, t } = setup([human])
    const acknowledge = vi.spyOn(controller, 'acknowledgeVisible').mockResolvedValue()
    render(<CollaborationRoom controller={controller} state={state} t={t}/>)
    await waitFor(() => { expect(acknowledge).toHaveBeenCalledOnce() })
    controller.dispose()
  })
  it('does not mark a new room event read while search results replace the timeline', async () => {
    const { controller, state, t } = setup([human])
    const acknowledge = vi.spyOn(controller, 'acknowledgeVisible').mockResolvedValue()
    const { rerender } = render(<CollaborationRoom controller={controller} state={state} t={t}/>)
    await waitFor(() => { expect(acknowledge).toHaveBeenCalledOnce() })
    fireEvent.click(screen.getByRole('button', { name: '搜索会话' }))
    const beforeNewEvent = acknowledge.mock.calls.length
    rerender(<CollaborationRoom controller={controller} state={{ ...state, events: [human, data],
      searchPhase: 'ready', searchResults: [human] }} t={t}/>)
    expect(screen.queryByRole('region', { name: '消息记录' })).toBeNull()
    expect(acknowledge).toHaveBeenCalledTimes(beforeNewEvent)
    fireEvent.click(screen.getByRole('button', { name: '关闭搜索' }))
    await waitFor(() => { expect(acknowledge).toHaveBeenCalledTimes(beforeNewEvent + 1) })
    controller.dispose()
  })
  it('keeps a new room event unread while narrow navigation covers the room', async () => {
    const { controller, state, t } = setup([human])
    const occludesMain = createSnapshotStore(false)
    const acknowledge = vi.spyOn(controller, 'acknowledgeVisible').mockResolvedValue()
    const { rerender } = render(<CollaborationRoom controller={controller} state={state} t={t}
      occludesMain={occludesMain}/>)
    await waitFor(() => { expect(acknowledge).toHaveBeenCalledOnce() })
    occludesMain.set(true)
    rerender(<CollaborationRoom controller={controller} state={{ ...state, events: [human, data] }} t={t}
      occludesMain={occludesMain}/>)
    expect(acknowledge).toHaveBeenCalledOnce()
    occludesMain.set(false)
    await waitFor(() => { expect(acknowledge).toHaveBeenCalledTimes(2) })
    controller.dispose()
  })
  it('renders two humans and multiple Bots in one ordered timeline with source and signature', () => {
    const { controller, state, t } = setup()
    render(<CollaborationRoom controller={controller} state={state} t={t}/>)
    expect(screen.getByRole('region', { name: '消息记录' }).textContent).toContain('张总')
    expect(screen.getByRole('region', { name: '消息记录' }).textContent).toContain('陈经理')
    expect(screen.getByRole('region', { name: '消息记录' }).textContent).toContain('研究 Bot')
    expect(screen.getByRole('region', { name: '消息记录' }).textContent).toContain('数据 Bot')
    expect(screen.getByRole('region', { name: '消息记录' }).textContent).toContain('研究 Bot 将任务交给编辑 Bot')
    expect(screen.getByText('工作流')).toBeTruthy()
    expect(screen.getAllByText(/签名记录/).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: '查看执行记录' })).toHaveLength(3)
    expect(reactionCounts(state.events, 'research')).toEqual([{ emoji: '👍', count: 1 }])
    expect(screen.queryByText('reaction')).toBeNull()
    controller.dispose()
  })

  it('sends a human room message with selected Bot identities and retains failed draft', async () => {
    const { controller, state, t } = setup([])
    const send = vi.spyOn(controller, 'send').mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    render(<CollaborationRoom controller={controller} state={state} t={t}/>)
    fireEvent.click(screen.getByRole('button', { name: '@ 提及成员' }))
    fireEvent.click(screen.getByLabelText('研究 Bot'))
    fireEvent.change(screen.getByRole('textbox', { name: '消息' }), { target: { value: '请开始调研' } })
    const input = screen.getByRole('textbox', { name: '消息' })
    if (!(input instanceof HTMLTextAreaElement)) throw new Error('room composer is not a textarea')
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => { expect(send).toHaveBeenCalledWith('请开始调研', { mentionedEmployeeIds: ['research-bot'] }) })
    expect(input.value).toBe('请开始调研')
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => { expect(input.value).toBe('') })
    controller.dispose()
  })

  it('sends an explicit human mention alongside Bot mentions', async () => {
    const { controller, state, t } = setup([])
    const selected = state.selection
    if (selected === null) throw new Error('room selection missing')
    const withPeople = { ...state, selection: { detail: { ...selected.detail,
      humanMembers: [{ userId: 'u2', displayName: '陈经理' }] } } }
    const send = vi.spyOn(controller, 'send').mockResolvedValue(true)
    render(<CollaborationRoom controller={controller} state={withPeople} t={t}/>)
    fireEvent.click(screen.getByRole('button', { name: '@ 提及成员' }))
    fireEvent.click(screen.getByLabelText('陈经理'))
    fireEvent.click(screen.getByLabelText('研究 Bot'))
    fireEvent.change(screen.getByRole('textbox', { name: '消息' }), { target: { value: '请复核' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => { expect(send).toHaveBeenCalledWith('请复核', {
      mentionedEmployeeIds: ['research-bot'], mentionedUserIds: ['u2'],
    }) })
    controller.dispose()
  })

  it('opens a thread and searches the same room without selecting an employee Session', async () => {
    const { controller, state, t } = setup()
    const thread = vi.spyOn(controller, 'openThread').mockResolvedValue()
    const search = vi.spyOn(controller, 'search').mockResolvedValue()
    const inspect = vi.spyOn(controller, 'inspect').mockResolvedValue()
    render(<CollaborationRoom controller={controller} state={state} t={t}/>)
    fireEvent.click(screen.getAllByRole('button', { name: '在线程中回复' })[0]!)
    expect(thread).toHaveBeenCalledWith('human')
    fireEvent.click(screen.getByRole('button', { name: '搜索会话' }))
    fireEvent.change(screen.getByPlaceholderText('搜索消息与工作记录'), { target: { value: '指标' } })
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    expect(search).toHaveBeenCalledWith('指标')
    fireEvent.click(screen.getAllByRole('button', { name: '查看执行记录' })[0]!)
    expect(inspect).toHaveBeenCalledWith('execution-1')
    controller.dispose()
  })

  it('dismisses member mentions with Escape and returns focus to the composer', () => {
    const { controller, state, t } = setup([])
    render(<CollaborationRoom controller={controller} state={state} t={t}/>)
    fireEvent.click(screen.getByRole('button', { name: '@ 提及成员' }))
    expect(screen.getByRole('group', { name: '数字员工' })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('group', { name: '数字员工' })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '消息' }))
    controller.dispose()
  })

  it('places channel workflow definitions in its right details pane', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.endsWith('/decisions')
      ? { items: [], canDecide: false }
      : { items: [{ id: 'release-notes', revision: 2, yaml: 'version: 1' }], canManage: false })))
    const { controller, state, t } = setup([])
    const selected = state.selection
    if (selected === null) throw new Error('room selection missing')
    const channel = { ...state, selection: { detail: { ...selected.detail, kind: 'channel' as const } } }
    render(<CollaborationRoom controller={controller} state={channel} t={t}/>)
    fireEvent.click(screen.getByRole('button', { name: '会话详情' }))
    expect(await screen.findByText('频道工作流')).toBeTruthy()
    expect(await screen.findByText('版本 2')).toBeTruthy()
    controller.dispose()
  })
})
