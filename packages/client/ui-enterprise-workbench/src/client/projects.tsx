/** Project space: the governed project list, one member-gated project detail, and the surface roster. */
import { useEffect, useState } from 'react'
import { IconChecklistOutline14, IconUserOutline16, IconWarningOutline16, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { EnterpriseWorkbenchKey } from './locales.ts'
import type {
  EnterpriseProjectDetailError, EnterpriseProjectLifecycle, EnterpriseProjectMemberView,
  EnterpriseProjectsState, EnterpriseSurfacesState,
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
  all: 'projects.surfaceKind.all',
  group: 'projects.surfaceKind.group',
  channel: 'projects.surfaceKind.channel',
  dm: 'projects.surfaceKind.dm',
} as const satisfies Record<'all' | 'group' | 'channel' | 'dm', EnterpriseWorkbenchKey>

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
      {detail.members.map((member, index) => <MemberAvatar key={`${member.principalType}:${member.principalId}:${index}`}
        member={member}/>)}
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
      <p className={css.description}>{t('projects.scopeNote')}</p>
    </article>
  </>
}

function CreateProjectForm({ busy, actionError, createProject, t }: {
  busy: boolean
  actionError: EnterpriseProjectsState['actionError']
  createProject: (input: { name: string; goal: string; workspacePath: string }) => Promise<boolean>
  t: Translate
}) {
  const [name, setName] = useState('')
  const [goal, setGoal] = useState('')
  const [workspacePath, setWorkspacePath] = useState('')
  const submit = (): void => {
    void createProject({ name: name.trim(), goal: goal.trim(), workspacePath: workspacePath.trim() })
      .then((created) => {
        if (!created) return
        setName('')
        setGoal('')
        setWorkspacePath('')
      })
  }
  return <form className={css.startWorkActions} aria-label={t('projects.createTitle')}
    onSubmit={(event) => { event.preventDefault(); submit() }}>
    <label className={css.inlineField}>
      <span>{t('projects.name')}</span>
      <input value={name} placeholder={t('projects.namePlaceholder')} disabled={busy}
        onChange={(event) => { setName(event.target.value) }}/>
    </label>
    <label className={css.inlineField}>
      <span>{t('projects.goal')}</span>
      <input value={goal} placeholder={t('projects.goalPlaceholder')} disabled={busy}
        onChange={(event) => { setGoal(event.target.value) }}/>
    </label>
    <label className={css.inlineField}>
      <span>{t('projects.workspacePath')}</span>
      <input value={workspacePath} placeholder={t('projects.workspacePathPlaceholder')} disabled={busy}
        onChange={(event) => { setWorkspacePath(event.target.value) }}/>
    </label>
    <button type="submit" className={css.secondaryButton}
      disabled={busy || name.trim() === '' || goal.trim() === '' || workspacePath.trim() === ''}>
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

/** Surface roster rows for one client-side kind filter; the roster stays organization-scoped. */
function SurfacesRoster({ surfaces, loadSurfaces, t }: {
  surfaces: EnterpriseSurfacesState
  loadSurfaces: () => Promise<boolean>
  t: Translate
}) {
  const [kind, setKind] = useState<'all' | 'group' | 'channel' | 'dm'>('all')
  useEffect(() => {
    if (surfaces.phase === 'idle') void loadSurfaces()
  }, [surfaces.phase, loadSurfaces])
  const visible = kind === 'all' ? surfaces.list : surfaces.list.filter(surface => surface.kind === kind)
  return <section aria-labelledby="surface-roster-title">
    <div className={css.sectionHead}>
      <h2 id="surface-roster-title">{t('projects.rosterHeading')}</h2>
      <select className={css.rosterFilter} aria-label={t('projects.rosterFilter')}
        value={kind} onChange={(event) => { setKind(event.target.value as typeof kind) }}>
        <option value="all">{t(SURFACE_KIND_KEYS.all)}</option>
        <option value="group">{t(SURFACE_KIND_KEYS.group)}</option>
        <option value="channel">{t(SURFACE_KIND_KEYS.channel)}</option>
        <option value="dm">{t(SURFACE_KIND_KEYS.dm)}</option>
      </select>
    </div>
    {surfaces.phase === 'error' ? <div className={css.empty} role="alert">
      <IconWarningOutline16 size={20}/><strong>{t('projects.rosterLoadError')}</strong><span>{surfaces.error}</span>
      <button type="button" className={css.secondaryButton}
        onClick={() => { void loadSurfaces() }}>{t('retry')}</button>
    </div>
      : surfaces.phase === 'idle' ? null
        : visible.length === 0 ? (surfaces.phase === 'loading'
          ? <div className={css.loading} role="status"><span className={css.skeleton}/>{t('loading')}</div>
          : <div className={css.empty}><IconChecklistOutline14 size={20}/>
            <span>{t('projects.rosterEmpty')}</span></div>)
          : <div className={css.rows}>{visible.map(surface => <div className={css.row} key={surface.id}>
            <span className={css.surfaceChip} data-kind={surface.kind}>{t(SURFACE_KIND_KEYS[surface.kind])}</span>
            <span className={css.recordMain}>
              <strong>{surface.name ?? t('projects.surface.unnamed')}</strong>
            </span>
            {surface.memberCount !== undefined && <span className={css.recordStatus}>
              {t('projects.surfaceMembers', { count: surface.memberCount })}
            </span>}
          </div>)}</div>}
  </section>
}

function DetailErrorAlert({ detailError, selectProject, t }: {
  detailError: EnterpriseProjectDetailError
  selectProject: (projectId?: string) => Promise<void>
  t: Translate
}) {
  return <div className={css.empty} role="alert">
    <IconWarningOutline16 size={20}/>
    <strong>{t(DETAIL_ERROR_KEYS[detailError])}</strong>
    <button type="button" className={css.secondaryButton}
      onClick={() => { void selectProject() }}>{t('projects.back')}</button>
  </div>
}

export interface ProjectSpaceProps {
  readonly projects: EnterpriseProjectsState
  readonly surfaces: EnterpriseSurfacesState
  readonly loadProjects: () => Promise<boolean>
  readonly loadSurfaces: () => Promise<boolean>
  readonly createProject: (input: { name: string; goal: string; workspacePath: string }) => Promise<boolean>
  readonly selectProject: (projectId?: string) => Promise<void>
  readonly addProjectMember: (
    projectId: string, member: { principalType: 'user' | 'employee'; principalId: string },
  ) => Promise<boolean>
  readonly archiveProject: (projectId: string) => Promise<boolean>
  readonly t: Translate
}

/** Project list where one selected row opens the member-gated space, with the surface roster below. */
export function ProjectSpace(props: ProjectSpaceProps) {
  const { projects, surfaces, loadProjects, loadSurfaces, createProject, selectProject, addProjectMember, archiveProject, t } = props
  useEffect(() => {
    if (projects.phase === 'idle') void loadProjects()
  }, [projects.phase, loadProjects])
  const selected = projects.selected
  return <section aria-labelledby="project-space-title">
    <div className={css.sectionHead}>
      <h2 id="project-space-title">{t('projects.heading')}</h2>
      <span aria-live="polite">{projects.list.length}</span>
    </div>
    {projects.phase === 'error' ? <div className={css.empty} role="alert">
      <IconWarningOutline16 size={20}/><strong>{t('projects.loadError')}</strong><span>{projects.error}</span>
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
              : <div className={css.empty}><IconUserOutline16 size={20}/>
                <span>{t('projects.empty')}</span></div>)
              : <ProjectList projects={projects} selectProject={selectProject} t={t}/>}
    {projects.phase !== 'error' && selected === undefined && projects.detailError === null
      && <CreateProjectForm busy={projects.busy} actionError={projects.actionError}
        createProject={createProject} t={t}/>}
    <SurfacesRoster surfaces={surfaces} loadSurfaces={loadSurfaces} t={t}/>
  </section>
}
