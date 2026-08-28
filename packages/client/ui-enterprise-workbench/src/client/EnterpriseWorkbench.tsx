/* oxlint-disable @stylistic/max-len, typescript/no-non-null-assertion */
/** Enterprise digital-employee roster and operations overlay. */
import { useEffect, useRef, useState } from 'react'
import {
  IconCheckOutline16, IconCloseOutline16, IconPlayOutline16, IconRefreshOutline16,
  IconUserOutline16, IconWarningOutline16, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { JsonValue } from '@deepseek-ai/dsh-session/types'
import type {
  EnterpriseApproval, EnterpriseAsset, EnterpriseAssetKind, EnterpriseBusinessState,
  EnterpriseEmployeeDraft, EnterpriseSchedule, EnterpriseScheduleTarget, EnterpriseTeam,
  EnterpriseTeamMember, EnterpriseVisibility, EnterpriseWorkRecord as OperationWorkRecord,
} from '@deepseek-ai/dsh-api-enterprise-controller/types'
import { NS, type EnterpriseWorkbenchKey } from './locales.ts'
import type {
  EmployeeOperationalState, EnterpriseEmployeeDraftFields, EnterpriseEmployeeView,
  EnterprisePageState, EnterpriseWorkbenchPage, EnterpriseWorkbenchState,
  EnterpriseWorkRecord, WorkRecordState,
} from './store.ts'
import css from './EnterpriseWorkbench.module.css'

export interface EnterpriseWorkbenchInjected {
  hooks: { enterprise: SnapshotStore<EnterpriseWorkbenchState> }
  close: () => void
  refresh: () => Promise<void>
  setPage: (page: EnterpriseWorkbenchPage) => void
  setEmployeeFilters: (filters: { search?: string; status?: EnterpriseEmployeeDraft['status']; visibility?: EnterpriseVisibility; ownerUserId?: string }) => void
  refreshEmployees: () => Promise<void>
  loadMoreEmployees: () => Promise<void>
  openEmployeeDraft: (presetId: string) => Promise<void>
  patchEmployeeDraft: (patch: Partial<EnterpriseEmployeeDraftFields>) => void
  saveEmployeeDraft: () => Promise<void>
  publishEmployee: () => Promise<void>
  rollbackEmployee: (releaseId: string) => Promise<void>
  closeEmployeeEditor: () => void
  startEmployee: (employeeId: string) => Promise<void>
  openRecord: (sessionId: SessionId) => void
  updateWorkRecord: (record: OperationWorkRecord, state: EnterpriseBusinessState) => Promise<void>
  transitionApproval: (approval: EnterpriseApproval, state: 'approved' | 'rejected', reason?: string) => Promise<void>
  cancelApproval: (approval: EnterpriseApproval, reason?: string) => Promise<void>
  saveSchedule: (input: { scheduleId: string; target: EnterpriseScheduleTarget; timezone: string; rule: string; input: Readonly<Record<string, JsonValue>>; nextRunAt: number | null; expectedRevision: number }) => Promise<boolean>
  transitionSchedule: (schedule: EnterpriseSchedule, state: EnterpriseSchedule['state']) => Promise<void>
  saveAssetVersion: (input: { assetId: string; kind: EnterpriseAssetKind; name: string; content: Readonly<Record<string, JsonValue>>; expectedRevision: number }) => Promise<boolean>
  archiveAsset: (asset: EnterpriseAsset) => Promise<void>
  saveTeam: (input: { teamId: string; leaderEmployeeReleaseId: string; members: readonly EnterpriseTeamMember[]; workflowTemplate: Readonly<Record<string, JsonValue>>; approvalPolicy: Readonly<Record<string, JsonValue>>; expectedRevision: number }) => Promise<boolean>
  retryMutation: () => Promise<void>
  resolveMutationConflict: () => Promise<void>
  dismissMutationError: () => void
  adoptServerEmployeeConflict: () => void
  keepLocalEmployeeConflict: () => void
}

export type EnterpriseWorkbenchProps = PropsRuntime<'shell.overlay'> & PropsLocale<typeof NS> & InjectFace<EnterpriseWorkbenchInjected>
type Translate = (key: EnterpriseWorkbenchKey, params?: Record<string, string | number>) => string
const NAV: readonly [EnterpriseWorkbenchPage, EnterpriseWorkbenchKey][] = [
  ['employees', 'nav.employees'], ['work-records', 'nav.work-records'], ['approvals', 'nav.approvals'],
  ['schedules', 'nav.schedules'], ['assets', 'nav.assets'], ['teams', 'nav.teams'],
]

function formatDate(value: number): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(value)
}

function profileText(draft: EnterpriseEmployeeDraft, key: string, fallback = ''): string {
  return typeof draft.profile[key] === 'string' ? draft.profile[key] : fallback
}

function profileList(draft: EnterpriseEmployeeDraft, key: string): readonly string[] {
  return Array.isArray(draft.profile[key]) && draft.profile[key].every(value => typeof value === 'string')
    ? draft.profile[key] : []
}

function recordText(record: Readonly<Record<string, JsonValue>>, key: string): string {
  return typeof record[key] === 'string' ? record[key] : ''
}

