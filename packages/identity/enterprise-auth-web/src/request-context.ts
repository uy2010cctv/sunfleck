/** Authenticated enterprise principal scoped to one Host request. */

import { AsyncLocalStorage } from 'node:async_hooks'
import type { EnterprisePrincipal } from '@deepseek-ai/dsh-enterprise-governance'

/**
 * Carries the server-authenticated principal through asynchronous Host work.
 * Callers cannot establish a principal through an RPC payload; only the
 * authenticated transport boundary invokes {@link run}.
 */
export class EnterpriseRequestContext {
  private readonly storage = new AsyncLocalStorage<{ principal: EnterprisePrincipal; generation: number }>()
  private generation = 0
  private disposed = false

  /**
   * Run one request callback with its authenticated principal.
   * @param principal - Principal established by the authenticated transport.
   * @param callback - Host work that may read the principal.
   * @returns the callback result.
   */
  run<T>(principal: EnterprisePrincipal, callback: () => T): T {
    return this.storage.run({ principal, generation: this.generation }, callback)
  }

  /**
   * Run Agent-owned work without inheriting the active authenticated Human.
   * @param callback - Work whose asynchronous descendants must carry no request principal.
   * @returns the callback result while the surrounding request store is restored afterwards.
   */
  withoutPrincipal<T>(callback: () => T): T {
    return this.storage.exit(callback)
  }

  /**
   * Return the principal for the active request, if any.
   * @returns the active principal, or `undefined` outside a live request.
   */
  current(): EnterprisePrincipal | undefined {
    const store = this.storage.getStore()
    return this.disposed || store?.generation !== this.generation ? undefined : store.principal
  }

  /**
   * Return the active principal or fail closed outside an authenticated request.
   * @returns the active authenticated principal.
   */
  requirePrincipal(): EnterprisePrincipal {
    const principal = this.current()
    if (principal === undefined) throw new Error('authenticated enterprise principal is required')
    return principal
  }

  /** Clear every context store inherited by outstanding asynchronous work. */
  disable(): void {
    this.generation++
    this.storage.disable()
  }

  /** Release this request-context instance during plugin disposal. */
  dispose(): void {
    this.disposed = true
    this.disable()
  }
}
