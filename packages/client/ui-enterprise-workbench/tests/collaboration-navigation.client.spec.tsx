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
  it('hides stored groups while keeping channels selectable', () => {
    const { controller, props } = setup()
    controller.state.set({ ...controller.state.getSnapshot(), phase: 'ready', surfaces: [{ id: 'g', kind: 'group', name: '续约群', memberCount: 2 }, { id: 'c', kind: 'channel', name: 'IT 值班', memberCount: 1 }] })
    const select = vi.spyOn(controller, 'select').mockResolvedValue()
    render(<CollaborationSidebar {...props} wide expandSidebar={() => {}} />)
    expect(screen.queryByRole('region', { name: '群聊' })).toBeNull()
    expect(screen.getByRole('region', { name: '频道' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '续约群' })).toBeNull()
    expect(screen.queryByRole('button', { name: '创建群聊' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'IT 值班' }))
    expect(select).toHaveBeenCalledWith('c')
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
      },
    } })
    render(<CollaborationSetup {...props}/>)
    expect(screen.getByRole('heading', { name: 'IT' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: '消息' })).toBeTruthy()
    expect(screen.queryByText('选择员工会话')).toBeNull()
  })

})