const RELEASE_KEYS = { draft: 'enum.employee.draft', published: 'enum.employee.published' } as const
const VISIBILITY_KEYS = {
  organization: 'enum.visibility.organization', private: 'enum.visibility.private', restricted: 'enum.visibility.restricted',
} as const
const ASSET_KEYS = {
  sop: 'enum.asset.sop', knowledge: 'enum.asset.knowledge', skill: 'enum.asset.skill',
  tool: 'enum.asset.tool', model: 'enum.asset.model',
} as const
const SOURCE_KEYS = { console: 'enum.source.console', schedule: 'enum.source.schedule', wecom: 'enum.source.wecom' } as const
const WORK_KEYS = {
  active: 'enum.work.active', 'waiting-approval': 'enum.work.waiting-approval',
  completed: 'enum.work.completed', failed: 'enum.work.failed',
} as const
const APPROVAL_STATE_KEYS = {
  pending: 'enum.approval.pending', approved: 'enum.approval.approved',
  rejected: 'enum.approval.rejected', cancelled: 'enum.approval.cancelled',
} as const
const APPROVAL_KIND_KEYS = {
  publish: 'enum.approval.publish', tool: 'enum.approval.tool',
  business: 'enum.approval.business', handoff: 'enum.approval.handoff',
} as const
const SCHEDULE_KEYS = {
  active: 'enum.schedule.active', paused: 'enum.schedule.paused', archived: 'enum.schedule.archived',
} as const
const TARGET_KEYS = { employee: 'enum.target.employee', team: 'enum.target.team' } as const

function employeeStatus(status: EmployeeOperationalState, t: Translate) {
  switch (status) {
    case 'active': return { label: t('status.active'), dot: 'ongoing' as const }
    case 'attention': return { label: t('status.attention'), dot: 'warning' as const }
    case 'ready': return { label: t('status.ready'), dot: 'done' as const }
    case 'unavailable': return { label: t('status.unavailable'), dot: 'error' as const }
  }
}

function recordStatus(status: WorkRecordState, t: Translate) {
  switch (status) {
    case 'running': return { label: t('record.running'), dot: 'ongoing' as const }
    case 'attention': return { label: t('record.attention'), dot: 'warning' as const }
    case 'completed': return { label: t('record.completed'), dot: 'done' as const }
    case 'ready': return { label: t('record.ready'), dot: 'done' as const }
  }
}

function PageBoundary<T>({ page, t, children }: { page: EnterprisePageState<T>; t: Translate; children: React.ReactNode }) {
  if (page.phase === 'loading' && page.items.length === 0) return <div className={css.loading} role="status"><span className={css.skeleton} />{t('loading')}</div>
  if (page.phase === 'permission') return <div className={css.empty} role="status"><IconWarningOutline16 size={20} /><strong>{t('permission.title')}</strong><span>{t('permission.body')}</span></div>
  if (page.phase === 'error' && page.items.length === 0) return <div className={css.empty} role="alert"><IconWarningOutline16 size={20} /><strong>{t('page.error')}</strong><span>{page.error}</span></div>
  if (page.items.length === 0) return <div className={css.empty}><IconCheckOutline16 size={20} /><span>{t('page.empty')}</span></div>
  return <>{children}</>
}

function NativeEmployeeCard({ employee, busy, start, t }: { employee: EnterpriseEmployeeView; busy: boolean; start: (id: string) => Promise<void>; t: Translate }) {
  const status = employeeStatus(employee.status, t); const unavailable = employee.status === 'unavailable'
  return <article className={css.employeeCard} data-status={employee.status} tabIndex={unavailable ? -1 : 0} aria-label={t('employee.destination', { name: employee.name })} onClick={() => { if (!unavailable) void start(employee.id) }} onKeyDown={(event) => { if (!unavailable && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); void start(employee.id) } }}>
    <div className={css.employeeHead}><div className={css.avatar} aria-hidden="true">{employee.name.slice(0, 2)}</div><div className={css.employeeIdentity}><div className={css.employeeNameRow}><h3>{employee.name}</h3>{employee.isDefault && <span className={css.badge}>{t('employee.default')}</span>}{employee.custom && <span className={css.badge}>{t('employee.custom')}</span>}</div><div className={css.employeeMeta}><span>{employee.position ?? employee.description ?? employee.employeeCode}</span>{employee.department !== undefined && <span>{employee.department}</span>}</div></div><div className={css.status}><StateDot state={status.dot} /><span>{status.label}</span></div></div>
    {employee.description !== undefined && employee.position !== undefined && <p className={css.description}>{employee.description}</p>}
    <div className={css.capabilities}>{employee.capabilities.map(value => <span key={value}>{value}</span>)}</div>
    <div className={css.employeeFoot}><span>{t('employee.work', { count: employee.recentWork })}</span><button type="button" className={css.primaryButton} aria-label={unavailable ? t('employee.unavailable', { name: employee.name }) : t('employee.start', { name: employee.name })} disabled={unavailable || busy} onClick={(event) => { event.stopPropagation(); void start(employee.id) }}>{busy ? <IconRefreshOutline16 className={css.spin} size={16} /> : <IconPlayOutline16 size={16} />}{busy ? t('employee.busy') : unavailable ? status.label : t('employee.action')}</button></div>
    {employee.unavailableReason !== undefined && <p className={css.unavailableReason}><IconWarningOutline16 size={14} />{employee.unavailableReason}</p>}
  </article>
}

