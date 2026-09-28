/** Shared group/channel room in the existing SUNFLECK main panel. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { IconCloseOutlineRegular, IconLoadingOutlineRegular, IconReactionAddOutlineRegular, IconSearchOutlineRegular, IconSendOutlineRegular, IconUsersOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CollaborationController, CollaborationState, RoomEvent, RoomPresentedFile } from './collaboration-store.ts'
import type { CollaborationChoices } from './CollaborationNavigation.tsx'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { ChannelWorkflowEditor } from './ChannelWorkflowEditor.tsx'
import { ChannelDecisionQueue } from './ChannelDecisionQueue.tsx'
import { CollaborationGroupDetails } from './CollaborationGroupDetails.tsx'
import { dicebearAvatarUrl } from './avatar.ts'
import { MarkdownText, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import 'emoji-picker-element'
import css from './CollaborationRoom.module.css'

type Copy = TranslateNS<'enterprise.collaboration'>

declare global {
  namespace JSX {
    interface IntrinsicElements {
      /** Open-source emoji picker web component (emoji-picker-element). */
      'emoji-picker': { class?: string | undefined; ref?: React.Ref<HTMLElement | null> }
    }
  }
}

/** One visible emoji reaction group on a message. */
export interface ReactionSummary { readonly emoji: string; readonly count: number; readonly mine: boolean }

/** Summarize reactions by target: only each author's latest reaction counts, so a
 * viewer adding another emoji replaces their previous one in the display. */
export function reactionSummaries(events: readonly RoomEvent[], targetId: string,
  viewerId?: string): readonly ReactionSummary[] {
  const latest = new Map<string, string>()
  for (const event of events) {
    if (event.kind !== 7 || !event.tags.some(tag => tag[0] === 'e' && tag[1] === targetId)) continue
    latest.set(event.author.id, event.content)
  }
  const groups = new Map<string, { count: number; mine: boolean }>()
  for (const [authorId, emoji] of latest) {
    const group = groups.get(emoji) ?? { count: 0, mine: false }
    group.count += 1
    if (viewerId !== undefined && authorId === viewerId) group.mine = true
    groups.set(emoji, group)
  }
  return [...groups].map(([emoji, group]) => ({ emoji, count: group.count, mine: group.mine }))
}

/** Employee identity chip shown on the triggering message while the agent works. */
export interface WorkingChip { readonly employeeId: string; readonly displayName: string; readonly avatarUrl?: string }

/** One rendered timeline row: the event plus any grouped agent execution state. */
interface TimelineItem {
  readonly event: RoomEvent
  /** Agent tool/progress events and follow-up messages folded into this final answer, collapsed by default. */
  workflowDetails?: RoomEvent[]
  /** Agents mentioned by this human message that have not replied yet. */
  readonly working?: readonly WorkingChip[]
  /** In channels, agent replies that belong to this message's thread. */
  readonly threadReplies?: readonly RoomEvent[]
}

/** Drop the model-generated reply meta prefix (回复/回应 variants) from an employee answer.
 * A message that is nothing but the meta line keeps its original content. */
export function stripReplyBoilerplate(content: string): string {
  const stripped = content.replace(/^已在房间回[复应][（(][^）)]*[)）][，,、。]?\s*/, '')
  return stripped.trim() === '' ? content : stripped
}

