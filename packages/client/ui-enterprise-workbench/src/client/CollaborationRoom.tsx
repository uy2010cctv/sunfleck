/** Shared group/channel room in the existing SUNFLECK main panel. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { IconCloseOutlineRegular, IconLoadingOutlineRegular, IconSearchOutlineRegular, IconSendOutlineRegular, IconUsersOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CollaborationController, CollaborationState, RoomEvent } from './collaboration-store.ts'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { ChannelWorkflowEditor } from './ChannelWorkflowEditor.tsx'
import { ChannelDecisionQueue } from './ChannelDecisionQueue.tsx'
import css from './CollaborationRoom.module.css'

type Copy = TranslateNS<'enterprise.collaboration'>

/** Count signed reaction events by target and emoji; the event itself stays in the audit timeline. */
export function reactionCounts(events: readonly RoomEvent[], targetId: string): readonly { emoji: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const event of events) {
    if (event.kind !== 7 || !event.tags.some(tag => tag[0] === 'e' && tag[1] === targetId)) continue
    counts.set(event.content, (counts.get(event.content) ?? 0) + 1)
  }
  return [...counts].map(([emoji, count]) => ({ emoji, count }))
}

function shortKey(value: string): string { return value.length < 13 ? value : `${value.slice(0, 8)}…${value.slice(-4)}` }