function NativeRecord({ record, open, t }: { record: EnterpriseWorkRecord; open: (id: SessionId) => void; t: Translate }) {
  const status = recordStatus(record.state, t)
  return <button type="button" className={css.record} aria-label={t('record.open', { title: record.title })} onClick={() => { open(record.sessionId) }}><span className={css.recordStatus}><StateDot state={status.dot} />{status.label}</span><span className={css.recordMain}><strong>{record.title}</strong><span>{record.employeeName ?? t('record.unassigned')}{record.workspaceTitle === undefined ? '' : ` · ${record.workspaceTitle}`}</span></span><time className={css.recordTime}>{formatDate(record.updatedAt)}</time></button>
}

function FallbackPage({ state, start, open, t }: { state: EnterpriseWorkbenchState; start: (id: string) => Promise<void>; open: (id: SessionId) => void; t: Translate }) {
  const view = state.view; if (view === undefined) return null
  return <><div className={css.notice} role="status">{t('mode.fallback')}</div><dl className={css.metrics} aria-label={t('metrics.aria')} aria-live="polite">{([['metrics.employees', view.metrics.employees], ['metrics.active', view.metrics.active], ['metrics.attention', view.metrics.attention], ['metrics.records', view.metrics.workRecords]] as const).map(([label, value]) => <div key={label}><dt>{t(label)}</dt><dd>{value}</dd></div>)}</dl><div className={css.content}><section aria-labelledby="enterprise-employees-title"><div className={css.sectionHead}><h2 id="enterprise-employees-title">{t('employees.title')}</h2><span aria-live="polite">{view.employees.length}</span></div>{view.employees.length === 0 ? <div className={css.empty}><IconUserOutline16 size={20} /><strong>{t('employees.empty.title')}</strong><span>{t('employees.empty.body')}</span></div> : <div className={css.employeeGrid}>{view.employees.map(employee => <NativeEmployeeCard key={employee.id} employee={employee} busy={state.busyEmployee === employee.id} start={start} t={t} />)}</div>}</section><section aria-labelledby="enterprise-records-title"><div className={css.sectionHead}><h2 id="enterprise-records-title">{t('records.title')}</h2><span aria-live="polite">{view.records.length}</span></div>{view.records.length === 0 ? <div className={css.empty}><IconCheckOutline16 size={20} /><span>{t('records.empty')}</span></div> : <div className={css.recordList}>{view.records.map(record => <NativeRecord key={record.sessionId} record={record} open={open} t={t} />)}</div>}</section></div></>
}