function Entry({ event, reactions, self, avatarUrl, attachmentUrlFor, workflowDetails, working, threadReplies, presented,
  threadAvatarFor = () => undefined, onThread, onReaction, onInspect, t }: {
  readonly event: RoomEvent
  readonly reactions: readonly ReactionSummary[]
  readonly self: boolean
  readonly avatarUrl: string | undefined
  readonly attachmentUrlFor: (attachmentId: string) => string
  readonly workflowDetails?: readonly RoomEvent[]
  readonly working?: readonly WorkingChip[]
  readonly threadReplies?: readonly RoomEvent[]
  readonly presented?: readonly RoomPresentedFile[]
  readonly threadAvatarFor?: (authorId: string) => string | undefined
  readonly onThread: (id: string) => void
  readonly onReaction: (id: string, emoji: string) => void
  readonly onInspect: (id: string) => void
  readonly t: Copy
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerRef = useRef<HTMLElement | null>(null)
  const floatRef = useRef<HTMLDivElement | null>(null)
  const addReactionRef = useRef<HTMLButtonElement | null>(null)
  const [pickerAnchor, setPickerAnchor] = useState<{ top: number; left: number } | undefined>(undefined)
  const markdownLabels: MarkdownLabels = {
    code: { copyLabel: t('markdownCopy'), copiedLabel: t('markdownCopied') },
    footnotes: t('markdownFootnotes'),
  }
  const mine = reactions.find(reaction => reaction.mine)
  const openReactionPicker = (): void => {
    const rect = addReactionRef.current?.getBoundingClientRect()
    if (rect !== undefined) {
      const width = Math.min(globalThis.innerWidth - 16, 380)
      const height = 430
      const left = Math.min(Math.max(8, rect.right - width), globalThis.innerWidth - width - 8)
      const below = rect.bottom + 8
      setPickerAnchor(globalThis.innerHeight - below > height || rect.top < height
        ? { top: below, left }
        : { top: Math.max(8, rect.top - height - 8), left })
    }
    setPickerOpen(true)
  }
  useEffect(() => {
    if (!pickerOpen) return
    const node = pickerRef.current
    if (node === null) return
    const onPick = (custom: Event): void => {
      const detail = (custom as CustomEvent<{ unicode: string }>).detail
      if (typeof detail.unicode === 'string' && detail.unicode !== '') {
        onReaction(event.id, detail.unicode)
        setPickerOpen(false)
      }
    }
    node.addEventListener('emoji-click', onPick)
    return () => { node.removeEventListener('emoji-click', onPick) }
  }, [pickerOpen, event.id, onReaction])
  useEffect(() => {
    if (!pickerOpen) return
    const node = pickerRef.current
    const float = floatRef.current
    const close = (): void => setPickerOpen(false)
    const onKey = (press: { key: string }): void => { if (press.key === 'Escape') setPickerOpen(false) }
    const onPointer = (down: Event): void => {
      const target = down.target
      // The toggle button owns the open/close decision; picker and float own picks.
      if (target instanceof Node
        && ((node !== null && node.contains(target)) || (float !== null && float.contains(target))
          || (addReactionRef.current !== null && addReactionRef.current.contains(target)))) return
      setPickerOpen(false)
    }
    // The picker anchors to the triggering row; scrolling detaches it.
    let owner: Element | null = addReactionRef.current
    while (owner !== null && getComputedStyle(owner).overflow !== 'auto' && getComputedStyle(owner).overflowY !== 'auto') owner = owner.parentElement
    owner?.addEventListener('scroll', close, { once: true })
    document.addEventListener('pointerdown', onPointer, true)
    document.addEventListener('keydown', onKey)
    return () => {
      owner?.removeEventListener('scroll', close)
      document.removeEventListener('pointerdown', onPointer, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [pickerOpen])
  const workflow = event.kind !== 9
  const workflowStatus = event.tags.find(tag => tag[0] === 'status')?.[1]
  const time = new Date(event.created_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return <article className={`${css.entry} ${self ? css.entrySelf : ''} ${workflow ? css.workflow : ''}`} data-event-id={event.id}>
    {avatarUrl !== undefined
      ? <img className={`${css.avatar} ${event.author.kind === 'employee' ? css.bot : ''}`} src={avatarUrl}
        alt={event.author.displayName} loading="lazy" referrerPolicy="no-referrer"/>
      : <span className={`${css.avatar} ${event.author.kind === 'employee' ? css.bot : event.author.kind === 'service' ? css.service : ''}`} aria-hidden="true">{event.author.displayName.slice(0, 1)}</span>}
    <div className={css.entryBody}>
      <div className={css.meta}><span className={css.author}>{event.author.displayName}</span><span className={css.kind}>{t(event.author.kind === 'employee' ? 'botMember' : event.author.kind === 'service' ? 'serviceMember' : 'humanMember')}</span><time dateTime={new Date(event.created_at * 1000).toISOString()}>{time}</time>{workflow && <span className={css.kind}>{t('workflowEvent')}</span>}{workflowStatus !== undefined && <span className={css.kind}>{workflowStatus}</span>}
        {event.kind === 9 && <span className={css.reactionRow}>
          {reactions.map(reaction => <button type="button" key={reaction.emoji} aria-label={`${reaction.emoji} ${reaction.count}`}
            className={reaction.mine ? css.reactionMine : undefined}
            onClick={() => { if (!reaction.mine) onReaction(event.id, reaction.emoji) }}>{reaction.emoji}{reaction.count > 1 ? ` ${reaction.count}` : ''}</button>)}
          <span className={css.reactionWrap}>
            <button type="button" aria-label={t('reactTo')} aria-expanded={pickerOpen}
              ref={addReactionRef}
              className={`${css.reactionAdd} ${mine === undefined ? css.reactionGhost : ''}`}
              onClick={() => { if (pickerOpen) setPickerOpen(false); else openReactionPicker() }}>
              {mine === undefined ? <IconReactionAddOutlineRegular size={14}/> : mine.emoji}</button>
            {pickerOpen && createPortal(
              <div ref={floatRef} className={css.emojiFloat}
                style={pickerAnchor === undefined ? undefined : { top: pickerAnchor.top, left: pickerAnchor.left }}>
                <emoji-picker ref={pickerRef} class={css.emojiPickerFloat}/>
              </div>, document.body)}
          </span>
        </span>}
      </div>
      {event.author.kind === 'employee'
        ? <div className={css.contentMarkdown}><MarkdownText text={stripReplyBoilerplate(event.content)} labels={markdownLabels}/></div>
        : <p className={css.content}>{event.content}</p>}
      {presented !== undefined && presented.length > 0 && <div className={css.fileCards}>{presented.map(file => (
        <div className={css.fileCardInner}>
          <span className={css.fileCardIcon} aria-hidden="true">{(file.path.split('.').pop() ?? '').slice(0, 4).toUpperCase()}</span>
          <span className={css.fileCardBody}>
            <span className={css.fileCardName}>{file.path.split('/').pop() ?? file.path}</span>
            {file.description !== undefined && <span className={css.fileCardDesc}>{file.description}</span>}
          </span>
          <a className={css.fileCardDownload} href={file.downloadUrl} download
            aria-label={`${t('attachment')} ${file.path.split('/').pop() ?? file.path}`}>⬇</a>
        </div>
      ))}</div>}
      {event.attachments !== undefined && <div className={css.attachments}>{event.attachments.map(file => (
        <a key={file.attachmentId} className={css.fileChip} href={attachmentUrlFor(file.attachmentId)}
          target="_blank" rel="noreferrer" aria-label={`${t('attachment')} ${file.name}`}>
          {file.mimeType.startsWith('image/') && <img className={css.filePreview} src={attachmentUrlFor(file.attachmentId)}
            alt={file.name} loading="lazy" referrerPolicy="no-referrer"/>}
          <span className={css.fileName}>{file.name}</span>
          <span className={css.fileSize}>{humanSize(file.size)}</span>
        </a>))}</div>}
      {working !== undefined && working.length > 0 && <div className={css.workingChips}>{working.map(chip => (
        <span key={chip.employeeId} className={css.workingChip} aria-label={t('replying')}>
          {chip.avatarUrl !== undefined
            ? <img className={css.workingAvatar} src={chip.avatarUrl} alt="" loading="lazy" referrerPolicy="no-referrer"/>
            : <span className={css.workingAvatar} aria-hidden="true">{chip.displayName.slice(0, 1)}</span>}
          <span>{chip.displayName}</span>
          <span className={css.typingDots} aria-hidden="true"><i/><i/><i/></span>
        </span>))}</div>}
      {workflowDetails !== undefined && workflowDetails.length > 0 && <details className={css.workflowDetails}>
        <summary>{t('workflowDetails')} · {workflowDetails.length}</summary>
        <ul>{workflowDetails.map(detail => <li key={detail.id}>
          <span className={css.detailMeta}>{detail.author.displayName} · {new Date(detail.created_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          <span className={css.detailContent}>{detail.author.kind === 'employee' ? stripReplyBoilerplate(detail.content) : detail.content}</span>
        </li>)}</ul>
      </details>}
      {threadReplies !== undefined && threadReplies.length > 0 && (() => {
        const last = threadReplies[threadReplies.length - 1]
        const stack = threadReplies.slice(-3).reverse()
        if (last === undefined) return null
        return <button type="button" className={css.threadChip} onClick={() => { onThread(event.id) }}>
          <span className={css.threadStack}>{stack.map((reply) => {
            const url = threadAvatarFor(reply.author.id)
            return url === undefined
              ? <span key={reply.id} className={css.threadAvatar} aria-hidden="true">{reply.author.displayName.slice(0, 1)}</span>
              : <img key={reply.id} className={css.threadAvatar} src={url} alt="" loading="lazy" referrerPolicy="no-referrer"/>
          })}</span>
          <span>{t('threadReplies', { count: threadReplies.length })}</span>
          <span className={css.threadTime}>{new Date(last.created_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </button>
      })()}
      {event.delivery === 'failed' && <p className={css.failure} role="status">{t('deliveryFailed')}</p>}
      <div className={css.eventFooter}>
        {event.sourceSessionId !== undefined && <button type="button" onClick={() => { if (event.sourceSessionId !== undefined) onInspect(event.sourceSessionId) }}>{t('viewExecution')}</button>}
      </div>
    </div>
  </article>
}

/** One file being attached to the draft; uploads commit before the message referencing them. */
interface PendingUpload {
  readonly key: string
  readonly file: File
  readonly status: 'uploading' | 'ready' | 'error'
  readonly ref?: { attachmentId: string; name: string; mimeType: string; size: number }
}

function humanSize(size: number): string {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  if (size >= 1024) return `${Math.max(1, Math.round(size / 1024))} KB`
  return `${size} B`
}

function Composer({ state, controller, t, threadRoot }: {
  readonly state: CollaborationState
  readonly controller: CollaborationController
  readonly t: Copy
  readonly threadRoot?: string
}) {
  const [draft, setDraft] = useState('')
  const [mentions, setMentions] = useState<string[]>([])
  const [peopleMentions, setPeopleMentions] = useState<string[]>([])
  const [openMentions, setOpenMentions] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [typedMention, setTypedMention] = useState(false)
  const [uploads, setUploads] = useState<PendingUpload[]>([])
  const [sending, setSending] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const mentionWrap = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const detail = state.selection?.detail
  useEffect(() => { setDraft(''); setMentions([]); setPeopleMentions([]); setUploads([]) }, [detail?.id, threadRoot])
  useEffect(() => {
    if (!openMentions) return
    const onPointer = (event: MouseEvent): void => { if (!mentionWrap.current?.contains(event.target as Node)) setOpenMentions(false) }
    const onEscape = (event: globalThis.KeyboardEvent): void => { if (event.key === 'Escape') { setOpenMentions(false); input.current?.focus() } }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onEscape)
    return () => { document.removeEventListener('mousedown', onPointer); document.removeEventListener('keydown', onEscape) }
  }, [openMentions])
  if (detail === undefined) return null
  const people = detail.humanMembers ?? detail.memberUserIds.map(userId => ({ userId, displayName: userId }))
  const query = mentionQuery.toLowerCase()
  const employeeCandidates = detail.members.filter(member => member.displayName.toLowerCase().includes(query))
  const peopleCandidates = people.filter(member => member.displayName.toLowerCase().includes(query))
  // @ ALL is a pseudo member that expands to every human and employee in the room.
  const allMatches = query === '' || 'all'.includes(query)
  const allSelected = detail.members.length > 0
    && detail.members.every(member => mentions.includes(member.employeeId))
    && detail.memberUserIds.every(userId => peopleMentions.includes(userId))
  const pickAll = (): void => {
    if (allSelected) { setMentions([]); setPeopleMentions([]); return }
    setMentions(detail.members.map(member => member.employeeId))
    setPeopleMentions([...detail.memberUserIds])
  }
  const readyAttachments = uploads.flatMap(upload => upload.status === 'ready' && upload.ref !== undefined ? [upload.ref] : [])
  const uploadPending = uploads.some(upload => upload.status === 'uploading')
  // Typing @ right before the caret summons the member picker filtered by the
  // partial name after it; the button opens the same menu unfiltered.
  const refreshMentionQuery = (text: string, caret: number | null): void => {
    const match = /(?:^|\s)@([^\s@]*)$/.exec(text.slice(0, caret ?? text.length))
    if (match !== null) { setMentionQuery(match[1] ?? ''); setTypedMention(true); setOpenMentions(true) }
    else if (typedMention) { setOpenMentions(false); setTypedMention(false) }
  }
  const insertMention = (name: string): void => {
    if (!typedMention) return
    setDraft((current) => {
      const index = current.lastIndexOf(`@${mentionQuery}`)
      if (index === -1) return `${current}@${name} `
      return `${current.slice(0, index)}@${name} ${current.slice(index + 1 + mentionQuery.length)}`
    })
  }
  const toggleMember = (kind: 'employee' | 'human', id: string, name: string): void => {
    if (kind === 'employee') setMentions(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id])
    else setPeopleMentions(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id])
    if (typedMention) { insertMention(name); setOpenMentions(false); setTypedMention(false); input.current?.focus() }
  }
  const send = async (event?: FormEvent): Promise<void> => {
    event?.preventDefault()
    if (sending || uploadPending || (draft.trim() === '' && readyAttachments.length === 0)) return
    setSending(true)
    try {
      const accepted = await controller.send(draft, {
        ...(threadRoot === undefined ? {} : { threadRoot }),
        ...(mentions.length === 0 ? {} : { mentionedEmployeeIds: mentions }),
        ...(peopleMentions.length === 0 ? {} : { mentionedUserIds: peopleMentions }),
        ...(readyAttachments.length === 0 ? {} : { attachments: readyAttachments }),
      })
      if (accepted) {
        setDraft(''); setMentions([]); setPeopleMentions([]); setUploads([]); setOpenMentions(false); input.current?.focus()
      }
    } finally { setSending(false) }
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send() }
  }
  const pickFiles = (files: FileList | null): void => {
    for (const file of Array.from(files ?? [])) {
      const key = `${file.name}:${file.size}:${Date.now()}:${Math.random()}`
      setUploads(current => [...current, { key, file, status: 'uploading' }])
      void controller.uploadAttachment(detail.id, file)
        .then((ref) => { setUploads(current => current.map(upload => upload.key === key ? { ...upload, status: 'ready' as const, ref } : upload)) })
        .catch(() => { setUploads(current => current.map(upload => upload.key === key ? { ...upload, status: 'error' as const } : upload)) })
    }
    if (fileInput.current !== null) fileInput.current.value = ''
  }
  return <form className={css.composer} onSubmit={(event) => { void send(event) }}>
    {(mentions.length > 0 || peopleMentions.length > 0 || uploads.length > 0) && <div className={css.mentionChips}>{mentions.map((id) => {
      const member = detail.members.find(item => item.employeeId === id)
      return <button key={`employee:${id}`} type="button" onClick={() => { setMentions(mentions.filter(value => value !== id)) }} aria-label={`${t('removeMention')} ${member?.displayName ?? id}`}>@{member?.displayName ?? id} ×</button>
    })}{peopleMentions.map((id) => {
      const member = people.find(item => item.userId === id)
      return <button key={`human:${id}`} type="button" onClick={() => { setPeopleMentions(peopleMentions.filter(value => value !== id)) }} aria-label={`${t('removeMention')} ${member?.displayName ?? id}`}>@{member?.displayName ?? id} ×</button>
    })}{uploads.map(upload => <span key={upload.key} className={css.uploadChip} data-status={upload.status}
      title={upload.status === 'error' ? t('attachFailed') : upload.status === 'uploading' ? t('attachUploading') : undefined}>
      {upload.status === 'uploading' && `${t('attachUploading')} · `}{upload.status === 'error' && `${t('attachFailed')} · `}{upload.file.name}
      <button type="button" aria-label={`${t('removeAttachment')} ${upload.file.name}`}
        onClick={() => { setUploads(current => current.filter(item => item.key !== upload.key)) }}>×</button>
    </span>)}</div>}
    <textarea ref={input} value={draft}
      onChange={(event) => { setDraft(event.target.value); refreshMentionQuery(event.target.value, event.target.selectionStart) }}
      onKeyDown={onKeyDown} placeholder={t(threadRoot === undefined ? 'roomPlaceholder' : 'threadPlaceholder')} aria-label={t('message')} disabled={sending} rows={2}/>
    <div className={css.composerActions}>
      <input ref={fileInput} type="file" multiple hidden
        onChange={(event) => { pickFiles(event.target.files) }}/>
      <button type="button" className={css.attach} aria-label={t('attach')} title={t('attach')}
        disabled={sending} onClick={() => { fileInput.current?.click() }}>＋</button>
      <div ref={mentionWrap} className={css.mentionWrap}><button type="button" aria-expanded={openMentions} onClick={() => { setTypedMention(false); setMentionQuery(''); setOpenMentions(!openMentions) }}>{t('mentionMember')}</button>
        {openMentions && <div className={css.mentionMenu}>
          {allMatches && <div role="group" aria-label={t('mentionAll')}>
            <label className={css.menuAll}><input type="checkbox" checked={allSelected}
              onChange={() => { pickAll(); if (typedMention) { insertMention('ALL'); setOpenMentions(false); setTypedMention(false); input.current?.focus() } }}/>
            <span className={css.menuAllLabel}>@ ALL</span><span className={css.menuAllHint}>{t('mentionAllHint')}</span>
            </label>
          </div>}
          <div role="group" aria-label={t('employees')}>
            {employeeCandidates.map(member => <span key={member.employeeId} className={css.menuRow}>
              <img className={css.menuAvatar} src={dicebearAvatarUrl(member.avatarSeed ?? member.employeeId)} alt=""
                loading="lazy" referrerPolicy="no-referrer"/>
              <label><input type="checkbox" checked={mentions.includes(member.employeeId)}
                onChange={() => { toggleMember('employee', member.employeeId, member.displayName) }}/>{member.displayName}</label>
            </span>)}
          </div>
          <div role="group" aria-label={t('people')}>
            {peopleCandidates.map(member => <span key={member.userId} className={css.menuRow}>
              <span className={css.menuAvatar} aria-hidden="true">{member.displayName.slice(0, 1)}</span>
              <label><input type="checkbox" checked={peopleMentions.includes(member.userId)}
                onChange={() => { toggleMember('human', member.userId, member.displayName) }}/>{member.displayName}</label>
            </span>)}
          </div>
          {employeeCandidates.length === 0 && peopleCandidates.length === 0 && !allMatches && <span>{t('mentionNoMatch')}</span>}
        </div>}
      </div>
      <span className={css.keyHint}>{t('sendHint')}</span>
      <button type="submit" className={css.send} disabled={sending || uploadPending || (draft.trim() === '' && readyAttachments.length === 0)} aria-label={t('send')}><IconSendOutlineRegular size={16}/></button>
    </div>
  </form>
}

/** One shared timeline for people and Bots, with a room context and thread rail. */
export function CollaborationRoom({ state, controller, loadChoices, t }: {
  readonly state: CollaborationState
  readonly controller: CollaborationController
  readonly loadChoices?: () => Promise<CollaborationChoices>
  readonly t: Copy
}) {
  const [showDetails, setShowDetails] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const scroll = useRef<HTMLDivElement>(null)
  const scrollBeforePrepend = useRef<{ height: number; top: number }>()
  const atBottom = useRef(true)
  const roomId = state.selection?.detail.id
  const latestSequence = state.events.at(-1)?.sequence
  useEffect(() => {
    if (roomId !== undefined && latestSequence !== undefined && state.roomPhase === 'ready'
      && (!showSearch || state.searchPhase === 'idle')) {
      void controller.acknowledgeVisible()
    }
  }, [controller, roomId, latestSequence, state.roomPhase, state.searchPhase, showSearch])
  useEffect(() => {
    if (roomId === undefined) return
    void controller.poll()
    const timer = setInterval(() => { void controller.poll() }, 3000)
    return () => { clearInterval(timer) }
  }, [controller, roomId])
  useEffect(() => {
    setShowDetails(false)
    setShowSearch(false)
    setSearchInput('')
    scrollBeforePrepend.current = undefined
    atBottom.current = true
  }, [roomId])
  useLayoutEffect(() => {
    const previous = scrollBeforePrepend.current
    const node = scroll.current
    if (previous === undefined || node === null) return
    node.scrollTop = previous.top + node.scrollHeight - previous.height
    scrollBeforePrepend.current = undefined
  }, [state.events[0]?.sequence])
  useLayoutEffect(() => {
    const node = scroll.current
    if (node !== null && atBottom.current && scrollBeforePrepend.current === undefined) node.scrollTop = node.scrollHeight
  }, [state.events.at(-1)?.sequence])
  const timeline = useMemo(() => state.events.filter(event => event.kind !== 7), [state.events])
  const selected = state.selection
  // Same seed resolution as the workbench roster cards: profile seed, else the
  // employee id, so every digital employee shows the roster face, never a text
  // initial.
  const avatars = useMemo(() => new Map((selected?.detail.members ?? []).map(member =>
    [member.employeeId, dicebearAvatarUrl(member.avatarSeed ?? member.employeeId)] as const)), [selected?.detail.members])
  // Agent replies carry the work Session that produced them; fetch its
  // presented files once per Session so answers can show file cards.
  const sourceSessions = useMemo(() => new Set(state.events.flatMap((event) => {
    if (event.author.kind !== 'employee' || event.sourceSessionId === undefined) return []
    return [event.sourceSessionId]
  })), [state.events])
  const [presentedFiles, setPresentedFiles] = useState<ReadonlyMap<string, readonly RoomPresentedFile[]>>(new Map())
  useEffect(() => {
    let live = true
    for (const sessionId of sourceSessions) {
      if (presentedFiles.has(sessionId)) continue
      void controller.presentedFiles(sessionId)
        .then((files) => { if (live) setPresentedFiles(current => new Map(current).set(sessionId, files)) })
        .catch(() => {})
    }
    return () => { live = false }
  }, [controller, sourceSessions, presentedFiles])
  const presentedFor = (sessionId: string): readonly RoomPresentedFile[] | undefined => presentedFiles.get(sessionId)
  // Group one agent reply: the employee's tool/progress events fold into their
  // next signed answer as collapsed details; a mentioned employee without an
  // answer yet renders a working chip on the mentioning message. Orphan
  // progress events (agent stopped, or a new turn started) render standalone.
  const displayItems = useMemo(() => {
    const items: TimelineItem[] = []
    const pending = new Map<string, RoomEvent[]>()
    // The employee's last signed answer across the whole timeline decides
    // whether an earlier mention is still being worked on.
    const answeredSeq = new Map<string, string>()
    for (const event of timeline) {
      if (event.author.kind === 'employee' && event.kind === 9) answeredSeq.set(event.author.id, event.sequence)
    }
    const members = new Map((selected?.detail.members ?? []).map(member => [member.employeeId, member.displayName]))
    // In channels every reply belongs to the thread of the message it answers:
    // claim human and agent replies alike so the main timeline stays root-only.
    const isChannel = (selected?.detail.kind ?? 'group') === 'channel'
    const threadReplies = new Map<string, RoomEvent[]>()
    if (isChannel) {
      const rootIds = new Set(timeline.filter(event => event.threadRoot === undefined).map(event => event.id))
      for (const event of timeline) {
        if (event.threadRoot === undefined || !rootIds.has(event.threadRoot)) continue
        const list = threadReplies.get(event.threadRoot) ?? []
        list.push(event)
        threadReplies.set(event.threadRoot, list)
      }
    }
    const flushOrphans = (): void => {
      for (const events of pending.values()) {
        for (const event of events) items.push({ event })
      }
      pending.clear()
    }
    // One agent reply spans everything the employee posts between two human
    // messages: the first signed message is the main answer, tool progress
    // events and any further signed messages fold into it as details.
    const runAnswered = new Set<string>()
    const runAnswerItem = new Map<string, TimelineItem>()
    for (const event of timeline) {
      if (isChannel && event.threadRoot !== undefined && threadReplies.has(event.threadRoot)) continue
      if (event.author.kind === 'employee' && event.kind !== 9) {
        const list = pending.get(event.author.id) ?? []
        list.push(event)
        pending.set(event.author.id, list)
        continue
      }
      if (event.author.kind === 'employee') {
        const details = pending.get(event.author.id)
        pending.delete(event.author.id)
        if (runAnswered.has(event.author.id)) {
          // A further signed message from the same reply run folds into the
          // main answer instead of rendering as its own timeline row.
          const main = runAnswerItem.get(event.author.id)
          if (main !== undefined) {
            // Fold the follow-up message plus any tool events it carried.
            main.workflowDetails = [...(main.workflowDetails ?? []), event, ...(pending.get(event.author.id) ?? [])]
            pending.delete(event.author.id)
          }
          continue
        }
        runAnswered.add(event.author.id)
        const item: TimelineItem = { event, ...(details === undefined ? {} : { workflowDetails: details }) }
        if (item.workflowDetails !== undefined) item.workflowDetails = [...item.workflowDetails]
        runAnswerItem.set(event.author.id, item)
        items.push(item)
        continue
      }
      flushOrphans()
      runAnswered.clear()
      runAnswerItem.clear()
      let working: readonly WorkingChip[] | undefined
      if (event.author.kind === 'human') {
        const targets = event.tags.filter(tag => tag[0] === 'dsh-target' && tag[1] !== undefined)
          .map(tag => tag[1] as string)
        const active = targets.filter((id) => {
          const answered = answeredSeq.get(id)
          return answered === undefined || BigInt(answered) < BigInt(event.sequence)
        })
        if (active.length > 0) {
          working = active.map((id) => {
            const avatarUrl = avatars.get(id)
            return { employeeId: id, displayName: members.get(id) ?? id, ...(avatarUrl === undefined ? {} : { avatarUrl }) }
          })
        }
      }
      const replies = isChannel ? threadReplies.get(event.id) : undefined
      items.push({ event, ...(working === undefined ? {} : { working }), ...(replies === undefined ? {} : { threadReplies: replies }) })
    }
    flushOrphans()
    return items
  }, [timeline, avatars, selected?.detail.kind, selected?.detail.members])
  if (selected === null) return <main className={css.room}><div className={css.center}>
    {state.roomPhase === 'loading' ? <IconLoadingOutlineRegular size={20}/> : t(state.error === 'forbidden' ? 'forbidden' : state.roomPhase === 'error' ? 'loadError' : 'noSelection')}
  </div></main>
  const detail = selected.detail
  const avatarFor = (event: RoomEvent): string | undefined => event.author.kind === 'employee' ? avatars.get(event.author.id) : undefined
  const attachmentUrlFor = (attachmentId: string): string => controller.attachmentUrl(detail.id, attachmentId)

  const isSelf = (event: RoomEvent): boolean => event.author.kind === 'human' && event.author.id === detail.viewerUserId
  const threadRoot = selected.threadRoot
  const root = threadRoot === undefined ? undefined : [...state.events, ...state.searchResults].find(event => event.id === threadRoot)
  return <main className={css.room}>
    <header className={css.header}>
      <div className={css.heading}><span className={css.roomIcon}>{detail.kind === 'channel' ? '#' : <IconUsersOutlineRegular size={18}/>}</span><div><h1>{detail.name}</h1><p>{t(detail.kind === 'group' ? 'groups' : 'channels')} · {detail.memberCount} {t('memberCount')}</p></div></div>
      <div className={css.headerActions}>
        <Tooltip label={t('searchRoom')}><button type="button" onClick={() => { setShowSearch(!showSearch) }} aria-label={t('searchRoom')} aria-expanded={showSearch}><IconSearchOutlineRegular size={17}/></button></Tooltip>
        <Tooltip label={t('roomDetails')}><button type="button" onClick={() => { setShowDetails(!showDetails); void controller.refreshCurrent() }} aria-label={t('roomDetails')} aria-expanded={showDetails}><IconUsersOutlineRegular size={17}/></button></Tooltip>
      </div>
    </header>
    {showSearch && <form className={css.search} onSubmit={(event) => { event.preventDefault(); void controller.search(searchInput) }}><label><span className={css.visuallyHidden}>{t('searchRoom')}</span><input autoFocus value={searchInput} onChange={(event) => { setSearchInput(event.target.value); if (event.target.value === '') void controller.search('') }} placeholder={t('searchPlaceholder')}/></label><button type="submit" disabled={searchInput.trim() === ''}>{t('search')}</button><button type="button" onClick={() => { setShowSearch(false); setSearchInput(''); void controller.search('') }} aria-label={t('closeSearch')}><IconCloseOutlineRegular size={15}/></button></form>}
    <div className={css.layout}>
      <div className={css.primary}>
        {showSearch && state.searchPhase !== 'idle' ? <div className={css.scroll} role="region" aria-label={t('searchResults')}>
          {state.searchPhase === 'loading' && <div className={css.center}><IconLoadingOutlineRegular size={20}/></div>}
          {state.searchPhase === 'error' && <div className={css.center} role="alert">{t('searchFailed')}<button type="button" onClick={() => { void controller.search(searchInput) }}>{t('retry')}</button></div>}
          {state.searchPhase === 'ready' && (state.searchResults.length === 0 ? <div className={css.center}>{t('noSearchResults')}</div> : state.searchResults.map(event => <Entry key={event.id} event={event} reactions={[]} self={isSelf(event)} avatarUrl={avatarFor(event)} attachmentUrlFor={attachmentUrlFor} onThread={(id) => { setShowSearch(false); void controller.openThread(id) }} onReaction={(id, emoji) => { void controller.react(id, emoji) }} onInspect={(id) => { void controller.inspect(id) }} t={t}/>))}
        </div> : <div ref={scroll} className={css.scroll} role="region" aria-label={t('roomTimeline')}
          onScroll={(event) => {
            const node = event.currentTarget
            atBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48
          }}>
          {state.roomPhase === 'loading' && <div className={css.center}><IconLoadingOutlineRegular size={20}/></div>}
          {state.roomPhase === 'error' && <div className={css.center} role="alert">{t('loadError')}<button type="button" onClick={() => { void controller.select(detail.id) }}>{t('retry')}</button></div>}
          {state.roomPhase === 'ready' && <>
            {state.olderCursor !== null && <button className={css.more} type="button" onClick={() => {
              const node = scroll.current
              if (node !== null) scrollBeforePrepend.current = { height: node.scrollHeight, top: node.scrollTop }
              void controller.loadOlder()
            }}>{t('loadOlder')}</button>}
            {timeline.length === 0 && <div className={css.center}>{t('emptyRoom')}</div>}
            {displayItems.map((item) => {
              const presented = item.event.sourceSessionId === undefined ? undefined : presentedFor(item.event.sourceSessionId)
              return <Entry key={item.event.id} event={item.event}
                reactions={reactionSummaries(state.events, item.event.id, detail.viewerUserId)}
                self={isSelf(item.event)} avatarUrl={avatarFor(item.event)}
                attachmentUrlFor={attachmentUrlFor} threadAvatarFor={authorId => avatars.get(authorId)}
                {...(item.workflowDetails === undefined ? {} : { workflowDetails: item.workflowDetails })}
                {...(item.working === undefined ? {} : { working: item.working })}
                {...(item.threadReplies === undefined ? {} : { threadReplies: item.threadReplies })}
                {...(presented === undefined ? {} : { presented })}
                onThread={(id) => { void controller.openThread(id) }}
                onReaction={(id, emoji) => { void controller.react(id, emoji) }}
                onInspect={(id) => { void controller.inspect(id) }} t={t}/>
            })}
          </>}
        </div>}
        {state.error !== null && <p className={css.error} role="alert">{t(state.error === 'forbidden' ? 'forbidden' : 'requestFailed')}</p>}
        <Composer state={state} controller={controller} t={t}/>
      </div>
      {(showDetails || threadRoot !== undefined) && <aside className={css.side} aria-label={t(threadRoot === undefined ? 'roomDetails' : 'roomThread')}>
        <div className={css.sideHeader}><h2>{t(threadRoot === undefined ? 'roomDetails' : 'roomThread')}</h2><button type="button" aria-label={t('closeDetails')} onClick={() => { if (threadRoot !== undefined) controller.closeThread(); else setShowDetails(false) }}><IconCloseOutlineRegular size={16}/></button></div>
        {threadRoot === undefined ? <div className={css.details}>
          {detail.kind === 'group' ? <CollaborationGroupDetails detail={detail}
            {...(detail.viewerIsAdmin ? { controller } : {})}
            {...(loadChoices === undefined ? {} : { loadChoices })} t={t}/>
            : <><section><h3>{t('people')}</h3><p>{detail.memberUserIds.length} {t('humanMembers')}</p></section>
              <section><h3>{t('employees')}</h3>{detail.members.length === 0 ? <p>{t('emptyEmployees')}</p> : <ul>{detail.members.map(member => <li key={member.employeeId}>{member.displayName}{detail.dutyEmployeeIds.includes(member.employeeId) && <span>{t('onDuty')}</span>}</li>)}</ul>}</section></>}
          {detail.team !== undefined && <section><h3>{t('team')}</h3><p>{detail.team.name}</p></section>}
          {detail.project !== undefined && <section><h3>{t('project')}</h3><p>{detail.project.name}</p></section>}
          {detail.kind === 'channel' && <><ChannelDecisionQueue key={`${detail.id}-decisions`} channelId={detail.id} t={t}/>
            <ChannelWorkflowEditor key={`${detail.id}-workflows`} channelId={detail.id} t={t}/></>}
        </div> : <><div className={css.threadScroll}>{root !== undefined && <Entry event={root} reactions={reactionSummaries(state.events, root.id, detail.viewerUserId)} self={isSelf(root)} avatarUrl={avatarFor(root)} attachmentUrlFor={attachmentUrlFor} onThread={() => {}} onReaction={(id, emoji) => { void controller.react(id, emoji) }} onInspect={(id) => { void controller.inspect(id) }} t={t}/>}{state.threadPhase === 'loading' && <div className={css.center}><IconLoadingOutlineRegular size={20}/></div>}{state.threadPhase === 'error' && <div className={css.center} role="alert">{t('loadError')}<button type="button" onClick={() => { void controller.openThread(threadRoot) }}>{t('retry')}</button></div>}{state.threadPhase === 'ready' && state.threadEvents.filter(event => event.kind !== 7 && event.id !== threadRoot).map(event => <Entry key={event.id} event={event} reactions={reactionSummaries(state.threadEvents, event.id, detail.viewerUserId)} self={isSelf(event)} avatarUrl={avatarFor(event)} attachmentUrlFor={attachmentUrlFor} onThread={() => {}} onReaction={(id, emoji) => { void controller.react(id, emoji) }} onInspect={(id) => { void controller.inspect(id) }} t={t}/>)}</div><Composer state={state} controller={controller} t={t} threadRoot={threadRoot}/></>}
      </aside>}
    </div>
  </main>
}
