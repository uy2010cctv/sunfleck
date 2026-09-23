/* oxlint-disable @stylistic/max-len */
/** Enterprise digital-employee roster and operations overlay. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import QRCode from 'qrcode/lib/browser.js'
import { EnterpriseBrand } from './EnterpriseBrand.tsx'
import {
  IconApiOutline14, IconCheckOutline16, IconChecklistOutline14, IconCloseOutline16,
  IconContextInjectionOutline16, IconCordisPluginOutline14, IconEditOutline16, IconPlayOutline16,
  IconRefreshOutline16, IconPlusOutline16, IconSearchOutline16, IconSkillOutline16, IconSparkle16,
  IconUserOutline16, IconWarningOutline16, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type {
  EnterpriseApproval, EnterpriseAsset, EnterpriseAssetKind, EnterpriseBusinessState,
  EnterpriseChannelBindingSession, EnterpriseChannelBotInstallResult, EnterpriseChannelConfiguration, EnterpriseChannelPollBotInstallResult, EnterpriseEmployeeDraft, EnterpriseEmployeeRelease, EnterpriseSchedule, EnterpriseScheduleTarget, EnterpriseTeam,
  EnterpriseTeamAutonomyGrant, EnterpriseTeamDecision, EnterpriseTeamDefinition, EnterpriseTeamMember,
  EnterpriseTeamRun, EnterpriseVisibility, EnterpriseWorkRecord as OperationWorkRecord,
  EnterpriseComputerUseRun, EnterpriseDeviceActionView, EnterpriseDeviceView,
  CordisPackageVersion, CordisReviewRequest, CordisScopeBinding,
} from '@deepseek-ai/dsh-api-enterprise-controller/types'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { NS, type EnterpriseWorkbenchKey } from './locales.ts'
import type {
  EmployeeOperationalState, EnterpriseEmployeeDraftFields, EnterpriseEmployeeView,
  EnterprisePageState, EnterpriseWorkbenchPage, EnterpriseWorkbenchState,
  EnterpriseWorkRecord, WorkRecordState,
} from './store.ts'
import css from './EnterpriseWorkbench.module.css'
import { StartWorkPanel } from './StartWorkPanel.tsx'
import { EmployeeDirectory } from './employees.tsx'
import { ProjectSpace } from './projects.tsx'
import {
  CHANNEL_BINDING_BROADCAST_CHANNEL, CHANNEL_BINDING_PROFILES,
  channelBindingCallbackUri, channelBotInstallCallbackUri, officialChannelAuthorizationUrl, officialChannelBindingState,
} from './channelBindingProfiles.ts'

export interface EnterpriseWorkbenchInjected {
  hooks: { enterprise: SnapshotStore<EnterpriseWorkbenchState> }
  close: () => void
  refresh: () => Promise<void>
  setPage: (page: EnterpriseWorkbenchPage) => void
  setEmployeeFilters: (filters: { search?: string; status?: EnterpriseEmployeeDraft['status']; visibility?: EnterpriseVisibility; ownerUserId?: string }) => void
  refreshEmployees: () => Promise<void>
  loadMoreEmployees: () => Promise<void>
  createEmployeeDraft: () => void
  openEmployeeDraft: (presetId: string) => Promise<void>
  patchEmployeeDraft: (patch: Partial<EnterpriseEmployeeDraftFields>) => void
  saveEmployeeDraft: () => Promise<void>
  publishEmployee: () => Promise<void>
  rollbackEmployee: (releaseId: string) => Promise<void>
  closeEmployeeEditor: () => void
  startEmployee: (employeeId: string) => Promise<void>
  loadEmployees: () => Promise<boolean>
  sendMessage: (employeeId: string, text: string) => Promise<boolean>
  selectEmployee: (employeeId?: string) => void
  loadEmployeeMemories: (employeeId: string) => Promise<boolean>
  reviewEmployeeMemory: (
    employeeId: string, memoryId: string, decision: 'approved' | 'rejected', revision: number,
  ) => Promise<boolean>
  retireEmployeeMemory: (employeeId: string, memoryId: string, revision: number) => Promise<boolean>
  loadProjects: () => Promise<boolean>
  loadSurfaces: () => Promise<boolean>
  createProject: (input: { name: string; goal: string; workspacePath: string }) => Promise<boolean>
  selectProject: (projectId?: string) => Promise<void>
  addProjectMember: (
    projectId: string, member: { principalType: 'user' | 'employee'; principalId: string },
  ) => Promise<boolean>
  archiveProject: (projectId: string) => Promise<boolean>
  prepareWork: (input: { objective: string; deadline?: string; workspaceId?: string; preferredEmployeeReleaseId?: string }) => Promise<import('@deepseek-ai/dsh-api-enterprise-controller/types').EnterpriseWorkPreparation>
  startPreparedWork: (input: import('@deepseek-ai/dsh-api-enterprise-controller/types').EnterpriseWorkStartRequest) => Promise<import('@deepseek-ai/dsh-api-enterprise-controller/types').EnterpriseWorkStartValue>
  openRecord: (sessionId: SessionId) => void
  updateWorkRecord: (record: OperationWorkRecord, state: EnterpriseBusinessState) => Promise<void>
  transitionApproval: (approval: EnterpriseApproval, state: 'approved' | 'rejected', reason?: string) => Promise<void>
  cancelApproval: (approval: EnterpriseApproval, reason?: string) => Promise<void>
  saveSchedule: (input: { scheduleId: string; target: EnterpriseScheduleTarget; timezone: string; rule: string; input: Readonly<Record<string, JsonValue>>; nextRunAt: number | null; expectedRevision: number }) => Promise<boolean>
  transitionSchedule: (schedule: EnterpriseSchedule, state: EnterpriseSchedule['state']) => Promise<void>
  saveAssetVersion: (input: { assetId: string; kind: EnterpriseAssetKind; name: string; content: Readonly<Record<string, JsonValue>>; expectedRevision: number }) => Promise<boolean>
  archiveAsset: (asset: EnterpriseAsset) => Promise<void>
  saveTeam: (input: { teamId: string; leaderEmployeeReleaseId: string; members: readonly EnterpriseTeamMember[]; workflowTemplate: Readonly<Record<string, JsonValue>>; approvalPolicy: Readonly<Record<string, JsonValue>>; expectedRevision: number }) => Promise<boolean>
  saveTeamDefinition: (input: Omit<EnterpriseTeamDefinition, 'orgId' | 'revision' | 'createdAt' | 'updatedAt'> & { expectedRevision: number }) => Promise<boolean>
  saveTeamDefinitionDraft: (input: Omit<EnterpriseTeamDefinition, 'orgId' | 'revision' | 'createdAt' | 'updatedAt' | 'state'> & { state?: 'needs-charter' | 'draft'; expectedRevision: number }) => Promise<EnterpriseTeamDefinition | undefined>
  publishTeamDefinitionDraft: (input: { teamId: string; expectedRevision: number }) => Promise<EnterpriseTeamDefinition | undefined>
  getTeamDefinitionDraft: (teamId: string) => Promise<EnterpriseTeamDefinition | undefined>
  saveChannelConfiguration: (input: { channelId: string; name: string; provider: EnterpriseChannelConfiguration['provider']; tenantId?: string; accountId: string; credentialRef?: string; defaultEmployeeReleaseId?: string; inboundEnabled: boolean; state: 'draft' | 'active' | 'paused'; expectedRevision: number }) => Promise<boolean>
  archiveChannelConfiguration: (channel: EnterpriseChannelConfiguration) => Promise<void>
  beginChannelBinding: (channel: EnterpriseChannelConfiguration, redirectUri: string) => Promise<EnterpriseChannelBindingSession>
  beginChannelBotInstall: (provider: EnterpriseChannelConfiguration['provider'], redirectUri: string) => Promise<EnterpriseChannelBotInstallResult>
  pollChannelBotInstall: (installId: string, verificationCode?: string) => Promise<EnterpriseChannelPollBotInstallResult>
  refreshChannels: () => Promise<boolean>
  refreshDevices: () => Promise<boolean>
  pairLocalDevice: (dshOrigin: string) => Promise<boolean>
  createRecorderPairing: () => Promise<{ pairingId: string; code: string; expiresAt: number }>
  testLocalDevice: (deviceId: string) => Promise<import('@deepseek-ai/dsh-api-enterprise-controller/types').EnterpriseDeviceActionView>
  loadDeviceActivity?: () => Promise<{ runs: readonly EnterpriseComputerUseRun[]; actions: readonly EnterpriseDeviceActionView[] }>
  transitionDeviceRun?: (run: EnterpriseComputerUseRun, state: 'active' | 'paused' | 'stopped') => Promise<EnterpriseComputerUseRun>
  startTeamRun: (input: { teamId: string; expectedTeamRevision: number; workspaceId: string; prompt: string }) => Promise<boolean>
  cancelTeamRun: (run: EnterpriseTeamRun) => Promise<void>
  respondTeamDecision: (decision: EnterpriseTeamDecision, answer: string) => Promise<void>
  setExtensionWorkspace: (workspaceId: string) => void
  refreshExtensions: () => Promise<boolean>
  stopExtension: (binding: CordisScopeBinding, reason: string) => Promise<void>
  rollbackExtension: (binding: CordisScopeBinding, packageId: string, reason: string) => Promise<void>
  reviewExtension: (review: CordisReviewRequest, action: 'approve' | 'return' | 'publish', reason: string) => Promise<void>
  retryMutation: () => Promise<void>
  resolveMutationConflict: () => Promise<void>
  dismissMutationError: () => void
  adoptServerEmployeeConflict: () => void
  keepLocalEmployeeConflict: () => void
  optimizeEmployeePrompt: () => Promise<void>
}

export interface EnterpriseEmployeeChannelOwner {
  readonly employee: {
    readonly presetId: string
    readonly releaseId: string
    readonly name: string
    readonly position?: string
  }
}

export interface EnterpriseKnowledgeAssetsOwner {
  /** Null means the provider count is loading or unavailable. */
  readonly onCountChange: (count: number | null) => void
  /** Read counts without mounting management controls. */
  readonly summaryOnly?: boolean
  /** Reload counts when the owning page refreshes. */
  readonly refreshKey?: string
}

export interface EnterpriseEmployeeKnowledgeBindingsOwner {
  readonly presetId: string
  readonly disabled: boolean
  /** Null means the provider count is loading or unavailable. */
  readonly onCountChange: (count: number | null) => void
  /** Read counts without mounting management controls. */
  readonly summaryOnly?: boolean
  /** Reload counts when the owning page refreshes. */
  readonly refreshKey?: string
}

export type EnterpriseWorkbenchProps = PropsRuntime<'shell.overlay'>
  & PropsRenderSlots<'enterprise.employee-channels' | 'enterprise.knowledge-assets' | 'enterprise.employee-knowledge-bindings'>
  & PropsLocale<typeof NS>
  & InjectFace<EnterpriseWorkbenchInjected>
