/** Channel workflow ingestion from an already verified GitHub webhook delivery. */
import { createHash } from 'node:crypto'
import { parseChannelWorkflow, workflowMatches, type ChannelWorkflowTrigger } from './collaboration-workflows.ts'

/** One channel's configured revision and manager. */
export interface ChannelGitSubscription {
  readonly orgId: string
  readonly channelId: string
  readonly workflowId: string
  readonly revision: number
  readonly yaml: string
  readonly createdBy: string
}
/** Normalized provider facts after GitHub signature verification. */
export interface ChannelVerifiedGitDelivery {
  readonly source: string
  readonly eventName: string
  readonly repository?: string
  readonly tag?: string
  readonly gitEvent?: 'review_submitted' | 'patch_merged'
  readonly deliveryKey: string
}
/** Exact pushed tag fields for repository-scoped YAML triggers. */
export interface ChannelGitTag extends ChannelVerifiedGitDelivery {
  readonly repository: string
  readonly tag: string
}

/** Select a bounded Git tag push from authenticated provider JSON.
 * @param value - VerifiedWebhookDelivery from the GitHub adapter.
 * @returns Tag facts or undefined for other Git events.
 */
function parseVerifiedGitHubDelivery(value: unknown): ChannelVerifiedGitDelivery | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const delivery = value as Record<string, unknown>
  if (delivery['kind'] !== 'github' || typeof delivery['source'] !== 'string'
    || typeof delivery['deliveryId'] !== 'string' || typeof delivery['event'] !== 'object'
    || delivery['event'] === null || Array.isArray(delivery['event'])) return undefined
  const event = delivery['event'] as Record<string, unknown>
  if (typeof event['name'] !== 'string' || event['name'].length > 80
    || typeof event['payload'] !== 'object'
    || event['payload'] === null || Array.isArray(event['payload'])) return undefined
  const payload = event['payload'] as Record<string, unknown>
  const repository = payload['repository']
  const fullName = typeof repository === 'object' && repository !== null && !Array.isArray(repository)
    ? (repository as Record<string, unknown>)['full_name'] : undefined
  if (delivery['source'].trim() === '' || delivery['deliveryId'].trim() === ''
    || typeof fullName === 'string' && (fullName.trim() === '' || fullName.length > 200)) return undefined
  const ref = payload['ref']
  const tag = event['name'] === 'push' && payload['deleted'] !== true
    && typeof ref === 'string' && ref.startsWith('refs/tags/') ? ref.slice('refs/tags/'.length) : undefined
  const review = payload['review']
  const pullRequest = payload['pull_request']
  const gitEvent = event['name'] === 'pull_request_review' && payload['action'] === 'submitted'
    && typeof review === 'object' && review !== null && !Array.isArray(review)
    ? 'review_submitted' as const
    : event['name'] === 'pull_request' && payload['action'] === 'closed'
      && typeof pullRequest === 'object' && pullRequest !== null && !Array.isArray(pullRequest)
      && (pullRequest as Record<string, unknown>)['merged'] === true ? 'patch_merged' as const : undefined
  if (tag !== undefined && (tag.trim() === '' || tag.length > 128 || /[\r\n]/u.test(tag))) return undefined
  const deliveryKey = createHash('sha256').update(JSON.stringify([
    delivery['source'], delivery['deliveryId'],
  ])).digest('hex')
  return { source: delivery['source'], eventName: event['name'], deliveryKey,
    ...(typeof fullName === 'string' ? { repository: fullName } : {}),
    ...(tag === undefined ? {} : { tag }), ...(gitEvent === undefined ? {} : { gitEvent }) }
}

/** Select a pushed tag with a concrete repository from verified provider JSON.
 * @param value - VerifiedWebhookDelivery from the GitHub adapter.
 * @returns Tag facts, or undefined for non-tag events.
 */
export function parseGitTagDelivery(value: unknown): ChannelGitTag | undefined {
  const delivery = parseVerifiedGitHubDelivery(value)
  return delivery?.tag === undefined || delivery.repository === undefined ? undefined
    : { ...delivery, repository: delivery.repository, tag: delivery.tag }
}

/** Authorized Host actions for one verified Git delivery. */
export interface ChannelGitWorkflowDependencies {
  subscriptions(): Promise<readonly ChannelGitSubscription[]>
  publish(subscription: ChannelGitSubscription, delivery: ChannelVerifiedGitDelivery): Promise<string>
  run(subscription: ChannelGitSubscription, trigger: ChannelWorkflowTrigger, signedSourceEventId: string): Promise<void>
}

/** Match exact repository subscriptions and publish one ingress fact per channel. */
export class ChannelGitWorkflowBridge {
  /** @param deps - Stored definitions, signed room publication, and workflow dispatch. */
  constructor(private readonly deps: ChannelGitWorkflowDependencies) {}

  /** Handle one delivery only after the provider adapter verified its signature.
   * @param delivery - Immutable verified provider event.
   * @returns Number of channels that accepted this verified delivery.
   */
  async onVerifiedDelivery(delivery: unknown): Promise<number> {
    const verified = parseVerifiedGitHubDelivery(delivery)
    if (verified === undefined) return 0
    const triggers: ChannelWorkflowTrigger[] = [{ type: 'webhook', hookId: verified.source }]
    if (verified.tag !== undefined && verified.repository !== undefined) {
      triggers.push({ type: 'git', event: 'tag_pushed', source: verified.source,
        repository: verified.repository })
    }
    if (verified.gitEvent !== undefined && verified.repository !== undefined) {
      triggers.push({ type: 'git', event: verified.gitEvent, source: verified.source,
        repository: verified.repository })
    }
    const rooms = new Map<string, { subscription: ChannelGitSubscription; triggers: ChannelWorkflowTrigger[] }>()
    for (const subscription of await this.deps.subscriptions()) {
      const matched = triggers.filter(trigger => workflowMatches(parseChannelWorkflow(subscription.yaml), trigger))
      if (matched.length === 0) continue
      const key = JSON.stringify([subscription.orgId, subscription.channelId])
      const room = rooms.get(key)
      if (room === undefined) rooms.set(key, { subscription, triggers: matched })
      else for (const trigger of matched) {
        if (!room.triggers.some(value => value.type === trigger.type)) room.triggers.push(trigger)
      }
    }
    for (const { subscription, triggers: matched } of rooms.values()) {
      const eventId = await this.deps.publish(subscription, verified)
      for (const trigger of matched) await this.deps.run(subscription, trigger, eventId)
    }
    return rooms.size
  }
}
