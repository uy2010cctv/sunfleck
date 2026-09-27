// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CollaborationRoom, reactionCounts, stripReplyBoilerplate } from '../src/client/CollaborationRoom.tsx'
import { CollaborationController, type RoomEvent } from '../src/client/collaboration-store.ts'
import { zh, type CollaborationKey } from '../src/client/collaboration-locales.ts'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'

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
    viewerUserId: 'u1', viewerIsAdmin: false,
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
    render(<CollaborationRoom controller={controller} state={admin} t={t}
      loadChoices={async () => ({ workspaces: [], employees: [{ id: 'new-bot', name: '新 Bot' }],
        people: [{ id: 'u9', name: '王五' }], teams: [], projects: [], peopleAvailable: true })}/>)
    fireEvent.click(screen.getByRole('button', { name: '会话详情' }))
    expect(screen.getByText('张总')).toBeTruthy()
    expect(screen.getByText('群管理员')).toBeTruthy()
    const renameInput = () => {
      fireEvent.click(screen.getAllByRole('button', { name: '编辑' })[0]!)
      return screen.getByRole('textbox', { name: '群名称' })
    }
    fireEvent.change(renameInput(), { target: { value: 'Q4 交付群' } })
    fireEvent.click(screen.getAllByRole('button', { name: '保存' })[0]!)
    await waitFor(() => { expect(rename).toHaveBeenCalledWith('room', 'Q4 交付群') })
    await waitFor(() => { expect(screen.getAllByRole('button', { name: '编辑' })).toHaveLength(2) })
    fireEvent.click(screen.getAllByRole('button', { name: '编辑' })[1]!)
    fireEvent.change(screen.getByRole('textbox', { name: '群公告' }), { target: { value: '周五评审' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(setAnnouncement).toHaveBeenCalledWith('room', '周五评审') })
    fireEvent.click(screen.getByLabelText('移除成员 陈经理'))
    await waitFor(() => { expect(removeMembers).toHaveBeenCalledWith('room', [], ['u2']) })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    fireEvent.click(await screen.findByLabelText('新 Bot'))
    fireEvent.click(screen.getByLabelText('王五'))
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    await waitFor(() => { expect(addMembers).toHaveBeenCalledWith('room', ['new-bot'], ['u9']) })
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
    expect(screen.getByText('群管理员')).toBeTruthy()
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