function EmployeeEditor({ editor, assets, api, back, rollback, mutationBusy, t }: {
  editor: NonNullable<EnterpriseWorkbenchState['employeeEditor']>
  assets: EnterprisePageState<EnterpriseAsset>
  api: EnterpriseWorkbenchInjected
  back: () => void
  rollback: (releaseId: string) => void
  mutationBusy: boolean
  t: Translate
}) {
  const [bindingAssetId, setBindingAssetId] = useState('')
  if (editor.phase === 'loading') return <div className={css.loading} role="status">{t('loading')}</div>
  if (editor.fields === undefined) return <div className={css.empty} role="alert"><span>{editor.error ?? t('page.error')}</span></div>
  const field = editor.fields
  const validationText = (error: string): string => error === 'name-required' ? t('editor.nameRequired') : error === 'prompt-required' ? t('editor.promptRequired') : error === 'model-required' ? t('editor.modelRequired') : error
  return <section className={css.editor} aria-labelledby="employee-editor-title">
    <div className={css.sectionHead}><div><h2 id="employee-editor-title">{t('editor.title')}</h2><span className={css.code}>{field.presetId}</span></div><button type="button" className={css.secondaryButton} onClick={back}>{t('editor.back')}</button></div>
    {editor.errors.length > 0 && <div className={css.validation} role="alert"><strong>{t('editor.validation')}</strong><ul>{editor.errors.map(error => <li key={error}>{validationText(error)}</li>)}</ul></div>}
    {editor.conflict && <div className={css.validation} role="alert">{t('editor.conflict')}</div>}{editor.error !== null && !editor.conflict && <div className={css.inlineError} role="alert">{editor.error}</div>}
    {editor.conflictServerFields !== undefined && <section className={css.conflictComparison} aria-label={t('editor.conflictComparison', { revision: editor.conflictServerRevision ?? 0 })}><h3>{t('editor.conflictComparison', { revision: editor.conflictServerRevision ?? 0 })}</h3><div><div><strong>{t('editor.localCopy')}</strong><span>{field.name}</span><span>{field.prompt}</span><span>{field.modelRef}</span></div><div><strong>{t('editor.serverCopy')}</strong><span>{editor.conflictServerFields.name}</span><span>{editor.conflictServerFields.prompt}</span><span>{editor.conflictServerFields.modelRef}</span></div></div><div className={css.conflictActions}><button type="button" className={css.secondaryButton} onClick={api.adoptServerEmployeeConflict}>{t('editor.adoptServer')}</button><button type="button" className={css.primaryButton} onClick={api.keepLocalEmployeeConflict}>{t('editor.keepLocal')}</button></div></section>}
    <div className={css.bindingPicker}><label>{t('editor.asset')}<select value={bindingAssetId} onChange={(event) => { setBindingAssetId(event.target.value) }}><option value="">{t('filters.all')}</option>{assets.items.filter(asset => !asset.archived).map(asset => <option key={asset.assetId} value={asset.assetId}>{asset.name}</option>)}</select></label><button type="button" className={css.secondaryButton} disabled={bindingAssetId === '' || mutationBusy} onClick={() => { const asset = assets.items.find(item => item.assetId === bindingAssetId); if (asset !== undefined) api.patchEmployeeDraft({ bindings: [...field.bindings, { kind: asset.kind, assetId: asset.assetId, version: asset.revision }] }) }}>{t('editor.addBinding')}</button></div>
    <fieldset className={css.editorFields} disabled={editor.saving}>
      <div className={css.formGrid}>
        <label>{t('editor.name')}<input value={field.name} onChange={(event) => { api.patchEmployeeDraft({ name: event.target.value }) }} /></label><label>{t('editor.position')}<input value={field.position} onChange={(event) => { api.patchEmployeeDraft({ position: event.target.value }) }} /></label><label>{t('editor.department')}<input value={field.department} onChange={(event) => { api.patchEmployeeDraft({ department: event.target.value }) }} /></label><label>{t('editor.model')}<input value={field.modelRef} onChange={(event) => { api.patchEmployeeDraft({ modelRef: event.target.value }) }} /></label>
        <label className={css.fullField}>{t('editor.description')}<textarea rows={3} value={field.description} onChange={(event) => { api.patchEmployeeDraft({ description: event.target.value }) }} /></label><label className={css.fullField}>{t('editor.prompt')}<textarea rows={8} value={field.prompt} onChange={(event) => { api.patchEmployeeDraft({ prompt: event.target.value }) }} /></label><label>{t('editor.visibility')}<select value={field.visibility} onChange={(event) => { api.patchEmployeeDraft({ visibility: event.target.value as EnterpriseVisibility }) }}><option value="organization">{t(VISIBILITY_KEYS.organization)}</option><option value="private">{t(VISIBILITY_KEYS.private)}</option><option value="restricted">{t(VISIBILITY_KEYS.restricted)}</option></select></label><details className={css.fullField}><summary>{t('editor.advancedJson')}</summary><label>{t('editor.bindings')}<textarea rows={5} value={JSON.stringify(field.bindings, null, 2)} readOnly /></label></details>
      </div>
    </fieldset>
    <div className={css.formActions}><button type="button" className={css.primaryButton} disabled={editor.saving || editor.conflict || mutationBusy} onClick={() => { void api.saveEmployeeDraft() }}>{editor.saving ? t('editor.saving') : t('editor.save')}</button><button type="button" className={css.secondaryButton} disabled={editor.dirty || editor.saving || editor.conflict || mutationBusy} onClick={() => { void api.publishEmployee() }}>{t('editor.publish')}</button></div>
    <section className={css.history} aria-labelledby="release-history-title"><h3 id="release-history-title">{t('editor.releases')}</h3>{editor.releases.length === 0 ? <p>{t('editor.noReleases')}</p> : <div className={css.rows}>{editor.releases.map(release => <div className={css.row} key={release.releaseId}><div><strong>v{release.version}</strong><span>{formatDate(release.publishedAt)} · {release.publishedBy}</span></div><button type="button" className={css.secondaryButton} disabled={editor.saving || mutationBusy} onClick={() => { rollback(release.releaseId) }}>{t('editor.rollback', { version: release.version })}</button></div>)}</div>}</section>
  </section>
}

