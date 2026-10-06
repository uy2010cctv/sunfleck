/** Running Turn clock isolated from the transcript's render cycle. */
import { memo, useEffect, useState, type CSSProperties } from 'react'
import { TextShimmer } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { formatRunDuration, LIVE_RUN_CLOCK_INTERVAL_MS } from './message-chrome.ts'
import growthCss from './TurnProcessNodeView.module.css'

const GROWTH_STAGES = ['。', '丨', '十', '木', '林', '森'] as const
import a11yCss from './accessibility.module.css'
import css from './ChatView.module.css'

interface RunningStatusProps {
  readonly startTime: number | undefined
  readonly t: ChatViewSlotProps['t']
}

/**
 * Show live elapsed time after the current Turn's content without announcing ticks.
 * @param props - Current Turn start time and localized copy.
 * @returns the SUNFLECK growth indicator; mount only while the Session is running.
 */
export const RunningStatus = memo(function RunningStatus({ startTime, t }: RunningStatusProps) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (startTime === undefined) return
    setNow(Date.now())
    const timer = setInterval(() => { setNow(Date.now()) }, LIVE_RUN_CLOCK_INTERVAL_MS)
    return () => { clearInterval(timer) }
  }, [startTime])
  const label = startTime === undefined ? t('chat.deepDiving') : t('chat.deepDivingFor', {
    duration: formatRunDuration(Math.max(1000, now - startTime), t).map(part => part.text).join(''),
  })
  return (
    <div className={css.running} data-chat-running>
      <span className={a11yCss.visuallyHidden} role="status" aria-live="polite" aria-atomic="true">{t('chat.deepDiving')}</span>
      <span className={css.runningDivider} aria-hidden="true" />
      <span className={css.runningContent}>
        <span className={growthCss.growthMark} aria-hidden="true">
          {GROWTH_STAGES.map((stage, index) => <span key={stage} className={growthCss.growthStage}
            style={{ '--stage': index } as CSSProperties} data-growth-stage={stage} />)}
        </span>
        <TextShimmer active className={`${css.runningText} ${growthCss.growthText}`}>{label}</TextShimmer>
      </span>
    </div>
  )
})