type Translate = (key: EnterpriseWorkbenchKey, params?: Record<string, string | number>) => string
const LEGACY_TEAM_OWNER_SENTINEL = 'system:legacy-fixed-team-migration'
const NAV_GROUPS: readonly { label: EnterpriseWorkbenchKey; items: readonly [EnterpriseWorkbenchPage, EnterpriseWorkbenchKey][] }[] = [
  { label: 'nav.use', items: [['employees', 'nav.employees'], ['projects', 'nav.projects'], ['devices', 'nav.devices'], ['work-records', 'nav.work-records'], ['approvals', 'nav.approvals'], ['attention', 'nav.attention']] },
  { label: 'nav.manage', items: [['schedules', 'nav.schedules'], ['assets', 'nav.assets'], ['teams', 'nav.teams'], ['channels', 'nav.channels'], ['extensions', 'nav.extensions']] },
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

/** Stable DiceBear Lorelei URL; seeds are opaque ids, never employee names or email addresses. */
export function dicebearAvatarUrl(seed: string): string {
  return `https://api.dicebear.com/10.x/lorelei/svg?seed=${encodeURIComponent(seed)}`
}

function EmployeeAvatar({ name, seed, large = false, t }: {
  name: string
  seed: string
  large?: boolean
  t: Translate
}) {
  return <img
    className={large ? css.avatarImageLarge : css.avatarImage}
    src={dicebearAvatarUrl(seed)}
    alt={t('avatar.alt', { name })}
    loading="lazy"
    referrerPolicy="no-referrer"
  />
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
type ManagedAssetKind = 'sop' | 'knowledge' | 'skill' | 'tool'
type CapabilityCategory = ManagedAssetKind | 'cordis'
const MANAGED_ASSET_KINDS: readonly ManagedAssetKind[] = ['sop', 'knowledge', 'skill', 'tool']
const CAPABILITY_CARD_KEYS = {
  sop: ['capability.sop', 'capability.sopDescription'],
  knowledge: ['enum.asset.knowledge', 'capability.knowledgeDescription'],
  skill: ['enum.asset.skill', 'capability.skillDescription'],
  tool: ['enum.asset.tool', 'capability.toolDescription'],
  cordis: ['capability.cordis', 'capability.cordisDescription'],
} as const satisfies Record<CapabilityCategory, readonly [EnterpriseWorkbenchKey, EnterpriseWorkbenchKey]>

function CapabilityIcon({ category }: { category: CapabilityCategory }) {
  if (category === 'sop') return <IconChecklistOutline14 size={18}/>
  if (category === 'knowledge') return <IconContextInjectionOutline16 size={18}/>
  if (category === 'skill') return <IconSkillOutline16 size={18}/>
  if (category === 'tool') return <IconApiOutline14 size={18}/>
  return <IconCordisPluginOutline14 size={18}/>
}

function CapabilityTypeCards({ counts, selected, select, openCordis, t }: {
  counts: Readonly<Record<CapabilityCategory, number | string>>
  selected: ManagedAssetKind
  select: (kind: ManagedAssetKind) => void
  openCordis: () => void
  t: Translate
}) {
  return <div className={css.capabilityTypeGrid} role="list" aria-label={t('capability.categories')}>
    {([...MANAGED_ASSET_KINDS, 'cordis'] as const).map((category) => {
      const [labelKey, descriptionKey] = CAPABILITY_CARD_KEYS[category]
      const active = category === selected
      return <div role="listitem" key={category}><button
        type="button"
        className={css.capabilityTypeCard}
        data-selected={active}
        aria-pressed={category === 'cordis' ? undefined : active}
        onClick={() => { if (category === 'cordis') openCordis(); else select(category) }}
      >
        <span className={css.capabilityTypeIcon}><CapabilityIcon category={category}/></span>
        <span className={css.capabilityTypeCopy}><strong>{t(labelKey)}</strong><small>{t(descriptionKey)}</small></span>
        <span className={css.capabilityTypeCount}>{t('capability.count', { count: counts[category] })}</span>
      </button></div>
    })}
  </div>
}

function cordisExtensionCount(state: EnterpriseWorkbenchState): number {
  return new Set([
    ...state.extensions.items.map(item => `package:${item.pluginId}`),
    ...state.formalPlugins.items.map(item => `formal:${item.entryId}`),
  ]).size
}
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

function PageBoundary<T>({ page, t, children, empty }: { page: EnterprisePageState<T>; t: Translate; children: React.ReactNode; empty?: React.ReactNode }) {
  if (page.phase === 'loading' && page.items.length === 0) return <div className={css.loading} role="status"><span className={css.skeleton} />{t('loading')}</div>
  if (page.phase === 'permission') return <div className={css.empty} role="status"><IconWarningOutline16 size={20} /><strong>{t('permission.title')}</strong><span>{t('permission.body')}</span></div>
  if (page.phase === 'error' && page.items.length === 0) return <div className={css.empty} role="alert"><IconWarningOutline16 size={20} /><strong>{t('page.error')}</strong><span>{page.error}</span></div>
  if (page.items.length === 0) return <>{empty ?? <div className={css.empty}><IconCheckOutline16 size={20} /><span>{t('page.empty')}</span></div>}</>
  return <>{children}</>
}

function ManagementHeader({ id, title, description, count, action }: {
  id: string
  title: string
  description: string
  count: number | string
  action?: React.ReactNode
}) {
  return <div className={css.managementHeader}>
    <div><h2 id={id}>{title}</h2><p>{description}</p></div>
    <div><span>{count}</span>{action}</div>
  </div>
}

function ActionableEmpty({ title, description, action }: {
  title: string
  description: string
  action?: React.ReactNode
}) {
  return <div className={css.actionableEmpty}>
    <IconCheckOutline16 size={20}/><strong>{title}</strong><p>{description}</p>{action}
  </div>
}

function releaseName(release: EnterpriseEmployeeRelease): string {
  return recordText(release.snapshot.profile, 'name') || release.presetId
}

function scheduleRule(frequency: 'daily' | 'weekdays' | 'weekly', time: string): string {
  const [hour = '9', minute = '0'] = time.split(':')
  return `${String(Number(minute))} ${String(Number(hour))} * * ${frequency === 'daily' ? '*' : frequency === 'weekdays' ? '1-5' : '1'}`
}

function scheduleTargetLabel(target: EnterpriseScheduleTarget, releases: readonly EnterpriseEmployeeRelease[]): string {
  if (target.kind === 'team') return target.teamId
  const release = releases.find(candidate => candidate.releaseId === target.employeeReleaseId)
  return release === undefined ? target.employeeReleaseId : releaseName(release)
}

function NativeEmployeeCard({ employee, busy, start, t }: { employee: EnterpriseEmployeeView; busy: boolean; start: (id: string) => Promise<void>; t: Translate }) {
  const status = employeeStatus(employee.status, t); const unavailable = employee.status === 'unavailable'
  return <article className={css.employeeCard} data-status={employee.status} tabIndex={unavailable ? -1 : 0} aria-label={t('employee.destination', { name: employee.name })} onClick={() => { if (!unavailable) void start(employee.id) }} onKeyDown={(event) => { if (!unavailable && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); void start(employee.id) } }}>
    <div className={css.employeeHead}><EmployeeAvatar name={employee.name} seed={employee.id} t={t}/><div className={css.employeeIdentity}><div className={css.employeeNameRow}><h3>{employee.name}</h3>{employee.isDefault && <span className={css.badge}>{t('employee.default')}</span>}{employee.custom && <span className={css.badge}>{t('employee.custom')}</span>}</div><div className={css.employeeMeta}><span>{employee.position ?? employee.description ?? employee.employeeCode}</span>{employee.department !== undefined && <span>{employee.department}</span>}</div></div><div className={css.status}><StateDot state={status.dot} /><span>{status.label}</span></div></div>
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

function EmployeeEditor({ editor, assets, modelOptions, cordisCount, api, back, rollback, openExtensions, renderEmployeeKnowledgeBindings, mutationBusy, t }: {
  editor: NonNullable<EnterpriseWorkbenchState['employeeEditor']>
  assets: EnterprisePageState<EnterpriseAsset>
  modelOptions: EnterpriseWorkbenchState['modelOptions']
  cordisCount: number
  api: EnterpriseWorkbenchInjected
  back: () => void
  rollback: (releaseId: string) => void
  openExtensions: () => void
  renderEmployeeKnowledgeBindings: EnterpriseWorkbenchProps['renderSlot']
  mutationBusy: boolean
  t: Translate
}) {
  const [bindingAssetId, setBindingAssetId] = useState('')
  const [bindingKind, setBindingKind] = useState<ManagedAssetKind>('sop')
  const [providerKnowledgeCount, setProviderKnowledgeCount] = useState<number | null>(0)
  const [departments, setDepartments] = useState<readonly { id: string; name: string }[]>([])
  useEffect(() => {
    const abort = new AbortController()
    void fetch('/auth/departments', { credentials: 'same-origin', signal: abort.signal })
      .then(async response => response.ok ? response.json() as Promise<readonly { id: string; name: string }[]> : [])
      .then((items) => { setDepartments(items) })
      .catch(() => {})
    return () => { abort.abort() }
  }, [])
  if (editor.phase === 'loading') return <div className={css.loading} role="status">{t('loading')}</div>
  if (editor.fields === undefined) return <div className={css.empty} role="alert"><span>{editor.error ?? t('page.error')}</span></div>
  const field = editor.fields
  const displayName = field.name.trim() || t('editor.unnamed')
  const avatarSeed = field.avatarSeed || field.presetId
  const bindingCounts = Object.fromEntries(MANAGED_ASSET_KINDS.map(kind => [
    kind, field.bindings.filter(binding => binding.kind === kind).length,
  ])) as Record<ManagedAssetKind, number>
  const capabilityCounts: Record<CapabilityCategory, number | string> = {
    ...bindingCounts,
    knowledge: providerKnowledgeCount === null ? '—' : bindingCounts.knowledge + providerKnowledgeCount,
    cordis: cordisCount,
  }
  const availableAssets = assets.items.filter(asset => !asset.archived && asset.kind === bindingKind)
  const selectedAsset = availableAssets.find(asset => asset.assetId === bindingAssetId)
  const selectedBindings = selectedAsset === undefined ? [] : field.bindings.filter(binding =>
    binding.kind === selectedAsset.kind && binding.assetId === selectedAsset.assetId)
  const selectedBound = selectedAsset !== undefined && selectedBindings.some(binding => binding.version === selectedAsset.revision)
  const catalogReady = assets.phase === 'ready'
  const catalogFailed = assets.phase === 'error' || assets.phase === 'permission'
  const categoryBindings = field.bindings.map((binding, index) => ({ binding, index })).filter(({ binding }) => binding.kind === bindingKind)
  const allBound = availableAssets.length > 0 && availableAssets.every(asset => field.bindings.some(binding =>
    binding.kind === asset.kind && binding.assetId === asset.assetId && binding.version === asset.revision))
  const nativeBindingManager = <>
    <div className={`${css.fullField} ${css.bindingPicker}`}>
      <label>{t('editor.asset')}<select value={bindingAssetId} disabled={!catalogReady || availableAssets.length === 0} onChange={(event) => { setBindingAssetId(event.target.value) }}>
        <option value="">{!catalogReady ? t(catalogFailed ? 'editor.assetLoadError' : 'editor.assetLoading') : availableAssets.length === 0 ? t('editor.assetEmpty') : t('editor.assetPlaceholder')}</option>
        {availableAssets.map(asset => <option key={asset.assetId} value={asset.assetId}>{field.bindings.some(binding => binding.kind === asset.kind && binding.assetId === asset.assetId && binding.version === asset.revision) ? t('editor.boundOption', { name: asset.name }) : asset.name}</option>)}
      </select></label>
      <button type="button" className={css.secondaryButton} disabled={!catalogReady || selectedAsset === undefined || selectedBound || mutationBusy} onClick={() => {
        if (selectedAsset === undefined || selectedBound) return
        api.patchEmployeeDraft({ bindings: [
          ...field.bindings.filter(binding => binding.kind !== selectedAsset.kind || binding.assetId !== selectedAsset.assetId),
          { kind: selectedAsset.kind, assetId: selectedAsset.assetId, version: selectedAsset.revision },
        ] })
        setBindingAssetId('')
      }}>{t(selectedBound ? 'editor.bound' : selectedBindings.length > 0 ? 'editor.updateBinding' : 'editor.addBinding')}</button>
    </div>
    <div className={css.fullField}>
      {catalogFailed ? <div className={css.inlineError} role="alert"><span>{t('editor.assetLoadError')}</span><button type="button" className={css.secondaryButton} disabled={mutationBusy} onClick={() => { void api.refresh() }}>{t('editor.retryAssets')}</button></div>
        : !catalogReady ? <p className={css.bindingHelp} role="status">{t('editor.assetLoading')}</p>
          : availableAssets.length === 0 ? <p className={css.bindingHelp}>{t('editor.noAssets')}</p>
            : allBound && <p className={css.bindingHelp}>{t('editor.allAssetsBound')}</p>}
      <h4 className={css.bindingHeading}>{t('editor.boundAssets')}</h4>
      {categoryBindings.length === 0 ? <p className={css.bindingHelp}>{t('editor.noBindings')}</p>
        : <ul className={css.boundAssets} aria-label={t('editor.boundAssets')}>
          {categoryBindings.map(({ binding, index }) => {
            const asset = assets.items.find(item => item.assetId === binding.assetId && item.kind === binding.kind)
            const name = asset?.name ?? binding.assetId
            return <li key={index}><div><strong>{name}</strong><span>{t('editor.bindingVersion', { version: binding.version })}{catalogReady && (asset === undefined || asset.archived) && ` · ${t('editor.bindingUnavailable')}`}</span></div><button type="button" className={css.secondaryButton} disabled={mutationBusy} aria-label={t('editor.removeBinding', { name })} onClick={() => { api.patchEmployeeDraft({ bindings: field.bindings.filter((_binding, bindingIndex) => bindingIndex !== index) }) }}>{t('editor.remove')}</button></li>
          })}
        </ul>}
    </div>
  </>
  const validationText = (error: string): string => error === 'name-required' ? t('editor.nameRequired') : error === 'prompt-required' ? t('editor.promptRequired') : error === 'model-required' ? t('editor.modelRequired') : error
  return <section className={css.editor} aria-labelledby="employee-editor-title">
    <header className={css.editorHeader}>
      <div><h2 id="employee-editor-title">{editor.creatingFromPresetId === undefined ? t('editor.title') : t('editor.createTitle')}</h2><p>{editor.creatingFromPresetId === undefined ? t('editor.editHint') : t('editor.createHint')}</p></div>
      <button type="button" className={css.secondaryButton} onClick={back}>{t('editor.back')}</button>
    </header>
    <div className={css.editorLayout}>
      <aside className={css.identityPanel} aria-label={t('editor.identityPreview')}>
        <div className={css.avatarStage}><EmployeeAvatar name={displayName} seed={avatarSeed} large t={t}/></div>
        <div className={css.identityCopy}><strong>{displayName}</strong><span>{field.position.trim() || t('employee.positionFallback')}</span>{field.department.trim() !== '' && <span>{field.department}</span>}</div>
        <button type="button" className={css.secondaryButton} onClick={() => { api.patchEmployeeDraft({ avatarSeed: randomUUID() }) }}>{t('editor.changeAvatar')}</button>
      </aside>
      <div className={css.editorContent}>
        {editor.errors.length > 0 && <div className={css.validation} role="alert"><strong>{t('editor.validation')}</strong><ul>{editor.errors.map(error => <li key={error}>{validationText(error)}</li>)}</ul></div>}
        {editor.conflict && <div className={css.validation} role="alert">{t('editor.conflict')}</div>}{editor.error !== null && !editor.conflict && <div className={css.inlineError} role="alert">{editor.error}</div>}
        {editor.conflictServerFields !== undefined && <section className={css.conflictComparison} aria-label={t('editor.conflictComparison', { revision: editor.conflictServerRevision ?? 0 })}><h3>{t('editor.conflictComparison', { revision: editor.conflictServerRevision ?? 0 })}</h3><div><div><strong>{t('editor.localCopy')}</strong><span>{field.name}</span><span>{field.prompt}</span><span>{field.modelRef}</span></div><div><strong>{t('editor.serverCopy')}</strong><span>{editor.conflictServerFields.name}</span><span>{editor.conflictServerFields.prompt}</span><span>{editor.conflictServerFields.modelRef}</span></div></div><div className={css.conflictActions}><button type="button" className={css.secondaryButton} onClick={api.adoptServerEmployeeConflict}>{t('editor.adoptServer')}</button><button type="button" className={css.primaryButton} onClick={api.keepLocalEmployeeConflict}>{t('editor.keepLocal')}</button></div></section>}
        <fieldset className={css.editorFields} disabled={editor.saving}>
          <section className={css.formSection} aria-labelledby="employee-profile-section"><header><h3 id="employee-profile-section">{t('editor.profileSection')}</h3><p>{t('editor.profileHelp')}</p></header><div className={css.formGrid}>
            <label className={css.fullField}>{t('editor.name')}<input value={field.name} placeholder={t('editor.namePlaceholder')} onChange={(event) => { api.patchEmployeeDraft({ name: event.target.value }) }} /></label>
            <label>{t('editor.position')}<input value={field.position} placeholder={t('editor.positionPlaceholder')} onChange={(event) => { api.patchEmployeeDraft({ position: event.target.value }) }} /></label>
            <label>{t('editor.department')}<select value={field.department} onChange={(event) => { api.patchEmployeeDraft({ department: event.target.value }) }}><option value="">{departments.length === 0 ? t('editor.departmentEmpty') : t('editor.departmentPlaceholder')}</option>{field.department !== '' && !departments.some(department => department.name === field.department) && <option value={field.department}>{field.department}</option>}{departments.map(department => <option key={department.id} value={department.name}>{department.name}</option>)}</select></label>
            <label className={css.fullField}>{t('editor.description')}<textarea rows={3} value={field.description} placeholder={t('editor.descriptionPlaceholder')} onChange={(event) => { api.patchEmployeeDraft({ description: event.target.value }) }} /></label>
          </div></section>
          <section className={css.formSection} aria-labelledby="employee-runtime-section"><header><h3 id="employee-runtime-section">{t('editor.runtimeSection')}</h3><p>{t('editor.runtimeHelp')}</p></header><div className={css.formGrid}>
            <label className={css.compactField}>{t('editor.model')}<select value={field.modelRef} onChange={(event) => { api.patchEmployeeDraft({ modelRef: event.target.value }) }}><option value="">{t('editor.modelPlaceholder')}</option>{field.modelRef !== '' && !modelOptions.some(option => option.value === field.modelRef) && <option value={field.modelRef}>{field.modelRef}</option>}{modelOptions.map(option => <option key={option.value} value={option.value}>{option.provider} · {option.model}</option>)}</select></label>
            <div className={`${css.fullField} ${css.promptField}`}><div className={css.promptToolbar}><label htmlFor="employee-responsibility-prompt">{t('editor.prompt')}</label><button type="button" className={css.secondaryButton} disabled={field.prompt.trim() === '' || field.modelRef === '' || editor.optimizingPrompt === true || mutationBusy} onClick={() => { void api.optimizeEmployeePrompt() }}><IconSparkle16 size={16}/>{editor.optimizingPrompt === true ? t('editor.optimizing') : t('editor.optimize')}</button></div><textarea id="employee-responsibility-prompt" rows={8} value={field.prompt} placeholder={t('editor.promptPlaceholder')} onChange={(event) => { api.patchEmployeeDraft({ prompt: event.target.value }) }} /></div>
          </div></section>
          <section className={css.formSection} aria-labelledby="employee-access-section"><header><h3 id="employee-access-section">{t('editor.accessSection')}</h3><p>{t('editor.accessHelp')}</p></header><div className={css.formGrid}>
            <label>{t('editor.visibility')}<select value={field.visibility} onChange={(event) => { api.patchEmployeeDraft({ visibility: event.target.value as EnterpriseVisibility }) }}><option value="organization">{t(VISIBILITY_KEYS.organization)}</option><option value="private">{t(VISIBILITY_KEYS.private)}</option><option value="restricted">{t(VISIBILITY_KEYS.restricted)}</option></select></label>
            <div className={css.fullField}><p className={css.bindingHelp}>{t('editor.bindingHelp')}</p><CapabilityTypeCards counts={capabilityCounts} selected={bindingKind} select={(kind) => { setBindingKind(kind); setBindingAssetId('') }} openCordis={openExtensions} t={t}/></div>
            <div className={css.fullField} hidden={bindingKind !== 'knowledge'}>
              {renderEmployeeKnowledgeBindings('enterprise.employee-knowledge-bindings', {
                presetId: field.presetId,
                disabled: editor.saving || mutationBusy,
                onCountChange: setProviderKnowledgeCount,
              }, { fallback: bindingKind === 'knowledge' ? nativeBindingManager : null })}
            </div>
            {bindingKind !== 'knowledge' && nativeBindingManager}
            <details className={css.fullField}><summary>{t('editor.advancedJson')}</summary><label>{t('editor.bindings')}<textarea rows={5} value={JSON.stringify(field.bindings, null, 2)} readOnly /></label></details>
          </div></section>
        </fieldset>
        <section className={css.history} aria-labelledby="release-history-title"><h3 id="release-history-title">{t('editor.releases')}</h3>{editor.releases.length === 0 ? <p>{t('editor.noReleases')}</p> : <div className={css.rows}>{editor.releases.map(release => <div className={css.row} key={release.releaseId}><div><strong>{t('version.short', { version: release.version })}</strong><span>{formatDate(release.publishedAt)} · {release.publishedBy}</span></div><button type="button" className={css.secondaryButton} disabled={editor.saving || mutationBusy} onClick={() => { rollback(release.releaseId) }}>{t('editor.rollback', { version: release.version })}</button></div>)}</div>}</section>
      </div>
    </div>
    <footer className={css.editorActions}><span>{editor.revision === 0 || editor.dirty ? t('editor.saveBeforePublish') : t('editor.readyToPublish')}</span><div><button type="button" className={css.secondaryButton} disabled={editor.revision === 0 || editor.dirty || editor.saving || editor.conflict || mutationBusy} onClick={() => { void api.publishEmployee() }}>{t('editor.publish')}</button><button type="button" className={css.primaryButton} disabled={editor.saving || editor.conflict || mutationBusy} onClick={() => { void api.saveEmployeeDraft() }}>{editor.saving ? t('editor.saving') : t('editor.save')}</button></div></footer>
  </section>
}

/** Load provider-owned bindings for a roster card independently of its editor. */
function EmployeeKnowledgeCount({ presetId, nativeCount, refreshKey, renderSlot, t }: {
  presetId: string
  nativeCount: number
  refreshKey: string
  renderSlot: EnterpriseWorkbenchProps['renderSlot']
  t: Translate
}) {
  const [providerCount, setProviderCount] = useState<number | null>(0)
  return <span title={providerCount === null ? t('knowledge.countUnavailable') : undefined}>
    {t('employee.stat.knowledge', { count: providerCount === null ? '—' : nativeCount + providerCount })}
    <span hidden>{renderSlot('enterprise.employee-knowledge-bindings', {
      presetId, disabled: true, summaryOnly: true, refreshKey, onCountChange: setProviderCount,
    }, { fallback: null })}</span>
  </span>
}

function EmployeesPage({ state, api, guardDirty, renderEmployeeKnowledgeBindings, t }: {
  state: EnterpriseWorkbenchState
  api: EnterpriseWorkbenchInjected
  guardDirty: (action: () => void) => void
  renderEmployeeKnowledgeBindings: EnterpriseWorkbenchProps['renderSlot']
  t: Translate
}) {
  const filters = state.employeeFilters
  const [search, setSearch] = useState(filters.search ?? '')
  const [status, setStatus] = useState<EnterpriseEmployeeDraft['status'] | ''>(filters.status ?? '')
  const [visibility, setVisibility] = useState<EnterpriseVisibility | ''>(filters.visibility ?? '')
  const [owner, setOwner] = useState(filters.ownerUserId ?? '')
  const applyFilters = (nextStatus = status): void => {
    api.setEmployeeFilters({
      ...(search.trim() === '' ? {} : { search: search.trim() }),
      ...(nextStatus === '' ? {} : { status: nextStatus }),
      ...(visibility === '' ? {} : { visibility }),
      ...(owner.trim() === '' ? {} : { ownerUserId: owner.trim() }),
    })
    void api.refreshEmployees()
  }
  if (state.employeeEditor !== undefined) return <EmployeeEditor
    editor={state.employeeEditor}
    assets={state.assets}
    modelOptions={state.modelOptions}
    cordisCount={cordisExtensionCount(state)}
    api={api}
    back={() => { guardDirty(api.closeEmployeeEditor) }}
    rollback={(releaseId) => { guardDirty(() => { void api.rollbackEmployee(releaseId) }) }}
    openExtensions={() => { guardDirty(() => { api.setPage('extensions') }) }}
    renderEmployeeKnowledgeBindings={renderEmployeeKnowledgeBindings}
    mutationBusy={state.mutationPhase === 'running'}
    t={t}
  />
  return <section className={css.employeeGallery} aria-labelledby="employees-page-title">
    <div className={css.galleryIntro}>
      <div><h2 id="employees-page-title">{t('employees.heading')}</h2><p>{t('employees.intro')}</p></div>
      <div className={css.galleryIntroActions}><span>{t('employees.count', { count: state.employees.items.length })}</span><button type="button" className={css.primaryButton} onClick={api.createEmployeeDraft}><IconPlusOutline16 size={16}/>{t('employees.create')}</button></div>
    </div>
    <form className={css.galleryControls} onSubmit={(event) => { event.preventDefault(); applyFilters() }}>
      <label className={css.searchField}>
        <span className={css.visuallyHidden}>{t('filters.search')}</span>
        <IconSearchOutline16 size={16}/>
        <input value={search} placeholder={t('filters.searchPlaceholder')} onChange={(event) => { setSearch(event.target.value) }}/>
      </label>
      <button type="submit" className={css.secondaryButton}>{t('filters.searchAction')}</button>
      <details className={css.advancedFilters}>
        <summary>{t('filters.more')}</summary>
        <div>
          <label>{t('filters.visibility')}<select value={visibility} onChange={(event) => { setVisibility(event.target.value as EnterpriseVisibility | '') }}><option value="">{t('filters.all')}</option><option value="organization">{t(VISIBILITY_KEYS.organization)}</option><option value="private">{t(VISIBILITY_KEYS.private)}</option><option value="restricted">{t(VISIBILITY_KEYS.restricted)}</option></select></label>
          <label>{t('filters.owner')}<input value={owner} onChange={(event) => { setOwner(event.target.value) }}/></label>
          <button type="submit" className={css.secondaryButton}>{t('filters.apply')}</button>
        </div>
      </details>
    </form>
    <div className={css.employeeTabs} role="tablist" aria-label={t('employees.categories')}>
      {([['', 'employees.all'], ['published', 'enum.employee.published'], ['draft', 'enum.employee.draft']] as const).map(([value, key]) => <button type="button" role="tab" key={value || 'all'} aria-selected={status === value} onClick={() => { setStatus(value); applyFilters(value) }}>{t(key)}</button>)}
    </div>
    <PageBoundary page={state.employees} t={t} empty={<ActionableEmpty title={t('employees.empty.title')} description={t('employees.empty.body')} action={<button type="button" className={css.primaryButton} onClick={api.createEmployeeDraft}><IconPlusOutline16 size={16}/>{t('employees.create')}</button>}/>}><div className={css.employeeGrid}>{state.employees.items.map((draft) => {
      const name = profileText(draft, 'name', draft.presetId)
      const position = profileText(draft, 'position', t('employee.positionFallback'))
      const department = profileText(draft, 'department')
      const description = profileText(draft, 'description', t('employee.descriptionFallback'))
      const capabilities = profileList(draft, 'capabilities')
      const avatarSeed = profileText(draft, 'avatarSeed', draft.presetId)
      const count = (kind: EnterpriseAssetKind): number => draft.bindings.filter(binding => binding.kind === kind).length
      const toolCount = count('skill') + count('tool')
      return <article className={css.employeeCard} data-status={draft.status} key={draft.presetId}>
        <div className={css.employeeHead}>
          <EmployeeAvatar name={name} seed={avatarSeed} t={t}/>
          <div className={css.employeeIdentity}>
            <div className={css.employeeNameRow}><h3>{name}</h3></div>
            <div className={css.employeeMeta}><span>{position}</span>{department !== '' && <span>{department}</span>}</div>
          </div>
          <div className={css.rosterStatus}><StateDot state={draft.status === 'published' ? 'done' : 'warning'}/><span>{t(RELEASE_KEYS[draft.status])}</span></div>
        </div>
        <p className={css.description}>{description}</p>
        {capabilities.length > 0 && <div className={css.capabilities}>{capabilities.slice(0, 3).map(value => <span key={value}>{value}</span>)}</div>}
        <div className={css.assetStats} aria-label={t('employee.assetsSummary')}>
          <EmployeeKnowledgeCount presetId={draft.presetId} nativeCount={count('knowledge')} refreshKey={state.employees.phase} renderSlot={renderEmployeeKnowledgeBindings} t={t}/>
          <span>{t('employee.stat.tools', { count: toolCount })}</span>
          <span>{t('employee.stat.sop', { count: count('sop') })}</span>
        </div>
        <div className={css.employeeActions}>
          <button type="button" className={css.secondaryButton} aria-label={t('employee.edit', { name })} onClick={() => { void api.openEmployeeDraft(draft.presetId) }}><IconEditOutline16 size={16}/>{t('employee.manage')}</button>
          <button type="button" className={css.startButton} aria-label={t('employee.start', { name })} disabled={state.busyEmployee === draft.presetId} onClick={() => { void api.startEmployee(draft.presetId) }}><IconPlayOutline16 size={16}/>{state.busyEmployee === draft.presetId ? t('employee.busy') : t('employee.action')}</button>
        </div>
      </article>
    })}</div></PageBoundary>
    {state.employees.nextCursor !== undefined && <button type="button" className={css.loadMore} onClick={() => { void api.loadMoreEmployees() }}>{t('loadMore')}</button>}
  </section>
}

function WorkRecordsPage({ page, update, busy, t }: { page: EnterprisePageState<OperationWorkRecord>; update: EnterpriseWorkbenchInjected['updateWorkRecord']; busy: boolean; t: Translate }) {
  return <section aria-labelledby="work-page-title"><div className={css.sectionHead}><h2 id="work-page-title">{t('nav.work-records')}</h2><span>{page.items.length}</span></div><PageBoundary page={page} t={t}><div className={css.rows}>{page.items.map(record => <div className={css.row} key={`${record.sessionId}:${record.employeeReleaseId}`}><div><strong>{typeof record.sourceReferences.title === 'string' ? record.sourceReferences.title : record.sessionId}</strong><span>{record.employeeReleaseId} · {t(SOURCE_KEYS[record.source])} · {formatDate(record.updatedAt)}</span></div><label className={css.inlineField}>{t('work.state')}<select value={record.businessState} disabled={busy} onChange={(event) => { void update(record, event.target.value as EnterpriseBusinessState) }}><option value="active">{t(WORK_KEYS.active)}</option><option value="waiting-approval">{t(WORK_KEYS['waiting-approval'])}</option><option value="completed">{t(WORK_KEYS.completed)}</option><option value="failed">{t(WORK_KEYS.failed)}</option></select></label></div>)}</div></PageBoundary></section>
}

function DevicesPage({ page, api, busy, t }: {
  page: EnterprisePageState<EnterpriseDeviceView>
  api: EnterpriseWorkbenchInjected
  busy: boolean
  t: Translate
}) {
  const [testState, setTestState] = useState<{ deviceId: string; message: string; ok: boolean }>()
  const [pairing, setPairing] = useState<{ phase: 'idle' | 'loading' | 'ready' | 'error'; code?: string; expiresAt?: number }>({ phase: 'idle' })
  const [activity, setActivity] = useState<{ phase: 'loading' | 'ready' | 'error'; runs: readonly EnterpriseComputerUseRun[]; actions: readonly EnterpriseDeviceActionView[] }>({ phase: 'loading', runs: [], actions: [] })
  const refreshActivity = (): void => {
    if (api.loadDeviceActivity === undefined) {
      setActivity({ phase: 'ready', runs: [], actions: [] })
      return
    }
    setActivity(current => ({ ...current, phase: 'loading' }))
    void api.loadDeviceActivity()
      .then((value) => { setActivity({ phase: 'ready', ...value }) })
      .catch(() => { setActivity(current => ({ ...current, phase: 'error' })) })
  }
  useEffect(refreshActivity, [page.items])
  const transition = (run: EnterpriseComputerUseRun, state: 'active' | 'paused' | 'stopped'): void => {
    if (api.transitionDeviceRun !== undefined) void api.transitionDeviceRun(run, state).then(refreshActivity)
  }
  return <section aria-labelledby="devices-page-title">
    <div className={css.sectionHead}>
      <div><h2 id="devices-page-title">{t('device.title')}</h2><p>{t('device.description')}</p></div>
      <div className={css.inlineActions}>
        <button type="button" className={css.secondaryButton} disabled={busy || pairing.phase === 'loading'} onClick={() => {
          setPairing({ phase: 'loading' })
          void api.createRecorderPairing()
            .then((value) => { setPairing({ phase: 'ready', code: value.code, expiresAt: value.expiresAt }) })
            .catch(() => { setPairing({ phase: 'error' }) })
        }}>{pairing.phase === 'loading' ? t('device.bindingRecorder') : t('device.bindRecorder')}</button>
        <button type="button" className={css.primaryButton} disabled={busy} onClick={() => {
          void api.pairLocalDevice(window.location.origin)
        }}>{busy ? t('device.connecting') : t('device.connect')}</button>
      </div>
    </div>
    {pairing.phase === 'ready' && pairing.code !== undefined && pairing.expiresAt !== undefined
      && <div role="status" className={css.compactEmpty}><strong>{t('device.pairingTitle')}</strong>
        <span>{pairing.code}</span><span>{t('device.pairingBody', { time: formatDate(pairing.expiresAt) })}</span></div>}
    {pairing.phase === 'error' && <div role="alert" className={css.compactEmpty}>{t('device.pairingFailed')}</div>}
    <PageBoundary page={page} t={t} empty={<div className={css.empty}>
      <strong>{t('device.emptyTitle')}</strong><span>{t('device.emptyBody')}</span>
    </div>}>
      <div className={css.rows}>{page.items.map(device => <div className={css.row} key={device.deviceId}>
        <div><strong>{device.deviceName}</strong><span>{t(`device.platform.${device.platform}`)} · {
          device.lastHeartbeatAt === undefined
            ? t('device.neverSeen')
            : t('device.lastSeen', { time: formatDate(device.lastHeartbeatAt) })
        }</span></div>
        <div className={css.inlineActions}>
          <div className={css.status}><StateDot state={device.status === 'online' ? 'done' : 'idle'}/>
            <span>{t(`device.status.${device.status}`)}</span></div>
          {device.kind === 'recorder'
            ? <span className={css.mutedText}>{t('device.recorderBound')}</span>
            : <button type="button" className={css.secondaryButton} disabled={busy || device.status !== 'online'} onClick={() => {
              setTestState({ deviceId: device.deviceId, message: t('device.testing'), ok: false })
              void api.testLocalDevice(device.deviceId).then((action) => {
                const ok = action.state === 'completed'
                setTestState({ deviceId: device.deviceId,
                  message: ok ? t('device.testPassed') : t('device.testFailed', { state: action.state }), ok })
                refreshActivity()
              }).catch(() => {
                setTestState({ deviceId: device.deviceId, message: t('device.testFailed', { state: 'error' }), ok: false })
              })
            }}>{t('device.test')}</button>}
        </div>
        {testState?.deviceId === device.deviceId && <span role="status" className={testState.ok ? css.successText : css.mutedText}>
          {testState.message}
        </span>}
      </div>)}</div>
    </PageBoundary>
    <div className={css.deviceActivity}>
      <div className={css.sectionHead}><div><h3>{t('device.runsTitle')}</h3><p>{t('device.runsBody')}</p></div></div>
      {activity.runs.filter(run => run.status === 'active' || run.status === 'paused').length === 0
        ? <div className={css.compactEmpty}>{t('device.noActiveRuns')}</div>
        : <div className={css.rows}>{activity.runs.filter(run => run.status === 'active' || run.status === 'paused').map(run => <div className={css.row} key={run.runId}>
          <div><strong>{run.status === 'active' ? t('device.runActive') : t('device.runPaused')}</strong><span>{t(`device.mode.${run.mode}`)} · {run.updatedAt === undefined ? '' : formatDate(run.updatedAt)}</span></div>
          <div className={css.inlineActions}>
            {run.status === 'active' && <button type="button" className={css.secondaryButton} disabled={busy} onClick={() => { transition(run, 'paused') }}>{t('device.pause')}</button>}
            {run.status === 'paused' && <button type="button" className={css.primaryButton} disabled={busy} onClick={() => { transition(run, 'active') }}>{t('device.resume')}</button>}
            <button type="button" className={css.secondaryButton} disabled={busy} onClick={() => { transition(run, 'stopped') }}>{t('device.stop')}</button>
          </div>
        </div>)}</div>}
      <div className={css.sectionHead}><div><h3>{t('device.actionsTitle')}</h3><p>{t('device.actionsBody')}</p></div></div>
      {activity.phase === 'error' ? <div className={css.compactEmpty}>{t('device.activityError')}</div>
        : activity.actions.length === 0 ? <div className={css.compactEmpty}>{t('device.noActions')}</div>
          : <div className={css.rows}>{activity.actions.slice(0, 12).map(action => <div className={css.row} key={action.actionId}>
            <div><strong>{t(`device.operation.${action.operation.kind}`)}</strong><span>{action.summary ?? t('device.actionWaiting')} · {formatDate(action.updatedAt)}</span></div>
            <div className={css.status}><StateDot state={action.state === 'completed' ? 'done' : action.state === 'failed' || action.state === 'rejected' ? 'error' : 'idle'}/><span>{t(`device.action.${action.state}`)}</span></div>
          </div>)}</div>}
    </div>
  </section>
}

function ApprovalsPage({ page, api, busy, t }: { page: EnterprisePageState<EnterpriseApproval>; api: EnterpriseWorkbenchInjected; busy: boolean; t: Translate }) {
  return <section aria-labelledby="approvals-page-title"><div className={css.sectionHead}><h2 id="approvals-page-title">{t('nav.approvals')}</h2><span>{page.items.length}</span></div><PageBoundary page={page} t={t}><div className={css.rows}>{page.items.map(item => <div className={css.row} key={item.approvalId}><div><strong>{t(APPROVAL_KIND_KEYS[item.kind])} · {item.subjectType}</strong><span>{item.subjectId} · {t(APPROVAL_STATE_KEYS[item.state])} · {formatDate(item.updatedAt)}</span></div>{item.state === 'pending' && <div className={css.inlineActions}><button className={css.primaryButton} type="button" disabled={busy} onClick={() => { void api.transitionApproval(item, 'approved') }}>{t('approval.approve')}</button><button className={css.secondaryButton} type="button" disabled={busy} onClick={() => { void api.transitionApproval(item, 'rejected') }}>{t('approval.reject')}</button><button className={css.secondaryButton} type="button" disabled={busy} onClick={() => { void api.cancelApproval(item) }}>{t('approval.cancel')}</button></div>}</div>)}</div></PageBoundary></section>
}

function SchedulesPage({ page, releases, api, busy, onDirty, t }: { page: EnterprisePageState<EnterpriseSchedule>; releases: readonly EnterpriseEmployeeRelease[]; api: EnterpriseWorkbenchInjected; busy: boolean; onDirty: () => void; t: Translate }) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [instructions, setInstructions] = useState('')
  const [frequency, setFrequency] = useState<'daily' | 'weekdays' | 'weekly'>('daily')
  const [time, setTime] = useState('09:00')
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const canCreate = releases.length > 0
  const goEmployees = <button type="button" className={css.primaryButton} onClick={() => { api.setPage('employees') }}>{t('prerequisite.goEmployees')}</button>
  return <section className={css.managementPage} aria-labelledby="schedules-page-title">
    <ManagementHeader id="schedules-page-title" title={t('nav.schedules')} description={t('schedule.description')} count={page.items.length}
      action={page.items.length === 0 ? undefined : canCreate ? <button type="button" className={css.primaryButton} onClick={() => { setCreating(true) }}><IconPlusOutline16 size={16}/>{t('schedule.create')}</button> : goEmployees}/>
    {!canCreate && <ActionableEmpty title={t('schedule.prerequisiteTitle')} description={t('schedule.prerequisiteBody')} action={goEmployees}/>}
    {canCreate && creating && <form className={css.guidedForm} onSubmit={(event) => {
      event.preventDefault()
      const success = api.saveSchedule({
        scheduleId: `schedule-${randomUUID()}`, target: { kind: 'employee', employeeReleaseId: target },
        timezone, rule: scheduleRule(frequency, time), input: { name, prompt: instructions },
        nextRunAt: null, expectedRevision: 0,
      })
      void success.then((saved) => { if (saved) { setCreating(false); setName(''); setTarget(''); setInstructions('') } })
    }}>
      <div className={css.formTitle}><div><h3>{t('schedule.create')}</h3><p>{t('schedule.formHelp')}</p></div><button type="button" className={css.secondaryButton} onClick={() => { setCreating(false) }}>{t('cancel')}</button></div>
      <div className={css.formGrid}>
        <label>{t('schedule.name')}<input required disabled={busy} value={name} onChange={(event) => { setName(event.target.value); onDirty() }}/></label>
        <label>{t('schedule.employee')}<select required disabled={busy} value={target} onChange={(event) => { setTarget(event.target.value); onDirty() }}><option value="">{t('schedule.selectEmployee')}</option>{releases.map(release => <option key={release.releaseId} value={release.releaseId}>{releaseName(release)} {t('version.short', { version: release.version })}</option>)}</select></label>
        <label className={css.fullField}>{t('schedule.instructions')}<textarea required rows={4} disabled={busy} value={instructions} onChange={(event) => { setInstructions(event.target.value); onDirty() }}/></label>
        <label>{t('schedule.frequency')}<select disabled={busy} value={frequency} onChange={(event) => { setFrequency(event.target.value as typeof frequency); onDirty() }}><option value="daily">{t('schedule.daily')}</option><option value="weekdays">{t('schedule.weekdays')}</option><option value="weekly">{t('schedule.weekly')}</option></select></label>
        <label>{t('schedule.time')}<input type="time" required disabled={busy} value={time} onChange={(event) => { setTime(event.target.value); onDirty() }}/></label>
        <label className={css.fullField}>{t('schedule.timezone')}<input readOnly value={timezone}/></label>
      </div>
      <div className={css.formActions}><button className={css.primaryButton} type="submit" disabled={busy || name.trim() === '' || target === '' || instructions.trim() === ''}>{t('schedule.save')}</button></div>
    </form>}
    {canCreate && <PageBoundary page={page} t={t} empty={<ActionableEmpty title={t('schedule.emptyTitle')} description={t('schedule.emptyBody')} action={<button type="button" className={css.primaryButton} onClick={() => { setCreating(true) }}>{t('schedule.create')}</button>}/>}><div className={css.rows}>{page.items.map(item => <div className={css.row} key={item.scheduleId}><div><strong>{typeof item.input['name'] === 'string' ? item.input['name'] : item.scheduleId}</strong><span>{scheduleTargetLabel(item.target, releases)} · {item.rule} · {item.timezone} · {t(SCHEDULE_KEYS[item.state])}</span></div><div className={css.inlineActions}>{item.state === 'active' && <button type="button" className={css.secondaryButton} disabled={busy} onClick={() => { void api.transitionSchedule(item, 'paused') }}>{t('schedule.pause')}</button>}{item.state === 'paused' && <button type="button" className={css.primaryButton} disabled={busy} onClick={() => { void api.transitionSchedule(item, 'active') }}>{t('schedule.resume')}</button>}{item.state !== 'archived' && <button type="button" className={css.secondaryButton} disabled={busy} onClick={() => { void api.transitionSchedule(item, 'archived') }}>{t('schedule.archive')}</button>}</div></div>)}</div></PageBoundary>}
  </section>
}

function AssetsPage({ page, cordisCount, api, busy, onDirty, openExtensions, renderKnowledgeAssets, t }: { page: EnterprisePageState<EnterpriseAsset>; cordisCount: number; api: EnterpriseWorkbenchInjected; busy: boolean; onDirty: () => void; openExtensions: () => void; renderKnowledgeAssets: EnterpriseWorkbenchProps['renderSlot']; t: Translate }) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<ManagedAssetKind>('sop')
  const [summary, setSummary] = useState('')
  const [content, setContent] = useState('')
  const [providerKnowledgeCount, setProviderKnowledgeCount] = useState<number | null>(0)
  const managedAssets = page.items.filter(asset => MANAGED_ASSET_KINDS.includes(asset.kind as ManagedAssetKind))
  const filteredAssets = managedAssets.filter(asset => asset.kind === kind)
  const counts = Object.fromEntries(MANAGED_ASSET_KINDS.map(category => [
    category, managedAssets.filter(asset => asset.kind === category).length,
  ])) as Record<ManagedAssetKind, number>
  const capabilityCounts: Record<CapabilityCategory, number | string> = {
    ...counts,
    knowledge: providerKnowledgeCount === null ? '—' : counts.knowledge + providerKnowledgeCount,
    cordis: cordisCount,
  }
  const filteredPage = { ...page, items: filteredAssets }
  const createButton = <button type="button" className={css.primaryButton} onClick={() => { setCreating(true) }}><IconPlusOutline16 size={16}/>{t('asset.create')}</button>
  const createForm = creating && <form className={css.guidedForm} onSubmit={(event) => {
    event.preventDefault()
    const payload: Readonly<Record<string, JsonValue>> = kind === 'sop'
      ? { summary, steps: content.split('\n').map(step => step.trim()).filter(Boolean) }
      : { summary, content }
    const success = api.saveAssetVersion({ assetId: `asset-${randomUUID()}`, name, kind, content: payload, expectedRevision: 0 })
    void success.then((saved) => { if (saved) { setCreating(false); setName(''); setSummary(''); setContent('') } })
  }}>
    <div className={css.formTitle}><div><h3>{t('asset.create')}</h3><p>{t('asset.formHelp')}</p></div><button type="button" className={css.secondaryButton} onClick={() => { setCreating(false) }}>{t('cancel')}</button></div>
    <div className={css.formGrid}>
      <label>{t('asset.name')}<input required disabled={busy} value={name} onChange={(event) => { setName(event.target.value); onDirty() }}/></label>
      <div className={css.categoryField}><span>{t('asset.kind')}</span><strong>{t(ASSET_KEYS[kind])}</strong></div>
      <label className={css.fullField}>{t('asset.summary')}<input required disabled={busy} value={summary} onChange={(event) => { setSummary(event.target.value); onDirty() }}/></label>
      <label className={css.fullField}>{t('asset.body')}<textarea required rows={6} disabled={busy} placeholder={kind === 'sop' ? t('asset.sopPlaceholder') : t('asset.contentPlaceholder')} value={content} onChange={(event) => { setContent(event.target.value); onDirty() }}/></label>
    </div>
    <div className={css.formActions}><button className={css.primaryButton} type="submit" disabled={busy || name.trim() === '' || summary.trim() === '' || content.trim() === ''}>{t('asset.save')}</button></div>
  </form>
  const assetList = <PageBoundary page={filteredPage} t={t} empty={<ActionableEmpty title={t('asset.emptyCategoryTitle', { category: t(ASSET_KEYS[kind]) })} description={t('asset.emptyBody')} action={createButton}/>}><div className={css.rows}>{filteredAssets.map(item => <div className={css.row} key={item.assetId}><div><strong>{item.name}</strong><span>{t(ASSET_KEYS[item.kind])} · {t('employee.revision', { revision: item.revision })} · {formatDate(item.updatedAt)}</span></div>{!item.archived && <button type="button" className={css.secondaryButton} disabled={busy} onClick={() => { void api.archiveAsset(item) }}>{t('asset.archive')}</button>}</div>)}</div></PageBoundary>
  return <section className={css.managementPage} aria-labelledby="assets-page-title">
    <ManagementHeader id="assets-page-title" title={t('nav.assets')} description={t('asset.description')} count={providerKnowledgeCount === null ? '—' : managedAssets.length + providerKnowledgeCount} action={kind === 'knowledge' ? undefined : managedAssets.length === 0 ? undefined : createButton}/>
    <CapabilityTypeCards counts={capabilityCounts} selected={kind} select={setKind} openCordis={openExtensions} t={t}/>
    <div hidden={kind !== 'knowledge'} title={providerKnowledgeCount === null ? t('knowledge.countUnavailable') : undefined}>
      {renderKnowledgeAssets('enterprise.knowledge-assets', {
        summaryOnly: kind !== 'knowledge', refreshKey: page.phase, onCountChange: setProviderKnowledgeCount,
      }, { fallback: kind === 'knowledge' ? <>{createForm}{assetList}</> : null })}
    </div>
    {kind !== 'knowledge' && <>{createForm}{assetList}</>}
  </section>
}