function EmployeesPage({ state, api, guardDirty, t }: {
  state: EnterpriseWorkbenchState
  api: EnterpriseWorkbenchInjected
  guardDirty: (action: () => void) => void
  t: Translate
}) {
  const filters = state.employeeFilters
  const [search, setSearch] = useState(filters.search ?? ''); const [status, setStatus] = useState(filters.status ?? ''); const [visibility, setVisibility] = useState(filters.visibility ?? ''); const [owner, setOwner] = useState(filters.ownerUserId ?? '')
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null)
  if (state.employeeEditor !== undefined) return <EmployeeEditor
    editor={state.employeeEditor}
    assets={state.assets}
    api={api}
    back={() => { guardDirty(api.closeEmployeeEditor) }}
    rollback={(releaseId) => { guardDirty(() => { void api.rollbackEmployee(releaseId) }) }}
    mutationBusy={state.mutationPhase === 'running'}
    t={t}
  />
  return <section aria-labelledby="employees-page-title"><div className={css.sectionHead}><h2 id="employees-page-title">{t('employees.title')}</h2><span>{state.employees.items.length}</span></div><form className={css.filters} onSubmit={(event) => { event.preventDefault(); api.setEmployeeFilters({ ...(search === '' ? {} : { search }), ...(status === '' ? {} : { status: status as EnterpriseEmployeeDraft['status'] }), ...(visibility === '' ? {} : { visibility: visibility as EnterpriseVisibility }), ...(owner === '' ? {} : { ownerUserId: owner }) }); void api.refreshEmployees() }}><label>{t('filters.search')}<input value={search} onChange={(event) => { setSearch(event.target.value) }} /></label><label>{t('filters.status')}<select value={status} onChange={(event) => { setStatus(event.target.value) }}><option value="">{t('filters.all')}</option><option value="draft">{t(RELEASE_KEYS.draft)}</option><option value="published">{t(RELEASE_KEYS.published)}</option></select></label><label>{t('filters.visibility')}<select value={visibility} onChange={(event) => { setVisibility(event.target.value) }}><option value="">{t('filters.all')}</option><option value="organization">{t(VISIBILITY_KEYS.organization)}</option><option value="private">{t(VISIBILITY_KEYS.private)}</option><option value="restricted">{t(VISIBILITY_KEYS.restricted)}</option></select></label><label>{t('filters.owner')}<input value={owner} onChange={(event) => { setOwner(event.target.value) }} /></label><button type="submit" className={css.secondaryButton}>{t('filters.apply')}</button></form>
    <PageBoundary page={state.employees} t={t}><div className={css.employeeGrid}>{state.employees.items.map((draft) => { const name = profileText(draft, 'name', draft.presetId); const capabilities = profileList(draft, 'capabilities'); const select = (): void => { setSelectedEmployeeId(draft.presetId) }; return <article className={css.employeeCard} data-selected={selectedEmployeeId === draft.presetId} tabIndex={0} aria-label={t('employee.select', { name })} key={draft.presetId} onClick={select} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select() } }}><div className={css.employeeHead}><div className={css.avatar} aria-hidden="true">{name.slice(0, 2)}</div><div className={css.employeeIdentity}><div className={css.employeeNameRow}><h3>{name}</h3><span className={css.badge}>{t(RELEASE_KEYS[draft.status])}</span></div><div className={css.employeeMeta}><span>{profileText(draft, 'position', draft.presetId)}</span>{profileText(draft, 'department') !== '' && <span>{profileText(draft, 'department')}</span>}</div></div></div><div className={css.capabilities}>{capabilities.map(value => <span key={value}>{value}</span>)}{draft.bindings.map(binding => <span key={`${binding.kind}:${binding.assetId}:${binding.version}`}>{t(ASSET_KEYS[binding.kind])} · {binding.assetId} v{binding.version}</span>)}</div><dl className={css.facts}><div><dt>{t('employee.revision', { revision: draft.revision })}</dt><dd>{formatDate(draft.updatedAt)}</dd></div><div><dt>{t('employee.visibility', { visibility: t(VISIBILITY_KEYS[draft.visibility]) })}</dt><dd>{t('employee.owner', { owner: draft.ownerUserId })}</dd></div></dl><div className={css.employeeFoot}><span>{t('employee.bindings', { count: draft.bindings.length })}</span><div className={css.inlineActions}><button type="button" className={css.secondaryButton} aria-label={t('employee.edit', { name })} onClick={(event) => { event.stopPropagation(); void api.openEmployeeDraft(draft.presetId) }}>{t('editor.title')}</button><button type="button" className={css.primaryButton} aria-label={t('employee.start', { name })} disabled={state.busyEmployee === draft.presetId} onClick={(event) => { event.stopPropagation(); void api.startEmployee(draft.presetId) }}><IconPlayOutline16 size={16} />{t('employee.action')}</button></div></div></article> })}</div></PageBoundary>{state.employees.nextCursor !== undefined && <button type="button" className={css.loadMore} onClick={() => { void api.loadMoreEmployees() }}>{t('loadMore')}</button>}{selectedEmployeeId !== null && <div className={css.mobilePrimary}><button type="button" className={css.primaryButton} aria-label={t('employee.start', { name: profileText(state.employees.items.find(item => item.presetId === selectedEmployeeId)!, 'name', selectedEmployeeId) })} onClick={() => { void api.startEmployee(selectedEmployeeId) }}>{t('employee.action')}</button></div>}
  </section>
}

function WorkRecordsPage({ page, update, busy, t }: { page: EnterprisePageState<OperationWorkRecord>; update: EnterpriseWorkbenchInjected['updateWorkRecord']; busy: boolean; t: Translate }) {
  return <section aria-labelledby="work-page-title"><div className={css.sectionHead}><h2 id="work-page-title">{t('nav.work-records')}</h2><span>{page.items.length}</span></div><PageBoundary page={page} t={t}><div className={css.rows}>{page.items.map(record => <div className={css.row} key={`${record.sessionId}:${record.employeeReleaseId}`}><div><strong>{typeof record.sourceReferences.title === 'string' ? record.sourceReferences.title : record.sessionId}</strong><span>{record.employeeReleaseId} · {t(SOURCE_KEYS[record.source])} · {formatDate(record.updatedAt)}</span></div><label className={css.inlineField}>{t('work.state')}<select value={record.businessState} disabled={busy} onChange={(event) => { void update(record, event.target.value as EnterpriseBusinessState) }}><option value="active">{t(WORK_KEYS.active)}</option><option value="waiting-approval">{t(WORK_KEYS['waiting-approval'])}</option><option value="completed">{t(WORK_KEYS.completed)}</option><option value="failed">{t(WORK_KEYS.failed)}</option></select></label></div>)}</div></PageBoundary></section>
}

