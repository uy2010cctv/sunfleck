/** Shared group/channel room in the existing SUNFLECK main panel. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import type {} from '@deepseek-ai/dsh-client-ui-attachment/client'
import type { DraftAttachmentId } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsRenderFactories } from '@deepseek-ai/dsh-client-ui-slots'
import { RoomAttachmentMenu } from './RoomAttachmentMenu.tsx'
import { RoomPresentedFiles } from './RoomPresentedFiles.tsx'
import { filesForRoomReply } from './room-presented-files.ts'
import { channelThreadEvents, threadReplyItems } from './channel-threads.ts'
import { ComposerCard, ComposerControlRow, ComposerSendButton, IconCloseOutlineRegular, IconPlusOutlineMedium, IconLoadingOutlineRegular, IconReactionAddOutlineRegular, IconSearchOutlineRegular, IconUsersOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CollaborationController, CollaborationState, RoomEvent, RoomPresentedFile } from './collaboration-store.ts'
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
    if (event.kind !== 7) continue
    const target = event.tags.findLast(tag => tag[0] === 'e' && tag[3] !== 'root')?.[1]
    if (target !== targetId) continue
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

function answerSequences(events: readonly RoomEvent[]): ReadonlyMap<string, string> {
  const answered = new Map<string, string>()
  for (const event of events) {
    if (event.author.kind === 'employee' && event.kind === 9) answered.set(event.author.id, event.sequence)
  }
  return answered
}

function workingChipsFor(event: RoomEvent, answered: ReadonlyMap<string, string>,
  members: ReadonlyMap<string, string>, avatars: ReadonlyMap<string, string>,
  admissionFailures: readonly RoomEvent[]): readonly WorkingChip[] | undefined {
  if (event.author.kind !== 'human') return undefined
  const targets = event.tags.filter(tag => tag[0] === 'dsh-target' && tag[1] !== undefined)
    .map(tag => tag[1]).filter((id): id is string => id !== undefined)
  const active = targets.filter((id) => {
    if (admissionFailures.some(failure => attachmentFailureSource(failure) === event.id
      && attachmentFailureTag(failure)?.[2] === 'employee' && attachmentFailureTag(failure)?.[3] === id)) return false
    const answer = answered.get(id)
    return answer === undefined || BigInt(answer) < BigInt(event.sequence)
  })
  if (active.length === 0) return undefined
  return active.map((id) => {
    const avatarUrl = avatars.get(id)
    return { employeeId: id, displayName: members.get(id) ?? id,
      ...(avatarUrl === undefined ? {} : { avatarUrl }) }
  })
}

/** One rendered timeline row: the event plus any grouped agent execution state. */
interface TimelineItem {
  readonly event: RoomEvent
  /** Agent tool/progress events and follow-up messages folded into this final answer, collapsed by default. */
  workflowDetails?: RoomEvent[]
  /** Agents mentioned by this human message that have not replied yet. */
  readonly working?: readonly WorkingChip[]
  /** In channels, agent replies that belong to this message's thread. */
  readonly threadReplies?: readonly RoomEvent[]
  /** In channels, a thread whose triggering message is older than the loaded page. */
  readonly orphanThread?: { readonly rootId: string; readonly events: readonly RoomEvent[] }
}

/** Drop the model-generated reply meta prefix (回复/回应 variants) from an employee answer.
 * A message that is nothing but the meta line keeps its original content. */
export function stripReplyBoilerplate(content: string): string {
  const stripped = content.replace(/^已在房间回[复应][（(][^）)]*[)）][，,、。]?\s*/, '')
  return stripped.trim() === '' ? content : stripped
}

interface AttachmentNotice { readonly id: string; readonly text: string }

function attachmentFailureTag(event: RoomEvent): readonly string[] | undefined {
  if (event.kind !== 41000 || event.author.kind !== 'service' || event.author.id !== 'attachment-admission') return undefined
  const tag = event.tags.find(value => value[0] === 'dsh-attachment-error')
  return tag?.length === 4 ? tag : undefined
}

function attachmentFailureSource(event: RoomEvent): string | undefined {
  return event.tags.find(tag => tag[0] === 'e' && tag[3] !== 'root')?.[1]
}