export function latestEmployeeReleases(
  releases: readonly EnterpriseEmployeeRelease[],
): readonly EnterpriseEmployeeRelease[] {
  const order: string[] = []
  const latest = new Map<string, EnterpriseEmployeeRelease>()
  for (const release of releases) {
    const current = latest.get(release.presetId)
    if (current === undefined) order.push(release.presetId)
    if (current === undefined || release.version > current.version
      || (release.version === current.version && release.publishedAt > current.publishedAt)) {
      latest.set(release.presetId, release)
    }
  }
  return order.flatMap(presetId => latest.get(presetId) ?? [])
}

function TeamEmployeeChoice({ release, type, checked, disabled, change, t }: {
  release: EnterpriseEmployeeRelease
  type: 'radio' | 'checkbox'
  checked: boolean
  disabled: boolean
  change: (checked: boolean) => void
  t: Translate
}) {
  const name = releaseName(release)
  const avatarSeed = recordText(release.snapshot.profile, 'avatarSeed') || release.presetId
  const position = recordText(release.snapshot.profile, 'position')
  const department = recordText(release.snapshot.profile, 'department')
  return <label className={css.teamEmployeeChoice} data-selected={checked} data-disabled={disabled}>
    <input
      type={type}
      name={type === 'radio' ? 'team-leader' : undefined}
      aria-label={t(type === 'radio' ? 'team.leaderAria' : 'team.memberAria', { name })}
      checked={checked}
      disabled={disabled}
      onChange={(event) => { change(event.target.checked) }}
    />
    <EmployeeAvatar name={name} seed={avatarSeed} t={t}/>
    <span className={css.teamEmployeeIdentity}>
      <strong>{name}</strong>
      {(position !== '' || department !== '') && <small>{[position, department].filter(Boolean).join(' · ')}</small>}
      <small>{t('team.latestVersion', { version: release.version })}</small>
    </span>
  </label>
}

