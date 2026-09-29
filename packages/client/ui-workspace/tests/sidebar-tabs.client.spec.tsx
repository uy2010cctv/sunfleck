// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SidebarTabs } from '../src/client/sidebar-tabs.tsx'

afterEach(cleanup)

it('switches Workspace, group, and channel browsing in the left sidebar without clearing attention', () => {
  const groupAttention = createSnapshotStore(true)
  const tabs = [
    { id: 'workspace', order: 100, title: () => '工作区', icon: () => <span>W</span> },
    { id: 'group', order: 200, title: () => '群聊', icon: () => <span>G</span>, attention: groupAttention },
    { id: 'channel', order: 300, title: () => '频道', icon: () => <span>C</span> },
  ]
  render(<SidebarTabs tabs={tabs} wide label="协作导航" expandSidebar={vi.fn()}
    renderContent={id => <p>{id} content</p>}/>)
  expect(screen.getByRole('tablist', { name: '协作导航' })).toBeTruthy()
  expect(screen.getByText('workspace content')).toBeTruthy()
  const group = screen.getByRole('tab', { name: '群聊' })
  expect(group.querySelector('[data-attention]')).not.toBeNull()
  fireEvent.click(group)
  expect(screen.getByText('group content')).toBeTruthy()
  expect(group.querySelector('[data-attention]')).not.toBeNull()
  fireEvent.keyDown(group, { key: 'ArrowRight' })
  expect(screen.getByRole('tab', { name: '频道' }).getAttribute('aria-selected')).toBe('true')
  expect(screen.getByText('channel content')).toBeTruthy()
})

it('shows Workspace completion attention across category switches until the Session is read', () => {
  const attention = createSnapshotStore(false)
  render(<SidebarTabs tabs={[
    { id: 'workspace', order: 100, title: () => '工作区', icon: () => <span>W</span>, attention },
    { id: 'channel', order: 300, title: () => '频道', icon: () => <span>C</span> },
  ]} wide label="协作导航" expandSidebar={vi.fn()} renderContent={id => <p>{id}</p>}/>)
  const workspace = screen.getByRole('tab', { name: '工作区' })
  expect(workspace.querySelector('[data-attention]')).toBeNull()
  fireEvent.click(screen.getByRole('tab', { name: '频道' }))
  act(() => { attention.set(true) })
  expect(workspace.querySelector('[data-attention]')).not.toBeNull()
  fireEvent.click(workspace)
  expect(workspace.querySelector('[data-attention]')).not.toBeNull()
  act(() => { attention.set(false) })
  expect(workspace.querySelector('[data-attention]')).toBeNull()
})
