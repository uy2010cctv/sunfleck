// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CollaborationSidebar, CollaborationSetup } from '../src/client/CollaborationNavigation.tsx'
import type { CollaborationChoices } from '../src/client/CollaborationNavigation.tsx'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { CollaborationController, type CollaborationState } from '../src/client/collaboration-store.ts'
import { zh, type CollaborationKey } from '../src/client/collaboration-locales.ts'

afterEach(cleanup)
const choices: CollaborationChoices = { employees: [{ id: 'analyst', name: '分析师' }], workspaces: [{ id: 'w', name: '项目部' }], people: [{ id: 'u', name: '陈经理' }], peopleAvailable: true, teams: [], projects: [] }
function setup() {
  const controller = new CollaborationController(vi.fn(), vi.fn(), vi.fn())
  const t: TranslateNS<'enterprise.collaboration'> = key => zh[key as CollaborationKey] ?? key
  const props = {
    usePanelInfo: <T,>(select: (value: { activePanelId: null }) => T): T => select({ activePanelId: null }),
    controller, loadChoices: () => Promise.resolve(choices),
    useCollaboration: <T,>(select: (state: CollaborationState) => T): T => select(controller.state.getSnapshot()), t,
  }
  return { controller, props }
}

describe('native collaboration navigation', () => {
  it('shows stored groups and channels as separate selectable sections', () => {
    const { controller, props } = setup()
    controller.state.set({ ...controller.state.getSnapshot(), phase: 'ready', surfaces: [{ id: 'g', kind: 'group', name: '续约群', memberCount: 2 }, { id: 'c', kind: 'channel', name: 'IT 值班', memberCount: 1 }] })
    const select = vi.spyOn(controller, 'select').mockResolvedValue()
    render(<CollaborationSidebar {...props} wide expandSidebar={() => {}} />)
    expect(screen.getByRole('region', { name: '群聊' })).toBeTruthy()
    expect(screen.getByRole('region', { name: '频道' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '续约群' }))
    expect(select).toHaveBeenCalledWith('g')
    expect(screen.getByRole('button', { name: '创建群聊' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'IT 值班' }))
    expect(select).toHaveBeenCalledWith('c')
  })

  it('shows mention and unread badges, hides them when muted, and pins rooms via the row menu', async () => {
    const { controller, props } = setup()
    controller.state.set({ ...controller.state.getSnapshot(), phase: 'ready', surfaces: [
      { id: 'g-a', kind: 'group', name: '甲群', memberCount: 2,
        attention: { newMessages: true, mentions: true, unread: 5 }, prefs: { pinned: false, starred: false, muted: false } },
      { id: 'g-b', kind: 'group', name: '乙群', memberCount: 2,
        attention: { newMessages: false, mentions: false, unread: 0 }, prefs: { pinned: true, starred: true, muted: false } },
      { id: 'g-c', kind: 'group', name: '丙群', memberCount: 2,
        attention: { newMessages: true, mentions: false, unread: 3 }, prefs: { pinned: false, starred: false, muted: true } },
    ] })
    const setRoomPrefs = vi.spyOn(controller, 'setRoomPrefs').mockResolvedValue(true)
    render(<CollaborationSidebar {...props} wide expandSidebar={() => {}} />)
    // Pinned 乙群 sorts first; muted 丙群 shows no badges.
    const names = [...screen.getByRole('region', { name: '群聊' }).querySelectorAll('button')]
      .map(node => node.textContent ?? '').filter(text => text.includes('群'))
    expect(names[0]).toContain('乙群')
    expect(names[2]).toContain('丙群')
    expect(screen.getByText('5')).toBeTruthy()
    expect(screen.getAllByTitle('有人@了你')).toHaveLength(1)
    expect(screen.queryByText('3')).toBeNull()
    expect(screen.getByText('★')).toBeTruthy()
    expect(screen.getAllByTitle('免打扰')).toHaveLength(1)
    // The row menu pins 甲群.
    fireEvent.click(screen.getAllByRole('button', { name: '房间选项' })[1]!)
    fireEvent.click(await screen.findByText('置顶'))
    await waitFor(() => { expect(setRoomPrefs).toHaveBeenCalledWith('g-a', { pinned: true }) })
  })

  it('opens channel navigation from the compact sidebar only after expanding', () => {
    const { props } = setup()
    props.controller.state.set({ ...props.controller.state.getSnapshot(), phase: 'ready' })
    const expand = vi.fn()
    render(<CollaborationSidebar {...props} wide={false} expandSidebar={expand} />)
    fireEvent.click(screen.getByRole('button', { name: '频道' }))
    expect(expand).toHaveBeenCalledOnce()
    expect(screen.queryByText('暂无频道')).toBeNull()
  })

  it('submits explicit workspace, human and employee choices', async () => {
    const { controller, props } = setup()
    controller.beginCreate('group')
    const create = vi.spyOn(controller, 'create').mockResolvedValue(true)
    render(<CollaborationSetup {...props}/>)
    await screen.findByLabelText('名称')
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '续约协作' } })
    fireEvent.change(screen.getByLabelText('工作区'), { target: { value: 'w' } })
    fireEvent.click(screen.getByLabelText('分析师'))
    fireEvent.click(screen.getByLabelText('陈经理'))
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await waitFor(() =>{  expect(create).toHaveBeenCalledWith({ kind: 'group', name: '续约协作', workspaceId: 'w', memberEmployeeIds: ['analyst'], memberUserIds: ['u'] }) })
  })
  it('preselects the owning project when creating a channel from its detail', async () => {
    const { controller, props } = setup()
    controller.beginCreate('channel', 'project-q4')
    const create = vi.spyOn(controller, 'create').mockResolvedValue(true)
    render(<CollaborationSetup {...props} loadChoices={async () => ({ ...choices,
      projects: [{ id: 'project-q4', name: 'Q4 续约' }] })}/>)
    await screen.findByLabelText('项目')
    expect((screen.getByLabelText('项目') as HTMLSelectElement).value).toBe('project-q4')
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '项目进度' } })
    fireEvent.change(screen.getByLabelText('工作区'), { target: { value: 'w' } })
    fireEvent.click(screen.getByLabelText('分析师'))
    fireEvent.change(screen.getByLabelText('当值员工'), { target: { value: 'analyst' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await waitFor(() => { expect(create).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'channel', projectId: 'project-q4', workspaceId: 'w', dutyEmployeeIds: ['analyst'],
    })) })
  })
  it('shows one room for a channel with multiple employees', () => {
    const { controller, props } = setup()
    controller.state.set({ ...controller.state.getSnapshot(), phase: 'ready', selection: {
      detail: {
        id: 'c', kind: 'channel', name: 'IT', memberCount: 2, workspaceId: 'w', memberUserIds: [], dutyEmployeeIds: [],
        members: [{ employeeId: 'a', displayName: '分析师' }, { employeeId: 'b', displayName: '李清' }],
        topics: [{ id: 'topic', title: '复核', state: 'open', destinations: [{ employeeId: 'a', sessionId: 'sa' }, { employeeId: 'b', sessionId: 'sb' }] }],
        viewerUserId: 'u', viewerIsAdmin: false,
      },
    } })
    render(<CollaborationSetup {...props}/>)
    expect(screen.getByRole('heading', { name: 'IT' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: '消息' })).toBeTruthy()
    expect(screen.queryByText('选择员工会话')).toBeNull()
  })

})