function TeamsPage({ page, releases, api, busy, onDirty, t, embedded = false }: { page: EnterprisePageState<EnterpriseTeam>; releases: readonly EnterpriseEmployeeRelease[]; api: EnterpriseWorkbenchInjected; busy: boolean; onDirty: () => void; t: Translate; embedded?: boolean }) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [leader, setLeader] = useState('')
  const [members, setMembers] = useState<EnterpriseTeamMember[]>([])
  const latestReleases = latestEmployeeReleases(releases)
  const canCreate = latestReleases.length >= 2
  const goEmployees = <button type="button" className={css.primaryButton} onClick={() => { api.setPage('employees') }}>{t('prerequisite.goEmployees')}</button>
  return <section className={css.managementPage} aria-label={embedded ? t('team.legacyTitle') : undefined} aria-labelledby={embedded ? undefined : 'teams-page-title'}>
    {!embedded && <ManagementHeader id="teams-page-title" title={t('team.legacyTitle')} description={t('team.legacyDescription')} count={page.items.length}
      action={page.items.length === 0 ? undefined : canCreate ? <button type="button" className={css.primaryButton} onClick={() => { setCreating(true) }}><IconPlusOutline16 size={16}/>{t('team.create')}</button> : goEmployees}/>
    }
    {embedded && page.items.length > 0 && <div className={css.legacyActions}>{canCreate ? <button type="button" className={css.secondaryButton} onClick={() => { setCreating(true) }}><IconPlusOutline16 size={16}/>{t('team.create')}</button> : goEmployees}</div>}
    {!canCreate && <ActionableEmpty title={t('team.prerequisiteTitle')} description={t('team.prerequisiteBody')} action={goEmployees}/>}
    {canCreate && creating && <form className={css.guidedForm} onSubmit={(event) => {
      event.preventDefault()
      const success = api.saveTeam({
        teamId: `team-${randomUUID()}`, leaderEmployeeReleaseId: leader, members,
        workflowTemplate: { name }, approvalPolicy: {}, expectedRevision: 0,
      })
      void success.then((saved) => { if (saved) { setCreating(false); setName(''); setLeader(''); setMembers([]) } })
    }}>
      <div className={css.formTitle}><div><h3>{t('team.create')}</h3><p>{t('team.formHelp')}</p></div><button type="button" className={css.secondaryButton} onClick={() => { setCreating(false) }}>{t('cancel')}</button></div>
      <div className={css.formGrid}>
        <label className={css.fullField}>{t('team.name')}<input required disabled={busy} value={name} onChange={(event) => { setName(event.target.value); onDirty() }}/></label>
        <fieldset className={`${css.fullField} ${css.teamPicker}`}><legend>{t('team.leaderSelect')}</legend><p>{t('team.leaderHelp')}</p><div className={css.teamChoiceGrid}>{latestReleases.map(release => <TeamEmployeeChoice key={release.releaseId} release={release} type="radio" checked={leader === release.releaseId} disabled={busy} change={(selected) => { if (!selected) return; setLeader(release.releaseId); setMembers(current => current.filter(member => member.employeeReleaseId !== release.releaseId)); onDirty() }} t={t}/>)}</div></fieldset>
        <fieldset className={`${css.fullField} ${css.teamPicker}`}><legend>{t('team.memberSelect')}</legend><p>{leader === '' ? t('team.memberHelpBeforeLeader') : t('team.memberHelp')}</p><div className={css.teamChoiceGrid}>{latestReleases.filter(release => release.releaseId !== leader).map(release => <TeamEmployeeChoice key={release.releaseId} release={release} type="checkbox" checked={members.some(member => member.employeeReleaseId === release.releaseId)} disabled={busy || leader === ''} change={(selected) => { setMembers(current => selected ? [...current, { employeeReleaseId: release.releaseId, role: 'member' }] : current.filter(member => member.employeeReleaseId !== release.releaseId)); onDirty() }} t={t}/>)}</div></fieldset>
      </div>
      <div className={css.formActions}><button className={css.primaryButton} type="submit" disabled={busy || name.trim() === '' || leader === '' || members.length === 0}>{t('team.save')}</button></div>
    </form>}
    {canCreate && <PageBoundary page={page} t={t} empty={<ActionableEmpty title={t('team.emptyTitle')} description={t('team.emptyBody')} action={<button type="button" className={css.primaryButton} onClick={() => { setCreating(true) }}>{t('team.create')}</button>}/>}><div className={css.rows}>{page.items.map(item => <div className={css.row} key={item.teamId}><div><strong>{recordText(item.workflowTemplate, 'name') || item.teamId}</strong><span>{releaseName(releases.find(release => release.releaseId === item.leaderEmployeeReleaseId) ?? { presetId: item.leaderEmployeeReleaseId, version: 0, snapshot: { profile: {} } } as EnterpriseEmployeeRelease)} · {t('team.memberCount', { count: item.members.length })}</span></div><button type="button" className={css.secondaryButton} disabled={busy} onClick={() => { void api.saveTeam({ teamId: item.teamId, leaderEmployeeReleaseId: item.leaderEmployeeReleaseId, members: item.members, workflowTemplate: item.workflowTemplate, approvalPolicy: item.approvalPolicy, expectedRevision: item.revision }) }}>{t('team.save')}</button></div>)}</div></PageBoundary>}
  </section>
}

function LegacyTeamsDisclosure({ initiallyOpen, count, t, children }: { initiallyOpen: boolean; count: number; t: Translate; children: ReactNode }) {
  const [open, setOpen] = useState(initiallyOpen)
  return <details className={css.legacyTeams} open={open} onToggle={(event) => { setOpen(event.currentTarget.open) }}>
    <summary><span><strong>{t('team.legacyTitle')}</strong><small>{t('team.legacyDescription')}</small></span><span>{count}</span></summary>
    {children}
  </details>
}

function teamRunDot(state: EnterpriseTeamRun['state']): 'done' | 'error' | 'ongoing' | 'warning' {
  if (state === 'completed') return 'done'
  if (state === 'failed' || state === 'cancelled') return 'error'
  if (state === 'waiting-human' || state === 'verifying') return 'warning'
  return 'ongoing'
}

