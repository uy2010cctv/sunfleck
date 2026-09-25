/** Project space: the governed project list, one member-gated project detail, and the surface roster. */
import { useEffect, useState } from 'react'
import { IconChecklistOutlineMedium, IconUserOutlineRegular, IconWarningOutlineRegular, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { EnterpriseWorkbenchKey } from './locales.ts'
import type {
  EnterpriseProjectDetailError, EnterpriseProjectLifecycle, EnterpriseProjectMemberView,
  EnterpriseProjectsState, EnterpriseSurfaceView, EnterpriseSurfacesState,
} from './store.ts'
import css from './EnterpriseWorkbench.module.css'

type Translate = (key: EnterpriseWorkbenchKey, params?: Record<string, string | number>) => string

const PROJECT_STATE_KEYS = {
  active: 'projects.state.active',
  archived: 'projects.state.archived',
} as const satisfies Record<EnterpriseProjectLifecycle, EnterpriseWorkbenchKey>

/** Green while active, grey once archived. */
function projectDot(state: EnterpriseProjectLifecycle): 'ongoing' | 'idle' {
  return state === 'active' ? 'ongoing' : 'idle'
}

function ProjectStatus({ state, className, t }: {
  state: EnterpriseProjectLifecycle
  className: string | undefined
  t: Translate
}) {
  const label = t(PROJECT_STATE_KEYS[state])
  // StateDot renders aria-hidden, so the wrapper carries the accessible state name.
  return <span className={className} role="img" aria-label={label}>
    <StateDot state={projectDot(state)}/><span>{label}</span>
  </span>
}

const SURFACE_KIND_KEYS = {
  group: 'projects.surfaceKind.group',
  channel: 'projects.surfaceKind.channel',
} as const satisfies Record<'group' | 'channel', EnterpriseWorkbenchKey>

const DETAIL_ERROR_KEYS = {
  'not-member': 'projects.detailError.not-member',
  'load-failed': 'projects.detailError.load-failed',
} as const satisfies Record<EnterpriseProjectDetailError, EnterpriseWorkbenchKey>

function MemberAvatar({ member }: { member: EnterpriseProjectMemberView }) {
  return <span
    className={css.memberAvatar}
    data-principal={member.principalType}
    aria-hidden="true"
  >{member.principalId.slice(0, 1)}</span>
}

function MemberSection({ detail, busy, actionError, addProjectMember, t }: {
  detail: NonNullable<EnterpriseProjectsState['selected']>
  busy: boolean
  actionError: EnterpriseProjectsState['actionError']
  addProjectMember: (
    projectId: string, member: { principalType: 'user' | 'employee'; principalId: string },
  ) => Promise<boolean>
  t: Translate
}) {
  const [principalType, setPrincipalType] = useState<'user' | 'employee'>('user')
  const [principalId, setPrincipalId] = useState('')
  const submit = (): void => {
    const id = principalId.trim()
    if (id === '') return
    void addProjectMember(detail.project.id, { principalType, principalId: id })
      .then((added) => { if (added) setPrincipalId('') })
  }
  return <>
    <div className={css.memberRow} aria-label={t('projects.memberCount', { count: detail.members.length })}>
      {detail.members.map(member => <span className={css.memberPill}
        key={`${member.principalType}:${member.principalId}`}>
        <MemberAvatar member={member}/><span>{member.principalId}</span>
        <small>{t(member.principalType === 'user' ? 'projects.memberType.user' : 'projects.memberType.employee')}</small>
      </span>)}
    </div>
    <form className={css.startWorkActions} onSubmit={(event) => { event.preventDefault(); submit() }}>
      <label className={css.inlineField}>
        <span>{t('projects.memberType')}</span>
        <select value={principalType} disabled={busy}
          onChange={(event) => { setPrincipalType(event.target.value as 'user' | 'employee') }}>
          <option value="user">{t('projects.memberType.user')}</option>
          <option value="employee">{t('projects.memberType.employee')}</option>
        </select>
      </label>
      <label className={css.searchField}>
        <span className={css.visuallyHidden}>{t('projects.memberId')}</span>
        <input
          value={principalId}
          placeholder={t('projects.memberIdPlaceholder')}
          disabled={busy}
          onChange={(event) => { setPrincipalId(event.target.value) }}
        />
      </label>
      <button type="submit" className={css.secondaryButton} disabled={busy || principalId.trim() === ''}>
        {busy ? t('projects.adding') : t('projects.add')}
      </button>
    </form>
    {actionError === 'add-member-failed' && <div className={css.inlineError} role="alert">
      {t('projects.addMemberFailed')}
    </div>}
  </>
}

function ProjectDetail({ detail, busy, actionError, addProjectMember, archiveProject, selectProject, t }: {
  detail: NonNullable<EnterpriseProjectsState['selected']>
  busy: boolean
  actionError: EnterpriseProjectsState['actionError']
  addProjectMember: (
    projectId: string, member: { principalType: 'user' | 'employee'; principalId: string },
  ) => Promise<boolean>
  archiveProject: (projectId: string) => Promise<boolean>
  selectProject: (projectId?: string) => Promise<void>
  t: Translate
}) {
  // Archive is the page's one destructive action; the two-step click keeps a
  // stray click from ending the project while the confirm state names the effect.
  const [confirmingArchive, setConfirmingArchive] = useState(false)
  const project = detail.project
  return <>
    <div className={css.employeeActions}>
      <button type="button" className={css.secondaryButton}
        onClick={() => { setConfirmingArchive(false); void selectProject() }}>{t('projects.back')}</button>
    </div>
    <article className={css.employeeCard} aria-label={t('projects.detailAria', { name: project.name })}>
      <div className={css.employeeHead}>
        <div className={css.employeeIdentity}>
          <div className={css.employeeNameRow}><h3>{project.name}</h3></div>
        </div>
        <ProjectStatus state={project.state} className={css.status} t={t}/>
      </div>
      <p className={css.description}>{project.goal}</p>
      {project.state === 'active' && <MemberSection
        detail={detail}
        busy={busy}
        actionError={actionError}
        addProjectMember={addProjectMember}
        t={t}
      />}
      {project.state === 'active' && <div className={css.employeeFoot}>
        {confirmingArchive
          ? <>
            <button type="button" className={css.primaryButton} disabled={busy}
              aria-label={t('projects.archiveAria', { name: project.name })}
              onClick={() => { setConfirmingArchive(false); void archiveProject(project.id) }}>
              {t('projects.archiveConfirm')}
            </button>
            <button type="button" className={css.secondaryButton} disabled={busy}
              onClick={() => { setConfirmingArchive(false) }}>{t('cancel')}</button>
          </>
          : <button type="button" className={css.secondaryButton} disabled={busy}
            onClick={() => { setConfirmingArchive(true) }}>{t('projects.archive')}</button>}
      </div>}
      {actionError === 'archive-failed' && <div className={css.inlineError} role="alert">
        {t('projects.archiveFailed')}
      </div>}
    </article>
  </>
}

interface ProjectDraft { readonly name: string; readonly goal: string; readonly workspacePath: string }
const EMPTY_PROJECT_DRAFT: ProjectDraft = { name: '', goal: '', workspacePath: '' }

function CreateProjectForm({ busy, actionError, draft, change, createProject, onCreated, t }: {
  busy: boolean
  actionError: EnterpriseProjectsState['actionError']
  draft: ProjectDraft
  change: (patch: Partial<ProjectDraft>) => void
  createProject: (input: { name: string; goal: string; workspacePath: string }) => Promise<boolean>
  onCreated: () => void
  t: Translate
}) {
  const submit = (): void => {
    void createProject({ name: draft.name.trim(), goal: draft.goal.trim(), workspacePath: draft.workspacePath.trim() })
      .then((created) => {
        if (!created) return
        change(EMPTY_PROJECT_DRAFT)
        onCreated()
      })
  }
  return <form className={css.startWorkActions} aria-label={t('projects.createTitle')}
    onSubmit={(event) => { event.preventDefault(); submit() }}>
    <label className={css.inlineField}>
      <span>{t('projects.name')}</span>
      <input value={draft.name} placeholder={t('projects.namePlaceholder')} disabled={busy}
        onChange={(event) => { change({ name: event.target.value }) }}/>
    </label>
    <label className={css.inlineField}>
      <span>{t('projects.goal')}</span>
      <input value={draft.goal} placeholder={t('projects.goalPlaceholder')} disabled={busy}
        onChange={(event) => { change({ goal: event.target.value }) }}/>
    </label>
    <label className={css.inlineField}>
      <span>{t('projects.workspacePath')}</span>
      <input value={draft.workspacePath} placeholder={t('projects.workspacePathPlaceholder')} disabled={busy}
        onChange={(event) => { change({ workspacePath: event.target.value }) }}/>
    </label>
    <button type="submit" className={css.secondaryButton}
      disabled={busy || draft.name.trim() === '' || draft.goal.trim() === '' || draft.workspacePath.trim() === ''}>
      {busy ? t('projects.creating') : t('projects.create')}
    </button>
    {actionError === 'create-failed' && <div className={css.inlineError} role="alert">
      {t('projects.createFailed')}
    </div>}
  </form>
}

function ProjectList({ projects, selectProject, t }: {
  projects: EnterpriseProjectsState
  selectProject: (projectId?: string) => Promise<void>
  t: Translate
}) {
  return <div className={css.rows}>{projects.list.map(project => <button
    type="button"
    key={project.id}
    className={css.record}
    aria-label={t('projects.select', { name: project.name })}
    onClick={() => { void selectProject(project.id) }}
  >
    <ProjectStatus state={project.state} className={css.recordStatus} t={t}/>
    <span className={css.recordMain}>
      <strong>{project.name}</strong>
      <span>{project.goal}</span>
    </span>
  </button>)}</div>
}

/** One member-visible conversation list, scoped to a kind or selected project. */
function RoomList({ surfaces, projects, workspaces, loadSurfaces, kind, projectId, canCreate = true, openRoom, createRoom, t }: {
  surfaces: EnterpriseSurfacesState
  projects: EnterpriseProjectsState
  workspaces: readonly { id: string; name: string }[]
  loadSurfaces: () => Promise<boolean>
  kind?: 'group' | 'channel'
  projectId?: string
  canCreate?: boolean
  openRoom: (id: string) => boolean
  createRoom: (kind: 'group' | 'channel', projectId?: string) => boolean
  t: Translate
}) {
  const [actionError, setActionError] = useState(false)
  const visible = surfaces.list.filter((surface): surface is EnterpriseSurfaceView & { kind: 'group' | 'channel' } =>
    surface.kind === 'group' || surface.kind === 'channel')
    .filter(surface => (kind === undefined || surface.kind === kind)
      && (projectId === undefined || surface.projectId === projectId))
  const projectNames = new Map(projects.list.map(project => [project.id, project.name]))
  const workspaceNames = new Map(workspaces.map(workspace => [workspace.id, workspace.name]))
  const start = (target: 'group' | 'channel'): void => { setActionError(!createRoom(target, projectId)) }
  return <section className={css.roomDirectory} aria-label={projectId === undefined
    ? t(kind === 'channel' ? 'projects.tab.channels' : 'projects.tab.groups') : t('projects.linkedRooms')}>
    {projectId !== undefined && <div className={css.sectionHead}><h2>{t('projects.linkedRooms')}</h2>{canCreate && <div className={css.collaborationActions}>
      <button type="button" className={css.secondaryButton} onClick={() => { start('group') }}>{t('projects.newGroup')}</button>
      <button type="button" className={css.secondaryButton} onClick={() => { start('channel') }}>{t('projects.newChannel')}</button>
    </div>}</div>}
    {surfaces.phase === 'error' && <div className={visible.length > 0 ? css.inlineError : css.empty} role="alert">
      <IconWarningOutlineRegular size={20}/><strong>{t('projects.rosterLoadError')}</strong>
      <button type="button" className={css.secondaryButton}
        onClick={() => { void loadSurfaces() }}>{t('retry')}</button>
    </div>}
    {surfaces.phase === 'idle' ? null
      : visible.length === 0 ? (surfaces.phase === 'error' ? null : surfaces.phase === 'loading'
        ? <div className={css.loading} role="status"><span className={css.skeleton}/></div>
        : <div className={css.empty}><IconChecklistOutlineMedium size={20}/>
          <span>{t(projectId !== undefined ? 'projects.emptyProjectRooms'
            : kind === 'group' ? 'projects.emptyGroup' : 'projects.emptyChannel')}</span></div>)
        : <div className={css.rows}>{visible.map(surface => <button type="button" className={css.collaborationRow}
          key={surface.id} aria-label={`${t('projects.openRoom')} ${surface.name ?? t('projects.surface.unnamed')}`}
          onClick={() => { setActionError(!openRoom(surface.id)) }}>
          <span className={css.surfaceChip} data-kind={surface.kind}>{t(SURFACE_KIND_KEYS[surface.kind])}</span>
          <span className={css.recordMain}><strong>{surface.name ?? t('projects.surface.unnamed')}</strong>
            <span>{surface.workspaceId === undefined ? null : `${workspaceNames.get(surface.workspaceId) ?? t('projects.workspaceUnknown')} · `}
              {surface.projectId === undefined ? t('projects.unlinked')
                : projectNames.get(surface.projectId) ?? t('projects.unlinked')}
              {surface.teamDefinitionId !== undefined && ` · ${t('projects.chartered')}`}</span>
          </span>
          {surface.memberCount !== undefined && <span className={css.recordStatus}>
            {t('projects.surfaceMembers', { count: surface.memberCount })}
          </span>}
        </button>)}</div>}
    {actionError && <p className={css.inlineError} role="alert">{t('projects.roomUnavailable')}</p>}
  </section>
}

function DetailErrorAlert({ detailError, selectProject, t }: {
  detailError: EnterpriseProjectDetailError
  selectProject: (projectId?: string) => Promise<void>
  t: Translate
}) {
  return <div className={css.empty} role="alert">
    <IconWarningOutlineRegular size={20}/>
    <strong>{t(DETAIL_ERROR_KEYS[detailError])}</strong>
    <button type="button" className={css.secondaryButton}
      onClick={() => { void selectProject() }}>{t('projects.back')}</button>
  </div>
}

export interface ProjectSpaceProps {
  readonly projects: EnterpriseProjectsState
  readonly surfaces: EnterpriseSurfacesState
  readonly workspaces?: readonly { id: string; name: string }[]
  readonly loadProjects: () => Promise<boolean>
  readonly loadSurfaces: () => Promise<boolean>
  readonly createProject: (input: { name: string; goal: string; workspacePath: string }) => Promise<boolean>
  readonly selectProject: (projectId?: string) => Promise<void>
  readonly addProjectMember: (
    projectId: string, member: { principalType: 'user' | 'employee'; principalId: string },
  ) => Promise<boolean>
  readonly archiveProject: (projectId: string) => Promise<boolean>
  readonly openRoom: (id: string) => boolean
  readonly createRoom: (kind: 'group' | 'channel', projectId?: string) => boolean
  readonly openGovernance: () => void
  readonly t: Translate
}

/** Projects and member-visible conversations share one task-oriented directory. */
export function ProjectSpace(props: ProjectSpaceProps) {
  const { projects, surfaces, workspaces = [], loadProjects, loadSurfaces, createProject, selectProject, addProjectMember,
    archiveProject, openRoom, createRoom, openGovernance, t } = props
  const [view, setView] = useState<'projects' | 'group' | 'channel'>('projects')
  const [creatingProject, setCreatingProject] = useState(false)
  const [projectDraft, setProjectDraft] = useState<ProjectDraft>(EMPTY_PROJECT_DRAFT)
  const [roomActionError, setRoomActionError] = useState(false)
  useEffect(() => {
    if (projects.phase === 'idle') void loadProjects()
  }, [projects.phase, loadProjects])
  useEffect(() => {
    if (surfaces.phase === 'idle') void loadSurfaces()
  }, [surfaces.phase, loadSurfaces])
  const selected = projects.selected
  const counts = { projects: projects.list.length, group: surfaces.list.filter(row => row.kind === 'group').length,
    channel: surfaces.list.filter(row => row.kind === 'channel').length }
  const startRoom = (kind: 'group' | 'channel'): void => { setRoomActionError(!createRoom(kind)) }
  return <section className={css.collaborationHub} aria-labelledby="project-space-title">
    <div className={css.collaborationHubHeader}><div><h2 id="project-space-title">{t('projects.heading')}</h2>
      <p>{t('projects.intro')}</p></div><button type="button" className={css.secondaryButton}
      onClick={openGovernance}>{t('projects.governance')}</button></div>
    <div className={css.collaborationTabs} role="tablist" aria-label={t('projects.heading')}>
      {(['projects', 'group', 'channel'] as const).map(item => <button type="button" role="tab" key={item}
        id={`collaboration-tab-${item}`} aria-controls="collaboration-panel" tabIndex={view === item ? 0 : -1}
        aria-selected={view === item} onClick={() => { setView(item); setRoomActionError(false)
          if (item !== 'projects') void loadSurfaces() }} onKeyDown={(event) => {
          const tabs = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])
          const index = tabs.indexOf(event.currentTarget)
          const target = event.key === 'ArrowRight' ? tabs[(index + 1) % tabs.length]
            : event.key === 'ArrowLeft' ? tabs[(index + tabs.length - 1) % tabs.length]
              : event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : undefined
          if (target !== undefined) { event.preventDefault(); target.focus(); target.click() }
        }}>
        {t(item === 'projects' ? 'projects.tab.projects' : item === 'group' ? 'projects.tab.groups' : 'projects.tab.channels')}
        <span aria-hidden="true">{counts[item]}</span>
      </button>)}
    </div>
    {view === 'projects' && <div role="tabpanel" id="collaboration-panel" aria-labelledby="collaboration-tab-projects" className={css.collaborationPane}>
      {selected === undefined && <div className={css.collaborationPaneHeader}><h3>{t('projects.tab.projects')}</h3>
        <button type="button" className={css.primaryButton} aria-expanded={creatingProject}
          onClick={() => { setCreatingProject(value => !value) }}>{t('projects.newProject')}</button></div>}
      {creatingProject && selected === undefined && <div className={css.collaborationCreate}><CreateProjectForm
        busy={projects.busy} actionError={projects.actionError} draft={projectDraft}
        change={(patch) => { setProjectDraft(value => ({ ...value, ...patch })) }} createProject={createProject}
        onCreated={() => { setCreatingProject(false) }} t={t}/></div>}
      {projects.phase === 'error' ? <div className={css.empty} role="alert">
        <IconWarningOutlineRegular size={20}/><strong>{t('projects.loadError')}</strong><span>{projects.error}</span>
        <button type="button" className={css.secondaryButton}
          onClick={() => { void loadProjects() }}>{t('retry')}</button>
      </div>
        : selected !== undefined ? <ProjectDetail
          detail={selected}
          busy={projects.busy}
          actionError={projects.actionError}
          addProjectMember={addProjectMember}
          archiveProject={archiveProject}
          selectProject={selectProject}
          t={t}
        />
          : projects.detailError !== null ? <DetailErrorAlert detailError={projects.detailError}
            selectProject={selectProject} t={t}/>
            : projects.phase === 'idle' ? null
              : projects.list.length === 0 ? (projects.phase === 'loading'
                ? <div className={css.loading} role="status"><span className={css.skeleton}/>{t('loading')}</div>
                : <div className={css.empty}><IconUserOutlineRegular size={20}/>
                  <span>{t('projects.empty')}</span></div>)
                : <ProjectList projects={projects} selectProject={selectProject} t={t}/>}
      {selected !== undefined && <RoomList surfaces={surfaces} projects={projects} workspaces={workspaces} loadSurfaces={loadSurfaces}
        projectId={selected.project.id} canCreate={selected.project.state === 'active'}
        openRoom={openRoom} createRoom={createRoom} t={t}/>}
    </div>}
    {view !== 'projects' && <div role="tabpanel" id="collaboration-panel" aria-labelledby={`collaboration-tab-${view}`} className={css.collaborationPane}>
      <div className={css.collaborationPaneHeader}><div><h3>{t(view === 'group' ? 'projects.tab.groups' : 'projects.tab.channels')}</h3>
        <p>{t(view === 'group' ? 'projects.groupHelp' : 'projects.channelHelp')}</p></div>
      <button type="button" className={css.primaryButton} onClick={() => { startRoom(view) }}>
        {t(view === 'group' ? 'projects.newGroup' : 'projects.newChannel')}</button></div>
      <RoomList surfaces={surfaces} projects={projects} workspaces={workspaces} loadSurfaces={loadSurfaces} kind={view}
        openRoom={openRoom} createRoom={createRoom} t={t}/>
      {roomActionError && <p className={css.inlineError} role="alert">{t('projects.roomUnavailable')}</p>}
    </div>}
  </section>
}