function Entry({ event, reactions, onThread, onReaction, onInspect, t }: {
  readonly event: RoomEvent
  readonly reactions: readonly { emoji: string; count: number }[]
  readonly onThread: (id: string) => void
  readonly onReaction: (id: string, emoji: string) => void
  readonly onInspect: (id: string) => void
  readonly t: Copy
}) {
  const workflow = event.kind !== 9
  const workflowStatus = event.tags.find(tag => tag[0] === 'status')?.[1]
  const time = new Date(event.created_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return <article className={`${css.entry} ${workflow ? css.workflow : ''}`} data-event-id={event.id}>
    <span className={`${css.avatar} ${event.author.kind === 'employee' ? css.bot : event.author.kind === 'service' ? css.service : ''}`} aria-hidden="true">{event.author.displayName.slice(0, 1)}</span>
    <div className={css.entryBody}>
      <div className={css.meta}><span className={css.author}>{event.author.displayName}</span><span className={css.kind}>{t(event.author.kind === 'employee' ? 'botMember' : event.author.kind === 'service' ? 'serviceMember' : 'humanMember')}</span><time dateTime={new Date(event.created_at * 1000).toISOString()}>{time}</time>{workflow && <span className={css.kind}>{t('workflowEvent')}</span>}{workflowStatus !== undefined && <span className={css.kind}>{workflowStatus}</span>}</div>
      <p className={css.content}>{event.content}</p>
      {event.delivery === 'failed' && <p className={css.failure} role="status">{t('deliveryFailed')}</p>}
      <div className={css.eventFooter}>
        <Tooltip label={`${t('signedRecord')} · ${event.pubkey}`}><span className={css.signature}>{t('signedRecord')} · {shortKey(event.pubkey)}</span></Tooltip>
        {event.sourceSessionId !== undefined && <button type="button" onClick={() => { if (event.sourceSessionId !== undefined) onInspect(event.sourceSessionId) }}>{t('viewExecution')}</button>}
        {event.kind === 9 && <><button type="button" onClick={() => { onThread(event.id) }}>{t('replyThread')}</button>
          <button type="button" aria-label={`${t('reactTo')} ${event.author.displayName}`} onClick={() => { onReaction(event.id, '👍') }}>👍</button></>}
        {reactions.map(reaction => <button type="button" key={reaction.emoji} aria-label={`${reaction.emoji} ${reaction.count}`} onClick={() => { onReaction(event.id, reaction.emoji) }}>{reaction.emoji} {reaction.count}</button>)}
      </div>
    </div>
  </article>
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
  const [sending, setSending] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const mentionWrap = useRef<HTMLDivElement>(null)
  const detail = state.selection?.detail
  useEffect(() => { setDraft(''); setMentions([]); setPeopleMentions([]) }, [detail?.id, threadRoot])
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
  const send = async (event?: FormEvent): Promise<void> => {
    event?.preventDefault()
    if (sending || draft.trim() === '') return
    setSending(true)
    try {
      const accepted = await controller.send(draft, {
        ...(threadRoot === undefined ? {} : { threadRoot }),
        ...(mentions.length === 0 ? {} : { mentionedEmployeeIds: mentions }),
        ...(peopleMentions.length === 0 ? {} : { mentionedUserIds: peopleMentions }),
      })
      if (accepted) { setDraft(''); setMentions([]); setPeopleMentions([]); setOpenMentions(false); input.current?.focus() }
    } finally { setSending(false) }
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send() }
  }
  return <form className={css.composer} onSubmit={(event) => { void send(event) }}>
    {(mentions.length > 0 || peopleMentions.length > 0) && <div className={css.mentionChips}>{mentions.map((id) => {
      const member = detail.members.find(item => item.employeeId === id)
      return <button key={`employee:${id}`} type="button" onClick={() => { setMentions(mentions.filter(value => value !== id)) }} aria-label={`${t('removeMention')} ${member?.displayName ?? id}`}>@{member?.displayName ?? id} ×</button>
    })}{peopleMentions.map((id) => {
      const member = people.find(item => item.userId === id)
      return <button key={`human:${id}`} type="button" onClick={() => { setPeopleMentions(peopleMentions.filter(value => value !== id)) }} aria-label={`${t('removeMention')} ${member?.displayName ?? id}`}>@{member?.displayName ?? id} ×</button>
    })}</div>}
    <textarea ref={input} value={draft} onChange={(event) => { setDraft(event.target.value) }} onKeyDown={onKeyDown} placeholder={t(threadRoot === undefined ? 'roomPlaceholder' : 'threadPlaceholder')} aria-label={t('message')} disabled={sending} rows={2}/>
    <div className={css.composerActions}>
      <div ref={mentionWrap} className={css.mentionWrap}><button type="button" aria-expanded={openMentions} onClick={() => { setOpenMentions(!openMentions) }}>{t('mentionMember')}</button>
        {openMentions && <div className={css.mentionMenu}>
          <div role="group" aria-label={t('employees')}>
            {detail.members.map(member => <label key={member.employeeId}><input type="checkbox" checked={mentions.includes(member.employeeId)} onChange={(event) => { setMentions(event.target.checked ? [...mentions, member.employeeId] : mentions.filter(id => id !== member.employeeId)) }}/>{member.displayName}</label>)}
          </div>
          <div role="group" aria-label={t('people')}>
            {people.map(member => <label key={member.userId}><input type="checkbox" checked={peopleMentions.includes(member.userId)} onChange={(event) => { setPeopleMentions(event.target.checked ? [...peopleMentions, member.userId] : peopleMentions.filter(id => id !== member.userId)) }}/>{member.displayName}</label>)}
          </div>
          {detail.members.length === 0 && people.length === 0 && <span>{t('emptyEmployees')}</span>}
        </div>}
      </div>
      <span className={css.keyHint}>{t('sendHint')}</span>
      <button type="submit" className={css.send} disabled={sending || draft.trim() === ''} aria-label={t('send')}><IconSendOutlineRegular size={16}/></button>
    </div>
  </form>
}