function CharterEditor({ definition, newerDefinition, releases, api, busy, onDirty, onClean, close, loadNewer, t }: {
  definition?: EnterpriseTeamDefinition
  newerDefinition?: EnterpriseTeamDefinition
  releases: readonly EnterpriseEmployeeRelease[]
  api: EnterpriseWorkbenchInjected
  busy: boolean
  onDirty: () => void
  onClean: () => void
  close: () => void
  loadNewer: () => void
  t: Translate
}) {
  const existingAgents = definition?.roster.flatMap(member => member.actor.kind === 'agent' ? [member.actor.employeeReleaseId] : []) ?? []
  const latestReleases = latestEmployeeReleases(releases)
  const referencedReleaseIds = new Set([definition?.leaderEmployeeReleaseId ?? '', ...existingAgents])
  const selectableReleases = [...latestReleases, ...releases.filter(release => referencedReleaseIds.has(release.releaseId)
    && !latestReleases.some(latest => latest.releaseId === release.releaseId))]
  const existingVerifier = definition?.roster.find(member => member.roleId === 'verifier' && member.actor.kind === 'agent')
  const [teamId] = useState(() => definition?.teamId ?? `team-${randomUUID()}`)
  const [name, setName] = useState(definition?.name ?? '')
  const [northStar, setNorthStar] = useState(definition?.northStar ?? '')
  const [ownerUserId, setOwnerUserId] = useState(definition?.ownerUserId === LEGACY_TEAM_OWNER_SENTINEL ? '' : definition?.ownerUserId ?? '')
  const [departmentId, setDepartmentId] = useState(definition?.departmentId ?? '')
  const [visibility, setVisibility] = useState<EnterpriseTeamDefinition['visibility']>(definition?.visibility ?? 'organization')
  const [allowedUsers, setAllowedUsers] = useState((definition?.allowedUserIds ?? []).join('\n'))
  const [leader, setLeader] = useState(definition?.leaderEmployeeReleaseId ?? '')
  const [members, setMembers] = useState<string[]>(existingAgents.filter(id => id !== definition?.leaderEmployeeReleaseId && id !== (existingVerifier?.actor.kind === 'agent' ? existingVerifier.actor.employeeReleaseId : '')))
  const [verifier, setVerifier] = useState(existingVerifier?.actor.kind === 'agent' ? existingVerifier.actor.employeeReleaseId : '')
  const [rubrics, setRubrics] = useState((definition?.verificationPolicy.rubricRefs ?? []).join('\n'))
  const [verifierRequired, setVerifierRequired] = useState(definition?.verificationPolicy.verifierRequired ?? true)
  const [openDecisionLimit, setOpenDecisionLimit] = useState(definition?.attentionPolicy.openDecisionLimit?.toString() ?? '')
  const [workInProgressLimit, setWorkInProgressLimit] = useState(definition?.attentionPolicy.workInProgressLimit?.toString() ?? '')
  const [roleEdits, setRoleEdits] = useState(() => [...(definition?.roles ?? [])])
  const [dirty, setDirty] = useState(false)
  const [savedDraft, setSavedDraft] = useState<EnterpriseTeamDefinition | null>(definition?.state === 'draft' ? definition : null)
  const mark = (): void => { setDirty(true); onDirty() }
  const requestClose = (): void => {
    if (dirty && !window.confirm(t('team.charter.discardConfirm'))) return
    close()
  }
  const requestLoadNewer = (): void => {
    if (dirty && !window.confirm(t('team.charter.loadServerConfirm'))) return
    loadNewer()
  }
  const rubricRefs = rubrics.split('\n').map(value => value.trim()).filter(Boolean)
  const allowedUserIds = [...new Set(allowedUsers.split('\n').map(value => value.trim()).filter(Boolean))]
  const canActivate = name.trim() !== '' && northStar.trim() !== '' && ownerUserId.trim() !== '' && leader !== ''
    && (!verifierRequired || (verifier !== '' && rubricRefs.length > 0))
    && (visibility !== 'restricted' || allowedUserIds.length > 0)
    && roleEdits.every(role => role.roleId.trim() !== '' && role.name.trim() !== '' && role.responsibility.trim() !== '')
  const save = async (activate: boolean): Promise<void> => {
    if (activate && savedDraft !== null && !dirty) {
      const published = await api.publishTeamDefinitionDraft({ teamId, expectedRevision: savedDraft.revision })
      if (published !== undefined) { close() }
      return
    }
    const existingRoleByActor = new Map((definition?.roster ?? []).map(member => [
      member.actor.kind === 'human' ? `human:${member.actor.userId}` : `agent:${member.actor.employeeReleaseId}`,
      member.roleId,
    ]))
    const ownerActor = ownerUserId.trim() === '' ? [] : [{
      actor: { kind: 'human' as const, userId: ownerUserId.trim() },
      roleId: existingRoleByActor.get(`human:${ownerUserId.trim()}`) ?? 'owner',
    }]
    const otherHumans = (definition?.roster ?? []).filter(member => member.actor.kind === 'human'
      && member.actor.userId !== ownerUserId.trim())
    const agentRoster = [
      ...(leader === '' ? [] : [{ actor: { kind: 'agent' as const, employeeReleaseId: leader }, roleId: existingRoleByActor.get(`agent:${leader}`) ?? 'lead' }]),
      ...members.filter(id => id !== leader && id !== verifier).map(employeeReleaseId => ({ actor: { kind: 'agent' as const, employeeReleaseId }, roleId: existingRoleByActor.get(`agent:${employeeReleaseId}`) ?? 'member' })),
      ...(verifier === '' || verifier === leader ? [] : [{ actor: { kind: 'agent' as const, employeeReleaseId: verifier }, roleId: 'verifier' }]),
    ]
    const roster = [...ownerActor, ...otherHumans, ...agentRoster]
    const rolesById = new Map(roleEdits.map(role => [role.roleId, role]))
    const defaults = new Map([
      ['owner', { roleId: 'owner', name: t('team.charter.roleOwner'), responsibility: t('team.charter.roleOwnerResponsibility') }],
      ['lead', { roleId: 'lead', name: t('team.charter.roleLead'), responsibility: t('team.charter.roleLeadResponsibility') }],
      ['member', { roleId: 'member', name: t('team.charter.roleMember'), responsibility: t('team.charter.roleMemberResponsibility') }],
      ['verifier', { roleId: 'verifier', name: t('team.charter.roleVerifier'), responsibility: t('team.charter.roleVerifierResponsibility') }],
    ])
    for (const member of roster) if (!rolesById.has(member.roleId)) {
      const fallback = defaults.get(member.roleId)
      if (fallback !== undefined) rolesById.set(member.roleId, fallback)
    }
    const baseDefinition = savedDraft ?? definition
    const preservedAttention = { ...baseDefinition?.attentionPolicy }
    delete preservedAttention.openDecisionLimit
    delete preservedAttention.workInProgressLimit
    const draft = await api.saveTeamDefinitionDraft({
      teamId, name: name.trim(), northStar: northStar.trim(), ownerUserId: ownerUserId.trim(),
      ...(departmentId.trim() === '' ? {} : { departmentId: departmentId.trim() }), visibility,
      ...(visibility === 'restricted' ? { allowedUserIds } : {}), leaderEmployeeReleaseId: leader,
      roster, roles: [...rolesById.values()], verificationPolicy: { ...baseDefinition?.verificationPolicy, verifierRequired, rubricRefs, highRiskHumanReviewRequired: true },
      attentionPolicy: {
        ...preservedAttention,
        decisionQueue: 'centralized',
        ...(Number(openDecisionLimit) > 0 ? { openDecisionLimit: Number(openDecisionLimit) } : {}),
        ...(Number(workInProgressLimit) > 0 ? { workInProgressLimit: Number(workInProgressLimit) } : {}),
      },
      approvalPolicy: { ...baseDefinition?.approvalPolicy, highRiskApprovalRequired: true }, state: canActivate ? 'draft' : 'needs-charter', expectedRevision: baseDefinition?.revision ?? 0,
    })
    if (draft === undefined) return
    setSavedDraft(draft)
    setDirty(false)
    onClean()
    if (activate) {
      const published = await api.publishTeamDefinitionDraft({ teamId, expectedRevision: draft.revision })
      if (published !== undefined) close()
    }
  }
  return <form className={css.charterEditor} aria-labelledby="charter-editor-title" onSubmit={(event) => { event.preventDefault(); if (canActivate) void save(true) }}>
    {newerDefinition !== undefined && <div className={css.charterRevisionNotice} role="status"><span><strong>{t('team.charter.newerRevision')}</strong>{t('team.charter.newerRevisionHelp', { revision: newerDefinition.revision })}</span><button type="button" className={css.secondaryButton} onClick={requestLoadNewer}>{t('team.charter.loadServer')}</button></div>}
    <div className={css.charterEditorHeader}><div><span>{t(definition === undefined ? 'team.charter.createEyebrow' : 'team.charter.improveEyebrow')}</span><h3 id="charter-editor-title">{t(definition === undefined ? 'team.charter.createTitle' : 'team.charter.improveTitle')}</h3><p>{t('team.charter.editorHelp')}</p></div><button type="button" className={css.secondaryButton} onClick={requestClose}>{t('cancel')}</button></div>
    <div className={css.charterEditorGrid}>
      <label>{t('team.name')}<input autoFocus required disabled={busy} value={name} onChange={(event) => { setName(event.target.value); mark() }} placeholder={t('team.charter.namePlaceholder')}/></label>
      <label>{t('team.charter.owner')}<input required disabled={busy} value={ownerUserId} onChange={(event) => { setOwnerUserId(event.target.value); mark() }} placeholder={t('team.charter.ownerPlaceholder')}/></label>
      <label className={css.fullField}>{t('team.charter.northStar')}<textarea aria-label={t('team.charter.northStar')} rows={3} required disabled={busy} value={northStar} onChange={(event) => { setNorthStar(event.target.value); mark() }} placeholder={t('team.charter.northStarPlaceholder')}/><small>{t('team.charter.northStarHelp')}</small></label>
      <label>{t('team.charter.visibility')}<select value={visibility} disabled={busy} onChange={(event) => { setVisibility(event.target.value as EnterpriseTeamDefinition['visibility']); mark() }}><option value="organization">{t('team.charter.visibilityOrganization')}</option><option value="private">{t('team.charter.visibilityPrivate')}</option><option value="restricted">{t('team.charter.visibilityRestricted')}</option></select></label>
      <label>{t('team.charter.department')}<input disabled={busy} value={departmentId} onChange={(event) => { setDepartmentId(event.target.value); mark() }} placeholder={t('team.charter.departmentPlaceholder')}/></label>
      {visibility === 'restricted' && <label className={css.fullField}>{t('team.charter.allowedUsers')}<textarea rows={2} disabled={busy} value={allowedUsers} onChange={(event) => { setAllowedUsers(event.target.value); mark() }} placeholder={t('team.charter.allowedUsersPlaceholder')}/></label>}
      <label className={css.fullField}>{t('team.charter.leader')}<select required value={leader} disabled={busy} onChange={(event) => { const value = event.target.value; setLeader(value); setMembers(current => current.filter(id => id !== value)); if (verifier === value) setVerifier(''); mark() }}><option value="">{t('team.charter.leaderPlaceholder')}</option>{selectableReleases.map(release => <option key={release.releaseId} value={release.releaseId}>{t('startWork.employeeNamed', { name: releaseName(release), version: release.version })}</option>)}</select></label>
      {roleEdits.length > 0 && <fieldset className={`${css.fullField} ${css.charterRoles}`}><legend>{t('team.charter.roles')}</legend><p>{t('team.charter.rolesHelp')}</p><div>{roleEdits.map((role, index) => <div key={role.roleId || String(index)}><label>{t('team.charter.roleName', { role: role.roleId })}<input value={role.name} disabled={busy} onChange={(event) => { setRoleEdits(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item)); mark() }}/></label><label>{t('team.charter.roleResponsibility', { role: role.name || role.roleId })}<input aria-label={t('team.charter.roleResponsibility', { role: role.name || role.roleId })} value={role.responsibility} disabled={busy} onChange={(event) => { setRoleEdits(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, responsibility: event.target.value } : item)); mark() }} placeholder={t('team.charter.roleResponsibilityPlaceholder')}/></label></div>)}</div></fieldset>}
      <fieldset className={css.charterRosterPicker}><legend>{t('team.charter.members')}</legend><p>{t('team.charter.membersHelp')}</p><div>{selectableReleases.filter(release => release.releaseId !== leader && release.releaseId !== verifier).map(release => <label key={release.releaseId}><input type="checkbox" checked={members.includes(release.releaseId)} disabled={busy} onChange={(event) => { setMembers(current => event.target.checked ? [...current, release.releaseId] : current.filter(id => id !== release.releaseId)); mark() }}/><span><strong>{releaseName(release)}</strong><small>{t('version.short', { version: release.version })}</small></span></label>)}</div></fieldset>
      <fieldset className={css.charterRosterPicker}><legend>{t('team.charter.verifier')}</legend><p>{t('team.charter.verifierHelp')}</p><div><label><input type="radio" name="team-charter-verifier" checked={verifier === ''} disabled={busy} onChange={() => { setVerifier(''); mark() }}/><span><strong>{t('team.charter.verifierNone')}</strong></span></label>{selectableReleases.filter(release => release.releaseId !== leader).map(release => <label key={release.releaseId}><input type="radio" name="team-charter-verifier" aria-label={t('team.charter.verifierAria', { name: releaseName(release) })} checked={verifier === release.releaseId} disabled={busy} onChange={() => { setVerifier(release.releaseId); setMembers(current => current.filter(id => id !== release.releaseId)); mark() }}/><span><strong>{releaseName(release)}</strong><small>{t('version.short', { version: release.version })}</small></span></label>)}</div></fieldset>
      <label className={css.fullField}>{t('team.charter.rubrics')}<textarea aria-label={t('team.charter.rubrics')} rows={3} disabled={busy || !verifierRequired} value={rubrics} onChange={(event) => { setRubrics(event.target.value); mark() }} placeholder={t('team.charter.rubricsPlaceholder')}/><small>{t('team.charter.rubricsHelp')}</small></label>
      <div className={`${css.fullField} ${css.charterSwitches}`}><label><input type="checkbox" checked={verifierRequired} disabled={busy} onChange={(event) => { setVerifierRequired(event.target.checked); mark() }}/><span><strong>{t('team.charter.verifierRequired')}</strong><small>{t('team.charter.verifierRequiredHelp')}</small></span></label><label data-enforced="true"><input type="checkbox" checked readOnly disabled/><span><strong>{t('team.charter.highRisk')}</strong><small>{t('team.charter.highRiskHelp')}</small></span></label></div>
      <details className={`${css.fullField} ${css.charterAdvanced}`}><summary>{t('team.charter.advanced')}</summary><div><label>{t('team.charter.decisionLimit')}<input type="number" min="1" disabled={busy} value={openDecisionLimit} onChange={(event) => { setOpenDecisionLimit(event.target.value); mark() }}/></label><label>{t('team.charter.wipLimit')}<input type="number" min="1" disabled={busy} value={workInProgressLimit} onChange={(event) => { setWorkInProgressLimit(event.target.value); mark() }}/></label></div></details>
    </div>
    <div className={css.charterEditorActions}><span>{leader === '' ? t('team.charter.releaseRequired') : canActivate ? t('team.charter.ready') : t('team.charter.incomplete')}</span><div><button type="button" className={css.secondaryButton} disabled={busy || name.trim() === '' || leader === ''} onClick={() => { void save(false) }}>{t('team.charter.saveDraft')}</button><button type="submit" className={css.primaryButton} disabled={busy || !canActivate}>{t('team.charter.activate')}</button></div></div>
  </form>
}

function TeamControlPanel({ definitions, runs, decisions, autonomy, workspaces, releases, api, busy, onDirty, onClean, t }: {
  definitions: EnterprisePageState<EnterpriseTeamDefinition>
  runs: EnterprisePageState<EnterpriseTeamRun>
  decisions: EnterprisePageState<EnterpriseTeamDecision>
  autonomy: EnterprisePageState<EnterpriseTeamAutonomyGrant>
  workspaces: WorkspaceSnapshot
  releases: readonly EnterpriseEmployeeRelease[]
  api: EnterpriseWorkbenchInjected
  busy: boolean
  onDirty: () => void
  onClean: () => void
  t: Translate
}) {
  const activeDefinitions = definitions.items.filter(item => item.state === 'active')
  const [teamId, setTeamId] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const [prompt, setPrompt] = useState('')
  const [editing, setEditing] = useState<EnterpriseTeamDefinition | 'new' | null>(null)
  const newerDefinition = editing === null || editing === 'new' ? undefined : definitions.items.find(item => item.teamId === editing.teamId && item.revision > editing.revision)
  const selected = activeDefinitions.find(item => item.teamId === teamId)
  const visibleRuns = runs.items.filter(run => teamId === '' || run.teamId === teamId)
  const openDecisionCount = decisions.items.filter(item => item.state === 'open').length
  const liveRunCount = runs.items.filter(run => !['completed', 'failed', 'cancelled'].includes(run.state)).length
  return <section className={css.teamControl} aria-labelledby="team-command-title">
    <header className={css.teamCommandHeader}>
      <div><h2 id="team-command-title">{t('team.commandTitle')}</h2><p>{t('team.commandDescription')}</p></div>
      <div className={css.teamCommandPulse} aria-label={t('team.commandSummary', { charters: activeDefinitions.length, runs: liveRunCount, decisions: openDecisionCount })}>
        <span><strong>{activeDefinitions.length}</strong>{t('team.commandCharters')}</span>
        <span><strong>{liveRunCount}</strong>{t('team.commandRuns')}</span>
        <button type="button" data-urgent={openDecisionCount > 0} onClick={() => { api.setPage('attention') }}><strong>{openDecisionCount}</strong>{t('team.commandDecisions')}</button>
      </div>
    </header>
    {editing !== null
      ? <CharterEditor key={editing === 'new' ? 'new' : `${editing.teamId}:${editing.revision}`} {...(editing === 'new' ? {} : { definition: editing })} {...(newerDefinition === undefined ? {} : { newerDefinition })} releases={releases} api={api} busy={busy} onDirty={onDirty} onClean={onClean} close={() => { setEditing(null); onClean() }} loadNewer={() => { if (newerDefinition !== undefined) setEditing(newerDefinition) }} t={t}/>
      : <div className={css.teamCommandGrid}>
        <section className={css.teamCharters} aria-labelledby="team-charters-title">
          <div className={css.sectionHead}><div><h3 id="team-charters-title">{t('team.charters')}</h3><p>{t('team.chartersHelp')}</p></div><div className={css.charterListActions}><span>{definitions.items.length}</span><button type="button" className={css.primaryButton} disabled={busy} onClick={() => { setEditing('new') }}><IconPlusOutline16 size={16}/>{t('team.charter.new')}</button></div></div>
          {definitions.items.length === 0
            ? <p className={css.quietText}>{t('team.chartersEmpty')}</p>
            : <div className={css.charterList}>{definitions.items.map((item) => {
              const isSelected = teamId === item.teamId
              const humanCount = item.roster.filter(member => member.actor.kind === 'human').length
              const agentCount = item.roster.filter(member => member.actor.kind === 'agent').length
              return <article className={css.charterRow} data-state={item.state} data-selected={isSelected} key={`${item.teamId}:${item.revision}`}>
                <button type="button" className={css.charterSelect} aria-pressed={isSelected} aria-label={t('team.selectCharterAria', { name: item.name || item.teamId })} disabled={item.state !== 'active'} onClick={() => { setTeamId(item.teamId) }}><span className={css.charterIdentity}><strong>{item.name || item.teamId}</strong><small>{t(`team.state.${item.state}`)} · {t('team.releaseFence', { revision: item.revision })}</small></span><span className={css.charterNorthStar}><small>{t('team.northStar')}</small><span>{item.northStar || t('team.charterRequired')}</span></span><span className={css.charterRoster}>{t('team.rosterSummary', { humans: humanCount, agents: agentCount })}</span></button>
                <div className={css.charterRowActions}>{item.state === 'active' && <><span>{isSelected ? t('team.selected') : t('team.launch')}</span><button type="button" className={css.secondaryButton} disabled={busy} onClick={() => { void api.getTeamDefinitionDraft(item.teamId).then((draft) => { setEditing(draft ?? item) }) }}>{t('team.charter.improve')}</button></>}{(item.state === 'needs-charter' || item.state === 'draft') && <button type="button" className={css.secondaryButton} disabled={busy} onClick={() => { setEditing(item) }}>{t('team.charter.improve')}</button>}</div>
              </article>
            })}</div>}
        </section>
        <form className={css.teamLaunch} onSubmit={(event) => {
          event.preventDefault()
          if (selected === undefined) return
          void api.startTeamRun({ teamId: selected.teamId, expectedTeamRevision: selected.revision, workspaceId, prompt })
        }}>
          <div className={css.launchHeading}><div><h3>{t('team.launchTitle')}</h3><p>{t('team.launchHelp')}</p></div><span>{selected === undefined ? t('team.launchWaiting') : t('team.launchReady')}</span></div>
          {selected === undefined
            ? <div className={css.launchEmpty}><strong>{t('team.launchEmptyTitle')}</strong><span>{t('team.launchEmptyBody')}</span></div>
            : <div className={css.launchNorthStar}><small>{t('team.northStar')}</small><strong>{selected.northStar}</strong><div><span>{t('team.releaseFence', { revision: selected.revision })}</span><span>{t('team.rosterCount', { count: selected.roster.length })}</span><span>{t('team.verificationSummary', { count: selected.verificationPolicy.rubricRefs?.length ?? 0 })}</span></div></div>}
          <label>{t('team.workspace')}<select required value={workspaceId} onChange={(event) => { setWorkspaceId(event.target.value) }}><option value="">{t('team.workspacePlaceholder')}</option>{workspaces.items.map(workspace => <option key={workspace.workspaceId} value={workspace.workspaceId}>{workspace.title}</option>)}</select></label>
          <label className={css.fullField}>{t('team.objective')}<textarea required rows={4} value={prompt} onChange={(event) => { setPrompt(event.target.value) }} placeholder={t('team.objectivePlaceholder')}/></label>
          <button className={css.primaryButton} type="submit" disabled={busy || selected === undefined || workspaceId === '' || prompt.trim() === ''}>{t('team.startRun')}</button>
        </form>
      </div>}
    <section className={css.teamRooms} aria-labelledby="team-runs-title">
      <div className={css.sectionHead}><div><h3 id="team-runs-title">{t('team.rooms')}</h3><p>{t('team.roomsHelp')}</p></div><span>{visibleRuns.length}</span></div>
      {visibleRuns.length === 0 ? <p className={css.quietText}>{t('team.roomsEmpty')}</p> : <div className={css.teamRunSpine}>{visibleRuns.map((run) => {
        const definition = definitions.items.find(item => item.teamId === run.teamId)
        const runDecisions = decisions.items.filter(item => item.runId === run.runId && item.state === 'open').length
        const grants = autonomy.items.filter(item => item.teamId === run.teamId && item.state === 'active').length
        return <article className={css.teamRoomRow} data-state={run.state} key={run.runId}><span className={css.teamRunDot}><StateDot state={teamRunDot(run.state)}/></span><div className={css.teamRunMain}><div className={css.teamRunTitle}><strong>{definition?.name ?? run.teamId}</strong><span>{t(`team.runState.${run.state}`)}</span>{runDecisions > 0 && <button type="button" onClick={() => { api.setPage('attention') }}>{t('team.decisionBadge', { count: runDecisions })}</button>}</div><p>{definition?.northStar ?? run.runId}</p><small>{t('team.roomEvidence', { members: run.rosterSnapshot.length, decisions: runDecisions, grants })} · {formatDate(run.updatedAt)}</small></div><div className={css.inlineActions}>{run.rootSessionId !== undefined && <button type="button" className={css.primaryButton} onClick={() => { api.openRecord(run.rootSessionId as SessionId) }}>{t('team.openRoom')}</button>}{!['completed', 'failed', 'cancelled'].includes(run.state) && <button type="button" className={css.secondaryButton} disabled={busy} onClick={() => { void api.cancelTeamRun(run) }}>{t('team.cancelRun')}</button>}</div></article>
      })}</div>}
      {openDecisionCount > 0 && <button type="button" className={css.attentionLink} onClick={() => { api.setPage('attention') }}>{t('team.openAttention', { count: openDecisionCount })}</button>}
    </section>
  </section>
}

