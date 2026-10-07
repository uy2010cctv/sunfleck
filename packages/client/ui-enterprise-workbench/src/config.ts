/** Deployment settings shared by the host and browser room timeline. */
import z from '@deepseek-ai/schemastery'

/** Browser collaboration timeline preferences. */
export interface Config {
  /** Latest room events fetched on entry; older pages remain available. */
  roomInitialPageSize: number
}

/** Validated collaboration entry page size. */
export const Config: z<Partial<Config>, Config> = z.object({
  roomInitialPageSize: z.natural().min(1).max(100).default(20),
})
