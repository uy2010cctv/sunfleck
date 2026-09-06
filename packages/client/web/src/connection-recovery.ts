/** Framework-free recovery notice for a lost Host transport. */

import type { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import css from './connection-recovery.module.css'

/** Browser-safe slice of the connection service used by the boot kernel. */
export interface RecoverableConnection {
  reconnect(): void
  state: {
    getSnapshot(): 'connected' | 'connecting' | 'disconnected' | undefined
    subscribe(listener: () => void): () => void
  }
}

/** Locale face used by the recovery notice after the client plugin tree mounts. */
type RecoveryLocale = Pick<LocaleRuntime, 'bind' | 'subscribe'>

/**
 * Keeps recovery controls outside the application renderer so a Host restart
 * cannot turn an already-mounted route into a blank root. The application
 * state remains mounted; recovery asks the owned connection loop for a new
 * carrier rather than reloading the document.
 */
export class ConnectionRecovery {
  private readonly root = document.createElement('aside')
  private readonly unsubscribe: () => void

  constructor(private readonly connection: RecoverableConnection, private readonly locale: RecoveryLocale) {
    this.root.dataset.dshConnectionRecovery = ''
    this.root.className = css.notice ?? ''
    this.root.setAttribute('role', 'status')
    this.root.setAttribute('aria-live', 'polite')
    const stopConnection = connection.state.subscribe(() => { this.render() })
    const stopLocale = locale.subscribe(() => { this.render() })
    this.unsubscribe = () => {
      stopConnection()
      stopLocale()
    }
    document.body.append(this.root)
    this.render()
  }

  /** Release the browser-owned notice with the client plugin tree. */
  dispose(): void {
    this.unsubscribe()
    this.root.remove()
  }

  private render(): void {
    if (this.connection.state.getSnapshot() !== 'disconnected') {
      this.root.hidden = true
      return
    }
    this.root.hidden = false
    const title = document.createElement('strong')
    title.className = css.title ?? ''
    const t = this.locale.bind('common')
    title.textContent = t('connection.recovery.title')
    const body = document.createElement('div')
    body.className = css.body ?? ''
    body.textContent = t('connection.recovery.body')
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset.dshConnectionRetry = ''
    button.className = css.action ?? ''
    button.textContent = t('connection.recovery.action')
    button.addEventListener('click', () => { this.connection.reconnect() })
    this.root.replaceChildren(title, body, button)
  }
}