function TeamAttentionPage({ page, runs, definitions, api, busy, t }: { page: EnterprisePageState<EnterpriseTeamDecision>; runs: EnterprisePageState<EnterpriseTeamRun>; definitions: EnterprisePageState<EnterpriseTeamDefinition>; api: EnterpriseWorkbenchInjected; busy: boolean; t: Translate }) {
  const open = page.items.filter(item => item.state === 'open')
  return <section className={css.attentionPage} aria-labelledby="attention-page-title"><ManagementHeader id="attention-page-title" title={t('nav.attention')} description={t('attention.description')} count={open.length}/><PageBoundary page={{ ...page, items: open }} t={t} empty={<ActionableEmpty title={t('attention.emptyTitle')} description={t('attention.emptyBody')}/>}><div className={css.decisionQueue}>{open.map((item) => {
    const run = runs.items.find(candidate => candidate.runId === item.runId)
    const definition = run === undefined ? undefined : definitions.items.find(candidate => candidate.teamId === run.teamId)
    const titleId = `decision-${item.decisionId}`
    return <article className={css.decisionRow} data-kind={item.kind} key={item.decisionId} aria-labelledby={titleId}>
      <div className={css.decisionMeta}><span>{t(`attention.kind.${item.kind}`)}</span><span>{t('attention.fromTeam', { name: definition?.name ?? run?.teamId ?? item.runId })}</span><time>{formatDate(item.updatedAt)}</time></div>
      <div className={css.decisionBody}><h3 id={titleId}>{item.question}</h3><span>{t('attention.evidenceBound')}</span>{item.recommendation !== undefined && <p><small>{t('attention.agentRecommendation')}</small><strong>{item.recommendation}</strong></p>}</div>
      <div className={css.decisionActions}>{run?.rootSessionId !== undefined && <button type="button" className={css.secondaryButton} onClick={() => { api.openRecord(run.rootSessionId as SessionId) }}>{t('attention.openRoom')}</button>}<div className={css.decisionOptions}>{item.options.map(option => <button type="button" className={option === item.recommendation ? css.primaryButton : css.secondaryButton} disabled={busy} key={option} onClick={() => { void api.respondTeamDecision(item, option) }}>{option}</button>)}</div></div>
    </article>
  })}</div></PageBoundary></section>
}

const CHANNEL_PROVIDERS = ['wecom', 'feishu', 'dingtalk', 'wechat'] as const
const CHANNEL_BINDING_RECONCILE_MS = 1_500
type ChannelRecoveryTarget = 'configuration' | 'binding'

