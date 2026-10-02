// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { CollaborationRoom, reactionSummaries, stripReplyBoilerplate } from '../src/client/CollaborationRoom.tsx'
import { CollaborationController, type RoomEvent } from '../src/client/collaboration-store.ts'
import { zh } from '../src/client/collaboration-locales.ts'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { PropsRenderFactories } from '@deepseek-ai/dsh-client-ui-slots'
import type { MenuViewInjected } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { MenuView } from '../../ui-input-trigger/src/client/MenuView.tsx'
import { zh as menuZh } from '../../ui-input-trigger/src/client/locales.ts'

const scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
afterEach(() => {
  cleanup(); vi.unstubAllGlobals()
  if (scrollDescriptor === undefined) Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
  else Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollDescriptor)
})
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
    viewerUserId: 'u1', viewerIsAdmin: false,
  } }, events })
  const t: TranslateNS<'enterprise.collaboration'> = makeTranslate(zh)
  return { controller, state: controller.state.getSnapshot(), t }
}

describe('shared room UI', () => {
  it('shows attachment rejection beside its channel post without hiding it in execution details', () => {
    const failure: RoomEvent = { ...human, id: 'attachment-failure', sequence: '40', kind: 41000,
      author: { kind: 'service', id: 'attachment-admission', displayName: 'Attachment admission' },
      content: 'Attachment delivery failed: INVALID_IMAGE', threadRoot: human.id,
      tags: [['e', human.id], ['e', human.id, '', 'root'], ['dsh-attachment-error', 'INVALID_IMAGE', 'employee', 'research-bot']] }
    const targeted = { ...human, tags: [['dsh-target', 'research-bot']] }
    const { controller, state, t } = setup([targeted, failure])
    const channel = { ...state, selection: { detail: { ...state.selection!.detail, kind: 'channel' as const } } }
    render(<CollaborationRoom controller={controller} state={channel} t={t} />)
    expect(screen.getByRole('alert').textContent).toBe('附件验证未通过，未交给研究 Bot')
    expect(screen.queryByText('Attachment delivery failed: INVALID_IMAGE')).toBeNull()
    expect(screen.queryByText('执行详情')).toBeNull()
    expect(screen.queryByLabelText('正在回复')).toBeNull()
    controller.dispose()
  })
  it('keeps main and thread file menus independent and consumes menu Escape before closing the thread', () => {
    const { controller, state, t } = setup([])
    vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
    const menuT = makeTranslate(menuZh)
    const factory: PropsRenderFactories['renderFactorySlot'] = (name, props) => name === 'input-trigger.menu'
      ? <MenuView {...props as MenuViewInjected} t={menuT} /> : null
    const channel = { ...state, selection: { detail: { ...state.selection!.detail, kind: 'channel' as const }, threadRoot: human.id },
      events: [human], threadRootEvent: human }
    const close = vi.spyOn(controller, 'closeThread')
    const view = render(<CollaborationRoom controller={controller} state={channel} t={t} renderFactorySlot={factory} />)
    const thread = screen.getByRole('complementary', { name: '线程' })
    const buttons = screen.getAllByRole('button', { name: '添加附件' })
    const inputs = view.container.querySelectorAll<HTMLInputElement>('input[type="file"]')
    const mainPicker = vi.spyOn(inputs[0]!, 'click')
    const threadPicker = vi.spyOn(inputs[1]!, 'click')
    fireEvent.click(within(thread).getByRole('button', { name: '添加附件' }))
    fireEvent.keyDown(within(thread).getByRole('textbox', { name: '消息' }), { key: 'Escape' })
    expect(close).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).toBeNull()
    fireEvent.click(within(thread).getByRole('button', { name: '添加附件' }))
    fireEvent.keyDown(within(thread).getByRole('textbox', { name: '消息' }), { key: 'Enter' })
    expect(threadPicker).toHaveBeenCalledTimes(1)
    expect(mainPicker).not.toHaveBeenCalled()
    fireEvent.click(within(thread).getByRole('button', { name: '添加附件' }))
    fireEvent.pointerDown(buttons[0]!)
    fireEvent.click(buttons[0]!)
    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(within(thread).queryByRole('listbox')).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: '@ 提及成员' })[0]!)
    expect(screen.queryByRole('listbox')).toBeNull()
    fireEvent.click(buttons[0]!)
    fireEvent.change(screen.getAllByRole('textbox', { name: '消息' })[0]!, { target: { value: '@研', selectionStart: 2 } })
    expect(screen.queryByRole('listbox')).toBeNull()
    controller.dispose()
  })
  it('opens the workspace file menu before the picker and closes it without losing draft text', async () => {
    const { controller, state, t } = setup([])
    vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
    const menuT = makeTranslate(menuZh)
    const factory: PropsRenderFactories['renderFactorySlot'] = (name, props) => name === 'input-trigger.menu'
      ? <MenuView {...props as MenuViewInjected} t={menuT} /> : null
    const view = render(<CollaborationRoom controller={controller} state={state} t={t} renderFactorySlot={factory} />)
    const editor = screen.getByRole('textbox', { name: '消息' }) as HTMLTextAreaElement
    fireEvent.change(editor, { target: { value: '保留草稿' } })
    const fileInput = view.container.querySelector('input[type="file"]') as HTMLInputElement
    const picker = vi.spyOn(fileInput, 'click')
    fireEvent.click(screen.getByRole('button', { name: '添加附件' }))
    expect(picker).not.toHaveBeenCalled()
    const option = await screen.findByRole('option', { name: /文件/ })
    fireEvent.mouseDown(option)
    expect(picker).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '添加附件' }))
    fireEvent.keyDown(editor, { key: 'Escape' })
    expect(screen.queryByRole('listbox', { name: '触发候选建议' })).toBeNull()
    expect(editor.value).toBe('保留草稿')
    fireEvent.click(screen.getByRole('button', { name: '添加附件' }))
    expect(screen.getByRole('listbox', { name: '触发候选建议' })).toBeTruthy()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('listbox', { name: '触发候选建议' })).toBeNull()
    expect(editor.value).toBe('保留草稿')
    controller.dispose()
  })
  it('keeps a reply reaction off the referenced root post', () => {
    const event = { ...reaction, tags: [['e', research.id], ['e', human.id, '', 'root']] }
    expect(reactionSummaries([event], research.id, 'u1')).toEqual([{ emoji: '👍', count: 1, mine: true }])
    expect(reactionSummaries([event], human.id, 'u1')).toEqual([])
  })
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
  it('renders two humans and multiple Bots in one ordered timeline with source and signature', () => {
    const { controller, state, t } = setup()
    render(<CollaborationRoom controller={controller} state={state} t={t}/>)
    expect(screen.getByRole('region', { name: '消息记录' }).textContent).toContain('张总')
    expect(screen.getByRole('region', { name: '消息记录' }).textContent).toContain('陈经理')
    expect(screen.getByRole('region', { name: '消息记录' }).textContent).toContain('研究 Bot')
    expect(screen.getByRole('region', { name: '消息记录' }).textContent).toContain('数据 Bot')
    expect(screen.getByRole('region', { name: '消息记录' }).textContent).toContain('研究 Bot 将任务交给编辑 Bot')
    expect(screen.getByText('工作流')).toBeTruthy()
    // The signature label is hidden; only execution-source links remain in footers.
    expect(screen.queryAllByText(/签名记录/)).toHaveLength(0)
    expect(screen.getAllByRole('button', { name: '查看执行记录' })).toHaveLength(3)
    expect(reactionSummaries(state.events, 'research', 'u1')).toEqual([{ emoji: '👍', count: 1, mine: true }])
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
    // The reply-in-thread footer button is hidden; channels open threads from the reply chip.
    const initial = render(<CollaborationRoom controller={controller} state={state} t={t}/>)
    expect(initial.container.querySelector('button[aria-label="在线程中回复"]')).toBeNull()
    initial.unmount()
    // Human replies inside the thread also leave the main timeline.
    const humanReply: RoomEvent = { ...human, id: 'human-reply', sequence: '500', threadRoot: human.id, content: '线程里的补充' }
    const reply: RoomEvent = { ...research, id: 'reply-1', threadRoot: human.id, content: '已收到协作消息。' }
    const channelState = { ...state, selection: { detail: { ...state.selection!.detail, kind: 'channel' as const } }, events: [human, humanReply, reply] }
    render(<CollaborationRoom controller={controller} state={channelState} t={t}/>)
    expect(screen.queryByText('线程里的补充')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /条回复/ }))
    expect(thread).toHaveBeenCalledWith('human')
    fireEvent.click(screen.getByRole('button', { name: '搜索会话' }))
    fireEvent.change(screen.getByPlaceholderText('搜索消息与工作记录'), { target: { value: '指标' } })
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    expect(search).toHaveBeenCalledWith('指标')
    controller.dispose()
  })

  it('keeps inline agent replies with execution links in groups', () => {
    const { controller, state, t } = setup()
    const inspect = vi.spyOn(controller, 'inspect').mockResolvedValue()
    render(<CollaborationRoom controller={controller} state={state} t={t}/>)
    fireEvent.click(screen.getAllByRole('button', { name: '查看执行记录' })[0]!)
    expect(inspect).toHaveBeenCalledWith('execution-1')
    controller.dispose()
  })

  it('shows presented file cards on the agent reply that carries a work Session', async () => {
    const presentedFiles = [{ path: 'reports/BRIEF.md', description: 'Lead 汇总的趋势洞察', seq: 40, index: 0,
      downloadUrl: '/api/present.download?sessionId=session-work-1&seq=40&index=0' }]
    const { controller, state, t } = setup()
    const presented = vi.spyOn(controller, 'presentedFiles').mockResolvedValue(presentedFiles)
    const selected = state.selection
    if (selected === null) throw new Error('room selection missing')
    const answer: RoomEvent = { ...research, id: 'answer-9', sequence: '400',
      sourceSessionId: 'session-work-1', content: '报告已完成。' }
    const withAnswer = { ...state, events: [human, answer] }
    render(<CollaborationRoom controller={controller} state={withAnswer} t={t}/>)
    expect(presented).toHaveBeenCalledWith('session-work-1', '400')
    expect(await screen.findByText('BRIEF.md')).toBeTruthy()
    const download = screen.getByRole('link', { name: /BRIEF.md/ })
    expect(download.getAttribute('href')).toContain('/api/present.download?sessionId=session-work-1&seq=40&index=0')
    controller.dispose()
  })

  it('loads delivery metadata for a reply found only in thread or search history', async () => {
    const { controller, state, t } = setup()
    const presented = vi.spyOn(controller, 'presentedFiles').mockResolvedValue([])
    const threadReply: RoomEvent = { ...research, id: 'thread-only', sequence: '400', sourceSessionId: 'thread-work' }
    const searchedReply: RoomEvent = { ...research, id: 'search-only', sequence: '401', sourceSessionId: 'search-work' }
    render(<CollaborationRoom controller={controller} state={{ ...state, events: [human],
      threadEvents: [threadReply], searchResults: [searchedReply] }} t={t}/>)
    await waitFor(() => {
      expect(presented).toHaveBeenCalledWith('thread-work', '400')
      expect(presented).toHaveBeenCalledWith('search-work', '401')
    })
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

  it('lets the group administrator rename, publish the announcement, and change membership', async () => {
    const { controller, state, t } = setup([])
    const selected = state.selection
    if (selected === null) throw new Error('room selection missing')
    const admin = { ...state, selection: { detail: { ...selected.detail, viewerIsAdmin: true, adminUserId: 'u1',
      humanMembers: [{ userId: 'u1', displayName: '张总' }, { userId: 'u2', displayName: '陈经理' }] } } }
    const rename = vi.spyOn(controller, 'rename').mockResolvedValue(true)
    const setAnnouncement = vi.spyOn(controller, 'setAnnouncement').mockResolvedValue(true)
    const addMembers = vi.spyOn(controller, 'addMembers').mockResolvedValue(true)
    const removeMembers = vi.spyOn(controller, 'removeMembers').mockResolvedValue(true)
    vi.spyOn(controller, 'getMemberOptions').mockResolvedValue({ employees: [{ id: 'new-bot', name: '新 Bot' }], people: [{ id: 'u9', name: '王五' }] })
    render(<CollaborationRoom controller={controller} state={admin} t={t}/>)
    fireEvent.click(screen.getByRole('button', { name: '会话详情' }))
    expect(screen.getByText('管理员')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '修改名称' }))
    fireEvent.change(screen.getByRole('textbox', { name: '群名称' }), { target: { value: 'Q4 交付群' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(rename).toHaveBeenCalledWith('room', 'Q4 交付群')
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.change(screen.getByRole('textbox', { name: '群公告' }), { target: { value: '周五评审' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(setAnnouncement).toHaveBeenCalledWith('room', '周五评审')
    fireEvent.click(screen.getByLabelText('移除成员 陈经理'))
    fireEvent.click(screen.getByRole('button', { name: '确认移除' }))
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(removeMembers).toHaveBeenCalledWith('room', [], ['u2'])
    fireEvent.click(screen.getByRole('button', { name: '添加数字员工' }))
    fireEvent.click(await screen.findByLabelText('新 Bot'))
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(addMembers).toHaveBeenCalledWith('room', ['new-bot'], [])
    controller.dispose()
  })

  it('shows the announcement and administrator badge without member controls for other members', async () => {
    const { controller, state, t } = setup([])
    const selected = state.selection
    if (selected === null) throw new Error('room selection missing')
    const member = { ...state, selection: { detail: { ...selected.detail, viewerIsAdmin: false, adminUserId: 'u1',
      announcement: '周五评审', humanMembers: [{ userId: 'u1', displayName: '张总' }] } } }
    render(<CollaborationRoom controller={controller} state={member} t={t}/>)
    fireEvent.click(screen.getByRole('button', { name: '会话详情' }))
    expect(screen.getByText('周五评审')).toBeTruthy()
    expect(screen.getByText('管理员')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '编辑' })).toBeNull()
    expect(screen.queryByRole('button', { name: '移除成员 张总' })).toBeNull()
    controller.dispose()
  })

  it('right-aligns the viewer posts and renders employee avatars from their published profile', () => {
    const { controller, state, t } = setup()
    const selected = state.selection
    if (selected === null) throw new Error('room selection missing')
    const seeded = { ...state, selection: { detail: { ...selected.detail,
      members: [{ employeeId: 'research-bot', displayName: '研究 Bot', avatarSeed: 'seed-bot' }, { employeeId: 'data-bot', displayName: '数据 Bot' }] } } }
    const { container } = render(<CollaborationRoom controller={controller} state={seeded} t={t}/>)
    const own = [...container.querySelectorAll('article')].filter(node => node.className.includes('entrySelf'))
    expect(own).toHaveLength(1)
    expect(own[0]!.textContent).toContain('张总')
    const avatars = [...container.querySelectorAll('img')].map(node => node.getAttribute('src'))
    // The research Bot appears twice (post + handoff) and the data Bot once.
    expect(avatars).toHaveLength(3)
    expect(avatars.filter(src => src?.includes('seed-bot'))).toHaveLength(2)
    // The unseeded employee falls back to its id seed, matching the roster card.
    expect(avatars.filter(src => src?.includes('data-bot'))).toHaveLength(1)
    controller.dispose()
  })

  it('keeps hooks stable when the room selection appears after an empty render', () => {
    const { controller, state, t } = setup()
    const empty = { ...state, selection: null }
    const view = render(<CollaborationRoom controller={controller} state={empty} t={t}/>)
    // Selecting a room after rendering without one must not crash the tree.
    view.rerender(<CollaborationRoom controller={controller} state={state} t={t}/>)
    expect(view.container.textContent).toContain('Q4 续约')
    view.rerender(<CollaborationRoom controller={controller} state={{ ...state, selection: null }} t={t}/>)
    view.rerender(<CollaborationRoom controller={controller} state={state} t={t}/>)
    expect(view.container.textContent).toContain('Q4 续约')
    controller.dispose()
  })

  it('echoes the human post immediately and reconciles it with the signed event', async () => {
    const { controller, state, t } = setup()
    let resolveSend: ((response: Response) => void) | undefined
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/messages')) {
        return new Promise<Response>((resolve) => { resolveSend = resolve })
      }
      return Response.json(url.endsWith('/events?limit=100') ? { items: [], nextCursor: null } : state.selection?.detail ?? {})
    }))
    render(<CollaborationRoom controller={controller} state={state} t={t}/>)
    fireEvent.change(screen.getByRole('textbox', { name: '消息' }), { target: { value: '即时上屏' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    // The optimistic echo appears before the response lands.
    expect(screen.getByText('即时上屏')).toBeTruthy()
    resolveSend?.(Response.json({ delivered: true, event: { ...human, id: 'signed-1', content: '即时上屏' }, targets: [] }))
    vi.unstubAllGlobals()
    await waitFor(() => { expect(screen.queryByText('即时上屏')).toBeTruthy() })
    controller.dispose()
  })

  it('uses the shared workspace composer capsule with attachment and member controls only', () => {
    const { controller, state, t } = setup()
    const view = render(<CollaborationRoom controller={controller} state={state} t={t}/>)
    expect(view.container.querySelector('[data-composer-card]')).not.toBeNull()
    expect(screen.getByRole('textbox', { name: '消息' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '添加附件' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '@ 提及成员' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /选择模型|访问模式|权限选择/ })).toBeNull()
    controller.dispose()
  })

  it('opens the member picker from a typed @, filters it, and inserts the picked name', async () => {
    const { controller, state, t } = setup([])
    const selected = state.selection
    if (selected === null) throw new Error('room selection missing')
    const seeded = { ...state, selection: { detail: { ...selected.detail,
      members: [{ employeeId: 'research-bot', displayName: '研究 Bot', avatarSeed: 'seed-bot' }, { employeeId: 'data-bot', displayName: '数据 Bot' }],
      humanMembers: [{ userId: 'u2', displayName: '陈经理' }] } } }
    const send = vi.spyOn(controller, 'send').mockResolvedValue(true)
    render(<CollaborationRoom controller={controller} state={seeded} t={t}/>)
    const input = screen.getByRole('textbox', { name: '消息' })
    fireEvent.change(input, { target: { value: '请 @研 复核', selectionStart: 4 } })
    expect(await screen.findByText('研究 Bot')).toBeTruthy()
    expect(screen.queryByText('数据 Bot')).toBeNull()
    // Menu rows carry the roster avatar for digital employees.
    expect(document.querySelector('img')).not.toBeNull()
    fireEvent.click(screen.getByText('研究 Bot'))
    expect((input as HTMLTextAreaElement).value).toBe('请 @研究 Bot  复核')
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => { expect(send).toHaveBeenCalledWith('请 @研究 Bot  复核', expect.objectContaining({
      mentionedEmployeeIds: ['research-bot'] })) })
    controller.dispose()
  })

  it('uploads pasted files through the same attachment intake as picked files', async () => {
    const { controller, state, t } = setup([])
    const upload = vi.spyOn(controller, 'uploadAttachment').mockResolvedValue({
      attachmentId: 'pasted', name: 'screen.png', mimeType: 'image/png', size: 1 })
    render(<CollaborationRoom controller={controller} state={state} t={t}/>)
    vi.stubGlobal('URL', class extends URL {
      static override createObjectURL(): string { return 'blob:preview' }
      static override revokeObjectURL(): void {}
    })
    const file = new File(['x'], 'screen.png', { type: 'image/png' })
    fireEvent.paste(screen.getByRole('textbox', { name: '消息' }), { clipboardData: { files: [file] } })
    await waitFor(() => { expect(upload).toHaveBeenCalledWith(state.selection!.detail.id, file) })
    controller.dispose()
  })

  it('keeps SVG uploads as generic files like the workspace composer', async () => {
    const { controller, state, t } = setup([])
    const upload = vi.spyOn(controller, 'uploadAttachment').mockResolvedValue({
      attachmentId: 'svg', name: 'diagram.svg', mimeType: 'image/svg+xml', size: 6 })
    const factory = vi.fn<PropsRenderFactories['renderFactorySlot']>(() => null)
    render(<CollaborationRoom controller={controller} state={state} t={t} renderFactorySlot={factory} />)
    const file = new File(['<svg/>'], 'diagram.svg', { type: 'image/svg+xml' })
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } })
    await waitFor(() => { expect(upload).toHaveBeenCalledWith(state.selection!.detail.id, file) })
    expect(factory).toHaveBeenCalledWith('attachments.composer', expect.objectContaining({
      attachments: [expect.objectContaining({ kind: 'file', file })],
    }))
    controller.dispose()
  })

  it('attaches files, uploads them before send, and renders signed attachments', async () => {
    const { controller, state, t } = setup([])
    const upload = vi.spyOn(controller, 'uploadAttachment').mockResolvedValue({
      attachmentId: 'att-1', name: '报价.pdf', mimeType: 'application/pdf', size: 2048 })
    vi.spyOn(controller, 'attachmentUrl').mockReturnValue('/download')
    const send = vi.spyOn(controller, 'send').mockResolvedValue(true)
    render(<CollaborationRoom controller={controller} state={state} t={t}/>)
    const file = new File(['x'], '报价.pdf', { type: 'application/pdf' })
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } })
    await waitFor(() => { expect(upload).toHaveBeenCalled() })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => { expect(send).toHaveBeenCalledWith('', expect.objectContaining({
      attachments: [{ attachmentId: 'att-1', name: '报价.pdf', mimeType: 'application/pdf', size: 2048 }] })) })
    controller.dispose()
  })

  it('folds an agent tool run into its final answer as collapsed details', () => {
    const { controller, state, t } = setup()
    const selected = state.selection
    if (selected === null) throw new Error('room selection missing')
    const tool = (id: string, content: string): RoomEvent => ({
      ...research, id, sequence: String(Number(research.sequence) + 100), kind: 91000, content })
    const toolA = tool('tool-a', 'Tool skill started.')
    const toolB = tool('tool-b', 'Tool bash succeeded.')
    const answer: RoomEvent = { ...research, id: 'answer-1', sequence: '300',
      content: '已在房间回复（事件 \'ca7b9160…c768\'，序号 71），调研完成：结论如下。' }
    const grouped = { ...state, events: [human, toolA, toolB, answer] }
    const { container } = render(<CollaborationRoom controller={controller} state={grouped} t={t}/>)
    // Tool events render exactly once, inside the answer entry, collapsed.
    expect(container.querySelectorAll('article')).toHaveLength(2)
    expect(container.textContent).toContain('执行详情')
    expect(container.textContent).toContain('Tool bash succeeded.')
    expect(container.querySelectorAll('details')[0]?.hasAttribute('open')).toBe(false)
    // The meta prefix is stripped from the displayed answer.
    expect(container.textContent).not.toContain('已在房间回复')
    expect(container.textContent).toContain('调研完成：结论如下。')
    controller.dispose()
  })

  it('strips the 回应 meta variant and keeps a pure meta message readable', () => {
    expect(stripReplyBoilerplate('已在房间回应（事件 \'632a363b…e185f6\'，序号 197）。\n\n**回应的四件事：**\n1. 向管理员确认在线。'))
      .toBe('**回应的四件事：**\n1. 向管理员确认在线。')
    // A message that is nothing but the meta line stays readable.
    expect(stripReplyBoilerplate('已在房间回应（事件 \'abc\'，序号 5）。')).not.toBe('')
  })

  it('shows a working chip on the mentioning message until the agent answers', () => {
    const { controller, state, t } = setup([human])
    const selected = state.selection
    if (selected === null) throw new Error('room selection missing')
    const targeted = { ...human, tags: [...human.tags, ['dsh-target', 'research-bot']] }
    const working = { ...state, events: [targeted] }
    const view = render(<CollaborationRoom controller={controller} state={working} t={t}/>)
    expect(screen.getByLabelText('正在回复')).toBeTruthy()
    expect(view.container.querySelector('img')?.getAttribute('src')).toContain('seed=research-bot')
    // The chip clears once the mentioned employee posts its answer.
    const answered = { ...state, events: [targeted, research] }
    cleanup()
    const after = render(<CollaborationRoom controller={controller} state={answered} t={t}/>)
    expect(after.container.querySelector('[aria-label="正在回复"]')).toBeNull()
    after.unmount()
    controller.dispose()
  })

  it('reuses the agent working chip for a channel thread reply until that thread receives an answer', () => {
    const { controller, state, t } = setup([human])
    const selected = state.selection
    if (selected === null) throw new Error('room selection missing')
    const threadMessage: RoomEvent = { ...human, id: 'thread-human', sequence: '2', threadRoot: human.id,
      content: '@研究 Bot 请处理', tags: [...human.tags, ['dsh-target', 'research-bot']] }
    const channel = { ...state,
      selection: { detail: { ...selected.detail, kind: 'channel' as const }, threadRoot: human.id },
      events: [human], threadRootEvent: human, threadEvents: [threadMessage], threadPhase: 'ready' as const }
    render(<CollaborationRoom controller={controller} state={channel} t={t}/>)
    const thread = screen.getByRole('complementary', { name: '线程' })
    const status = within(thread).getByLabelText('正在回复')
    expect(status).toBeTruthy()
    expect(status.querySelector('img')?.getAttribute('src')).toContain('seed=research-bot')

    const answer: RoomEvent = { ...research, id: 'thread-answer', sequence: '3', threadRoot: human.id }
    cleanup()
    render(<CollaborationRoom controller={controller} state={{ ...channel, threadEvents: [threadMessage, answer] }} t={t}/>)
    expect(within(screen.getByRole('complementary', { name: '线程' })).queryByLabelText('正在回复')).toBeNull()
    controller.dispose()
  })

  it('keeps the thread root working through an unrelated thread answer and clears it after attachment rejection', () => {
    const targeted = { ...human, tags: [...human.tags, ['dsh-target', 'research-bot']] }
    const otherAnswer = { ...research, id: 'other-answer', sequence: '40', threadRoot: 'another-thread' }
    const { controller, state, t } = setup([targeted, otherAnswer])
    const channel = { ...state, selection: { detail: { ...state.selection!.detail, kind: 'channel' as const }, threadRoot: human.id },
      threadRootEvent: targeted, threadPhase: 'ready' as const }
    const view = render(<CollaborationRoom controller={controller} state={channel} t={t} />)
    const thread = screen.getByRole('complementary', { name: '线程' })
    expect(within(thread).getByLabelText('正在回复').textContent).toContain('研究 Bot')
    const failure: RoomEvent = { ...human, id: 'rejected', sequence: '41', kind: 41000, threadRoot: human.id,
      author: { kind: 'service', id: 'attachment-admission', displayName: 'Attachment admission' },
      tags: [['e', human.id], ['dsh-attachment-error', 'INVALID_IMAGE', 'employee', 'research-bot']] }
    view.rerender(<CollaborationRoom controller={controller} state={{ ...channel, threadEvents: [failure] }} t={t} />)
    expect(within(thread).queryByLabelText('正在回复')).toBeNull()
    expect(within(thread).getByRole('alert').textContent).toContain('研究 Bot')
    controller.dispose()
  })

  it('expands @ ALL to every member mention and inserts the token', async () => {
    const { controller, state, t } = setup([])
    const selected = state.selection
    if (selected === null) throw new Error('room selection missing')
    const seeded = { ...state, selection: { detail: { ...selected.detail,
      members: [{ employeeId: 'research-bot', displayName: '研究 Bot' }, { employeeId: 'data-bot', displayName: '数据 Bot' }],
      humanMembers: [{ userId: 'u2', displayName: '陈经理' }] } } }
    const send = vi.spyOn(controller, 'send').mockResolvedValue(true)
    render(<CollaborationRoom controller={controller} state={seeded} t={t}/>)
    fireEvent.click(screen.getByRole('button', { name: '@ 提及成员' }))
    fireEvent.click(screen.getByText('@ ALL'))
    fireEvent.change(screen.getByRole('textbox', { name: '消息' }), { target: { value: '全体注意' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => { expect(send).toHaveBeenCalledWith('全体注意', expect.objectContaining({
      mentionedEmployeeIds: ['research-bot', 'data-bot'], mentionedUserIds: ['u1', 'u2', 'u3'] })) })
    controller.dispose()
  })

  it('offers @ ALL from the typed @ filter and inserts the token', async () => {
    const { controller, state, t } = setup([])
    const selected = state.selection
    if (selected === null) throw new Error('room selection missing')
    const targeted = { ...state, events: [{ ...human, tags: [...human.tags, ['dsh-target', 'research-bot']] }] }
    render(<CollaborationRoom controller={controller} state={targeted} t={t}/>)
    const input = screen.getByRole('textbox', { name: '消息' })
    fireEvent.change(input, { target: { value: '@al', selectionStart: 3 } })
    fireEvent.click(await screen.findByText('@ ALL'))
    expect((input as HTMLTextAreaElement).value).toBe('@ALL ')
    controller.dispose()
  })

  it('moves channel agent replies into the thread chip of the triggering message', () => {
    const { controller, state, t } = setup()
    const selected = state.selection
    if (selected === null) throw new Error('room selection missing')
    const reply: RoomEvent = { ...research, id: 'reply-1', threadRoot: human.id, content: '已收到协作消息。' }
    const channel = { ...state, selection: { detail: { ...selected.detail, kind: 'channel' as const } }, events: [human, reply] }
    const view = render(<CollaborationRoom controller={controller} state={channel} t={t}/>)
    // The agent reply leaves the main timeline; a thread chip names the replier.
    const articles = view.container.querySelectorAll('article')
    expect(articles).toHaveLength(1)
    expect(articles[0]!.textContent).toContain('请调研续约')
    expect(articles[0]!.textContent).not.toContain('已收到协作消息')
    const openThread = vi.spyOn(controller, 'openThread').mockResolvedValue()
    fireEvent.click(screen.getByRole('button', { name: /条回复/ }))
    expect(openThread).toHaveBeenCalledWith('human')
    controller.dispose()
  })

  it('keeps historical channel replies and tool facts in their persisted topic thread', () => {
    const { controller, state, t } = setup()
    const selected = state.selection
    if (selected === null) throw new Error('room selection missing')
    const oldReply = { ...research, content: 'Historical Bot reply' }
    const tool = { ...oldReply, id: 'old-tool', sequence: '4', kind: 41000, content: 'Tool completed' }
    const channel = { ...state, selection: { detail: { ...selected.detail, kind: 'channel' as const,
      topicPolicy: 'thread' as const, topics: [{ id: human.id, title: human.content, state: 'open' as const,
        destinations: [{ employeeId: 'research-bot', sessionId: 'execution-1' }] }] } }, events: [human, oldReply, tool] }
    const view = render(<CollaborationRoom controller={controller} state={channel} t={t}/>)
    expect(view.container.querySelectorAll('article')).toHaveLength(1)
    expect(view.container.textContent).not.toContain('Historical Bot reply')
    expect(view.container.textContent).not.toContain('Tool completed')
    expect(screen.getByRole('button', { name: /1 条回复/ })).toBeTruthy()
    controller.dispose()
  })

  it('lets a channel post without replies open its thread', () => {
    const { controller, state, t } = setup()
    const selected = state.selection
    if (selected === null) throw new Error('room selection missing')
    const open = vi.spyOn(controller, 'openThread').mockResolvedValue()
    render(<CollaborationRoom controller={controller} state={{ ...state,
      selection: { detail: { ...selected.detail, kind: 'channel' } }, events: [human] }} t={t}/>)
    fireEvent.click(screen.getByRole('button', { name: '在线程中回复' }))
    expect(open).toHaveBeenCalledWith(human.id)
    controller.dispose()
  })

  it('summarizes channel threads whose triggering message is older than the loaded page', () => {
    const { controller, state, t } = setup()
    const selected = state.selection
    if (selected === null) throw new Error('room selection missing')
    // The root reply is not on the loaded page: only the thread replies are.
    const orphanReply: RoomEvent = { ...research, id: 'reply-1', threadRoot: 'event-gone', content: '已收到协作消息。' }
    const channel = { ...state, selection: { detail: { ...selected.detail, kind: 'channel' as const } }, events: [orphanReply] }
    const view = render(<CollaborationRoom controller={controller} state={channel} t={t}/>)
    // The reply must not render as a full channel timeline post.
    expect(view.container.querySelectorAll('article')).toHaveLength(0)
    const openThread = vi.spyOn(controller, 'openThread').mockResolvedValue()
    fireEvent.click(screen.getByRole('button', { name: /条回复/ }))
    expect(openThread).toHaveBeenCalledWith('event-gone')
    controller.dispose()
  })

  it('folds a follow-up signed message from the same reply run into the main answer', () => {
    const { controller, state, t } = setup()
    const selected = state.selection
    if (selected === null) throw new Error('room selection missing')
    const main: RoomEvent = { ...research, id: 'main-1', sequence: '300',
      content: '@Enterprise Administrator 收到，我在。同步一下我这边的状态。' }
    const followUp: RoomEvent = { ...research, id: 'follow-1', sequence: '301',
      content: '已在房间回应（事件 \'632a363b…e185f6\'，序号 197）。\n\n**回应的四件事：**\n1. 向管理员确认在线。' }
    const grouped = { ...state, events: [human, main, followUp] }
    const { container } = render(<CollaborationRoom controller={controller} state={grouped} t={t}/>)
    // One agent reply produces ONE timeline row; the follow-up folds in.
    expect(container.querySelectorAll('article')).toHaveLength(2)
    expect(container.textContent).toContain('收到，我在。')
    expect(container.textContent).toContain('回应的四件事')
    expect(container.textContent).not.toContain('已在房间回应')
    // A new human message starts a fresh run: the next answer stands alone.
    const secondTurn = { ...state, events: [human, main, followUp, colleague, { ...research, id: 'main-2', sequence: '400', content: '新一轮回答。' }] }
    const second = render(<CollaborationRoom controller={controller} state={secondTurn} t={t}/>)
    expect(second.container.querySelectorAll('article')).toHaveLength(4)
    second.unmount()
    controller.dispose()
  })

  it('shows a scheduled Agent reply as a new group message after an earlier Agent answer', () => {
    const { controller, state, t } = setup()
    const main: RoomEvent = { ...research, id: 'main', sequence: '300', content: '任务已创建' }
    const scheduled: RoomEvent = { ...research, id: 'scheduled', sequence: '301',
      tags: [['h', 'room'], ['dsh-schedule']], content: '定时任务验收完成' }
    const { container } = render(<CollaborationRoom controller={controller}
      state={{ ...state, events: [human, main, scheduled] }} t={t}/>)
    expect(container.querySelectorAll('article')).toHaveLength(3)
    expect(screen.getByText('定时任务验收完成')).toBeDefined()
    controller.dispose()
  })

  it('keeps delivery cards visible when their owning follow-up reply is folded', async () => {
    const { controller, state, t } = setup()
    vi.spyOn(controller, 'presentedFiles').mockResolvedValue([{ path: '/workspace/follow-up.txt', seq: 20,
      index: 0, replySourceSeq: 25, downloadUrl: '/api/present.download?sessionId=execution-1&seq=20&index=0' }])
    const first = { ...research, tags: [['dsh-source', 'execution-1:15']] }
    const followUp = { ...research, id: 'follow-up-file', sequence: '5', content: '文件已交付',
      tags: [['dsh-source', 'execution-1:25']] }
    render(<CollaborationRoom controller={controller} state={{ ...state, events: [human, first, followUp] }} t={t}/>)
    expect(await screen.findByText('follow-up.txt')).toBeTruthy()
    expect(screen.getByRole('link', { name: /follow-up.txt/ }).getAttribute('href'))
      .toContain('sessionId=execution-1&seq=20&index=0')
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
    fireEvent.click(screen.getByText('工作流与审批'))
    expect(await screen.findByText('频道工作流')).toBeTruthy()
    expect(await screen.findByText('版本 2')).toBeTruthy()
    controller.dispose()
  })
})
