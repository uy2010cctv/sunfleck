/** Authenticated enterprise principal scoped to one Host request. */

import { AsyncLocalStorage } from 'node:async_hooks'
import type { EnterprisePrincipal } from '@deepseek-ai/dsh-enterprise-governance'

/**
 * Carries the server-authenticated principal through asynchronous Host work.
 * Callers cannot establish a principal through an RPC payload; only the
 * authenticated transport boundary invokes {@link run}.
 */
export class EnterpriseRequestContext {
  private readonly storage = new AsyncLocalStorage<EnterprisePrincipal>()

  /** Run one request callback with its authenticated principal. */
  run<T>(principal: EnterprisePrincipal, callback: () => T): T {
    return this.storage.run(principal, callback)
  }

  /** Return the principal for the active request, if any. */
  current(): EnterprisePrincipal | undefined {
    return this.storage.getStore()
  }

  /** Return the active principal or fail closed outside an authenticated request. */
  requirePrincipal(): EnterprisePrincipal {
    const principal = this.current()
    if (principal === undefined) throw new Error('authenticated enterprise principal is required')
    return principal
  }

  /** Clear every context store inherited by outstanding asynchronous work. */
  disable(): void {
    this.storage.disable()
  }

  /** Release this request-context instance during plugin disposal. */
  dispose(): void {
    this.disable()
  }
}