function ProviderInstallQr({ value, label }: { value: string; label: string }) {
  const code = QRCode.create(value, { errorCorrectionLevel: 'M' })
  let path = ''
  for (let row = 0; row < code.modules.size; row += 1) {
    for (let column = 0; column < code.modules.size; column += 1) {
      if (code.modules.get(row, column)) path += `M${column} ${row}h1v1h-1z`
    }
  }
  return <svg className={css.channelInstallQr} role="img" aria-label={label}
    viewBox={`-2 -2 ${code.modules.size + 4} ${code.modules.size + 4}`} shapeRendering="crispEdges">
    <rect x="-2" y="-2" width={code.modules.size + 4} height={code.modules.size + 4} fill="white"/>
    <path d={path} fill="black"/>
  </svg>
}
function NativeChannelsPage({ page, api, busy, t }: {
  page: EnterprisePageState<EnterpriseChannelConfiguration>
  api: EnterpriseWorkbenchInjected
  busy: boolean
  t: Translate
}) {
  const [botInstall, setBotInstall] = useState<{
    provider: EnterpriseChannelConfiguration['provider']
    phase: 'opening' | 'waiting' | 'verification-required' | 'setup-required' | 'unsupported' | 'error'
    officialDocumentationUrl?: string
    qrValue?: string
    verificationCode?: string
  } | null>(null)
  const [binding, setBinding] = useState<{
    generation: number
    attemptId: string
    channelId: string
    phase: 'opening' | 'waiting' | 'checking' | 'error' | 'expired'
    message?: string
    expiresAt?: number
    refreshComplete?: boolean
  } | null>(null)
  const attemptGeneration = useRef(0)
  const recoveryActionRefs = useRef(new Map<string, HTMLElement>())
  const activeBinding = useRef<{
    generation: number
    attemptId: string | null
    channelId: string
    popup: Window
    broadcast: BroadcastChannel | null
  } | null>(null)
  const activeBotInstall = useRef<{
    attemptId: string | null
    provider: EnterpriseChannelConfiguration['provider']
    popup: Window
    broadcast: BroadcastChannel
    pollTimer?: number
  } | null>(null)
  const currentBotInstallAttempt = () => activeBotInstall.current
  const isActiveAttempt = (generation: number, popup: Window): boolean => {
    const active = activeBinding.current
    return active !== null && active.generation === generation && active.popup === popup
  }
  const releaseActive = (active: NonNullable<typeof activeBinding.current>): void => {
    active.broadcast?.close()
    if (activeBinding.current === active) activeBinding.current = null
  }
  const acceptBindingSignal = (value: unknown): void => {
    const active = activeBinding.current
    if (active === null || typeof value !== 'object' || value === null) return
    const data = value as { type?: unknown; attemptId?: unknown; channelId?: unknown }
    if (active.attemptId === null || data.attemptId !== active.attemptId) return
    if (data.type === 'dsh-channel-binding-complete' && data.channelId === active.channelId) {
      releaseActive(active)
      setBinding(null)
      void api.refreshChannels()
    } else if (data.type === 'dsh-channel-binding-failed'
      && (data.channelId === undefined || data.channelId === active.channelId)) {
      releaseActive(active)
      setBinding({
        generation: active.generation, attemptId: active.attemptId, channelId: active.channelId,
        phase: 'error', message: t('channel.binding.callbackFailed'),
      })
    }
  }
  const releaseBotInstall = (): void => {
    const timer = activeBotInstall.current?.pollTimer
    if (timer !== undefined) window.clearTimeout(timer)
    activeBotInstall.current?.broadcast.close()
    activeBotInstall.current = null
  }
  const cancelBotInstall = (): void => {
    const active = activeBotInstall.current
    releaseBotInstall()
    if (active !== null && !active.popup.closed) active.popup.close()
    setBotInstall(null)
  }
  const acceptBotInstallSignal = (value: unknown): void => {
    const active = activeBotInstall.current
    if (active === null || active.attemptId === null || typeof value !== 'object' || value === null) return
    const data = value as { type?: unknown; attemptId?: unknown }
    if (data.attemptId !== active.attemptId) return
    if (data.type === 'dsh-channel-bot-install-complete') {
      releaseBotInstall()
      setBotInstall(null)
      void api.refreshChannels()
    } else if (data.type === 'dsh-channel-bot-install-failed') {
      const provider = active.provider
      releaseBotInstall()
      setBotInstall({ provider, phase: 'error' })
    }
  }
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const active = activeBinding.current
      if (event.origin !== window.location.origin) return
      const botInstallAttempt = activeBotInstall.current
      if (botInstallAttempt !== null && event.source === botInstallAttempt.popup) {
        acceptBotInstallSignal(event.data)
        return
      }
      if (active === null || event.source !== active.popup) return
      acceptBindingSignal(event.data)
    }
    window.addEventListener('message', onMessage)
    return () => { window.removeEventListener('message', onMessage) }
  }, [api, t])
  useEffect(() => () => {
    const active = activeBinding.current
    if (active !== null) releaseActive(active)
    releaseBotInstall()
  }, [])
  useEffect(() => {
    if (binding?.phase !== 'waiting' || binding.expiresAt === undefined) return
    const remaining = binding.expiresAt - Date.now()
    const expire = (): void => {
      const active = activeBinding.current
      if (active === null || active.generation !== binding.generation) return
      releaseActive(active)
      if (!active.popup.closed) active.popup.close()
      setBinding(current => current?.generation === binding.generation
        ? {
          generation: binding.generation, attemptId: binding.attemptId,
          channelId: binding.channelId, phase: 'expired',
        }
        : current)
    }
    if (remaining <= 0) {
      expire()
      return
    }
    const timer = window.setTimeout(expire, Math.min(remaining, 2_147_483_647))
    return () => { window.clearTimeout(timer) }
  }, [binding])
  useEffect(() => {
    if (binding?.phase !== 'waiting') return
    const poll = window.setInterval(() => {
      const active = activeBinding.current
      if (active === null || active.generation !== binding.generation || !active.popup.closed) return
      releaseActive(active)
      setBinding({
        generation: binding.generation, attemptId: binding.attemptId,
        channelId: binding.channelId, phase: 'checking', refreshComplete: false,
      })
      const markRefreshComplete = (): void => {
        setBinding(current => current?.generation === binding.generation && current.phase === 'checking'
          ? { ...current, refreshComplete: true }
          : current)
      }
      void api.refreshChannels().then(markRefreshComplete, markRefreshComplete)
    }, 250)
    return () => { window.clearInterval(poll) }
  }, [api, binding])
  useEffect(() => {
    if (binding === null) return
    const channel = page.items.find(item => item.channelId === binding.channelId)
    const popupClosedError = binding.phase === 'error' && binding.message === t('channel.binding.popupClosed')
    if ((binding.phase === 'checking' || popupClosedError) && channel?.bindingStatus === 'verified') {
      setBinding(null)
      return
    }
    if (binding.phase !== 'checking') return
    if (binding.refreshComplete !== true) return
    const reconcile = window.setTimeout(() => {
      setBinding(current => current?.generation === binding.generation && current.phase === 'checking'
        ? { ...current, phase: 'error', message: t('channel.binding.popupClosed') }
        : current)
    }, CHANNEL_BINDING_RECONCILE_MS)
    return () => { window.clearTimeout(reconcile) }
  }, [binding, page.items, t])
  const pollDeviceInstall = async (
    active: NonNullable<typeof activeBotInstall.current>,
    verificationCode?: string,
  ): Promise<void> => {
    if (activeBotInstall.current !== active || active.attemptId === null) return
    try {
      const result = verificationCode === undefined
        ? await api.pollChannelBotInstall(active.attemptId)
        : await api.pollChannelBotInstall(active.attemptId, verificationCode)
      if (activeBotInstall.current !== active) return
      if (result.status === 'complete') {
        if (!active.popup.closed) active.popup.close()
        releaseBotInstall()
        setBotInstall(null)
        void api.refreshChannels()
        return
      }
      if (result.status === 'verification-required') {
        setBotInstall(current => current === null ? current : {
          ...current, phase: 'verification-required', verificationCode: '',
        })
        return
      }
      setBotInstall((current) => {
        if (current === null) return current
        const { verificationCode: _verificationCode, ...rest } = current
        return { ...rest, phase: 'waiting' }
      })
      active.pollTimer = window.setTimeout(() => { void pollDeviceInstall(active) }, 500)
    } catch {
      if (!active.popup.closed) active.popup.close()
      const provider = active.provider
      releaseBotInstall()
      setBotInstall({ provider, phase: 'error' })
    }
  }
  const startBotInstall = async (provider: EnterpriseChannelConfiguration['provider']): Promise<void> => {
    const previous = activeBotInstall.current
    if (previous !== null) {
      releaseBotInstall()
      if (!previous.popup.closed) previous.popup.close()
    }
    const popup = window.open('', 'dsh-channel-bot-install', 'popup,width=640,height=760,resizable=yes,scrollbars=yes')
    if (popup == null) {
      setBotInstall({ provider, phase: 'error' })
      return
    }
    const broadcast = new BroadcastChannel(CHANNEL_BINDING_BROADCAST_CHANNEL)
    activeBotInstall.current = { attemptId: null, provider, popup, broadcast }
    broadcast.onmessage = (event) => { acceptBotInstallSignal(event.data) }
    setBotInstall({ provider, phase: 'opening' })
    try {
      const result = await api.beginChannelBotInstall(provider, channelBotInstallCallbackUri(window.location))
      if (result.status === 'ready') {
        const authorization = new URL(result.authorizationUrl)
        const active = currentBotInstallAttempt()
        if (authorization.protocol !== 'https:' || active === null
          || active.popup !== popup || active.provider !== provider) {
          throw new Error('invalid provider installation URL')
        }
        if (result.completionMode === 'poll') {
          const expectedHost = result.provider === 'feishu' ? 'open.feishu.cn'
            : result.provider === 'wecom' ? 'work.weixin.qq.com'
              : result.provider === 'wechat' ? 'liteapp.weixin.qq.com' : null
          if (expectedHost === null || authorization.host !== expectedHost) {
            throw new Error('invalid provider Device Grant URL')
          }
          active.attemptId = result.installId
        } else {
          const state = officialChannelBindingState(authorization)
          if (state === null || state !== result.installId) throw new Error('invalid provider callback state')
          active.attemptId = state
        }
        popup.opener = null
        popup.location.href = authorization.href
        if (result.completionMode === 'poll') {
          setBotInstall({ provider, phase: 'waiting', qrValue: authorization.href })
          void pollDeviceInstall(active)
        }
        return
      }
      if (!popup.closed) popup.close()
      releaseBotInstall()
      setBotInstall({
        provider: result.provider, phase: result.status,
        officialDocumentationUrl: result.officialDocumentationUrl,
      })
    } catch {
      if (!popup.closed) popup.close()
      releaseBotInstall()
      setBotInstall({ provider, phase: 'error' })
    }
  }
  const missingPrerequisites = (channel: EnterpriseChannelConfiguration): string[] => {
    const missing: string[] = []
    if (channel.accountId.trim() === '') missing.push(t('channel.binding.accountMissing'))
    if (channel.provider === 'wecom' && channel.bindingStatus !== 'verified'
      && (channel.tenantId?.trim() ?? '') === '') {
      missing.push(t('channel.binding.tenantMissing'))
    }
    if (channel.credentialStatus !== 'configured') missing.push(t('channel.credentialMissing'))
    return missing
  }
  const canBind = (channel: EnterpriseChannelConfiguration): boolean => channel.state !== 'archived'
    && missingPrerequisites(channel).length === 0
  const prerequisiteDetail = (channel: EnterpriseChannelConfiguration): string => {
    if (channel.state === 'archived') return t('channel.binding.archived')
    const missing = missingPrerequisites(channel)
    return missing.length === 0 ? t('channel.credentialConfigured') : missing.join(' · ')
  }
  const beginBinding = async (channel: EnterpriseChannelConfiguration, preparedPopup?: Window): Promise<void> => {
    const generation = ++attemptGeneration.current
    const localAttemptId = randomUUID()
    if (typeof BroadcastChannel !== 'function') {
      setBinding({
        generation, attemptId: localAttemptId, channelId: channel.channelId,
        phase: 'error', message: t('channel.binding.broadcastUnsupported'),
      })
      return
    }
    const previous = activeBinding.current
    if (previous !== null) {
      releaseActive(previous)
      if (!previous.popup.closed) previous.popup.close()
    }
    const popup = preparedPopup ?? window.open('', 'dsh-channel-binding', 'popup,width=560,height=720,resizable=yes,scrollbars=yes')
    if (popup === null) {
      setBinding({
        generation, attemptId: localAttemptId, channelId: channel.channelId,
        phase: 'error', message: t('channel.binding.popupBlocked'),
      })
      return
    }
    const broadcast = new BroadcastChannel(CHANNEL_BINDING_BROADCAST_CHANNEL)
    const active: NonNullable<typeof activeBinding.current> = {
      generation, attemptId: null, channelId: channel.channelId, popup, broadcast,
    }
    activeBinding.current = active
    broadcast.onmessage = (event) => { acceptBindingSignal(event.data) }
    setBinding({ generation, attemptId: localAttemptId, channelId: channel.channelId, phase: 'opening' })
    try {
      const session = await api.beginChannelBinding(
        channel,
        channelBindingCallbackUri(window.location),
      )
      if (!isActiveAttempt(generation, popup)) return
      if (popup.closed) {
        releaseActive(active)
        setBinding({
          generation, attemptId: localAttemptId, channelId: channel.channelId,
          phase: 'error', message: t('channel.binding.popupClosed'),
        })
        return
      }
      const authorization = officialChannelAuthorizationUrl(channel.provider, session.authorizationUrl)
      if (authorization === null) throw new Error('invalid provider authorization URL')
      const signedState = officialChannelBindingState(authorization)
      if (signedState === null) throw new Error('invalid provider authorization state')
      active.attemptId = signedState
      popup.opener = null
      popup.location.href = authorization.href
      setBinding({
        generation, attemptId: signedState, channelId: channel.channelId,
        phase: 'waiting', expiresAt: session.expiresAt,
      })
    } catch {
      if (!isActiveAttempt(generation, popup)) return
      popup.close()
      releaseActive(active)
      setBinding({
        generation, attemptId: localAttemptId, channelId: channel.channelId,
        phase: 'error', message: t('channel.binding.beginFailed'),
      })
    }
  }
  const bindingBusy = binding?.phase === 'opening' || binding?.phase === 'waiting' || binding?.phase === 'checking'
  const recoveryKey = (channelId: string, target: ChannelRecoveryTarget): string => `${channelId}:${target}`
  const setRecoveryAction = (channelId: string, target: ChannelRecoveryTarget, action: HTMLElement | null): void => {
    const key = recoveryKey(channelId, target)
    if (action === null) recoveryActionRefs.current.delete(key)
    else recoveryActionRefs.current.set(key, action)
  }
  const attention = page.items.flatMap<{ channel: EnterpriseChannelConfiguration; reason: string; target: ChannelRecoveryTarget }>((channel) => {
    if (channel.state === 'archived') return []
    const channelBinding = binding?.channelId === channel.channelId ? binding : null
    if (channelBinding?.phase === 'error' || channelBinding?.phase === 'expired') {
      const detail = channelBinding.message ?? t(`channel.binding.phase.${channelBinding.phase}`)
      return [{ channel, reason: t('channel.attention.binding', { reason: detail }), target: 'binding' }]
    }
    const missing = missingPrerequisites(channel)
    if (missing.length > 0) return [{ channel, reason: missing.join(' · '), target: 'configuration' }]
    if (bindingBusy) return []
    if (channel.state === 'active' && channel.bindingStatus !== 'verified') {
      return [{ channel, reason: t('channel.attention.unbound'), target: 'binding' }]
    }
    return []
  })
  const focusRecoveryAction = (channelId: string, target: ChannelRecoveryTarget): void => {
    const action = recoveryActionRefs.current.get(recoveryKey(channelId, target))
    const row = action?.closest('article')
    if (typeof row?.scrollIntoView === 'function') row.scrollIntoView({ block: 'center' })
    action?.focus()
  }
  const derivedStatusKeys = (channel: EnterpriseChannelConfiguration): EnterpriseWorkbenchKey[] => {
    if (channel.state === 'archived' || channel.state === 'paused') return []
    if (missingPrerequisites(channel).length > 0) return ['channel.status.pendingConfiguration']
    const statuses: EnterpriseWorkbenchKey[] = [channel.bindingStatus === 'verified'
      ? 'channel.status.identityVerified' : 'channel.status.readyToScan']
    if (channel.state === 'active' && channel.bindingStatus === 'verified') {
      statuses.push('channel.status.transportPending')
    }
    return statuses
  }
  return <section className={css.channelPage} aria-labelledby="channel-page-title">
    <ManagementHeader id="channel-page-title" title={t('channel.title')} description={t('channel.description')} count={page.items.length}/>
    <div className={css.channelPrinciple}><IconApiOutline14 size={16}/><div><strong>{t('channel.truthTitle')}</strong><span>{t('channel.truthBody')}</span></div></div>
    <div className={css.channelProviderStarts} aria-label={t('channel.botInstall.choicesAria')}>{CHANNEL_PROVIDERS.map(provider => <button type="button" className={provider === 'wecom' ? css.primaryButton : css.secondaryButton} key={provider} onClick={() => { void startBotInstall(provider) }}>{t(`channel.botInstall.start.${provider}`)}</button>)}</div>
    {botInstall !== null && <section className={css.channelBotInstall} role={botInstall.phase === 'error' ? 'alert' : 'status'}>
      <div><h3>{t(`channel.botInstall.title.${botInstall.phase}`, { provider: t(`channel.provider.${botInstall.provider}`) })}</h3><p>{t(`channel.botInstall.body.${botInstall.phase}.${botInstall.provider}`)}</p>{botInstall.qrValue !== undefined && <ProviderInstallQr value={botInstall.qrValue} label={t('channel.botInstall.qrAlt', { provider: t(`channel.provider.${botInstall.provider}`) })}/>}</div>
      <div>{botInstall.phase === 'verification-required' && <div className={css.channelVerification}><label><span>{t('channel.botInstall.verificationLabel')}</span><input aria-label={t('channel.botInstall.verificationLabel')} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" value={botInstall.verificationCode ?? ''} onChange={(event) => { const verificationCode = event.target.value.replace(/\D/gu, '').slice(0, 12); setBotInstall(current => current === null ? current : { ...current, verificationCode }) }}/></label><button type="button" className={css.primaryButton} disabled={!/^\d{4,12}$/u.test(botInstall.verificationCode ?? '')} onClick={() => { const active = activeBotInstall.current; if (active !== null) void pollDeviceInstall(active, botInstall.verificationCode) }}>{t('channel.botInstall.verificationSubmit')}</button></div>}{botInstall.officialDocumentationUrl !== undefined && <a href={botInstall.officialDocumentationUrl} target="_blank" rel="noopener noreferrer">{t('channel.botInstall.officialSetup')}</a>}<button type="button" className={css.textButton} onClick={cancelBotInstall}>{t('cancel')}</button></div>
    </section>}
    {attention.length > 0 && <section className={css.channelAttention} aria-label={t('channel.attentionAria')}>
      {attention.map(item => <button type="button" key={item.channel.channelId} aria-label={t('channel.attention.open', { name: item.channel.name, reason: item.reason })} onClick={() => { focusRecoveryAction(item.channel.channelId, item.target) }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); focusRecoveryAction(item.channel.channelId, item.target) } else if (event.key === ' ') event.preventDefault() }} onKeyUp={(event) => { if (event.key === ' ') { event.preventDefault(); focusRecoveryAction(item.channel.channelId, item.target) } }}>
        <IconWarningOutline16 size={16}/><strong>{item.channel.name}</strong><span>{item.reason}</span>
      </button>)}
    </section>}
    <PageBoundary page={page} t={t} empty={<ActionableEmpty title={t('channel.emptyTitle')} description={t('channel.emptyBody')}/>}>
      <div className={css.channelList}>{page.items.map((channel) => {
        const profile = CHANNEL_BINDING_PROFILES[channel.provider]
        const eligible = canBind(channel)
        const channelBinding = binding?.channelId === channel.channelId ? binding : null
        const verifiedIdentity = channel.boundProviderIdentityName ?? channel.boundProviderIdentityId
        const configurationReady = missingPrerequisites(channel).length === 0
        const recoverableBinding = channelBinding?.phase === 'error' || channelBinding?.phase === 'expired'
        return <article className={css.channelRow} data-state={channel.state} key={channel.channelId} aria-label={channel.name}>
          <div className={css.channelIdentity}><span className={css.channelProvider}>{t(`channel.provider.${channel.provider}`)}</span><div><h3>{channel.name}</h3><p>{channel.channelId} · {channel.accountId}</p></div><div className={css.channelStatuses}><span className={css.channelState}>{t(`channel.state.${channel.state}`)}</span>{derivedStatusKeys(channel).map(key => <span key={key}>{t(key)}</span>)}</div></div>
          <div className={css.channelBindingGuide}>
            <p>{t(profile.guidanceKey)}</p>
            <a ref={(node) => { setRecoveryAction(channel.channelId, 'configuration', node) }} href={profile.officialDocsUrl} target="_blank" rel="noopener noreferrer">{t('channel.binding.docs')}</a>
            {profile.identityOnly && <strong>{t('channel.binding.wechatBoundary')}</strong>}
          </div>
          <div className={css.channelTransportGuide}><strong>{t('channel.transport.separate')}</strong><p>{t(`channel.transport.guidance.${channel.provider}`)}</p></div>
          {channelBinding !== null && <div className={css.channelBindingBanner} role={channelBinding.phase === 'error' || channelBinding.phase === 'expired' ? 'alert' : 'status'} data-phase={channelBinding.phase}>
            <span>{channelBinding.message ?? t(`channel.binding.phase.${channelBinding.phase}`)}</span>
            {recoverableBinding && <button type="button" className={css.textButton} data-recovery-target="binding" ref={(node) => { setRecoveryAction(channel.channelId, 'binding', node) }} disabled={!eligible || bindingBusy} onClick={() => { if (eligible && !bindingBusy) void beginBinding(channel) }}>{t('channel.binding.retry')}</button>}
          </div>}
          <div className={css.connectionPath} role="group" aria-label={t('channel.factsAria', { name: channel.name })}>
            <span><small>{t('channel.truth.configuration')}</small><strong data-status={configurationReady ? 'configured' : 'missing'}>{configurationReady ? t('channel.binding.ready') : t('channel.binding.missing')}</strong><em className={css.channelPrerequisiteDetail}>{prerequisiteDetail(channel)}</em></span><i aria-hidden="true"/><span><small>{t('channel.truth.identity')}</small><strong data-status={channel.bindingStatus === 'verified' ? 'configured' : 'missing'}>{channel.bindingStatus === 'verified' ? t('channel.binding.verified') : t('channel.binding.unbound')}</strong><em className={css.channelPrerequisiteDetail}>{channelBinding === null ? t(profile.qrKey) : channelBinding.message ?? t(`channel.binding.phase.${channelBinding.phase}`)}</em></span><i aria-hidden="true"/><span><small>{t('channel.truth.route')}</small><strong>{channel.defaultEmployeeReleaseId ?? t('channel.routeWorkbench')}</strong></span><i aria-hidden="true"/><span><small>{t('channel.truth.transport')}</small><strong>{t('channel.transportUnverified')}</strong><em className={css.channelPrerequisiteDetail}>{t('channel.transportUnverifiedDetail')}</em></span>
          </div>
          {channel.bindingStatus === 'verified' && <div className={css.channelBindingEvidence}>
            <strong>{verifiedIdentity ?? t('channel.binding.identityFallback')}</strong>
            <span>{t('channel.binding.identityId', { id: channel.boundProviderIdentityId ?? t('channel.binding.notRecorded') })}</span>
            <span>{t('channel.binding.tenantEvidence', { id: channel.verifiedTenantId ?? t('channel.binding.notRecorded') })}</span>
            <span>{t('channel.binding.actorEvidence', { actor: channel.bindingVerifiedBy ?? t('channel.binding.notRecorded'), time: channel.bindingVerifiedAt === undefined ? t('channel.binding.notRecorded') : formatDate(channel.bindingVerifiedAt) })}</span>
          </div>}
          <div className={css.channelIntentRow}><span>{t('channel.allowedIntents')}</span><div>{channel.allowedIntents.map(intent => <span key={intent}>{t(`channel.intent.${intent}`)}</span>)}</div>{!channel.inboundEnabled && <em>{t('channel.outboundOnly')}</em>}</div>
          <div className={css.channelActions}><span>{t('channel.revision', { revision: channel.revision })}</span><button type="button" className={css.primaryButton} data-recovery-target="binding" ref={recoverableBinding ? undefined : (node) => { setRecoveryAction(channel.channelId, 'binding', node) }} disabled={!eligible || bindingBusy} onClick={() => { if (eligible && !bindingBusy) void beginBinding(channel) }}>{channel.bindingStatus === 'verified' ? t('channel.binding.rebind') : t(profile.actionKey)}</button>{channel.state === 'active' && <button type="button" className={css.secondaryButton} aria-label={t('channel.pauseAria', { name: channel.name })} disabled={busy} onClick={() => { void api.saveChannelConfiguration({ channelId: channel.channelId, name: channel.name, provider: channel.provider, ...(channel.tenantId === undefined ? {} : { tenantId: channel.tenantId }), accountId: channel.accountId, ...(channel.credentialRef === undefined ? {} : { credentialRef: channel.credentialRef }), ...(channel.defaultEmployeeReleaseId === undefined ? {} : { defaultEmployeeReleaseId: channel.defaultEmployeeReleaseId }), inboundEnabled: channel.inboundEnabled, state: 'paused', expectedRevision: channel.revision }) }}>{t('channel.pause')}</button>}{channel.state === 'paused' && <button type="button" className={css.primaryButton} disabled={busy || channel.credentialStatus !== 'configured'} onClick={() => { void api.saveChannelConfiguration({ channelId: channel.channelId, name: channel.name, provider: channel.provider, ...(channel.tenantId === undefined ? {} : { tenantId: channel.tenantId }), accountId: channel.accountId, ...(channel.credentialRef === undefined ? {} : { credentialRef: channel.credentialRef }), ...(channel.defaultEmployeeReleaseId === undefined ? {} : { defaultEmployeeReleaseId: channel.defaultEmployeeReleaseId }), inboundEnabled: channel.inboundEnabled, state: 'active', expectedRevision: channel.revision }) }}>{t('channel.resume')}</button>}<button type="button" className={css.secondaryButton} aria-label={t('channel.archiveAria', { name: channel.name })} disabled={busy || channel.state === 'archived'} onClick={() => { void api.archiveChannelConfiguration(channel) }}>{t('channel.archive')}</button></div>
        </article>
      })}</div>
    </PageBoundary>
  </section>
}

function ChannelsPage({ page, releases, api, busy, renderEmployeeChannels, t }: {
  page: EnterprisePageState<EnterpriseChannelConfiguration>
  releases: readonly EnterpriseEmployeeRelease[]
  api: EnterpriseWorkbenchInjected
  busy: boolean
  renderEmployeeChannels: EnterpriseWorkbenchProps['renderSlot']
  t: Translate
}) {
  const employees = latestEmployeeReleases(releases)
  const [selectedPresetId, setSelectedPresetId] = useState(employees[0]?.presetId ?? '')
  const selected = employees.find(release => release.presetId === selectedPresetId) ?? employees[0]
  useEffect(() => {
    if (selected !== undefined && selected.presetId !== selectedPresetId) setSelectedPresetId(selected.presetId)
  }, [selected, selectedPresetId])
  if (selected === undefined) {
    return <NativeChannelsPage page={page} api={api} busy={busy} t={t}/>
  }
  const draft = { profile: selected.snapshot.profile } as EnterpriseEmployeeDraft
  const name = profileText(draft, 'name', selected.presetId)
  const position = profileText(draft, 'position')
  const employee = {
    presetId: selected.presetId,
    releaseId: selected.releaseId,
    name,
    ...(position === '' ? {} : { position }),
  }
  return <section className={css.channelPage} aria-labelledby="channel-page-title">
    <ManagementHeader id="channel-page-title" title={t('channel.title')} description={t('channel.employee.description')} count={page.items.length}/>
    <div className={css.channelEmployeeSwitcher} role="group" aria-label={t('channel.employee.select')}>
      {employees.map((release) => {
        const releaseDraft = { profile: release.snapshot.profile } as EnterpriseEmployeeDraft
        const releaseName = profileText(releaseDraft, 'name', release.presetId)
        const releasePosition = profileText(releaseDraft, 'position')
        const avatarSeed = profileText(releaseDraft, 'avatarSeed', release.presetId)
        return <button type="button" className={css.channelEmployeeOption} aria-pressed={release.presetId === selected.presetId} key={release.presetId} onClick={() => { setSelectedPresetId(release.presetId) }}>
          <EmployeeAvatar name={releaseName} seed={avatarSeed} t={t}/>
          <span><strong>{releaseName}</strong>{releasePosition !== '' && <small>{releasePosition}</small>}</span>
        </button>
      })}
    </div>
    {renderEmployeeChannels('enterprise.employee-channels', { employee }, {
      fallback: <NativeChannelsPage page={page} api={api} busy={busy} t={t}/>,
    })}
  </section>
}