/** One shared timeline for people and Bots, with a room context and thread rail. */
export function CollaborationRoom({ state, controller, t }: {
  readonly state: CollaborationState
  readonly controller: CollaborationController
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
  if (selected === null) return <main className={css.room}><div className={css.center}>
    {state.roomPhase === 'loading' ? <IconLoadingOutlineRegular size={20}/> : t(state.error === 'forbidden' ? 'forbidden' : state.roomPhase === 'error' ? 'loadError' : 'noSelection')}
  </div></main>
  const detail = selected.detail
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
          {state.searchPhase === 'ready' && (state.searchResults.length === 0 ? <div className={css.center}>{t('noSearchResults')}</div> : state.searchResults.map(event => <Entry key={event.id} event={event} reactions={[]} onThread={(id) => { setShowSearch(false); void controller.openThread(id) }} onReaction={(id, emoji) => { void controller.react(id, emoji) }} onInspect={(id) => { void controller.inspect(id) }} t={t}/>))}
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
            {timeline.map(event => <Entry key={event.id} event={event} reactions={reactionCounts(state.events, event.id)}
              onThread={(id) => { void controller.openThread(id) }}
              onReaction={(id, emoji) => { void controller.react(id, emoji) }}
              onInspect={(id) => { void controller.inspect(id) }} t={t}/>)}
          </>}
        </div>}
        {state.error !== null && <p className={css.error} role="alert">{t(state.error === 'forbidden' ? 'forbidden' : 'requestFailed')}</p>}
        <Composer state={state} controller={controller} t={t}/>
      </div>
      {(showDetails || threadRoot !== undefined) && <aside className={css.side} aria-label={t(threadRoot === undefined ? 'roomDetails' : 'roomThread')}>
        <div className={css.sideHeader}><h2>{t(threadRoot === undefined ? 'roomDetails' : 'roomThread')}</h2><button type="button" aria-label={t('closeDetails')} onClick={() => { if (threadRoot !== undefined) controller.closeThread(); else setShowDetails(false) }}><IconCloseOutlineRegular size={16}/></button></div>
        {threadRoot === undefined ? <div className={css.details}>
          <section><h3>{t('people')}</h3><p>{detail.memberUserIds.length} {t('humanMembers')}</p></section>
          <section><h3>{t('employees')}</h3>{detail.members.length === 0 ? <p>{t('emptyEmployees')}</p> : <ul>{detail.members.map(member => <li key={member.employeeId}>{member.displayName}{detail.dutyEmployeeIds.includes(member.employeeId) && <span>{t('onDuty')}</span>}</li>)}</ul>}</section>
          {detail.team !== undefined && <section><h3>{t('team')}</h3><p>{detail.team.name}</p></section>}
          {detail.project !== undefined && <section><h3>{t('project')}</h3><p>{detail.project.name}</p></section>}
          {detail.kind === 'channel' && <><ChannelDecisionQueue key={`${detail.id}-decisions`} channelId={detail.id} t={t}/>
            <ChannelWorkflowEditor key={`${detail.id}-workflows`} channelId={detail.id} t={t}/></>}
        </div> : <><div className={css.threadScroll}>{root !== undefined && <Entry event={root} reactions={reactionCounts(state.events, root.id)} onThread={() => {}} onReaction={(id, emoji) => { void controller.react(id, emoji) }} onInspect={(id) => { void controller.inspect(id) }} t={t}/>}{state.threadPhase === 'loading' && <div className={css.center}><IconLoadingOutlineRegular size={20}/></div>}{state.threadPhase === 'error' && <div className={css.center} role="alert">{t('loadError')}<button type="button" onClick={() => { void controller.openThread(threadRoot) }}>{t('retry')}</button></div>}{state.threadPhase === 'ready' && state.threadEvents.filter(event => event.kind !== 7 && event.id !== threadRoot).map(event => <Entry key={event.id} event={event} reactions={reactionCounts(state.threadEvents, event.id)} onThread={() => {}} onReaction={(id, emoji) => { void controller.react(id, emoji) }} onInspect={(id) => { void controller.inspect(id) }} t={t}/>)}</div><Composer state={state} controller={controller} t={t} threadRoot={threadRoot}/></>}
      </aside>}
    </div>
  </main>
}