function ApprovalsPage({ page, api, busy, t }: { page: EnterprisePageState<EnterpriseApproval>; api: EnterpriseWorkbenchInjected; busy: boolean; t: Translate }) {
  return <section aria-labelledby="approvals-page-title"><div className={css.sectionHead}><h2 id="approvals-page-title">{t('nav.approvals')}</h2><span>{page.items.length}</span></div><PageBoundary page={page} t={t}><div className={css.rows}>{page.items.map(item => <div className={css.row} key={item.approvalId}><div><strong>{t(APPROVAL_KIND_KEYS[item.kind])} · {item.subjectType}</strong><span>{item.subjectId} · {t(APPROVAL_STATE_KEYS[item.state])} · {formatDate(item.updatedAt)}</span></div>{item.state === 'pending' && <div className={css.inlineActions}><button className={css.primaryButton} type="button" disabled={busy} onClick={() => { void api.transitionApproval(item, 'approved') }}>{t('approval.approve')}</button><button className={css.secondaryButton} type="button" disabled={busy} onClick={() => { void api.transitionApproval(item, 'rejected') }}>{t('approval.reject')}</button><button className={css.secondaryButton} type="button" disabled={busy} onClick={() => { void api.cancelApproval(item) }}>{t('approval.cancel')}</button></div>}</div>)}</div></PageBoundary></section>
}

function SchedulesPage({ page, api, busy, onDirty, t }: { page: EnterprisePageState<EnterpriseSchedule>; api: EnterpriseWorkbenchInjected; busy: boolean; onDirty: () => void; t: Translate }) {
  const [scheduleId, setScheduleId] = useState(''); const [target, setTarget] = useState(''); const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone); const [rule, setRule] = useState('')
  return <section aria-labelledby="schedules-page-title"><div className={css.sectionHead}><h2 id="schedules-page-title">{t('nav.schedules')}</h2><span>{page.items.length}</span></div><form className={css.createBar} onSubmit={(event) => { event.preventDefault(); if (scheduleId !== '' && target !== '' && rule !== '') void api.saveSchedule({ scheduleId, target: { kind: 'employee', employeeReleaseId: target }, timezone, rule, input: {}, nextRunAt: null, expectedRevision: 0 }) }}><label>{t('schedule.id')}<input required disabled={busy} value={scheduleId} onChange={(event) => { setScheduleId(event.target.value); onDirty() }} /></label><label>{t('schedule.target')}<input required disabled={busy} value={target} onChange={(event) => { setTarget(event.target.value); onDirty() }} /></label><label>{t('schedule.timezone')}<input required disabled={busy} value={timezone} onChange={(event) => { setTimezone(event.target.value); onDirty() }} /></label><label>{t('schedule.rule')}<input required disabled={busy} value={rule} onChange={(event) => { setRule(event.target.value); onDirty() }} /></label><button className={css.primaryButton} type="submit" disabled={busy}>{t('schedule.save')}</button></form><PageBoundary page={page} t={t}><div className={css.rows}>{page.items.map(item => <div className={css.row} key={item.scheduleId}><div><strong>{item.scheduleId}</strong><span>{t(TARGET_KEYS[item.target.kind])} · {item.target.kind === 'employee' ? item.target.employeeReleaseId : item.target.teamId} · {item.rule} · {item.timezone} · {t(SCHEDULE_KEYS[item.state])}</span></div><div className={css.inlineActions}>{item.state === 'active' && <button type="button" className={css.secondaryButton} disabled={busy} onClick={() => { void api.transitionSchedule(item, 'paused') }}>{t('schedule.pause')}</button>}{item.state === 'paused' && <button type="button" className={css.primaryButton} disabled={busy} onClick={() => { void api.transitionSchedule(item, 'active') }}>{t('schedule.resume')}</button>}{item.state !== 'archived' && <button type="button" className={css.secondaryButton} disabled={busy} onClick={() => { void api.transitionSchedule(item, 'archived') }}>{t('schedule.archive')}</button>}</div></div>)}</div></PageBoundary></section>
}

