/** Authenticated enterprise identity rendered below the Settings trigger. */

import { useState } from 'react'
import { IconUserOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { GovernancePrincipal } from './controller.ts'
import css from './EnterpriseAccountCard.module.css'

export interface EnterpriseAccountCardProps {
  readonly wide: boolean
  readonly principal: GovernancePrincipal
  readonly logout: () => Promise<void>
}

/** Show the current identity and provide the account-level logout action. */
export function EnterpriseAccountCard({ wide, principal, logout }: EnterpriseAccountCardProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const role = principal.roles.join(' · ')
  const label = `退出登录：${principal.displayName}`
  const submit = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await logout()
    } catch (reason) {
      setBusy(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  if (!wide) {
    return <Tooltip label={label} delayMs={500}>
      <button type="button" className={css.railButton} aria-label={label} disabled={busy}
        onClick={() => { void submit() }}>
        <IconUserOutline16 size={18} />
      </button>
    </Tooltip>
  }

  return <section className={css.card} aria-label="当前用户">
    <div className={css.identity}>
      <span className={css.avatar} aria-hidden="true"><IconUserOutline16 size={16} /></span>
      <span className={css.copy}>
        <strong title={principal.displayName}>{principal.displayName}</strong>
        <span title={`@${principal.username} · ${role}`}>@{principal.username} · {role}</span>
      </span>
    </div>
    <button type="button" className={css.logout} disabled={busy} onClick={() => { void submit() }}>
      {busy ? '正在退出…' : '退出登录'}
    </button>
    {error !== null && <span className={css.error} role="alert">退出失败，请重试</span>}
  </section>
}