function Entry({ event, reactions, self, avatarUrl, attachmentUrlFor, workflowDetails, working, threadReplies, presented,
  threadAvatarFor = () => undefined, onThread, onReaction, onInspect, renderFactorySlot, foldedPresented,
  postLayout = false, onReply, attachmentNotices, t }: {
  readonly event: RoomEvent
  readonly attachmentNotices?: readonly AttachmentNotice[] | undefined
  readonly postLayout?: boolean
  readonly onReply?: (() => void) | undefined
  readonly reactions: readonly ReactionSummary[]
  readonly self: boolean
  readonly avatarUrl: string | undefined
  readonly attachmentUrlFor: (attachmentId: string) => string
  readonly workflowDetails?: readonly RoomEvent[]
  readonly working?: readonly WorkingChip[]
  readonly threadReplies?: readonly RoomEvent[]
  readonly presented?: readonly RoomPresentedFile[] | undefined
  readonly foldedPresented?: readonly { readonly id: string; readonly sessionId: string; readonly files: readonly RoomPresentedFile[] }[]
  readonly renderFactorySlot?: PropsRenderFactories['renderFactorySlot'] | undefined
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
    const close = (): void => { setPickerOpen(false) }
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
  const reactionControls = event.kind === 9 ? <span className={`${css.reactionRow} ${postLayout ? css.postReactions : ''}`}>
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
  </span> : null
  return <article data-channel-post={postLayout || undefined} className={`${css.entry} ${postLayout ? css.entryPost : self ? css.entrySelf : ''} ${workflow ? css.workflow : ''}`} data-event-id={event.id}>
    {avatarUrl !== undefined
      ? <img className={`${css.avatar} ${event.author.kind === 'employee' ? css.bot : ''}`} src={avatarUrl}
        alt={event.author.displayName} loading="lazy" referrerPolicy="no-referrer"/>
      : <span className={`${css.avatar} ${event.author.kind === 'employee' ? css.bot : event.author.kind === 'service' ? css.service : ''}`} aria-hidden="true">{event.author.displayName.slice(0, 1)}</span>}
    <div className={css.entryBody}>
      <div className={css.meta}><span className={css.author}>{event.author.displayName}</span><span className={css.kind}>{t(event.author.kind === 'employee' ? 'botMember' : event.author.kind === 'service' ? 'serviceMember' : 'humanMember')}</span><time dateTime={new Date(event.created_at * 1000).toISOString()}>{time}</time>{workflow && <span className={css.kind}>{t('workflowEvent')}</span>}{workflowStatus !== undefined && <span className={css.kind}>{workflowStatus}</span>}
        {!postLayout && reactionControls}
      </div>
      {event.author.kind === 'employee'
        ? <div className={css.contentMarkdown}><MarkdownText text={stripReplyBoilerplate(event.content)} labels={markdownLabels}/></div>
        : <p className={css.content}>{event.content}</p>}
      {presented !== undefined && event.sourceSessionId !== undefined && <RoomPresentedFiles files={presented}
        sessionId={event.sourceSessionId} {...(renderFactorySlot === undefined ? {} : { renderFactorySlot })} downloadLabel={t('attachment')} />}
      {foldedPresented?.map(delivery => <RoomPresentedFiles key={delivery.id} files={delivery.files}
        sessionId={delivery.sessionId} {...(renderFactorySlot === undefined ? {} : { renderFactorySlot })} downloadLabel={t('attachment')} />)}
      {event.attachments !== undefined && <div className={css.attachments}>{event.attachments.map(file => (
        <a key={file.attachmentId} className={css.fileChip} href={attachmentUrlFor(file.attachmentId)}
          target="_blank" rel="noreferrer" aria-label={`${t('attachment')} ${file.name}`}>
          {file.mimeType.startsWith('image/') && <img className={css.filePreview} src={attachmentUrlFor(file.attachmentId)}
            alt={file.name} loading="lazy" referrerPolicy="no-referrer"/>}
          <span className={css.fileName}>{file.name}</span>
          <span className={css.fileSize}>{humanSize(file.size)}</span>
        </a>))}</div>}
      {attachmentNotices?.map(notice => <p key={notice.id} role="alert" className={css.error}>{notice.text}</p>)}
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
        {postLayout && (() => {
          const source = event.sourceSessionId ?? workflowDetails.find(detail => detail.sourceSessionId !== undefined)?.sourceSessionId
          return source === undefined ? null : <button type="button" onClick={() => { onInspect(source) }}>{t('viewExecution')}</button>
        })()}
      </details>}
      {postLayout && reactionControls}
      {threadReplies !== undefined && threadReplies.length > 0 && (() => {
        const last = threadReplies[threadReplies.length - 1]
        const stack = [...new Map(threadReplies.map(reply => [`${reply.author.kind}:${reply.author.id}`, reply])).values()].slice(-3).reverse()
        if (last === undefined) return null
        return <button type="button" className={css.threadChip} onClick={() => { onThread(event.id) }}>
          <span className={css.threadStack}>{stack.map((reply) => {
            const url = threadAvatarFor(reply.author.id)
            return url === undefined
              ? <span key={reply.id} className={css.threadAvatar} aria-hidden="true">{reply.author.displayName.slice(0, 1)}</span>
              : <img key={reply.id} className={css.threadAvatar} src={url} alt="" loading="lazy" referrerPolicy="no-referrer"/>
          })}</span>
          <span>{t('threadReplies', { count: threadReplies.length })}</span>
          <span className={css.threadTime}>{t('lastReplyAt', { time: new Date(last.created_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })}</span>
        </button>
      })()}
      {event.delivery === 'failed' && <p className={css.failure} role="status">{t('deliveryFailed')}</p>}
      <div className={css.eventFooter}>
        {onReply !== undefined && <button type="button" onClick={onReply}>{t('replyThread')}</button>}
        {event.sourceSessionId !== undefined && !postLayout && <button type="button" onClick={() => { if (event.sourceSessionId !== undefined) onInspect(event.sourceSessionId) }}>{t('viewExecution')}</button>}
      </div>
    </div>
  </article>
}

/** Collapsed signed execution facts that do not constitute channel posts. */
function ExecutionFacts({ events, onInspect, t }: {
  readonly events: readonly RoomEvent[]
  readonly onInspect: (sessionId: string) => void
  readonly t: Copy
}) {
  return <details className={css.channelExecution}>
    <summary>{t('workflowDetails')} · {events.length}</summary>
    <ul>{events.map(event => <li key={event.id}><span>{event.author.displayName} · {event.content}</span>
      {event.sourceSessionId !== undefined && <button type="button" onClick={() => {
        if (event.sourceSessionId !== undefined) onInspect(event.sourceSessionId)
      }}>{t('viewExecution')}</button>}</li>)}</ul>
  </details>
}

/** One file being attached to the draft; uploads commit before the message referencing them. */
interface PendingUpload {
  readonly key: DraftAttachmentId
  readonly file: File
  readonly previewUrl?: string
  readonly status: 'uploading' | 'ready' | 'error'
  readonly ref?: { attachmentId: string; name: string; mimeType: string; size: number }
}

function humanSize(size: number): string {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  if (size >= 1024) return `${Math.max(1, Math.round(size / 1024))} KB`
  return `${size} B`
}

function Composer({ state, controller, renderFactorySlot, t, threadRoot }: {
  readonly state: CollaborationState
  readonly controller: CollaborationController
  readonly t: Copy
  readonly threadRoot?: string
  readonly renderFactorySlot?: PropsRenderFactories['renderFactorySlot'] | undefined
}) {
  const [draft, setDraft] = useState('')
  const [mentions, setMentions] = useState<string[]>([])
  const [peopleMentions, setPeopleMentions] = useState<string[]>([])
  const [openAttachmentMenu, setOpenAttachmentMenu] = useState(false)
  const [openMentions, setOpenMentions] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [typedMention, setTypedMention] = useState(false)
  const [uploads, setUploads] = useState<PendingUpload[]>([])
  const [intakeError, setIntakeError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const mentionWrap = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const dropTarget = useRef<HTMLFormElement>(null)
  const uploadSequence = useRef(0)
  const previews = useRef(new Map<DraftAttachmentId, string>())
  useEffect(() => () => { for (const url of previews.current.values()) URL.revokeObjectURL(url); previews.current.clear() }, [])
  useEffect(() => {
    const live = new Set(uploads.map(upload => upload.key))
    for (const [id, url] of previews.current) if (!live.has(id)) { URL.revokeObjectURL(url); previews.current.delete(id) }
  }, [uploads])
  const detail = state.selection?.detail
  useEffect(() => { setDraft(''); setMentions([]); setPeopleMentions([]); setUploads([]); setIntakeError(null); setOpenAttachmentMenu(false) }, [detail?.id, threadRoot])
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
  const uploadPending = uploads.some(upload => upload.status !== 'ready')
  // Typing @ right before the caret summons the member picker filtered by the
  // partial name after it; the button opens the same menu unfiltered.
  const refreshMentionQuery = (text: string, caret: number | null): void => {
    const match = /(?:^|\s)@([^\s@]*)$/.exec(text.slice(0, caret ?? text.length))
    if (match !== null) { setOpenAttachmentMenu(false); setMentionQuery(match[1] ?? ''); setTypedMention(true); setOpenMentions(true) }
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
  const uploadFile = (upload: PendingUpload): void => {
    setUploads(current => current.map(item => item.key === upload.key ? { ...item, status: 'uploading' } : item))
    void controller.uploadAttachment(detail.id, upload.file)
      .then((ref) => { setUploads(current => current.map(item => item.key === upload.key ? { ...item, status: 'ready' as const, ref } : item)) })
      .catch(() => { setUploads(current => current.map(item => item.key === upload.key ? { ...item, status: 'error' as const } : item)) })
  }
  const pickFiles = (files: readonly File[], directories?: ReadonlySet<File>): void => {
    if (sending) return
    if (directories !== undefined && directories.size > 0) { setIntakeError(t('attachDirectoryUnsupported')); return }
    setIntakeError(null)
    for (const file of files) {
      const key = `room-file-${uploadSequence.current++}` as DraftAttachmentId
      const previewUrl = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) ? URL.createObjectURL(file) : undefined
      if (previewUrl !== undefined) previews.current.set(key, previewUrl)
      const upload: PendingUpload = { key, file, status: 'uploading', ...(previewUrl === undefined ? {} : { previewUrl }) }
      setUploads(current => [...current, upload])
      uploadFile(upload)
    }
    if (fileInput.current !== null) fileInput.current.value = ''
  }
  const openFilePicker = (): void => { setOpenAttachmentMenu(false); fileInput.current?.click() }
  return <form ref={dropTarget} className={css.composer} onKeyDownCapture={(event) => {
    if (!openAttachmentMenu) return
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpenAttachmentMenu(false); input.current?.focus() }
    else if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); openFilePicker() }
  }} onSubmit={(event) => { void send(event) }}>
    <ComposerCard>
      <RoomAttachmentMenu open={openAttachmentMenu} fileLabel={t('attachFile')} sectionLabel={t('attachMenuTitle')}
        onPick={openFilePicker} onDismiss={() => { setOpenAttachmentMenu(false) }} renderFactorySlot={renderFactorySlot} />
      {(mentions.length > 0 || peopleMentions.length > 0) && <div className={css.mentionChips}>{mentions.map((id) => {
        const member = detail.members.find(item => item.employeeId === id)
        return <button key={`employee:${id}`} type="button" onClick={() => { setMentions(mentions.filter(value => value !== id)) }} aria-label={`${t('removeMention')} ${member?.displayName ?? id}`}>@{member?.displayName ?? id} ×</button>
      })}{peopleMentions.map((id) => {
        const member = people.find(item => item.userId === id)
        return <button key={`human:${id}`} type="button" onClick={() => { setPeopleMentions(peopleMentions.filter(value => value !== id)) }} aria-label={`${t('removeMention')} ${member?.displayName ?? id}`}>@{member?.displayName ?? id} ×</button>
      })}</div>}
      {renderFactorySlot === undefined ? <div className={css.uploads}>{uploads.map(upload => <span key={upload.key}>
        {upload.file.name}{upload.status === 'error' && <button type="button" onClick={() => { uploadFile(upload) }}>{t('retry')}</button>}<button type="button" aria-label={`${t('removeAttachment')} ${upload.file.name}`}
          onClick={() => { setUploads(current => current.filter(item => item.key !== upload.key)) }}>×</button>
      </span>)}</div> : renderFactorySlot('attachments.composer', {
        attachments: uploads.map(upload => upload.previewUrl === undefined
          ? { kind: 'file' as const, id: upload.key, file: upload.file }
          : { kind: 'image' as const, id: upload.key, file: upload.file, previewUrl: upload.previewUrl }),
        uploads: Object.fromEntries(uploads.map(upload => [upload.key, { status: upload.status }])),
        canAcceptDrop: !sending, dropTarget, onAddFiles: pickFiles,
        onRemoveAttachment: (id) => { setUploads(current => current.filter(item => item.key !== id)) },
        onRetryFile: (id) => { const upload = uploads.find(item => item.key === id); if (upload !== undefined) uploadFile(upload) },
      })}
      {intakeError !== null && <div role="alert">{intakeError}</div>}
      <textarea ref={input} value={draft}
        onChange={(event) => { setDraft(event.target.value); refreshMentionQuery(event.target.value, event.target.selectionStart) }}
        onPaste={(event) => {
          const files = Array.from(event.clipboardData.files)
          if (files.length > 0) { event.preventDefault(); pickFiles(files) }
        }}
        onKeyDown={onKeyDown} placeholder={threadRoot !== undefined ? t('threadPlaceholder')
          : detail.kind === 'channel' ? t('channelPostPlaceholder', { name: detail.name }) : t('roomPlaceholder')} aria-label={t('message')} disabled={sending} rows={2}/>
      <ComposerControlRow className={css.composerActions}>
        <input ref={fileInput} type="file" multiple hidden
          onChange={(event) => { pickFiles(Array.from(event.target.files ?? [])) }}/>
        <button type="button" className={css.attach} aria-label={t('attach')} title={t('attach')}
          aria-haspopup="listbox" aria-expanded={openAttachmentMenu} disabled={sending}
          onMouseDown={(event) => { event.preventDefault() }}
          onClick={() => { setOpenMentions(false); setOpenAttachmentMenu(!openAttachmentMenu); input.current?.focus() }}>
          <IconPlusOutlineMedium size={14} /></button>
        <div ref={mentionWrap} className={css.mentionWrap}><button type="button" aria-expanded={openMentions} onClick={() => { setOpenAttachmentMenu(false); setTypedMention(false); setMentionQuery(''); setOpenMentions(!openMentions) }}>{t('mentionMember')}</button>
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
        <ComposerSendButton type="submit" disabled={sending || uploadPending || (draft.trim() === '' && readyAttachments.length === 0)} aria-label={t('send')} />
      </ComposerControlRow>
    </ComposerCard>
  </form>
}