const EXTENSION_SECTION = {
  running: 'running', personal: 'personal', department: 'department', organization: 'organization',
  formal: 'formal', reviews: 'reviews',
} as const
type ExtensionSection = typeof EXTENSION_SECTION[keyof typeof EXTENSION_SECTION]

function extensionScope(pkg: CordisPackageVersion, t: Translate): string {
  if (pkg.scope.type === 'personal-workspace') return t('extensions.scope.personal')
  if (pkg.scope.type === 'department') return t('extensions.scope.department')
  if (pkg.scope.type === 'organization') return t('extensions.scope.organization')
  return t('extensions.scope.session')
}

function sameExtensionScope(left: CordisPackageVersion['scope'], right: CordisScopeBinding['scope']): boolean {
  if (left.type !== right.type) return false
  if (left.type === 'personal-workspace' && right.type === 'personal-workspace') {
    return left.workspaceId === right.workspaceId && left.ownerUserId === right.ownerUserId
  }
  if (left.type === 'department' && right.type === 'department') return left.departmentId === right.departmentId
  if (left.type === 'organization' && right.type === 'organization') return left.organizationId === right.organizationId
  if (left.type === 'session' && right.type === 'session') return left.sessionId === right.sessionId
  return false
}

function ExtensionsPage({ state, workspaces, api, busy, t }: {
  state: EnterpriseWorkbenchState
  workspaces: WorkspaceSnapshot
  api: EnterpriseWorkbenchInjected
  busy: boolean
  t: Translate
}) {
  const [section, setSection] = useState<ExtensionSection>(EXTENSION_SECTION.running)
  const [reason, setReason] = useState('')
  const formalPlugins = state.formalPlugins.items.filter(plugin =>
    plugin.installSource !== undefined || plugin.protectedProfile === true)
  const bindingFor = (pkg: CordisPackageVersion): CordisScopeBinding | undefined => state.extensionBindings.find(binding =>
    binding.pluginId === pkg.pluginId && sameExtensionScope(pkg.scope, binding.scope))
  const packagesByPlugin = new Map<string, CordisPackageVersion[]>()
  for (const pkg of state.extensions.items) {
    const rows = packagesByPlugin.get(pkg.pluginId) ?? []
    rows.push(pkg)
    packagesByPlugin.set(pkg.pluginId, rows)
  }
  const packages = section === EXTENSION_SECTION.running
    ? state.extensions.items.filter((pkg) => {
      const binding = bindingFor(pkg)
      return binding?.activePackageId === pkg.packageId && !binding.disabled
    })
    : state.extensions.items.filter(pkg => pkg.scope.type === (section === EXTENSION_SECTION.personal
      ? 'personal-workspace' : section === EXTENSION_SECTION.department ? 'department' : 'organization'))
  const tabs: readonly [ExtensionSection, EnterpriseWorkbenchKey][] = [
    [EXTENSION_SECTION.running, 'extensions.running'], [EXTENSION_SECTION.personal, 'extensions.personal'],
    [EXTENSION_SECTION.department, 'extensions.department'], [EXTENSION_SECTION.organization, 'extensions.organization'],
    [EXTENSION_SECTION.formal, 'extensions.formal'], [EXTENSION_SECTION.reviews, 'extensions.reviews'],
  ]
  return <section aria-labelledby="extensions-page-title">
    <div className={css.extensionHeader}>
      <div><h2 id="extensions-page-title">{t('extensions.title')}</h2><p>{t('extensions.description')}</p></div>
      <div className={css.extensionWorkspace}>
        <label>{t('extensions.workspace')}<select value={state.extensionWorkspaceId ?? ''}
          onChange={(event) => { api.setExtensionWorkspace(event.target.value) }}>
          {workspaces.items.map(workspace => <option key={workspace.workspaceId} value={workspace.workspaceId}>{workspace.title}</option>)}
        </select></label>
        <button type="button" className={css.secondaryButton} disabled={busy}
          onClick={() => { void api.refreshExtensions() }}><IconRefreshOutline16 size={16} />{t('refresh')}</button>
      </div>
    </div>
    <nav className={css.extensionTabs} aria-label={t('extensions.sections')}>
      {tabs.map(([id, key]) => <button type="button" key={id} aria-current={section === id ? 'page' : undefined}
        onClick={() => { setSection(id) }}>{t(key)}</button>)}
    </nav>
    {section === EXTENSION_SECTION.formal
      ? <PageBoundary page={{ ...state.formalPlugins, items: formalPlugins }} t={t}><div className={css.extensionList}>
        {formalPlugins.map(plugin => <article className={css.extensionRow} key={plugin.entryId}>
          <div className={css.extensionIdentity}><strong>{plugin.moduleName}</strong><span>{plugin.entryId}</span>
            <p>{t('extensions.formalDescription')}</p></div>
          <div className={css.extensionMeta}>
            <span>{plugin.enabled ? t('extensions.formalEnabled') : t('extensions.formalDisabled')}</span>
            <span>{plugin.fiberPhase === 'active' ? t('extensions.formalActive')
              : plugin.fiberPhase === 'failed' ? t('extensions.formalFailed')
                : plugin.fiberPhase === 'pending' ? t('extensions.formalPending') : t('extensions.formalUnobserved')}</span>
            {plugin.installSource !== undefined && <span>{t(plugin.installSource.kind === 'registry'
              ? 'extensions.formalRegistry' : plugin.installSource.kind === 'tgz'
                ? 'extensions.formalTgz' : plugin.installSource.kind === 'git'
                  ? 'extensions.formalGit' : 'extensions.formalFile')}</span>}
            {plugin.protectedProfile === true && <span>{t('extensions.formalProtected')}</span>}
          </div>
        </article>)}
      </div></PageBoundary>
      : section === EXTENSION_SECTION.reviews
        ? <PageBoundary page={state.extensionReviews} t={t}><div className={css.extensionList}>
          {state.extensionReviews.items.map(review => <article className={css.extensionRow} key={review.reviewId}>
            <div className={css.extensionIdentity}><strong>{review.pluginId}</strong><span>{review.departmentId} · {t(`extensions.review.${review.status}`)}</span></div>
            <div className={css.extensionMeta}><span>{t('extensions.submittedBy', { user: review.submittedBy })}</span><span>{formatDate(review.updatedAt)}</span></div>
            {(review.status === 'pending' || review.status === 'changes-requested' || review.status === 'approved-department') && <div className={css.extensionReviewActions}>
              <label>{t('extensions.reason')}<input value={reason} onChange={(event) => { setReason(event.target.value) }} /></label>
              {review.status !== 'approved-department' && <button type="button" className={css.primaryButton} disabled={busy || reason.trim() === ''}
                onClick={() => { void api.reviewExtension(review, 'approve', reason) }}>{t('extensions.approve')}</button>}
              <button type="button" className={css.secondaryButton} disabled={busy || reason.trim() === ''}
                onClick={() => { void api.reviewExtension(review, 'return', reason) }}>{t('extensions.return')}</button>
              <button type="button" className={css.secondaryButton} disabled={busy}
                onClick={() => { void api.reviewExtension(review, 'publish', reason) }}>{t('extensions.publish')}</button>
            </div>}
          </article>)}
        </div></PageBoundary>
        : <PageBoundary page={{ ...state.extensions, items: packages }} t={t}><div className={css.extensionList}>
          {packages.map((pkg) => {
            const binding = bindingFor(pkg)
            const versions = packagesByPlugin.get(pkg.pluginId)?.toSorted((left, right) => right.version - left.version) ?? []
            const previous = versions.find(version => version.version < pkg.version)
            const active = binding?.activePackageId === pkg.packageId && !binding.disabled
            return <article className={css.extensionRow} key={pkg.packageId} data-active={active}>
              <div className={css.extensionIdentity}><strong>{pkg.name}</strong><span>{pkg.pluginId} · {t('extensions.version', { version: pkg.version })} · {extensionScope(pkg, t)}</span><p>{pkg.purpose}</p></div>
              <div className={css.extensionCapabilities}>{pkg.manifest.provides.map(capability => <span key={capability}>{capability}</span>)}</div>
              <div className={css.extensionMeta}><span>{active ? t('extensions.status.running') : binding?.disabled === true ? t('extensions.status.stopped') : t('extensions.status.available')}</span><span>{binding?.trustLevel === 'trusted-in-process' ? t('extensions.trust.trusted') : t('extensions.trust.isolated')}</span><span>{t('extensions.author', { user: pkg.authoredBy })}</span></div>
              <details className={css.extensionSource}><summary>{t('extensions.source')}</summary>{pkg.hostCode !== undefined && <pre>{pkg.hostCode}</pre>}{pkg.clientCode !== undefined && <pre>{pkg.clientCode}</pre>}</details>
              {binding !== undefined && <div className={css.inlineActions}>
                {!binding.disabled && <button type="button" className={css.secondaryButton} disabled={busy}
                  onClick={() => { void api.stopExtension(binding, t('extensions.stopReason')) }}>{t('extensions.stop')}</button>}
                {previous !== undefined && <button type="button" className={css.secondaryButton} disabled={busy}
                  onClick={() => { void api.rollbackExtension(binding, previous.packageId, t('extensions.rollbackReason')) }}>{t('extensions.rollback', { version: previous.version })}</button>}
              </div>}
            </article>
          })}
        </div></PageBoundary>}
  </section>
}

export function EnterpriseWorkbench(props: EnterpriseWorkbenchProps) {
  const state = props.useEnterprise(snapshot => snapshot); const dialogRef = useRef<HTMLElement>(null); const closeRef = useRef<HTMLButtonElement>(null); const page = state.page
  const workspaces = props.useWorkspaces(snapshot => snapshot)
  const emptyControlPage = { phase: 'ready', items: [], error: null } as const
  const compatibleState = state as unknown as {
    readonly teamDefinitions?: EnterprisePageState<EnterpriseTeamDefinition>
    readonly teamRuns?: EnterprisePageState<EnterpriseTeamRun>
    readonly teamDecisions?: EnterprisePageState<EnterpriseTeamDecision>
    readonly teamAutonomy?: EnterprisePageState<EnterpriseTeamAutonomyGrant>
    readonly channels?: EnterprisePageState<EnterpriseChannelConfiguration>
    readonly devices?: EnterprisePageState<EnterpriseDeviceView>
  }
  const teamDefinitions = compatibleState.teamDefinitions ?? emptyControlPage
  const teamRuns = compatibleState.teamRuns ?? emptyControlPage
  const teamDecisions = compatibleState.teamDecisions ?? emptyControlPage
  const teamAutonomy = compatibleState.teamAutonomy ?? emptyControlPage
  const channels = compatibleState.channels ?? emptyControlPage
  const devices = compatibleState.devices ?? emptyControlPage
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
  const pages = [state.employees, devices, state.workRecords, state.approvals, teamDefinitions, teamRuns,
    teamDecisions, teamAutonomy, state.schedules, state.assets, state.teams, channels,
    state.extensions, state.extensionReviews, state.formalPlugins]
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
    saveTeamDefinition: async (input) => {
      const success = await injected.saveTeamDefinition(input)
      if (success) setLocalFormDirty(false)
      return success
    },
    saveTeamDefinitionDraft: async (input) => {
      const saved = await injected.saveTeamDefinitionDraft(input)
      if (saved !== undefined) setLocalFormDirty(false)
      return saved
    },
    publishTeamDefinitionDraft: async (input) => {
      const published = await injected.publishTeamDefinitionDraft(input)
      if (published !== undefined) setLocalFormDirty(false)
      return published
    },
    saveChannelConfiguration: async (input) => {
      const success = await injected.saveChannelConfiguration(input)
      if (success) setLocalFormDirty(false)
      return success
    },
  }
  return <section ref={dialogRef} className={css.workbench} role="dialog" aria-modal="true" aria-label={props.t('title')} onKeyDown={onKeyDown}><header className={css.header}><div><h1><EnterpriseBrand heading label={props.t('title')} /></h1><p>{props.t('subtitle')}</p></div><div className={css.headerActions}><button type="button" className={css.iconButton} aria-label={props.t('refresh')} onClick={() => { void props.refresh() }}><IconRefreshOutline16 size={16} /></button><button ref={closeRef} type="button" className={css.iconButton} aria-label={props.t('close')} onClick={requestClose}><IconCloseOutline16 size={16} /></button></div></header>
    {state.mutationError !== null && <div className={css.mutationError} role="alert" aria-label={props.t('mutation.errorAria')}><IconWarningOutline16 size={18} /><span>{state.mutationPhase === 'conflict' ? props.t('mutation.conflict') : state.mutationError}</span>{state.mutationPhase === 'conflict' ? <button type="button" onClick={() => { void props.resolveMutationConflict() }}>{props.t('mutation.reload')}</button> : <button type="button" onClick={() => { void props.retryMutation() }}>{props.t('mutation.retry')}</button>}<button type="button" onClick={props.dismissMutationError}>{props.t('mutation.dismiss')}</button></div>}
    {state.phase === 'loading' && state.mode === null && <div className={css.loading} role="status"><span className={css.skeleton} />{props.t('loading')}</div>}
    {state.phase === 'error' && <div className={css.error} role="alert"><IconWarningOutline16 size={18} /><span>{state.error}</span><button type="button" onClick={() => { void props.refresh() }}>{props.t('retry')}</button></div>}
    {state.phase !== 'error' && state.mode === 'fallback' && <main className={css.body}><FallbackPage state={state} start={props.startEmployee} open={props.openRecord} t={props.t} /></main>}
    {state.phase !== 'error' && state.mode === 'enterprise' && <div className={css.shell}>
      <nav className={css.nav} aria-label={props.t('nav.aria')}>{NAV_GROUPS.map(group => <div className={css.navGroup} key={group.label}><span>{props.t(group.label)}</span>{group.items.map(([id, key]) => <button type="button" key={id} aria-current={page === id ? 'page' : undefined} onClick={() => { requestPage(id) }}>{props.t(key)}</button>)}</div>)}</nav>
      <main className={css.main}>
        {partial && <div className={css.notice} role="status">{props.t('partial')}</div>}
        {page === 'employees' && <><StartWorkPanel workspaces={workspaces} releases={state.releases} prepareWork={props.prepareWork} startPreparedWork={props.startPreparedWork} onStarted={(sessionId) => { props.openRecord(sessionId as SessionId); props.close() }} t={props.t}/><EmployeesPage state={state} api={api} guardDirty={guardDirty} renderEmployeeKnowledgeBindings={props.renderSlot} t={props.t} /><EmployeeDirectory staff={state.staff} memories={state.staffMemories} loadEmployees={props.loadEmployees} loadEmployeeMemories={props.loadEmployeeMemories} reviewEmployeeMemory={props.reviewEmployeeMemory} retireEmployeeMemory={props.retireEmployeeMemory} sendMessage={props.sendMessage} selectEmployee={props.selectEmployee} t={props.t}/></>}
        {page === 'projects' && <ProjectSpace projects={state.projects} surfaces={state.surfaces} loadProjects={props.loadProjects} loadSurfaces={props.loadSurfaces} createProject={props.createProject} selectProject={props.selectProject} addProjectMember={props.addProjectMember} archiveProject={props.archiveProject} t={props.t}/>}
        {page === 'devices' && <DevicesPage page={devices} api={api} busy={mutationBusy} t={props.t}/>}
        {page === 'work-records' && <WorkRecordsPage page={state.workRecords} update={props.updateWorkRecord} busy={mutationBusy} t={props.t} />}
        {page === 'approvals' && <ApprovalsPage page={state.approvals} api={api} busy={mutationBusy} t={props.t} />}
        {page === 'attention' && <TeamAttentionPage page={teamDecisions} runs={teamRuns} definitions={teamDefinitions} api={api} busy={mutationBusy} t={props.t} />}
        {page === 'schedules' && <SchedulesPage page={state.schedules} releases={state.releases} api={api} busy={mutationBusy} onDirty={() => { setLocalFormDirty(true) }} t={props.t} />}
        {page === 'assets' && <AssetsPage page={state.assets} cordisCount={cordisExtensionCount(state)} api={api} busy={mutationBusy} onDirty={() => { setLocalFormDirty(true) }} openExtensions={() => { requestPage('extensions') }} renderKnowledgeAssets={props.renderSlot} t={props.t} />}
        {page === 'teams' && <>
          <TeamControlPanel definitions={teamDefinitions} runs={teamRuns} decisions={teamDecisions} autonomy={teamAutonomy} workspaces={workspaces} releases={state.releases} api={api} busy={mutationBusy} onDirty={() => { setLocalFormDirty(true) }} onClean={() => { setLocalFormDirty(false) }} t={props.t}/>
          <LegacyTeamsDisclosure initiallyOpen={teamDefinitions.items.length === 0} count={state.teams.items.length} t={props.t}>
            <TeamsPage embedded page={state.teams} releases={state.releases} api={api} busy={mutationBusy} onDirty={() => { setLocalFormDirty(true) }} t={props.t} />
          </LegacyTeamsDisclosure>
        </>}
        {page === 'channels' && <ChannelsPage page={channels} releases={state.releases} api={api} busy={mutationBusy} renderEmployeeChannels={props.renderSlot} t={props.t}/>}
        {page === 'extensions' && <ExtensionsPage state={state} workspaces={workspaces} api={api} busy={mutationBusy} t={props.t} />}
      </main>
    </div>}
  </section>
}