function AssetsPage({ page, api, busy, onDirty, t }: { page: EnterprisePageState<EnterpriseAsset>; api: EnterpriseWorkbenchInjected; busy: boolean; onDirty: () => void; t: Translate }) {
  const [assetId, setAssetId] = useState(''); const [name, setName] = useState(''); const [kind, setKind] = useState<EnterpriseAssetKind>('sop'); const [content, setContent] = useState('{}'); const [jsonError, setJsonError] = useState(false)
  return <section aria-labelledby="assets-page-title"><div className={css.sectionHead}><h2 id="assets-page-title">{t('nav.assets')}</h2><span>{page.items.length}</span></div><form className={css.createBar} onSubmit={(event) => { event.preventDefault(); try { const value = JSON.parse(content) as Readonly<Record<string, JsonValue>>; setJsonError(false); void api.saveAssetVersion({ assetId, name, kind, content: value, expectedRevision: page.items.find(item => item.assetId === assetId)?.revision ?? 0 }) } catch { setJsonError(true) } }}><label>{t('asset.id')}<input required disabled={busy} value={assetId} onChange={(event) => { setAssetId(event.target.value); onDirty() }} /></label><label>{t('asset.name')}<input required disabled={busy} value={name} onChange={(event) => { setName(event.target.value); onDirty() }} /></label><label>{t('asset.kind')}<select disabled={busy} value={kind} onChange={(event) => { setKind(event.target.value as EnterpriseAssetKind); onDirty() }}><option value="sop">{t(ASSET_KEYS.sop)}</option><option value="knowledge">{t(ASSET_KEYS.knowledge)}</option><option value="skill">{t(ASSET_KEYS.skill)}</option><option value="tool">{t(ASSET_KEYS.tool)}</option><option value="model">{t(ASSET_KEYS.model)}</option></select></label><label className={css.wideField}>{t('asset.content')}<textarea rows={2} disabled={busy} value={content} onChange={(event) => { setContent(event.target.value); onDirty() }} /></label><button className={css.primaryButton} type="submit" disabled={busy}>{t('asset.save')}</button>{jsonError && <span className={css.fieldError} role="alert">{t('json.invalid')}</span>}</form><PageBoundary page={page} t={t}><div className={css.rows}>{page.items.map(item => <div className={css.row} key={item.assetId}><div><strong>{item.name}</strong><span>{t(ASSET_KEYS[item.kind])} · {item.assetId} · {t('employee.revision', { revision: item.revision })} · {formatDate(item.updatedAt)}</span></div>{!item.archived && <button type="button" className={css.secondaryButton} disabled={busy} onClick={() => { void api.archiveAsset(item) }}>{t('asset.archive')}</button>}</div>)}</div></PageBoundary></section>
}

function TeamsPage({ page, releases, api, busy, onDirty, t }: { page: EnterprisePageState<EnterpriseTeam>; releases: readonly import('@deepseek-ai/dsh-api-enterprise-controller/types').EnterpriseEmployeeRelease[]; api: EnterpriseWorkbenchInjected; busy: boolean; onDirty: () => void; t: Translate }) {
  const [teamId, setTeamId] = useState(''); const [leader, setLeader] = useState(''); const [members, setMembers] = useState<EnterpriseTeamMember[]>([]); const [jsonError, setJsonError] = useState(false)
  return <section aria-labelledby="teams-page-title">
    <div className={css.sectionHead}><h2 id="teams-page-title">{t('nav.teams')}</h2><span aria-live="polite">{page.items.length}</span></div>
    <form className={css.createBar} onSubmit={(event) => { event.preventDefault(); setJsonError(false); void api.saveTeam({ teamId, leaderEmployeeReleaseId: leader, members, workflowTemplate: {}, approvalPolicy: {}, expectedRevision: page.items.find(item => item.teamId === teamId)?.revision ?? 0 }) }}>
      <label>{t('team.id')}<input required disabled={busy} value={teamId} onChange={(event) => { setTeamId(event.target.value); onDirty() }} /></label>
      <label>{t('team.leaderSelect')}<select disabled={busy} value={leader} onChange={(event) => { setLeader(event.target.value); onDirty() }}><option value="">{t('filters.all')}</option>{releases.map(release => <option key={release.releaseId} value={release.releaseId}>{recordText(release.snapshot.profile, 'name') || release.presetId} v{release.version}</option>)}</select></label>
      <label>{t('team.memberSelect')}<select disabled={busy} value="" onChange={(event) => { const releaseId = event.target.value; if (releaseId !== '' && !members.some(member => member.employeeReleaseId === releaseId)) setMembers([...members, { employeeReleaseId: releaseId, role: 'member' }]); onDirty() }}><option value="">{t('filters.all')}</option>{releases.map(release => <option key={release.releaseId} value={release.releaseId}>{recordText(release.snapshot.profile, 'name') || release.presetId} v{release.version}</option>)}</select></label>
      <details className={css.wideField}><summary>{t('editor.advancedJson')}</summary><label>{t('team.members')}<textarea rows={2} readOnly value={JSON.stringify(members, null, 2)} /></label></details>
      <button className={css.primaryButton} type="submit" disabled={busy || leader === ''}>{t('team.save')}</button>{jsonError && <span className={css.fieldError} role="alert">{t('json.invalid')}</span>}
    </form>
    <PageBoundary page={page} t={t}><div className={css.rows}>{page.items.map(item => <div className={css.row} key={item.teamId}><div><strong>{item.teamId}</strong><span>{item.leaderEmployeeReleaseId} · {item.members.length} · {t('employee.revision', { revision: item.revision })}</span></div><button type="button" className={css.secondaryButton} disabled={busy} onClick={() => { void api.saveTeam({ teamId: item.teamId, leaderEmployeeReleaseId: item.leaderEmployeeReleaseId, members: item.members, workflowTemplate: item.workflowTemplate, approvalPolicy: item.approvalPolicy, expectedRevision: item.revision }) }}>{t('team.save')}</button></div>)}</div></PageBoundary>
  </section>
}