/** One shared timeline for people and Bots, with a room context and thread rail. */
export function CollaborationRoom({ state, controller, renderFactorySlot, t }: {
  readonly state: CollaborationState
  readonly controller: CollaborationController
  readonly renderFactorySlot?: PropsRenderFactories['renderFactorySlot'] | undefined
  readonly t: Copy
}) {
  const [showDetails, setShowDetails] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const scroll = useRef<HTMLDivElement>(null)
  const scrollBeforePrepend = useRef<{ height: number; top: number }>()
  const atBottom = useRef(true)
  const threadScroll = useRef<HTMLDivElement>(null)
  const threadAtBottom = useRef(true)
  const threadBeforePrepend = useRef<{ height: number; top: number }>()
  const threadCloseButton = useRef<HTMLButtonElement>(null)
  const threadOrigin = useRef<HTMLElement | null>(null)
  const selectedThread = state.selection?.threadRoot
  useEffect(() => {
    if (selectedThread === undefined) {
      if (threadOrigin.current?.isConnected) threadOrigin.current.focus({ preventScroll: true })
      threadOrigin.current = null
      return
    }
    threadOrigin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    threadAtBottom.current = true
    threadBeforePrepend.current = undefined
    threadCloseButton.current?.focus({ preventScroll: true })
  }, [selectedThread])
  useLayoutEffect(() => {
    const element = threadScroll.current
    if (element === null) return
    const before = threadBeforePrepend.current
    if (before !== undefined) {
      element.scrollTop = before.top + element.scrollHeight - before.height
      threadBeforePrepend.current = undefined
    } else if (threadAtBottom.current) element.scrollTop = element.scrollHeight
  }, [selectedThread, state.threadEvents, state.threadPhase])
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
  const timeline = useMemo(() => state.events.filter(event => event.kind !== 7
    && attachmentFailureTag(event) === undefined), [state.events])
  const selected = state.selection
  // Same seed resolution as the workbench roster cards: profile seed, else the
  // employee id, so every digital employee shows the roster face, never a text
  // initial.
  const avatars = useMemo(() => new Map((selected?.detail.members ?? []).map(member =>
    [member.employeeId, dicebearAvatarUrl(member.avatarSeed ?? member.employeeId)] as const)), [selected?.detail.members])
  // Signed reply revisions invalidate empty or earlier delivery lists.
  const sourceRevisions = useMemo(() => {
    const revisions = new Map<string, string>()
    const rootEvents = state.threadRootEvent === undefined ? [] : [state.threadRootEvent]
    for (const event of [...state.events, ...state.threadEvents, ...state.searchResults, ...rootEvents]) {
      if (event.kind === 9 && event.author.kind === 'employee' && event.sourceSessionId !== undefined) {
        const prior = revisions.get(event.sourceSessionId)
        if (prior === undefined || BigInt(event.sequence) > BigInt(prior)) revisions.set(event.sourceSessionId, event.sequence)
      }
    }
    return JSON.stringify([...revisions])
  }, [state.events, state.threadEvents, state.searchResults, state.threadRootEvent])
  const [presentedFiles, setPresentedFiles] = useState<ReadonlyMap<string, readonly RoomPresentedFile[]>>(new Map())
  useEffect(() => {
    let live = true
    const revisions = JSON.parse(sourceRevisions) as readonly (readonly [string, string])[]
    for (const [sessionId, revision] of revisions) {
      void controller.presentedFiles(sessionId, revision)
        .then((files) => { if (live) setPresentedFiles(current => new Map(current).set(sessionId, files)) })
        .catch((_error: unknown) => { /* A later signed reply retries unavailable delivery metadata. */ })
    }
    return () => { live = false }
  }, [controller, roomId, sourceRevisions])
  const presentedFor = (event: RoomEvent): readonly RoomPresentedFile[] | undefined => {
    const files = event.sourceSessionId === undefined ? undefined : presentedFiles.get(event.sourceSessionId)
    return files === undefined ? undefined
      : filesForRoomReply([...state.events, ...state.threadEvents, ...state.searchResults,
        ...(state.threadRootEvent === undefined ? [] : [state.threadRootEvent])], event, files)
  }
  const admissionFailures = useMemo(() => [...new Map([...state.events, ...state.threadEvents]
    .filter(event => attachmentFailureTag(event) !== undefined).map(event => [event.id, event])).values()],
  [state.events, state.threadEvents])
  const visibleThreadReplies = useMemo(() => {
    const thread = selected?.threadRoot
    if (thread === undefined || selected === null) return []
    const fetched = new Set(state.threadEvents.map(event => event.id))
    const records = channelThreadEvents([...state.events, ...state.threadEvents], selected.detail)
    const unique = new Map(records.filter(event => event.id !== thread
      && attachmentFailureTag(event) === undefined
      && (event.threadRoot === thread || fetched.has(event.id))).map(event => [event.id, event]))
    return [...unique.values()].sort((left, right) => BigInt(left.sequence) < BigInt(right.sequence) ? -1 : 1)
  }, [selected?.threadRoot, selected?.detail, state.events, state.threadEvents])
  const displayedThreadReplies = useMemo(() => selected?.detail.kind === 'channel'
    ? threadReplyItems(visibleThreadReplies)
    : visibleThreadReplies.filter(event => event.kind !== 7).map(event => ({ event, details: [] })),
  [visibleThreadReplies, selected?.detail.kind])
  const memberNames = useMemo(() => new Map((selected?.detail.members ?? []).map(member =>
    [member.employeeId, member.displayName] as const)), [selected?.detail.members])
  const threadAnswerSequences = useMemo(() => answerSequences(visibleThreadReplies), [visibleThreadReplies])
  // Group one agent reply: the employee's tool/progress events fold into their
  // next signed answer as collapsed details; a mentioned employee without an
  // answer yet renders a working chip on the mentioning message. Orphan
  // progress events (agent stopped, or a new turn started) render standalone.
  const channelTimeline = useMemo(() => selected === null ? timeline : channelThreadEvents(timeline, selected.detail),
    [timeline, selected?.detail])
  const displayItems = useMemo(() => {
    const items: TimelineItem[] = []
    const pending = new Map<string, RoomEvent[]>()
    // The employee's last signed answer across the whole timeline decides
    // whether an earlier mention is still being worked on.
    const answeredSeq = answerSequences(channelTimeline)
    // In channels every reply belongs to the thread of the message it answers:
    // claim human and agent replies alike so the main timeline stays root-only.
    const isChannel = (selected?.detail.kind ?? 'group') === 'channel'
    const threadReplies = new Map<string, RoomEvent[]>()
    const orphanThreads = new Map<string, RoomEvent[]>()
    if (isChannel) {
      const rootIds = new Set(channelTimeline.filter(event => event.threadRoot === undefined).map(event => event.id))
      for (const event of channelTimeline) {
        if (event.threadRoot === undefined) continue
        const target = rootIds.has(event.threadRoot) ? threadReplies : orphanThreads
        const list = target.get(event.threadRoot) ?? []
        list.push(event)
        target.set(event.threadRoot, list)
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
    for (const event of channelTimeline) {
      if (isChannel && event.kind !== 9 && event.kind !== 7 && event.threadRoot === undefined) continue
      if (isChannel && event.threadRoot !== undefined) {
        if (threadReplies.has(event.threadRoot)) continue
        const orphan = orphanThreads.get(event.threadRoot)
        if (orphan !== undefined) {
          // The triggering message is older than the loaded page: the thread
          // still stays out of the channel timeline and renders as one chip.
          if (orphan[0]?.id !== event.id) continue
          items.push({ event, orphanThread: { rootId: event.threadRoot, events: orphan } })
          continue
        }
      }
      if (event.author.kind === 'employee' && event.kind !== 9) {
        const list = pending.get(event.author.id) ?? []
        list.push(event)
        pending.set(event.author.id, list)
        continue
      }
      if (event.author.kind === 'employee') {
        if (!isChannel && event.tags.some(tag => tag[0] === 'dsh-schedule')) {
          runAnswered.delete(event.author.id)
          runAnswerItem.delete(event.author.id)
        }
        const details = pending.get(event.author.id)
        pending.delete(event.author.id)
        if (!isChannel && runAnswered.has(event.author.id)) {
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
        const replies = isChannel ? threadReplies.get(event.id)?.filter(reply => reply.kind === 9) : undefined
        const item: TimelineItem = { event, ...(details === undefined ? {} : { workflowDetails: details }),
          ...(replies === undefined ? {} : { threadReplies: replies }) }
        if (item.workflowDetails !== undefined) item.workflowDetails = [...item.workflowDetails]
        runAnswerItem.set(event.author.id, item)
        items.push(item)
        continue
      }
      flushOrphans()
      runAnswered.clear()
      runAnswerItem.clear()
      const working = workingChipsFor(event, answeredSeq, memberNames, avatars, admissionFailures)
      const replies = isChannel ? threadReplies.get(event.id)?.filter(reply => reply.kind === 9) : undefined
      items.push({ event, ...(working === undefined ? {} : { working }), ...(replies === undefined ? {} : { threadReplies: replies }) })
    }
    flushOrphans()
    return items
  }, [channelTimeline, avatars, selected?.detail.kind, memberNames, admissionFailures])
  if (selected === null) return <main className={css.room}><div className={css.center}>
    {state.roomPhase === 'loading' ? <IconLoadingOutlineRegular size={20}/> : t(state.error === 'forbidden' ? 'forbidden' : state.roomPhase === 'error' ? 'loadError' : 'noSelection')}
  </div></main>
  const detail = selected.detail
  const avatarFor = (event: RoomEvent): string | undefined => event.author.kind === 'employee' ? avatars.get(event.author.id) : undefined
  const attachmentUrlFor = (attachmentId: string): string => controller.attachmentUrl(detail.id, attachmentId)

  const noticeFor = (event: RoomEvent): AttachmentNotice => {
    const tag = attachmentFailureTag(event)
    const name = detail.members.find(member => member.employeeId === tag?.[3])?.displayName ?? t('attachmentRecipient')
    return { id: event.id, text: t(tag?.[1] === 'model-does-not-support-images' ? 'attachmentModelUnsupported' : 'attachmentRejected', { name }) }
  }
  const noticesFor = (sourceId: string): readonly AttachmentNotice[] => admissionFailures
    .filter(event => attachmentFailureSource(event) === sourceId).map(noticeFor)
  const displayedIds = new Set(displayItems.map(item => item.event.id))
  if (selected.threadRoot !== undefined) {
    displayedIds.add(selected.threadRoot)
    for (const event of visibleThreadReplies) if (event.kind === 9) displayedIds.add(event.id)
  }
  const detachedFailures = admissionFailures.filter(event => !displayedIds.has(attachmentFailureSource(event) ?? ''))

  const isSelf = (event: RoomEvent): boolean => event.author.kind === 'human' && event.author.id === detail.viewerUserId
  const threadRoot = selected.threadRoot
  const root = threadRoot === undefined ? undefined : state.threadRootEvent
    ?? [...state.events, ...state.searchResults].find(event => event.id === threadRoot)
  const rootWorking = root === undefined ? undefined
    : workingChipsFor(root, threadAnswerSequences, memberNames, avatars, admissionFailures)
  return <main className={`${css.room} ${detail.kind === 'channel' ? css.channel : ''}`}>

    <header className={css.header}>
      <div className={css.heading}><span className={css.roomIcon}>{detail.kind === 'channel' ? '#' : <IconUsersOutlineRegular size={18}/>}</span><div><h1>{detail.name}</h1><p>{t(detail.kind === 'group' ? 'groups' : 'channels')} · {detail.memberCount} {t('memberCount')}{state.roomReconciling && <span className={css.historySync} role="status"><IconLoadingOutlineRegular size={12}/>{t('historySyncing')}</span>}</p></div></div>
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
          {state.searchPhase === 'ready' && (state.searchResults.length === 0 ? <div className={css.center}>{t('noSearchResults')}</div> : state.searchResults.map(event => <Entry postLayout={detail.kind === 'channel'} renderFactorySlot={renderFactorySlot} presented={presentedFor(event)} key={event.id} event={event} reactions={[]} self={isSelf(event)} avatarUrl={avatarFor(event)} attachmentUrlFor={attachmentUrlFor} onThread={(id) => { setShowSearch(false); void controller.openThread(id) }} onReaction={(id, emoji) => { void controller.react(id, emoji) }} onInspect={(id) => { void controller.inspect(id) }} t={t}/>))}
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
              const { orphanThread } = item
              if (orphanThread !== undefined) {
                const replies = orphanThread.events.filter(event => event.kind === 9)
                const last = replies.at(-1)
                const authors = [...new Map(replies.map(reply => [`${reply.author.kind}:${reply.author.id}`, reply])).values()].slice(-3)
                return <button type="button" key={item.event.id} className={css.threadChip}
                  onClick={() => { void controller.openThread(orphanThread.rootId) }}>
                  <span className={css.threadStack}>{authors.map(reply => <span key={reply.author.id} className={css.threadAvatar}
                    aria-label={reply.author.displayName}>{reply.author.displayName.slice(0, 1)}</span>)}</span>
                  <span>{t('threadReplies', { count: replies.length })}</span>
                  {last !== undefined && <span className={css.threadTime}>{t('lastReplyAt', { time: new Date(last.created_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })}</span>}
                </button>
              }
              const presented = presentedFor(item.event)
              const foldedPresented = (item.workflowDetails ?? []).flatMap((reply) => {
                const files = presentedFor(reply)
                return reply.sourceSessionId === undefined || files === undefined || files.length === 0 ? []
                  : [{ id: reply.id, sessionId: reply.sourceSessionId, files }]
              })
              return <Entry postLayout={detail.kind === 'channel'} renderFactorySlot={renderFactorySlot} key={item.event.id} event={item.event} attachmentNotices={noticesFor(item.event.id)}
                foldedPresented={foldedPresented}
                onReply={detail.kind === 'channel' && item.event.kind === 9 ? () => { void controller.openThread(item.event.threadRoot ?? item.event.id) } : undefined}
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
        {detail.kind === 'channel' && channelTimeline.some(event => event.kind !== 9 && event.kind !== 7
          && event.threadRoot === undefined) && <ExecutionFacts
          events={channelTimeline.filter(event => event.kind !== 9 && event.kind !== 7 && event.threadRoot === undefined)}
          onInspect={(id) => { void controller.inspect(id) }} t={t}/>}
        {detachedFailures.map((event) => { const notice = noticeFor(event); return <p key={notice.id} role="alert" className={css.error}>{notice.text}</p> })}
        {state.error !== null && <p className={css.error} role="alert">{t(state.error === 'team-attachments-unavailable' ? 'teamAttachmentsUnavailable'
          : state.error === 'forbidden' ? 'forbidden' : 'requestFailed')}</p>}
        <Composer state={state} controller={controller} renderFactorySlot={renderFactorySlot} t={t}/>
      </div>
      {(showDetails || threadRoot !== undefined) && <aside className={`${css.side} ${detail.kind === 'channel' && threadRoot !== undefined ? css.threadPane : ''}`} aria-label={t(threadRoot === undefined ? 'roomDetails' : 'roomThread')} onKeyDown={(event) => {
        if (threadRoot !== undefined && event.key === 'Escape' && !event.defaultPrevented
          && event.currentTarget.querySelector('[aria-expanded="true"]') === null) { event.preventDefault(); controller.closeThread() }
      }}>
        <div className={css.sideHeader}><h2>{t(threadRoot === undefined ? 'roomDetails' : 'roomThread')}</h2><button ref={threadCloseButton} type="button" aria-label={t('closeDetails')} onClick={() => { if (threadRoot !== undefined) controller.closeThread(); else setShowDetails(false) }}><IconCloseOutlineRegular size={16}/></button></div>
        {threadRoot === undefined ? <div className={css.details}>
          <CollaborationGroupDetails key={detail.id} detail={detail} controller={controller} t={t}/>
          {detail.team !== undefined && <section><h3>{t('team')}</h3><p>{detail.team.name}</p></section>}
          {detail.project !== undefined && <section><h3>{t('project')}</h3><p>{detail.project.name}</p></section>}
          {detail.kind === 'channel' && <details className={css.channelAutomation}><summary>{t('channelAutomation')}</summary>
            <ChannelDecisionQueue key={`${detail.id}-decisions`} channelId={detail.id} t={t}/>
            <ChannelWorkflowEditor key={`${detail.id}-workflows`} channelId={detail.id} t={t}/></details>}
        </div> : <>
          <div className={css.threadScroll} ref={threadScroll} onScroll={() => {
            const element = threadScroll.current
            if (element !== null) threadAtBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80
          }}>
            {root !== undefined && <div className={css.threadRootPost}>
              <Entry postLayout={detail.kind === 'channel'} renderFactorySlot={renderFactorySlot} presented={presentedFor(root)}
                event={root} reactions={reactionSummaries(state.events, root.id, detail.viewerUserId)} self={isSelf(root)}
                avatarUrl={avatarFor(root)} attachmentUrlFor={attachmentUrlFor} attachmentNotices={noticesFor(root.id)} onThread={() => {}}
                {...(rootWorking === undefined ? {} : { working: rootWorking })}
                onReaction={(id, emoji) => { void controller.react(id, emoji) }} onInspect={(id) => { void controller.inspect(id) }} t={t}/>
            </div>}
            {state.threadOlderCursor != null && <button type="button" className={css.more} disabled={state.threadLoadingOlder}
              onClick={() => {
                const element = threadScroll.current
                if (element !== null) threadBeforePrepend.current = { height: element.scrollHeight, top: element.scrollTop }
                void controller.loadOlderThread()
              }}>{t('loadOlder')}</button>}
            {state.threadOlderError && <div className={css.historyError} role="alert">{t('loadError')}
              <button type="button" onClick={() => { void controller.loadOlderThread() }}>{t('retry')}</button></div>}
            <h3 className={css.threadReplyHeading}>{t('threadRepliesHeading')}</h3>
            {state.threadPhase === 'loading' && <div className={css.center}><IconLoadingOutlineRegular size={20}/></div>}
            {state.threadPhase === 'error' && <div className={css.center} role="alert">{t('loadError')}
              <button type="button" onClick={() => { void controller.openThread(threadRoot) }}>{t('retry')}</button></div>}
            {state.threadPhase === 'ready' && displayedThreadReplies.length === 0 && <p className={css.emptyThread}>{t('emptyThread')}</p>}
            {state.threadPhase === 'ready' && displayedThreadReplies.map((item) => {
              if (detail.kind === 'channel' && item.event.kind !== 9) return <ExecutionFacts key={item.event.id}
                events={[item.event, ...item.details]}
                onInspect={(id) => { void controller.inspect(id) }} t={t}/>
              const folded = item.details.flatMap((reply) => {
                const files = presentedFor(reply)
                return reply.sourceSessionId === undefined || files === undefined || files.length === 0 ? []
                  : [{ id: reply.id, sessionId: reply.sourceSessionId, files }]
              })
              const working = workingChipsFor(item.event, threadAnswerSequences, memberNames, avatars, admissionFailures)
              return <Entry postLayout={detail.kind === 'channel'} renderFactorySlot={renderFactorySlot}
                presented={presentedFor(item.event)} foldedPresented={folded} workflowDetails={item.details}
                key={item.event.id} event={item.event} attachmentNotices={noticesFor(item.event.id)}
                {...(working === undefined ? {} : { working })}
                reactions={reactionSummaries(visibleThreadReplies, item.event.id, detail.viewerUserId)}
                self={isSelf(item.event)} avatarUrl={avatarFor(item.event)} attachmentUrlFor={attachmentUrlFor}
                onThread={() => {}} onReaction={(id, emoji) => { void controller.react(id, emoji) }}
                onInspect={(id) => { void controller.inspect(id) }} t={t}/>
            })}
          </div>
          <Composer state={state} controller={controller} renderFactorySlot={renderFactorySlot} t={t} threadRoot={threadRoot}/>
        </>}

      </aside>}
    </div>
  </main>
}
