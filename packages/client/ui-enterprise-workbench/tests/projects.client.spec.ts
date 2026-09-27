// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { ProjectSpace } from '../src/client/projects.tsx'
import { zh } from '../src/client/locales.ts'
import {
  EnterpriseWorkbenchController,
  type EnterpriseProjectDetail, type EnterpriseProjectsState, type EnterpriseProjectSummary,
  type EnterpriseSurfacesState, type EnterpriseSurfaceView,
} from '../src/client/store.ts'

const t = makeTranslate(zh)

const RENEWAL: EnterpriseProjectSummary = {
  id: 'project-1', name: 'Q4 客户续约', goal: '12-20 前签约，毛利不低于 62%。', state: 'active',
  visibility: 'organization', createdBy: 'user-1', createdAt: 1_700_000_000_000,
}
const QUOTING: EnterpriseProjectSummary = {
  id: 'project-2', name: '报价平台迁移', goal: '把报价流程迁到统一工作区。', state: 'archived',
  visibility: 'private', createdBy: 'user-2', createdAt: 1_700_000_000_000,
  archivedAt: 1_700_000_000_001,
}

const IDLE_PROJECTS: EnterpriseProjectsState = {
  phase: 'idle', list: [], selected: undefined, detailError: null, error: null, busy: false, actionError: null,
}
const READY_PROJECTS: EnterpriseProjectsState = { ...IDLE_PROJECTS, phase: 'ready', list: [RENEWAL, QUOTING] }

const DETAIL: EnterpriseProjectDetail = {
  project: RENEWAL,
  members: [{ principalType: 'user', principalId: 'user-1' }],
}
const RENEWAL_DETAIL = { ...RENEWAL, members: DETAIL.members }

const GROUP_SURFACE: EnterpriseSurfaceView = { id: 'surface-1', kind: 'group', name: '销售协作群', memberCount: 3 }
const CHANNEL_SURFACE: EnterpriseSurfaceView = { id: 'surface-2', kind: 'channel', name: '值班频道', memberCount: 2 }
const DM_SURFACE: EnterpriseSurfaceView = { id: 'surface-3', kind: 'dm' }

const IDLE_SURFACES: EnterpriseSurfacesState = { phase: 'idle', list: [], error: null }

function projects(overrides: Partial<EnterpriseProjectsState>): EnterpriseProjectsState {
  return { ...IDLE_PROJECTS, ...overrides }
}

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

type FetchRoute = (url: string, init?: RequestInit) => Response | undefined