export function EnterpriseWorkbench(props: EnterpriseWorkbenchProps) {
  const state = props.useEnterprise(snapshot => snapshot); const dialogRef = useRef<HTMLElement>(null); const closeRef = useRef<HTMLButtonElement>(null); const page = state.page
  const [localFormDirty, setLocalFormDirty] = useState(false)
  const mutationBusy = state.mutationPhase === 'running'
  const dirty = state.employeeEditor?.dirty === true || localFormDirty
  const guardDirty = (action: () => void): void => {
    if (mutationBusy && !window.confirm(props.t('mutation.leaveBusy'))) return
    if (dirty && !window.confirm(props.t('editor.dirtyLeave'))) return
    setLocalFormDirty(false)
    action()
  }
  const requestClose = (): void => { guardDirty(props.close) }
  const requestPage = (next: EnterpriseWorkbenchPage): void => {
    if (next !== page) guardDirty(() => { props.setPage(next) })
  }
  useEffect(() => { if (!state.open) return; const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null; closeRef.current?.focus(); return () => { previous?.focus() } }, [state.open])
  useEffect(() => { if (!dirty) return; const warn = (event: BeforeUnloadEvent): void => { event.preventDefault() }; window.addEventListener('beforeunload', warn); return () => { window.removeEventListener('beforeunload', warn) } }, [dirty])
  if (!state.open) return null
  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => { if (event.key === 'Escape') { requestClose(); return } if (event.key !== 'Tab') return; const controls = [...dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])') ?? []]; const first = controls[0]; const last = controls.at(-1); if (first === undefined || last === undefined) return; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() } }
  const pages = [state.employees, state.workRecords, state.approvals, state.schedules, state.assets, state.teams]
  const partial = state.mode === 'enterprise' && pages.some(value => value.phase === 'error' || value.phase === 'permission') && pages.some(value => value.phase === 'ready')
  const injected = props as unknown as EnterpriseWorkbenchInjected
  const api: EnterpriseWorkbenchInjected = {
    ...injected,
    saveSchedule: async (input) => {
      const success = await injected.saveSchedule(input)
      if (success) setLocalFormDirty(false)
      return success
    },
    saveAssetVersion: async (input) => {
      const success = await injected.saveAssetVersion(input)
      if (success) setLocalFormDirty(false)
      return success
    },
    saveTeam: async (input) => {
      const success = await injected.saveTeam(input)
      if (success) setLocalFormDirty(false)
      return success
    },
  }
  return <section ref={dialogRef} className={css.workbench} role="dialog" aria-modal="true" aria-label={props.t('title')} onKeyDown={onKeyDown}><header className={css.header}><div><h1>{props.t('title')}</h1><p>{props.t('subtitle')}</p></div><div className={css.headerActions}><button type="button" className={css.iconButton} aria-label={props.t('refresh')} onClick={() => { void props.refresh() }}><IconRefreshOutline16 size={16} /></button><button ref={closeRef} type="button" className={css.iconButton} aria-label={props.t('close')} onClick={requestClose}><IconCloseOutline16 size={16} /></button></div></header>
    {state.mutationError !== null && <div className={css.mutationError} role="alert" aria-label={props.t('mutation.errorAria')}><IconWarningOutline16 size={18} /><span>{state.mutationPhase === 'conflict' ? props.t('mutation.conflict') : state.mutationError}</span>{state.mutationPhase === 'conflict' ? <button type="button" onClick={() => { void props.resolveMutationConflict() }}>{props.t('mutation.reload')}</button> : <button type="button" onClick={() => { void props.retryMutation() }}>{props.t('mutation.retry')}</button>}<button type="button" onClick={props.dismissMutationError}>{props.t('mutation.dismiss')}</button></div>}
    {state.phase === 'loading' && state.mode === null && <div className={css.loading} role="status"><span className={css.skeleton} />{props.t('loading')}</div>}{state.phase === 'error' && <div className={css.error} role="alert"><IconWarningOutline16 size={18} /><span>{state.error}</span><button type="button" onClick={() => { void props.refresh() }}>{props.t('retry')}</button></div>}{state.phase !== 'error' && state.mode === 'fallback' && <main className={css.body}><FallbackPage state={state} start={props.startEmployee} open={props.openRecord} t={props.t} /></main>}{state.phase !== 'error' && state.mode === 'enterprise' && <div className={css.shell}><nav className={css.nav} aria-label={props.t('nav.aria')}>{NAV.map(([id, key]) => <button type="button" key={id} aria-current={page === id ? 'page' : undefined} onClick={() => { requestPage(id) }}>{props.t(key)}</button>)}</nav><main className={css.main}>{partial && <div className={css.notice} role="status">{props.t('partial')}</div>}{page === 'employees' && <EmployeesPage state={state} api={api} guardDirty={guardDirty} t={props.t} />}{page === 'work-records' && <WorkRecordsPage page={state.workRecords} update={props.updateWorkRecord} busy={mutationBusy} t={props.t} />}{page === 'approvals' && <ApprovalsPage page={state.approvals} api={api} busy={mutationBusy} t={props.t} />}{page === 'schedules' && <SchedulesPage page={state.schedules} api={api} busy={mutationBusy} onDirty={() => { setLocalFormDirty(true) }} t={props.t} />}{page === 'assets' && <AssetsPage page={state.assets} api={api} busy={mutationBusy} onDirty={() => { setLocalFormDirty(true) }} t={props.t} />}{page === 'teams' && <TeamsPage page={state.teams} releases={state.releases} api={api} busy={mutationBusy} onDirty={() => { setLocalFormDirty(true) }} t={props.t} />}</main></div>}</section>
}
