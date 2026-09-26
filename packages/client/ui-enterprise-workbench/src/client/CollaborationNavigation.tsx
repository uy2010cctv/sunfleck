/** Group/channel rows and pre-session choices inside the existing native shell. */
import { useEffect, useState } from 'react'
import { IconNewChatOutlineRegular, IconPlusOutlineRegular, IconRefreshOutlineRegular, Tooltip, IconLoadingOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { CollaborationController, CollaborationState, CreateCollaboration } from './collaboration-store.ts'
import type {} from './collaboration-locales.ts'
import { CollaborationRoom } from './CollaborationRoom.tsx'
import css from './CollaborationNavigation.module.css'

/** Visible choices sourced from the same authenticated employee and Workspace catalogs as the workbench. */
export interface CollaborationChoices {
  readonly workspaces: readonly { id: string; name: string }[]
  readonly employees: readonly { id: string; name: string }[]
  readonly people: readonly { id: string; name: string }[]
  readonly teams: readonly { id: string; name: string }[]
  readonly projects: readonly { id: string; name: string }[]
  readonly peopleAvailable: boolean
}
/** Root source and actions shared by sidebar and setup panel registrations. */
export interface CollaborationInjected {
  readonly hooks: { collaboration: SnapshotStore<CollaborationState> }
  readonly controller: CollaborationController
  readonly loadChoices: () => Promise<CollaborationChoices>
}
type Copy = TranslateNS<'enterprise.collaboration'>

/** Translate Host failure reasons without putting internal diagnostics in the UI.
 * @param error - Stable failure code.
 * @param t - Collaboration dictionary.
 * @returns User-facing recovery message.
 */
export function collaborationError(error: string, t: Copy): string {
  if (error === 'forbidden') return t('forbidden')
  if (error === 'unavailable') return t('unavailable')
  if (error === 'no-target') return t('noTarget')
  if (error === 'no-topic') return t('noTopic')
  if (error === 'already-settled') return t('alreadySettled')
  return t('requestFailed')
}

/** Contribute channel navigation while retaining stored groups outside discovery. */
export function CollaborationSidebar({ wide, expandSidebar, usePanelInfo, useCollaboration, controller, t }: Pick<PropsRuntime<'sidebar.sections'>, 'wide' | 'expandSidebar' | 'usePanelInfo'> & InjectFace<CollaborationInjected> & PropsLocale<'enterprise.collaboration'>) {
  const state = useCollaboration(value => value)
  const panelId = usePanelInfo(info => info.activePanelId)
  useEffect(() => { controller.setMainPanel(panelId) }, [controller, panelId])
  useEffect(() => { if (state.phase === 'idle') void controller.refresh() }, [controller, state.phase])
  if (state.phase === 'unavailable') return null
  return <div className={css.sections}>
    <section aria-label={t('channels')}>
      <div className={css.sectionHeader}>
        {wide ? <span>{t('channels')}</span> : <Tooltip label={t('channels')} side="right"><button type="button" className={css.iconButton} onClick={expandSidebar} aria-label={t('channels')}><IconNewChatOutlineRegular size={18}/></button></Tooltip>}
        {wide && <Tooltip label={t('addChannel')}><button type="button" className={css.iconButton} onClick={() => { controller.beginCreate('channel') }} aria-label={t('addChannel')}><IconPlusOutlineRegular size={14}/></button></Tooltip>}
      </div>
      {wide && (state.phase === 'loading' && state.surfaces.length === 0 ? <div className={css.skeleton} aria-hidden="true"/> : state.surfaces.filter(row => row.kind === 'channel').map(row => <button type="button" key={row.id} className={css.row} aria-current={state.selection?.detail.id === row.id ? 'page' : undefined} disabled={state.busy} onClick={() => { void controller.select(row.id) }}>
        <IconNewChatOutlineRegular size={14}/><span>{row.name}</span>
      </button>))}
      {wide && state.phase === 'ready' && !state.surfaces.some(row => row.kind === 'channel') && <p className={css.empty}>{t('emptyChannel')}</p>}
    </section>
    {wide && state.phase === 'error' && <div className={css.queryError} role="alert">{t('loadError')}<button type="button" onClick={() => { void controller.refresh() }}>{t('retry')}</button></div>}
    {wide && state.error !== null && state.creation === null && (state.selection === null || state.selection.sessionId !== undefined) && <p className={css.queryError} role="alert">{collaborationError(state.error, t)}</p>}
    {wide && <Tooltip label={t('refresh')}><button type="button" className={css.refresh} aria-label={t('refresh')} onClick={() => { void controller.refresh() }}><IconRefreshOutlineRegular size={13}/></button></Tooltip>}
  </div>
}

function CreateForm({ kind, state, controller, loadChoices, t }: { kind: 'group' | 'channel'; state: CollaborationState; controller: CollaborationController; loadChoices: CollaborationInjected['loadChoices']; t: Copy }) {
  const [choices, setChoices] = useState<CollaborationChoices>()
  const [failed, setFailed] = useState(false)
  const [attempt, retry] = useState(0)
  const [name, setName] = useState('')
  const [workspaceId, setWorkspace] = useState('')
  const [employees, setEmployees] = useState<string[]>([])
  const [people, setPeople] = useState<string[]>([])
  const [team, setTeam] = useState('')
  const [project, setProject] = useState(state.creationProjectId ?? '')
  const [duty, setDuty] = useState('')
  const [topicPolicy, setTopic] = useState<'thread' | 'command' | 'lane'>('thread')
  const [respondPolicy, setRespond] = useState<'mention_duty' | 'ingest_only'>('mention_duty')
  useEffect(() => {
    let live = true
    setFailed(false)
    void loadChoices().then((value) => { if (live) setChoices(value) })
      .catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [loadChoices, attempt])
  const toggle = (list: string[], id: string, checked: boolean): string[] => checked ? [...list, id] : list.filter(value => value !== id)
  if (failed) return <div className={css.queryError} role="alert">{t('choicesError')}<button type="button" onClick={() => { retry(value => value + 1) }}>{t('retry')}</button></div>
  if (choices === undefined) return <div className={css.loading}><IconLoadingOutlineRegular size={20}/></div>
  return <form className={css.form} onSubmit={(event) => { event.preventDefault(); const input: CreateCollaboration = { kind, name: name.trim(), workspaceId, memberEmployeeIds: employees, memberUserIds: people, ...(team === '' ? {} : { teamDefinitionId: team }), ...(project === '' ? {} : { projectId: project }), ...(kind === 'channel' ? { topicPolicy, respondPolicy, dutyEmployeeIds: duty === '' ? [] : [duty] } : {}) }; void controller.create(input) }}>
    <h1>{t(kind === 'group' ? 'addGroup' : 'addChannel')}</h1><p>{t('createHelp')}</p>
    <label>{t('name')}<input value={name} required maxLength={120} disabled={state.busy} onChange={(e) => { setName(e.target.value) }}/></label>
    <label>{t('workspace')}<select required value={workspaceId} disabled={state.busy} onChange={(e) => { setWorkspace(e.target.value) }}><option value="">{t('chooseWorkspace')}</option>{choices.workspaces.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
    <fieldset disabled={state.busy}><legend>{t('employees')}</legend>{choices.employees.length === 0 ? <p>{t('emptyEmployees')}</p> : choices.employees.map(row => <label className={css.check} key={row.id}><input type="checkbox" checked={employees.includes(row.id)} onChange={(e) => { setEmployees(toggle(employees, row.id, e.target.checked)); if (!e.target.checked && duty === row.id) setDuty('') }}/>{row.name}</label>)}</fieldset>
    <fieldset disabled={state.busy}><legend>{t('people')}</legend>{choices.peopleAvailable ? choices.people.map(row => <label className={css.check} key={row.id}><input type="checkbox" checked={people.includes(row.id)} onChange={(e) => { setPeople(toggle(people, row.id, e.target.checked)) }}/>{row.name}</label>) : <p>{t('peopleUnavailable')}</p>}</fieldset>
    {kind === 'group' && <label>{t('team')}<select value={team} disabled={state.busy} onChange={(e) => { setTeam(e.target.value) }}><option value="">{t('noTeam')}</option>{choices.teams.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>}
    <label>{t('project')}<select value={project} disabled={state.busy} onChange={(e) => { setProject(e.target.value) }}><option value="">{t('noProject')}</option>{choices.projects.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
    {kind === 'channel' && <><label>{t('respondPolicy')}<select value={respondPolicy} disabled={state.busy} onChange={(e) => { setRespond(e.target.value as typeof respondPolicy) }}><option value="mention_duty">{t('mention_duty')}</option><option value="ingest_only">{t('ingest_only')}</option></select></label><label>{t('topicPolicy')}<select value={topicPolicy} disabled={state.busy} onChange={(e) => { setTopic(e.target.value as typeof topicPolicy) }}>{(['thread', 'command', 'lane'] as const).map(value => <option key={value} value={value}>{t(value)}</option>)}</select></label>{respondPolicy === 'mention_duty' && <label>{t('duty')}<select value={duty} required disabled={state.busy} onChange={(e) => { setDuty(e.target.value) }}><option value="">{t('chooseDuty')}</option>{choices.employees.filter(row => employees.includes(row.id)).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>}</>}
    {state.error !== null && <p role="alert">{collaborationError(state.error, t)}</p>}
    <button className={css.primary} type="submit" disabled={state.busy || name.trim() === '' || workspaceId === '' || (employees.length === 0 && team === '')}>{t('create')}</button>
  </form>
}

/** Main-panel room; creation keeps the same native shell slot. */
export function CollaborationSetup({ useCollaboration, controller, loadChoices, t }: InjectFace<CollaborationInjected> & PropsLocale<'enterprise.collaboration'>) {
  const state = useCollaboration(value => value)
  if (state.creation !== null) return <main className={css.setup}>
    <CreateForm key={`${state.creation}:${state.creationProjectId ?? ''}`} kind={state.creation} state={state} controller={controller} loadChoices={loadChoices} t={t}/>
  </main>
  return <CollaborationRoom state={state} controller={controller} t={t}/>
}