function stubFetch(route: FetchRoute): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const response = route(url, init)
    if (response === undefined) throw new Error(`unexpected fetch ${init?.method ?? 'GET'} ${url}`)
    return response
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function spaceProps(overrides: {
  projects?: EnterpriseProjectsState
  surfaces?: EnterpriseSurfacesState
  workspaces?: readonly { id: string; name: string }[]
  loadProjects?: () => Promise<boolean>
  loadSurfaces?: () => Promise<boolean>
  createProject?: (input: { name: string; goal: string }) => Promise<boolean>
  selectProject?: (projectId?: string) => Promise<void>
  addProjectMember?: (
    projectId: string, member: { principalType: 'user' | 'employee'; principalId: string },
  ) => Promise<boolean>
  archiveProject?: (projectId: string) => Promise<boolean>
  openRoom?: (id: string) => boolean
  createRoom?: (kind: 'group' | 'channel', projectId?: string) => boolean
  openGovernance?: () => void
} = {}) {
  return {
    projects: overrides.projects ?? IDLE_PROJECTS,
    surfaces: overrides.surfaces ?? IDLE_SURFACES,
    workspaces: overrides.workspaces ?? [],
    loadProjects: overrides.loadProjects ?? vi.fn(() => Promise.resolve(true)),
    loadSurfaces: overrides.loadSurfaces ?? vi.fn(() => Promise.resolve(true)),
    createProject: overrides.createProject ?? vi.fn(() => Promise.resolve(true)),
    selectProject: overrides.selectProject ?? vi.fn(() => Promise.resolve()),
    addProjectMember: overrides.addProjectMember ?? vi.fn(() => Promise.resolve(true)),
    archiveProject: overrides.archiveProject ?? vi.fn(() => Promise.resolve(true)),
    openRoom: overrides.openRoom ?? vi.fn(() => true),
    createRoom: overrides.createRoom ?? vi.fn(() => true),
    openGovernance: overrides.openGovernance ?? vi.fn(),
    t,
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('EnterpriseWorkbenchController project slice', () => {
  it('loads the project directory through the project list endpoint', async () => {
    const fetchMock = stubFetch(url =>
      url === '/enterprise/projects' ? jsonResponse([RENEWAL, QUOTING]) : undefined)
    const controller = new EnterpriseWorkbenchController({} as never, {} as never, {} as never, () => {})

    await expect(controller.loadProjects()).resolves.toBe(true)

    expect(fetchMock).toHaveBeenCalledWith('/enterprise/projects', {
      credentials: 'same-origin', headers: { accept: 'application/json' },
    })
    expect(controller.store.getSnapshot().projects).toMatchObject({
      phase: 'ready', error: null, list: [RENEWAL, QUOTING],
    })
  })

  it('keeps a failed project load contained in the slice', async () => {
    stubFetch(() => jsonResponse({ error: 'forbidden' }, 403))
    const controller = new EnterpriseWorkbenchController({} as never, {} as never, {} as never, () => {})

    await expect(controller.loadProjects()).resolves.toBe(false)

    const state = controller.store.getSnapshot().projects
    expect(state.phase).toBe('error')
    expect(state.error).toContain('403')
  })

  it('creates one project and reloads the directory', async () => {
    const fetchMock = stubFetch((url, init) => {
      if (url !== '/enterprise/projects') return undefined
      return init?.method === 'POST' ? jsonResponse(RENEWAL, 201) : jsonResponse([RENEWAL])
    })
    const controller = new EnterpriseWorkbenchController({} as never, {} as never, {} as never, () => {})

    await expect(controller.createProject({ name: RENEWAL.name, goal: RENEWAL.goal })).resolves.toBe(true)

    expect(fetchMock).toHaveBeenCalledWith('/enterprise/projects', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: RENEWAL.name, goal: RENEWAL.goal }),
    })
    const state = controller.store.getSnapshot().projects
    expect(state).toMatchObject({ phase: 'ready', busy: false, actionError: null, list: [RENEWAL] })
  })

  it('maps a failed create to the contained create-failed key', async () => {
    stubFetch((_url, init) =>
      init?.method === 'POST' ? jsonResponse({ error: 'invalid-payload' }, 400) : undefined)
    const controller = new EnterpriseWorkbenchController({} as never, {} as never, {} as never, () => {})

    await expect(controller.createProject({ name: 'x', goal: 'y' }))
      .resolves.toBe(false)
    expect(controller.store.getSnapshot().projects).toMatchObject({
      busy: false, actionError: 'create-failed',
    })
  })

  it('reads one project detail behind the member gate and seeds the creator member', async () => {
    stubFetch(url => url === '/enterprise/projects/project-1' ? jsonResponse(RENEWAL_DETAIL) : undefined)
    const controller = new EnterpriseWorkbenchController({} as never, {} as never, {} as never, () => {})

    await controller.selectProject('project-1')

    expect(controller.store.getSnapshot().projects).toMatchObject({
      detailError: null,
      selected: { project: RENEWAL, members: [{ principalType: 'user', principalId: 'user-1' }] },
    })
  })

  it('answers the member-gate 404 with the contained not-member key', async () => {
    stubFetch(() => jsonResponse({ error: 'project-not-found' }, 404))
    const controller = new EnterpriseWorkbenchController({} as never, {} as never, {} as never, () => {})

    await controller.selectProject('project-1')

    const state = controller.store.getSnapshot().projects
    expect(state.detailError).toBe('not-member')
    expect(state.selected).toBeUndefined()
  })

  it('maps other detail failures to the contained load-failed key', async () => {
    stubFetch(() => jsonResponse({ error: 'boom' }, 500))
    const controller = new EnterpriseWorkbenchController({} as never, {} as never, {} as never, () => {})

    await controller.selectProject('project-1')

    expect(controller.store.getSnapshot().projects.detailError).toBe('load-failed')
  })

  it('clears the selection and the detail error', async () => {
    stubFetch(() => jsonResponse({ error: 'project-not-found' }, 404))
    const controller = new EnterpriseWorkbenchController({} as never, {} as never, {} as never, () => {})
    await controller.selectProject('project-1')

    await controller.selectProject()

    const state = controller.store.getSnapshot().projects
    expect(state.selected).toBeUndefined()
    expect(state.detailError).toBeNull()
  })

  it('adds one member to the visible roster after a successful write', async () => {
    stubFetch((url, init) => {
      if (url === '/enterprise/projects/project-1' && init?.method === undefined) return jsonResponse(RENEWAL_DETAIL)
      if (url === '/enterprise/projects/project-1/members' && init?.method === 'POST') {
        return new Response(null, { status: 204 })
      }
      return undefined
    })
    const controller = new EnterpriseWorkbenchController({} as never, {} as never, {} as never, () => {})
    await controller.selectProject('project-1')

    await expect(controller.addProjectMember('project-1', {
      principalType: 'employee', principalId: 'employee-9',
    })).resolves.toBe(true)

    expect(controller.store.getSnapshot().projects.selected).toMatchObject({
      members: [
        { principalType: 'user', principalId: 'user-1' },
        { principalType: 'employee', principalId: 'employee-9' },
      ],
    })
  })
  it('reads persisted project members again after reopening the detail', async () => {
    const persisted = { ...RENEWAL_DETAIL, members: [
      ...RENEWAL_DETAIL.members, { principalType: 'employee', principalId: 'employee-9' },
    ] }
    const fetchMock = stubFetch(url => url === '/enterprise/projects/project-1'
      ? jsonResponse(persisted) : undefined)
    const controller = new EnterpriseWorkbenchController({} as never, {} as never, {} as never, () => {})
    await controller.selectProject('project-1')
    await controller.selectProject()
    await controller.selectProject('project-1')
    expect(controller.store.getSnapshot().projects.selected?.members).toEqual(persisted.members)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('maps a failed member add to the contained add-member-failed key', async () => {
    stubFetch((url, init) => {
      if (url === '/enterprise/projects/project-1' && init?.method === undefined) return jsonResponse(RENEWAL_DETAIL)
      if (url === '/enterprise/projects/project-1/members' && init?.method === 'POST') {
        return jsonResponse({ error: 'invalid-member' }, 400)
      }
      return undefined
    })
    const controller = new EnterpriseWorkbenchController({} as never, {} as never, {} as never, () => {})
    await controller.selectProject('project-1')

    await expect(controller.addProjectMember('project-1', {
      principalType: 'user', principalId: 'user-2',
    })).resolves.toBe(false)
    expect(controller.store.getSnapshot().projects).toMatchObject({
      busy: false, actionError: 'add-member-failed',
    })
  })

  it('archives one project, reloads the directory, and returns to the list', async () => {
    const archived = { ...RENEWAL, state: 'archived' as const, archivedAt: 1 }
    stubFetch((url, init) => {
      if (url === '/enterprise/projects/project-1/archive' && init?.method === 'POST') {
        return jsonResponse({ id: 'project-1', state: 'archived' })
      }
      if (url === '/enterprise/projects') return jsonResponse([archived])
      return undefined
    })
    const controller = new EnterpriseWorkbenchController({} as never, {} as never, {} as never, () => {})
    await controller.loadProjects()
    await controller.selectProject('project-1')

    await expect(controller.archiveProject('project-1')).resolves.toBe(true)

    const state = controller.store.getSnapshot().projects
    expect(state).toMatchObject({ busy: false, actionError: null, selected: undefined })
    expect(state.list).toEqual([archived])
  })

  it('keeps the detail and the contained archive-failed key when archiving fails', async () => {
    stubFetch((url, init) => {
      if (url === '/enterprise/projects/project-1' && init?.method === undefined) return jsonResponse(RENEWAL_DETAIL)
      if (url === '/enterprise/projects/project-1/archive' && init?.method === 'POST') {
        return jsonResponse({ error: 'conflict' }, 409)
      }
      return undefined
    })
    const controller = new EnterpriseWorkbenchController({} as never, {} as never, {} as never, () => {})
    await controller.selectProject('project-1')

    await expect(controller.archiveProject('project-1')).resolves.toBe(false)
    const state = controller.store.getSnapshot().projects
    expect(state.actionError).toBe('archive-failed')
    expect(state.selected?.project.id).toBe('project-1')
  })
})

describe('EnterpriseWorkbenchController surface slice', () => {
  it('loads the surface roster through the surfaces list endpoint', async () => {
    stubFetch(url =>
      url === '/enterprise/surfaces' ? jsonResponse([GROUP_SURFACE, CHANNEL_SURFACE, DM_SURFACE]) : undefined)
    const controller = new EnterpriseWorkbenchController({} as never, {} as never, {} as never, () => {})

    await expect(controller.loadSurfaces()).resolves.toBe(true)

    expect(controller.store.getSnapshot().surfaces).toEqual({
      phase: 'ready', error: null, list: [GROUP_SURFACE, CHANNEL_SURFACE, DM_SURFACE],
    })
  })

  it('keeps a failed surface load contained in the slice', async () => {
    stubFetch(() => jsonResponse({ error: 'forbidden' }, 403))
    const controller = new EnterpriseWorkbenchController({} as never, {} as never, {} as never, () => {})

    await expect(controller.loadSurfaces()).resolves.toBe(false)

    const state = controller.store.getSnapshot().surfaces
    expect(state.phase).toBe('error')
    expect(state.error).toContain('403')
  })
})

describe('ProjectSpace view', () => {
  it('shows project, group, and channel entry points', () => {
    render(createElement(ProjectSpace, spaceProps({ projects: READY_PROJECTS,
      surfaces: { phase: 'ready', error: null, list: [GROUP_SURFACE, CHANNEL_SURFACE] } })))
    fireEvent.click(screen.getByRole('tab', { name: '群聊' }))
    expect(screen.getByText(GROUP_SURFACE.name as string)).toBeDefined()
    expect(screen.getByRole('button', { name: '新建群聊' })).toBeDefined()
    fireEvent.click(screen.getByRole('tab', { name: zh['projects.tab.channels'] }))
    expect(screen.getByText(CHANNEL_SURFACE.name as string)).toBeDefined()
    expect(screen.queryByText(GROUP_SURFACE.name as string)).toBeNull()
  })
  it('opens a channel and starts another channel linked to the selected project', async () => {
    const openRoom = vi.fn(() => true)
    const createRoom = vi.fn(() => true)
    const surfaceState: EnterpriseSurfacesState = { phase: 'ready', error: null, list: [
      { ...GROUP_SURFACE, projectId: RENEWAL.id },
      { ...CHANNEL_SURFACE, workspaceId: 'shared', projectId: RENEWAL.id },
    ] }
    const { rerender } = render(createElement(ProjectSpace, spaceProps({
      projects: READY_PROJECTS,
      surfaces: surfaceState, workspaces: [{ id: 'shared', name: '销售部工作区' }], openRoom, createRoom,
    })))
    expect(screen.queryByText(GROUP_SURFACE.name as string)).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: zh['projects.tab.channels'] }))
    expect(screen.getByText(/销售部工作区/)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: `${zh['projects.openRoom']} ${CHANNEL_SURFACE.name}` }))
    expect(openRoom).toHaveBeenCalledWith(CHANNEL_SURFACE.id)
    fireEvent.click(screen.getByRole('tab', { name: zh['projects.tab.projects'] }))
    rerender(createElement(ProjectSpace, spaceProps({ projects: { ...READY_PROJECTS, selected: DETAIL },
      surfaces: surfaceState, openRoom, createRoom })))
    expect(screen.getByText(CHANNEL_SURFACE.name as string)).toBeDefined()
    expect(screen.getByText(GROUP_SURFACE.name as string)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: zh['projects.newGroup'] }))
    expect(createRoom).toHaveBeenCalledWith('group', RENEWAL.id)
    fireEvent.click(screen.getByRole('button', { name: zh['projects.newChannel'] }))
    expect(createRoom).toHaveBeenCalledWith('channel', RENEWAL.id)
  })
  it('keeps archived project rooms readable without offering new linked rooms', () => {
    render(createElement(ProjectSpace, spaceProps({
      projects: { ...READY_PROJECTS, selected: { project: QUOTING,
        members: [{ principalType: 'user', principalId: 'user-2' }] } },
      surfaces: { phase: 'ready', error: null, list: [{ ...CHANNEL_SURFACE, projectId: QUOTING.id }] },
    })))
    expect(screen.getByText(CHANNEL_SURFACE.name as string)).toBeDefined()
    expect(screen.queryByRole('button', { name: zh['projects.newChannel'] })).toBeNull()
  })
  it('supports keyboard movement through project, group, and channel views', () => {
    render(createElement(ProjectSpace, spaceProps({ projects: READY_PROJECTS,
      surfaces: { phase: 'ready', error: null, list: [GROUP_SURFACE, CHANNEL_SURFACE] } })))
    const projectTab = screen.getByRole('tab', { name: zh['projects.tab.projects'] })
    projectTab.focus()
    fireEvent.keyDown(projectTab, { key: 'ArrowRight' })
    const groupTab = screen.getByRole('tab', { name: zh['projects.tab.groups'] })
    expect(groupTab.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText(GROUP_SURFACE.name as string)).toBeDefined()
    fireEvent.keyDown(groupTab, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: zh['projects.tab.channels'] }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText(CHANNEL_SURFACE.name as string)).toBeDefined()
  })
  it('keeps an unfinished project draft while browsing channels', () => {
    render(createElement(ProjectSpace, spaceProps({ projects: projects({ phase: 'ready', list: [] }),
      surfaces: { phase: 'ready', error: null, list: [] } })))
    fireEvent.click(screen.getByRole('button', { name: zh['projects.newProject'] }))
    fireEvent.change(screen.getByPlaceholderText(zh['projects.namePlaceholder']), {
      target: { value: '续约项目' },
    })
    fireEvent.click(screen.getByRole('tab', { name: zh['projects.tab.channels'] }))
    fireEvent.click(screen.getByRole('tab', { name: zh['projects.tab.projects'] }))
    expect(screen.getByPlaceholderText<HTMLInputElement>(zh['projects.namePlaceholder']).value).toBe('续约项目')
  })
  it('loads the directory once on mount and shows rows with accessible state dots', async () => {
    const loadProjects = vi.fn(() => Promise.resolve(true))
    const selectProject = vi.fn(() => Promise.resolve())
    const { rerender } = render(createElement(ProjectSpace, spaceProps({
      projects: projects({ phase: 'idle' }), loadProjects, selectProject,
    })))
    await waitFor(() => { expect(loadProjects).toHaveBeenCalledTimes(1) })

    rerender(createElement(ProjectSpace, spaceProps({
      projects: READY_PROJECTS, loadProjects, selectProject,
    })))

    expect(screen.getByRole('button', { name: `打开项目${RENEWAL.name}` })).toBeDefined()
    expect(screen.getByRole('img', { name: zh['projects.state.active'] })).toBeDefined()
    expect(screen.getByRole('img', { name: zh['projects.state.archived'] })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: `打开项目${RENEWAL.name}` }))
    expect(selectProject).toHaveBeenCalledWith('project-1')
  })

  it('shows the contained empty and list error states', async () => {
    const loadProjects = vi.fn(() => Promise.resolve(true))
    const { rerender } = render(createElement(ProjectSpace, spaceProps({
      projects: projects({ phase: 'idle' }), loadProjects,
    })))
    await waitFor(() => { expect(loadProjects).toHaveBeenCalledTimes(1) })

    rerender(createElement(ProjectSpace, spaceProps({
      projects: projects({ phase: 'loading' }), loadProjects,
    })))
    expect(screen.getByText(zh.loading)).toBeDefined()

    rerender(createElement(ProjectSpace, spaceProps({
      projects: projects({ phase: 'ready', list: [] }), loadProjects,
    })))
    expect(screen.getByText(zh['projects.empty'])).toBeDefined()

    rerender(createElement(ProjectSpace, spaceProps({
      projects: projects({ phase: 'error', error: 'project list request failed (403)' }), loadProjects,
    })))
    expect(screen.getByRole('alert')?.textContent).toContain(zh['projects.loadError'])
    fireEvent.click(screen.getByRole('button', { name: zh.retry }))
    expect(loadProjects).toHaveBeenCalledTimes(2)
  })

  it('renders the project and its linked-conversation section', () => {
    const { container } = render(createElement(ProjectSpace, spaceProps({
      projects: projects({ phase: 'ready', list: [RENEWAL], selected: DETAIL }),
    })))

    expect(screen.getByRole('article', { name: `${RENEWAL.name}项目空间` })).toBeDefined()
    expect(screen.getByText(RENEWAL.goal)).toBeDefined()
    expect(screen.getByLabelText('1 位成员')).toBeDefined()
    expect(screen.getByText('user-1')).toBeDefined()
    expect(screen.getByRole('region', { name: zh['projects.linkedRooms'] })).toBeDefined()
    // The creator renders as a human (non-employee) avatar.
    expect(container.querySelector('[data-principal="user"]')).toBeDefined()
    expect(container.querySelector('[data-principal="employee"]')).toBeNull()
  })

  it('requires the two-step archive confirm before archiving', async () => {
    const archiveProject = vi.fn(() => Promise.resolve(true))
    const { container } = render(createElement(ProjectSpace, spaceProps({
      projects: projects({ phase: 'ready', list: [RENEWAL], selected: DETAIL }), archiveProject,
    })))

    expect(container.querySelectorAll('[class*="primaryButton"]').length).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: zh['projects.archive'] }))
    const confirm = screen.getByRole('button', { name: `归档${RENEWAL.name}` })
    expect(container.querySelectorAll('[class*="primaryButton"]').length).toBe(1)

    fireEvent.click(confirm)
    await waitFor(() => { expect(archiveProject).toHaveBeenCalledWith('project-1') })
  })

  it('adds an employee member from the named directory picker and shows member names', async () => {
    const addProjectMember = vi.fn(() => Promise.resolve(true))
    stubFetch((url) => {
      if (url === '/auth/admin/users') return jsonResponse([{ id: 'user-1', displayName: '张三' }])
      if (url === '/enterprise/employees') return jsonResponse([{ id: 'employee-9', displayName: '采购员' }])
      return undefined
    })
    render(createElement(ProjectSpace, spaceProps({
      projects: projects({ phase: 'ready', list: [RENEWAL], selected: DETAIL }), addProjectMember,
    })))

    // Loaded directories replace raw ids with display names in the member pills.
    await waitFor(() => { expect(screen.getAllByText('张三').length).toBeGreaterThan(0) })
    expect(screen.queryByText('user-1')).toBeNull()

    fireEvent.change(screen.getByLabelText(zh['projects.memberType']), { target: { value: 'employee' } })
    const picker = screen.getByLabelText(zh['projects.memberChoose'])
    if (!(picker instanceof HTMLSelectElement)) throw new Error('member picker is not a select')
    fireEvent.change(picker, { target: { value: 'employee-9' } })
    fireEvent.click(screen.getByRole('button', { name: zh['projects.add'] }))

    await waitFor(() => {
      expect(addProjectMember).toHaveBeenCalledWith('project-1', {
        principalType: 'employee', principalId: 'employee-9',
      })
    })
    await waitFor(() => { expect(picker.value).toBe('') })
  })

  it('shows the contained action errors for the add and the archive', () => {
    const { rerender } = render(createElement(ProjectSpace, spaceProps({
      projects: projects({
        phase: 'ready', list: [RENEWAL], selected: DETAIL, actionError: 'add-member-failed',
      }),
    })))
    expect(screen.getByRole('alert')?.textContent).toBe(zh['projects.addMemberFailed'])

    rerender(createElement(ProjectSpace, spaceProps({
      projects: projects({
        phase: 'ready', list: [RENEWAL], selected: DETAIL, actionError: 'archive-failed',
      }),
    })))
    expect(screen.getByRole('alert')?.textContent).toBe(zh['projects.archiveFailed'])
  })

  it('answers the member-gate detail error with the dictionary copy and keeps internal paths out of the DOM', () => {
    const { container } = render(createElement(ProjectSpace, spaceProps({
      projects: projects({ phase: 'ready', list: [RENEWAL], detailError: 'not-member' }),
    })))

    expect(screen.getByRole('alert')?.textContent).toContain(zh['projects.detailError.not-member'])
    expect(container.textContent).not.toContain('/managed')
    expect(container.textContent).not.toContain('workspacePath')
  })

  it('creates a project from the typed business fields', async () => {
    const createProject = vi.fn(() => Promise.resolve(true))
    render(createElement(ProjectSpace, spaceProps({
      projects: projects({ phase: 'ready', list: [] }), createProject,
    })))

    fireEvent.click(screen.getByRole('button', { name: zh['projects.newProject'] }))

    fireEvent.change(screen.getByPlaceholderText(zh['projects.namePlaceholder']), {
      target: { value: RENEWAL.name },
    })
    fireEvent.change(screen.getByPlaceholderText(zh['projects.goalPlaceholder']), {
      target: { value: RENEWAL.goal },
    })
    fireEvent.click(screen.getByRole('button', { name: zh['projects.create'] }))

    await waitFor(() => {
      expect(createProject).toHaveBeenCalledWith({
        name: RENEWAL.name, goal: RENEWAL.goal,
      })
    })
  })

  it('shows groups and channels in their tabs while omitting private messages', async () => {
    const loadSurfaces = vi.fn(() => Promise.resolve(true))
    const { rerender } = render(createElement(ProjectSpace, spaceProps({
      projects: projects({ phase: 'ready', list: [] }),
      surfaces: { phase: 'idle', list: [], error: null },
      loadSurfaces,
    })))
    await waitFor(() => { expect(loadSurfaces).toHaveBeenCalledTimes(1) })

    rerender(createElement(ProjectSpace, spaceProps({
      projects: projects({ phase: 'ready', list: [] }),
      surfaces: { phase: 'ready', error: null, list: [GROUP_SURFACE, CHANNEL_SURFACE, DM_SURFACE] },
      loadSurfaces,
    })))

    fireEvent.click(screen.getByRole('tab', { name: '群聊' }))
    expect(screen.getByText(GROUP_SURFACE.name as string)).toBeDefined()
    expect(screen.queryByText(CHANNEL_SURFACE.name as string)).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: zh['projects.tab.channels'] }))
    expect(screen.getByText(CHANNEL_SURFACE.name as string)).toBeDefined()
    expect(screen.queryByText(zh['projects.surface.unnamed'])).toBeNull()
    expect(screen.getByText('2 位成员')).toBeDefined()
  })

  it('shows the roster load error with retry', async () => {
    const loadSurfaces = vi.fn(() => Promise.resolve(true))
    const { rerender } = render(createElement(ProjectSpace, spaceProps({
      projects: projects({ phase: 'ready', list: [] }),
      surfaces: { phase: 'idle', list: [], error: null },
      loadSurfaces,
    })))
    await waitFor(() => { expect(loadSurfaces).toHaveBeenCalledTimes(1) })

    rerender(createElement(ProjectSpace, spaceProps({
      projects: projects({ phase: 'ready', list: [] }),
      surfaces: { phase: 'error', list: [], error: 'surface list request failed (403)' },
      loadSurfaces,
    })))

    fireEvent.click(screen.getByRole('tab', { name: zh['projects.tab.channels'] }))
    expect(screen.getByRole('alert')?.textContent).toContain(zh['projects.rosterLoadError'])
    fireEvent.click(screen.getByRole('button', { name: zh.retry }))
    expect(loadSurfaces).toHaveBeenCalledTimes(3)
  })
})
