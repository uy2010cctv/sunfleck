import { memo, useEffect, useState, type CSSProperties } from 'react'
import { IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatNodeViewProps } from '../contract/slots.ts'
import { turnProcessAlwaysOpen } from '../contract/turn-process.ts'
import { formatLiveRunDuration, formatRunDuration, LIVE_RUN_CLOCK_INTERVAL_MS } from './message-chrome.ts'
import a11yCss from './accessibility.module.css'
import css from './TurnProcessNodeView.module.css'

/** Growth stages of the running mark: seed, sprout, breaking soil, tree, grove, forest. */
const GROWTH_STAGES = ['。', '丨', '十', '木', '林', '森'] as const

/** Turn-level process disclosure controller. */
export const TurnProcessNodeView = memo(function TurnProcessNodeView({
  node, turnProcess, t,
}: ChatNodeViewProps<'turn-process'>) {
  if (turnProcess === undefined) throw new Error('turn-process node requires Turn process owner state')
  const open = !turnProcess.foldable || turnProcess.open
  const turn = node.location.kind === 'turn' || node.location.kind === 'step'
    ? node.location.turn
    : undefined
  const [now, setNow] = useState(Date.now)
  const ticking = turn?.status === 'open' && turn.start !== undefined
  useEffect(() => {
    if (!ticking) return
    setNow(Date.now())
    const timer = setInterval(() => { setNow(Date.now()) }, LIVE_RUN_CLOCK_INTERVAL_MS)
    return () => { clearInterval(timer) }
  }, [ticking])
  if (turn?.start === undefined && turn?.status !== 'closed') return null
  const canCollapse = turnProcess.foldable && turnProcess.hasContent && !turnProcessAlwaysOpen(node)
  const running = turn.status === 'open'
  const reason = turn.end?.data.reason.kind
  const elapsedMs = turn.start === undefined ? undefined
    : Math.max(1000, (turn.end?.time ?? now) - turn.start.time)
  const duration = elapsedMs === undefined ? undefined
    : running ? formatLiveRunDuration(elapsedMs, t) : formatRunDuration(elapsedMs, t)
  // Other end reasons retain elapsed time; only cancellation and failure replace it.
  const label = running
    ? duration === undefined ? t('chat.growing') : t('message.turnProcess.growingFor', { duration })
    : reason === 'aborted' ? t('message.stopped')
      : reason === 'error' ? t('message.turnProcess.failed')
        : duration === undefined ? t('message.turnProcess.worked')
          : t('message.turnProcess.took', { duration })
  const announcement = running ? t('chat.growing')
    : reason === 'aborted' ? t('message.stopped')
      : reason === 'error' ? t('message.turnProcess.failed')
        : t('message.turnProcess.worked')
  return (
    <>
      <span className={a11yCss.visuallyHidden} role="status" aria-live="polite" aria-atomic="true">{announcement}</span>
      <button
        type="button"
        className={css.root}
        data-open={open || undefined}
        data-turn-process={node.data.turn}
        data-turn-process-messages={node.data.messageCount}
        data-turn-process-tool-calls={node.data.toolCallCount}
        data-turn-process-subagents={node.data.subagentCount}
        disabled={!canCollapse}
        aria-expanded={turnProcess.hasContent ? open : undefined}
        onClick={(event) => {
          event.currentTarget.focus()
          turnProcess.setOpen(!open)
        }}
      >
        <span className={css.label}>
          {running && <span className={css.growthMark} aria-hidden="true">
            {GROWTH_STAGES.map((stage, index) => <span key={stage} className={css.growthStage}
              style={{ '--stage': index } as CSSProperties}>{stage}</span>)}
          </span>}
          <span className={running ? css.growthText : undefined}>{label}</span>
        </span>
        {canCollapse && <IconChevronDownOutlineRegular className={css.chevron} />}
      </button>
    </>
  )
})
