/** Shared group and channel management inside the existing room detail panel. */
import { useEffect, useState } from 'react'
import { Button, Input, Modal, IconLoadingOutlineRegular, IconSearchOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CollaborationController, CollaborationDetail } from './collaboration-store.ts'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { dicebearAvatarUrl } from './avatar.ts'
import { CollaborationGroupSchedules } from './CollaborationGroupSchedules.tsx'
import css from './RoomManagementDetails.module.css'

type Copy = TranslateNS<'enterprise.collaboration'>
type Dialog = { kind: 'name' | 'announcement' | 'people' | 'employees' | 'duty' | 'end' }
  | { kind: 'remove'; id: string; name: string; employee: boolean }
type Options = Awaited<ReturnType<CollaborationController['getMemberOptions']>>

/**
 * Render room information, eligible member selection and role-appropriate end actions.
 * @param props - authorized detail, shared room controller and translated labels.
 * @returns one management panel and its protected-focus dialog.
 */
export function CollaborationGroupDetails({ detail, controller, t }: {
  readonly detail: CollaborationDetail
  readonly controller: CollaborationController
  readonly t: Copy
}) {
  const admin = detail.viewerIsAdmin
  const channel = detail.kind === 'channel'
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [draft, setDraft] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<Options>()
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(false)
  const [loadVersion, setLoadVersion] = useState(0)
  const humans = detail.humanMembers ?? detail.memberUserIds.map(userId => ({ userId, displayName: userId }))
  const selecting = dialog?.kind === 'people' || dialog?.kind === 'employees'
  useEffect(() => { setDialog(null); setOptions(undefined); setPending(false); setError(false) }, [detail.id])
  useEffect(() => {
    if (!selecting) return
    let live = true
    setLoading(true); setLoadError(false)
    void controller.getMemberOptions(detail.id).then((value) => { if (live) setOptions(value) })
      .catch((_error: unknown) => { if (live) setLoadError(true) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [selecting, detail.id, controller, loadVersion])
  const open = (next: Dialog): void => {
    setError(false); setQuery(''); setPicked(next.kind === 'duty' ? [...detail.dutyEmployeeIds] : [])
    setDraft(next.kind === 'name' ? detail.name : next.kind === 'announcement' ? detail.announcement ?? '' : '')
    setDialog(next)
  }
  const close = (): void => { if (!pending) setDialog(null) }
  const run = async (): Promise<void> => {
    if (dialog === null || pending) return
    setPending(true); setError(false)
    let success = false
    try {
      switch (dialog.kind) {
        case 'name': success = await controller.rename(detail.id, draft.trim()); break
        case 'announcement': success = await controller.setAnnouncement(detail.id, draft.trim()); break
        case 'people': success = await controller.addMembers(detail.id, [], picked); break
        case 'employees': success = await controller.addMembers(detail.id, picked, []); break
        case 'duty': success = await controller.setDuty(detail.id, picked); break
        case 'remove': success = await controller.removeMembers(detail.id, dialog.employee ? [dialog.id] : [], dialog.employee ? [] : [dialog.id]); break
        case 'end': success = admin ? await controller.dissolveRoom(detail.id) : await controller.leaveRoom(detail.id); break
      }
      if (success) setDialog(null)
      else setError(true)
    } catch (_error: unknown) { setError(true) }
    finally { setPending(false) }
  }
  const endLabel = admin ? t(channel ? 'dissolveChannel' : 'dissolve') : t(channel ? 'leaveChannel' : 'leave')
  const title = dialog === null ? '' : dialog.kind === 'remove' ? t('removeMemberTitle', { name: dialog.name })
    : dialog.kind === 'end' ? endLabel : dialog.kind === 'name' ? t('editRoomName')
      : dialog.kind === 'announcement' ? t('editAnnouncement') : dialog.kind === 'duty' ? t('editDuty')
        : t(dialog.kind === 'people' ? 'addPeople' : 'addEmployees')
  const candidates = dialog?.kind === 'people' ? options?.people ?? [] : options?.employees ?? []
  const existing = dialog?.kind === 'people' ? detail.memberUserIds : detail.members.map(member => member.employeeId)
  const visible = candidates.filter(candidate => !existing.includes(candidate.id)
    && candidate.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  const invalid = dialog?.kind === 'name' ? draft.trim() === '' || draft.trim() === detail.name
    : selecting ? picked.length === 0 || loading || loadError : false
  return <div className={css.panel}>
    <section className={css.section}>
      <div className={css.heading}><h3>{t('basicInfo')}</h3></div>
      <div className={css.infoRow}><div><span className={css.label}>{t(channel ? 'channelName' : 'roomName')}</span>
        <p className={css.name}>{detail.name}</p></div>{admin && <Button size="sm" onClick={() => { open({ kind: 'name' }) }}>{t('editRoomName')}</Button>}</div>
      <div className={css.infoRow}><div><span className={css.label}>{t(channel ? 'channelAnnouncement' : 'groupAnnouncement')}</span>
        <p className={css.description}>{detail.announcement || t('noAnnouncement')}</p></div>{admin && <Button size="sm" onClick={() => { open({ kind: 'announcement' }) }}>{t('edit')}</Button>}</div>
    </section>
    <section className={css.section}>
      <div className={css.heading}><h3>{t('people')} <span>{humans.length}</span></h3>
        {admin && <Button size="sm" variant="outline" onClick={() => { open({ kind: 'people' }) }}>{t('addPeople')}</Button>}</div>
      <ul className={css.members}>{humans.map(member => <li key={member.userId}>
        <span className={css.avatar} aria-hidden="true">{member.displayName.slice(0, 1)}</span><span className={css.memberName}>{member.displayName}</span>
        {member.userId === detail.adminUserId ? <span className={css.badge}>{t('roomAdmin')}</span>
          : admin && <Button size="sm" aria-label={`${t('removeMember')} ${member.displayName}`}
            onClick={() => { open({ kind: 'remove', id: member.userId, name: member.displayName, employee: false }) }}>{t('remove')}</Button>}
      </li>)}</ul>
    </section>
    <section className={css.section}>
      <div className={css.heading}><h3>{t('employees')} <span>{detail.members.length}</span></h3>
        {admin && <Button size="sm" variant="outline" onClick={() => { open({ kind: 'employees' }) }}>{t('addEmployees')}</Button>}</div>
      {detail.members.length === 0 ? <p className={css.description}>{t('emptyEmployees')}</p>
        : <ul className={css.members}>{detail.members.map(member => <li key={member.employeeId}>
          <img className={css.avatar} src={dicebearAvatarUrl(member.avatarSeed ?? member.employeeId)} alt="" loading="lazy" referrerPolicy="no-referrer" />
          <span className={css.memberName}>{member.displayName}</span>
          {detail.dutyEmployeeIds.includes(member.employeeId) && <span className={css.badge}>{t('onDuty')}</span>}
          {admin && <Button size="sm" aria-label={`${t('removeMember')} ${member.displayName}`}
            onClick={() => { open({ kind: 'remove', id: member.employeeId, name: member.displayName, employee: true }) }}>{t('remove')}</Button>}
        </li>)}</ul>}
      {channel && detail.respondPolicy !== 'ingest_only' && <div className={css.dutyRow}>
        <span className={css.label}>{detail.dutyEmployeeIds.length > 0 ? t('dutyDescription') : t('noDuty')}</span>
        {admin && <Button size="sm" disabled={detail.members.length === 0} onClick={() => { open({ kind: 'duty' }) }}>{t('editDuty')}</Button>}
      </div>}
    </section>
    {!channel && <CollaborationGroupSchedules groupId={detail.id} canManage={admin} t={t}/>}
    <section className={css.endSection}>
      <h3>{t('roomActions')}</h3><p className={css.description}>{t(admin ? 'archiveRoomHint' : 'leaveRoomHint')}</p>
      <Button variant="outline" className={css.danger} onClick={() => { open({ kind: 'end' }) }}>{endLabel}</Button>
    </section>
    <Modal open={dialog !== null} title={title} closeLabel={t('closeDetails')} onClose={close} {...(css.dialog === undefined ? {} : { className: css.dialog })}
      {...(css.dialogContent === undefined ? {} : { contentClassName: css.dialogContent })}
      footer={<><Button disabled={pending} onClick={close}>{t('cancel')}</Button>
        <Button variant={dialog?.kind === 'end' || dialog?.kind === 'remove' ? 'outline' : 'primary'} className={dialog?.kind === 'end' || dialog?.kind === 'remove' ? css.danger : undefined}
          disabled={pending || invalid} onClick={() => { void run() }}>
          {pending && <IconLoadingOutlineRegular size={14} />}
          {dialog?.kind === 'end' ? t(admin ? 'confirmDissolve' : 'confirmLeave') : dialog?.kind === 'remove' ? t('confirmRemove') : selecting ? t('add') : t('save')}
        </Button></>}>
      <div className={css.dialogBody}>
        {error && <p className={css.error} role="alert">{t('requestFailed')}</p>}
        {dialog?.kind === 'name' && <Input data-modal-autofocus aria-label={t(channel ? 'channelName' : 'roomName')}
          value={draft} maxLength={120} disabled={pending} onChange={(event) => { setDraft(event.target.value) }} />}
        {dialog?.kind === 'announcement' && <textarea data-modal-autofocus aria-label={t('groupAnnouncement')} rows={5}
          value={draft} maxLength={2000} disabled={pending} onChange={(event) => { setDraft(event.target.value) }} />}
        {selecting && <>
          <Input data-modal-autofocus aria-label={t('searchMembers')} placeholder={t('searchMembers')}
            icon={<IconSearchOutlineRegular size={14} />} value={query} onChange={(event) => { setQuery(event.target.value) }} />
          {loading ? <div className={css.center}><IconLoadingOutlineRegular size={20} /></div>
            : loadError ? <div className={css.center}><p role="alert">{t('memberOptionsFailed')}</p>
              <Button onClick={() => { setLoadVersion(value => value + 1) }}>{t('retry')}</Button></div>
              : visible.length === 0 ? <p className={css.empty}>{t(query === '' ? 'noMembersToAdd' : 'noMemberMatches')}</p>
                : <div className={css.choices}>{visible.map(candidate => <label key={candidate.id}>
                  <input type="checkbox" checked={picked.includes(candidate.id)} disabled={pending}
                    onChange={(event) => {
                      setPicked(current => event.target.checked ? [...current, candidate.id] : current.filter(id => id !== candidate.id))
                    }} />
                  <span>{candidate.name}</span></label>)}</div>}
          <p className={css.label}>{t('selectedMembers', { count: picked.length })}</p>
        </>}
        {dialog?.kind === 'duty' && <div className={css.choices}>{detail.members.map(member => <label key={member.employeeId}>
          <input type="checkbox" checked={picked.includes(member.employeeId)} disabled={pending}
            onChange={(event) => {
              setPicked(current => event.target.checked ? [...current, member.employeeId] : current.filter(id => id !== member.employeeId))
            }} />
          <span>{member.displayName}</span></label>)}</div>}
        {dialog?.kind === 'remove' && <p>{t('removeMemberConfirm', { name: dialog.name })}</p>}
        {dialog?.kind === 'end' && <p>{t(admin ? 'archiveRoomConfirm' : 'leaveRoomConfirm', { name: detail.name })}</p>}
      </div>
    </Modal>
  </div>
}
