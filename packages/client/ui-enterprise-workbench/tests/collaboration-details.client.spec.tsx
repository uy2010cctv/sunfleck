// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CollaborationDetails, CollaborationDetailsAction } from '../src/client/CollaborationDetails.tsx'
import { CollaborationController, type CollaborationSelection } from '../src/client/collaboration-store.ts'
import { zh } from '../src/client/collaboration-details-locales.ts'

afterEach(cleanup)
const selection: CollaborationSelection = {
  sessionId: 'session-a', detail: { id: 'surface-a', kind: 'channel', name: '采购协作', workspaceId: 'workspace-private', memberCount: 2,
    members: [{ employeeId: 'employee-secret', displayName: '采购员' }], memberUserIds: ['user-secret'], dutyEmployeeIds: ['employee-secret'],
    topics: [{ id: 'topic-a', title: '九月采购', state: 'open' }], topicPolicy: 'thread', respondPolicy: 'mention_duty',
    team: { id: 'team-secret', name: '采购团队' }, project: { id: 'project-secret', name: '秋季上新', goal: '按时备货' },
  },
}
function setup(value: CollaborationSelection | null = selection) {
  const controller = new CollaborationController(vi.fn(), vi.fn(), vi.fn())
  controller.state.set({ phase: 'ready', surfaces: [], creation: null, selection: value, busy: false, error: null })
  return { controller, sessionId: 'session-a', t: (key: keyof typeof zh) => zh[key] }
}
describe('collaboration details', () => {
  it('shows authorized names and routes topic selection without exposing identifiers', () => {
    const props = setup()
    const select = vi.spyOn(props.controller, 'select').mockResolvedValue()
    const view = render(<CollaborationDetails {...props} />)
    expect(screen.getByText('采购协作')).toBeTruthy()
    expect(screen.getByText('采购团队')).toBeTruthy()
    expect(screen.getByText('按时备货')).toBeTruthy()
    expect(view.container.textContent).not.toContain('secret')
    fireEvent.click(screen.getByRole('button', { name: /九月采购/ }))
    expect(select).toHaveBeenCalledWith('surface-a', { topicId: 'topic-a' })
  })
  it('hides stale selection details and the header action after changing Session', () => {
    const props = { ...setup(), sessionId: 'session-b', openDetails: vi.fn() }
    const view = render(<><CollaborationDetails {...props} /><CollaborationDetailsAction {...props} /></>)
    expect(view.container.textContent).not.toContain('采购协作')
    expect(screen.queryByRole('button')).toBeNull()
  })
  it('renders honest empty sections and retains details on navigation failure', () => {
    const { team: _team, project: _project, ...detail } = selection.detail
    const props = setup({ ...selection, detail: { ...detail, members: [], topics: [], dutyEmployeeIds: [] } })
    props.controller.state.set({ ...props.controller.state.getSnapshot(), error: 'request-failed' })
    render(<CollaborationDetails {...props} />)
    expect(screen.getByText(zh['topics.empty'])).toBeTruthy()
    expect(screen.getByText(zh['members.empty'])).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe(zh.error)
    expect(screen.queryByText('team-secret')).toBeNull()
  })
  it('opens the selected group employee conversation', () => {
    const props = setup({ ...selection, detail: { ...selection.detail, kind: 'group' } })
    const select = vi.spyOn(props.controller, 'select').mockResolvedValue()
    render(<CollaborationDetails {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '采购员' }))
    expect(select).toHaveBeenCalledWith('surface-a', { employeeId: 'employee-secret' })
  })
  it('opens a channel topic at its responding employee destination', () => {
    const props = setup({ ...selection, detail: { ...selection.detail, topics: [{ id: 'topic-a', title: '九月采购', state: 'open', destinations: [{ employeeId: 'employee-secret', sessionId: 'session-response' }] }] } })
    const select = vi.spyOn(props.controller, 'select').mockResolvedValue()
    render(<CollaborationDetails {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '九月采购 · 采购员' }))
    expect(select).toHaveBeenCalledWith('surface-a', { topicId: 'topic-a', employeeId: 'employee-secret' })
  })
  it('does not offer details for private or preflight sessions', () => {
    const { sessionId: _sessionId, ...preflight } = selection
    const props = setup(preflight)
    const view = render(<CollaborationDetailsAction {...props} openDetails={vi.fn()} />)
    expect(view.container.textContent).toBe('')
  })
})
