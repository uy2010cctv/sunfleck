/** Framework-free recovery notice for a lost Host transport. */

/** Browser-safe slice of the connection service used by the boot kernel. */
export interface RecoverableConnection {
  reconnect(): void
  state: {
    getSnapshot(): 'connected' | 'connecting' | 'disconnected' | undefined
    subscribe(listener: () => void): () => void
  }
}

/**
 * Keeps recovery controls outside the application renderer so a Host restart
 * cannot turn an already-mounted route into a blank root. The application
 * state remains mounted; recovery asks the owned connection loop for a new
 * carrier rather than reloading the document.
 */
export class ConnectionRecovery {
  private readonly root = document.createElement('aside')
  private readonly unsubscribe: () => void

  constructor(private readonly connection: RecoverableConnection) {
    this.root.dataset.dshConnectionRecovery = ''
    this.root.setAttribute('role', 'status')
    this.root.setAttribute('aria-live', 'polite')
    this.root.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:360px;padding:12px 14px;border:1px solid #555;border-radius:8px;background:#151517;color:#f9fafb;font:14px/1.45 system-ui,sans-serif;box-shadow:0 8px 24px rgb(0 0 0 / 28%)'
    this.unsubscribe = connection.state.subscribe(() => { this.render() })
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
    title.textContent = 'Connection lost'
    const body = document.createElement('div')
    body.textContent = 'Your current page remains open. Reconnect when the Host is available.'
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset.dshConnectionRetry = ''
    button.textContent = 'Reconnect'
    button.style.cssText = 'margin-top:8px;border:1px solid #777;border-radius:6px;padding:5px 9px;background:transparent;color:inherit;font:inherit;cursor:pointer'
    button.addEventListener('click', () => { this.connection.reconnect() })
    this.root.replaceChildren(title, body, button)
  }
}
