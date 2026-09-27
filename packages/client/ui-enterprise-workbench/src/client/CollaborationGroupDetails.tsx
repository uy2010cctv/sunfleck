/** Group administration and membership sections inside the room details rail. */
import { useEffect, useState } from 'react'
import { IconCloseOutlineRegular, IconLoadingOutlineRegular, IconPlusOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CollaborationController, CollaborationDetail } from './collaboration-store.ts'
import type { CollaborationChoices } from './CollaborationNavigation.tsx'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { OrgPeoplePicker, useDirectories } from './RoomDirectoryPickers.tsx'
import css from './CollaborationRoom.module.css'

type Copy = TranslateNS<'enterprise.collaboration'>
type PickerMode = 'people' | 'employees'

/** Group sections for every member; editing and member changes render only for the group administrator. */
export function CollaborationGroupDetails({ detail, controller, loadChoices, t }: {
  readonly detail: CollaborationDetail
  /** Present only when the signed-in human administers this group. */
  readonly controller?: CollaborationController
  readonly loadChoices?: () => Promise<CollaborationChoices>
  readonly t: Copy
}) {
  const manage = controller
  const removeMember = manage === undefined ? undefined
    : (employeeIds: readonly string[], userIds: readonly string[]): Promise<boolean> =>
      manage.removeMembers(detail.id, employeeIds, userIds)
  const people = detail.humanMembers ?? detail.memberUserIds.map(userId => ({ userId, displayName: userId }))
  const [editing, setEditing] = useState<'name' | 'announcement' | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [adding, setAdding] = useState(false)
  const [choices, setChoices] = useState<CollaborationChoices>()
  const [employeePicks, setEmployeePicks] = useState<string[]>([])
  const [peoplePicks, setPeoplePicks] = useState<string[]>([])
  const [pickerMode, setPickerMode] = useState<PickerMode>('people')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [confirmEnd, setConfirmEnd] = useState(false)
  useEffect(() => {
    setEditing(null); setAdding(false); setPickerOpen(false); setConfirmEnd(false)
    setEmployeePicks([]); setPeoplePicks([])
  }, [detail.id])
  useEffect(() => {
    if (!adding || choices !== undefined || loadChoices === undefined) return
    let live = true
    void loadChoices().then((value) => { if (live) setChoices(value) })
      .catch(() => { if (live) setChoices({ workspaces: [], employees: [], people: [], teams: [], projects: [], peopleAvailable: false }) })
    return () => { live = false }
  }, [adding, choices, loadChoices])
  const toggle = (list: string[], id: string, checked: boolean): string[] => checked ? [...list, id] : list.filter(value => value !== id)
  const apply = async (action: () => Promise<boolean>, after?: () => void): Promise<void> => {
    setSaving(true)
    try { if (await action()) { setEditing(null); after?.() } } finally { setSaving(false) }
  }
  const joinableEmployees = choices === undefined ? []
    : choices.employees.filter(row => !detail.members.some(member => member.employeeId === row.id))
  const joinablePeople = choices === undefined || !choices.peopleAvailable ? []
    : choices.people.filter(row => !detail.memberUserIds.includes(row.id))

  return <>
    {manage !== undefined && <section>
      <div className={css.manageRow}><h3>{t('roomName')}</h3>
        {editing === null && <button type="button" onClick={() => { setDraft(detail.name); setEditing('name') }}>{t('edit')}</button>}
      </div>
      {editing === 'name' ? <div className={css.adminForm}>
        <input autoFocus value={draft} maxLength={120} disabled={saving} aria-label={t('roomName')}
          onChange={(event) => { setDraft(event.target.value) }}/>
        <div className={css.adminActions}>
          <button type="button" disabled={saving || draft.trim() === '' || draft.trim() === detail.name}
            onClick={() => { void apply(() => manage.rename(detail.id, draft.trim())) }}>{t('save')}</button>
          <button type="button" disabled={saving} onClick={() => { setEditing(null) }}>{t('cancel')}</button>
        </div>
      </div> : <p>{detail.name}</p>}
    </section>}
    <section>
      <div className={css.manageRow}><h3>{t('groupAnnouncement')}</h3>
        {manage !== undefined && editing === null && <button type="button"
          onClick={() => { setDraft(detail.announcement ?? ''); setEditing('announcement') }}>{t('edit')}</button>}
      </div>
      {editing === 'announcement' && manage !== undefined ? <div className={css.adminForm}>
        <textarea autoFocus rows={3} maxLength={2000} value={draft} placeholder={t('announcementPlaceholder')}
          disabled={saving} aria-label={t('groupAnnouncement')} onChange={(event) => { setDraft(event.target.value) }}/>
        <div className={css.adminActions}>
          <button type="button" disabled={saving}
            onClick={() => { void apply(() => manage.setAnnouncement(detail.id, draft.trim())) }}>{t('save')}</button>
          <button type="button" disabled={saving} onClick={() => { setEditing(null) }}>{t('cancel')}</button>
        </div>
      </div> : <p>{detail.announcement ?? t('noAnnouncement')}</p>}
    </section>
    <section>
      <div className={css.manageRow}>
        <h3>{t('people')}</h3>
        {manage !== undefined && <button type="button" className={css.sectionAdd} aria-label={t('addPeople')}
          onClick={() => { setPickerMode('people'); setPickerOpen(true) }}><IconPlusOutlineRegular size={12}/></button>}
      </div>
      <ul>{people.map(member => <li key={member.userId}>
        <span>{member.displayName}</span>
        {member.userId === detail.adminUserId ? <span className={css.badge}>{t('groupAdmin')}</span>
          : removeMember !== undefined && <button type="button" className={css.removeMember} disabled={saving}
            aria-label={`${t('removeMember')} ${member.displayName}`}
            onClick={() => { void apply(() => removeMember([], [member.userId])) }}>×</button>}
      </li>)}</ul>
    </section>
    <section>
      <div className={css.manageRow}>
        <h3>{t('employees')}</h3>
        {manage !== undefined && <button type="button" className={css.sectionAdd} aria-label={t('addEmployees')}
          onClick={() => { setPickerMode('employees'); setPickerOpen(true) }}><IconPlusOutlineRegular size={12}/></button>}
      </div>
      {detail.members.length === 0 ? <p>{t('emptyEmployees')}</p> : <ul>{detail.members.map(member => <li key={member.employeeId}>
        <span>{member.displayName}</span>
        <span className={css.memberMeta}>{detail.dutyEmployeeIds.includes(member.employeeId) && t('onDuty')}
          {removeMember !== undefined && <button type="button" className={css.removeMember} disabled={saving}
            aria-label={`${t('removeMember')} ${member.displayName}`}
            onClick={() => { void apply(() => removeMember([member.employeeId], [])) }}>×</button>}
        </span>
      </li>)}</ul>}
    </section>
    {manage !== undefined && <section>
      <div className={css.manageRow}>
        <h3>{t('addMembers')}</h3>
        <button type="button" aria-expanded={adding} onClick={() => { setAdding(!adding) }}>{adding ? t('cancel') : t('add')}</button>
      </div>
      {adding && (choices === undefined ? <p className={css.adminLoading}><IconLoadingOutlineRegular size={16}/></p>
        : <div className={css.addPicker}>
          <fieldset disabled={saving}><legend>{t('employees')}</legend>
            {joinableEmployees.length === 0 ? <p>{t('emptyEmployees')}</p> : joinableEmployees.map(row => <label key={row.id}>
              <input type="checkbox" checked={employeePicks.includes(row.id)}
                onChange={(event) => { setEmployeePicks(toggle(employeePicks, row.id, event.target.checked)) }}/>{row.name}</label>)}
          </fieldset>
          <fieldset disabled={saving}><legend>{t('people')}</legend>
            {choices.peopleAvailable ? joinablePeople.length === 0 ? <p>{t('noMembersToAdd')}</p> : joinablePeople.map(row => <label key={row.id}>
              <input type="checkbox" checked={peoplePicks.includes(row.id)}
                onChange={(event) => { setPeoplePicks(toggle(peoplePicks, row.id, event.target.checked)) }}/>{row.name}</label>)
              : <p>{t('peopleUnavailable')}</p>}
          </fieldset>
          <button type="button" disabled={saving || (employeePicks.length === 0 && peoplePicks.length === 0)}
            onClick={() => { void apply(() => manage.addMembers(detail.id, employeePicks, peoplePicks),
              () => { setEmployeePicks([]); setPeoplePicks([]) }) }}>{t('add')}</button>
        </div>)}
    </section>}
    {manage !== undefined && <MemberPickerModal detail={detail} controller={manage} t={t}
      open={pickerOpen} mode={pickerMode} onClose={() => { setPickerOpen(false) }}/>}
    <section className={css.endActions}>
      {!confirmEnd && <button type="button"
        className={manage !== undefined ? css.endDissolve : css.endLeave}
        onClick={() => { setConfirmEnd(true) }}>
        {manage !== undefined ? t('dissolve') : t('leave')}
      </button>}
      {confirmEnd && manage !== undefined && <div className={css.endConfirm}>
        <span>{t('dissolveConfirmText')}</span>
        <div className={css.adminActions}>
          <button type="button" className={css.endDanger} disabled={saving}
            onClick={() => { void manage.dissolveRoom(detail.id) }}>{t('confirmEnd')}</button>
          <button type="button" disabled={saving} onClick={() => { setConfirmEnd(false) }}>{t('cancel')}</button>
        </div>
      </div>}
    </section>
  </>
}

/** Modal picker: the org tree for people, a flat roster for digital employees. */
function MemberPickerModal({ detail, controller, t, open, mode, onClose }: {
  readonly detail: CollaborationDetail
  readonly controller: CollaborationController
  readonly open: boolean
  readonly mode: PickerMode
  readonly onClose: () => void
  readonly t: Copy
}) {
  const { departments, people, employees } = useDirectories()
  const [picked, setPicked] = useState<string[]>([])
  useEffect(() => { if (open) setPicked([]) }, [open, mode])
  if (!open) return null
  const available = mode === 'people' ? people : employees
  const loaded = mode === 'people' ? departments.length > 0 || people.length > 0 : employees.length > 0
  const nameOf = (id: string): string => available.find(row => row.id === id)?.name ?? id
  const toggle = (id: string): void => setPicked(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id])
  const confirm = (): void => {
    void controller.addMembers(detail.id, mode === 'employees' ? picked : [], mode === 'people' ? picked : [])
      .then((added) => { if (added) onClose() })
  }
  return <div className={css.pickerModal} role="dialog" aria-label={t(mode === 'people' ? 'pickerPeopleTitle' : 'pickerEmployeeTitle')}>
    <div className={css.pickerHeader}>
      <strong>{t(mode === 'people' ? 'pickerPeopleTitle' : 'pickerEmployeeTitle')}</strong>
      <button type="button" aria-label={t('closeDetails')} onClick={onClose}><IconCloseOutlineRegular size={14}/></button>
    </div>
    {mode === 'people'
      ? <OrgPeoplePicker people={people} departments={departments} picked={picked} onToggle={toggle}
        unassignedLabel={t('pickerUnassigned')}/>
      : <div className={css.pickerTree}>
        {!loaded ? <p className={css.pickerEmpty}><IconLoadingOutlineRegular size={14}/></p>
          : employees.length === 0 ? <p className={css.pickerEmpty}>{t('pickerEmpty')}</p>
            : employees.map(row => <label key={row.id} className={css.pickerRow}>
              <input type="checkbox" checked={picked.includes(row.id)} onChange={() => { toggle(row.id) }}/>
              <span>{row.name}</span>
            </label>)}
      </div>}
    {picked.length > 0 && <div className={css.pickerSelected}>
      {picked.map(id => <span key={id} className={css.pickerChip}>
        {nameOf(id)}
        <button type="button" aria-label={`${t('removeMember')} ${nameOf(id)}`} onClick={() => { toggle(id) }}>×</button>
      </span>)}
    </div>}
    <div className={css.pickerActions}>
      <button type="button" onClick={onClose}>{t('cancel')}</button>
      <button type="button" className={css.pickerConfirm} disabled={picked.length === 0} onClick={confirm}>{t('add')}</button>
    </div>
  </div>
}
