/** Server-custodied NIP-01 signing identities for shared enterprise rooms. */
import { createHash } from 'node:crypto'
import { credentialKey, type CredentialProvider, type CredentialRecord } from '@deepseek-ai/dsh-credentials'
import type { EnterprisePrincipal } from '@deepseek-ai/dsh-enterprise-governance'
import type { RoomActorKind, RoomNostrEvent } from '@deepseek-ai/dsh-enterprise-postgres'
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure'

const HEX_64 = /^[0-9a-f]{64}$/
const EVENT_ID = /^[0-9a-f]{64}$/
const MAX_CREATED_AT = 8_640_000_000_000

/** Server-issued Bot identity tied to one native employee Session. */
export interface RoomEmployeeSigner {
  readonly orgId: string
  readonly employeeId: string
  readonly sessionId: string
}

/** Server-issued service identity for authenticated workflow or webhook events. */
export interface RoomServiceSigner {
  readonly orgId: string
  readonly serviceId: string
}

/** Metadata of one uploaded room file signed into a text event. */
export interface RoomAttachmentTag {
  readonly attachmentId: string
  readonly name: string
  readonly mimeType: string
  readonly size: number
}

/** Content and references signed into one immutable room event. */
export type RoomSigningInput =
  | { readonly type: 'text'
    readonly content: string
    readonly threadRoot?: string
    readonly sourceEventId?: string
    readonly sourceCursor?: string
    readonly hop?: number
    readonly targetEmployeeIds?: readonly string[]
    readonly mentionedUserIds?: readonly string[]
    readonly route?: 'team' | 'ingest'
    readonly requestId?: string
    readonly createdAt?: number
    readonly attachments?: readonly RoomAttachmentTag[] }
  | { readonly type: 'reaction'
    readonly content: string
    readonly targetEventId: string
    readonly threadRoot?: string
    readonly requestId?: string
    readonly createdAt?: number }
  | { readonly type: 'workflow'
    readonly content: string
    readonly threadRoot?: string
    readonly stepId: string
    readonly sourceEventId?: string
    readonly sourceCursor?: string
    readonly targetEmployeeIds?: readonly string[]
    readonly createdAt?: number }
  | { readonly type: 'handoff'
    readonly content: string
    readonly taskId: string
    readonly targetEmployeeId: string
    readonly sourceEventId?: string
    readonly sourceCursor?: string
    readonly hop?: number
    readonly createdAt?: number }

/** PostgreSQL binding for the first public key of an organization actor. */
export interface RoomActorKeyStore {
  getRoomActorKey(orgId: string, actorKind: RoomActorKind, actorId: string): Promise<string | undefined>
  ensureRoomActorKey(input: { readonly orgId: string
    readonly actorKind: RoomActorKind
    readonly actorId: string
    readonly pubkey: string }): Promise<string>
}

/** Current room membership and native employee binding checks supplied by the Host. */
export interface RoomSigningAuthorization {
  human(principal: EnterprisePrincipal, roomId: string): Promise<boolean>
  employee(orgId: string, employeeId: string, sessionId: string, roomId: string): Promise<boolean>
  service?(orgId: string, serviceId: string, roomId: string): Promise<boolean>
}

interface SigningAddress {
  readonly orgId: string
  readonly actorKind: RoomActorKind
  readonly actorId: string
}

interface SigningKeyPayload extends SigningAddress {
  readonly version: 1
  readonly secretHex: string
}

function keyPayload(value: CredentialRecord | undefined, address: SigningAddress): SigningKeyPayload | undefined {
  if (value === undefined) return undefined
  if (value.kind !== 'grant' || typeof value.payload !== 'object' || value.payload === null || Array.isArray(value.payload)) {
    throw new Error('room-signing-key-unavailable')
  }
  const payload = value.payload as Record<string, unknown>
  if (payload['version'] !== 1 || payload['orgId'] !== address.orgId || payload['actorKind'] !== address.actorKind
    || payload['actorId'] !== address.actorId || typeof payload['secretHex'] !== 'string'
    || !HEX_64.test(payload['secretHex'])) throw new Error('room-signing-key-unavailable')
  return { version: 1, orgId: address.orgId, actorKind: address.actorKind,
    actorId: address.actorId, secretHex: payload['secretHex'] }
}

function validId(value: string): void {
  if (!EVENT_ID.test(value)) throw new Error('room-event-reference-invalid')
}

function appendBotSource(tags: string[][], input: { readonly sourceEventId?: string
  readonly hop?: number }): void {
  if (input.sourceEventId !== undefined) {
    validId(input.sourceEventId)
    tags.push(['e', input.sourceEventId])
  }
  if (input.hop !== undefined) {
    if (!Number.isSafeInteger(input.hop) || input.hop < 0 || input.hop > 8) throw new Error('room-event-hop-invalid')
    tags.push(['dsh-hop', String(input.hop)])
  }
}

function appendTargets(tags: string[][], targetEmployeeIds: readonly string[] | undefined): void {
  if (targetEmployeeIds === undefined) return
  if (!Array.isArray(targetEmployeeIds) || targetEmployeeIds.length > 16) throw new Error('room-event-target-invalid')
  const seen = new Set<string>()
  for (const employeeId of targetEmployeeIds) {
    if (typeof employeeId !== 'string' || employeeId.length === 0 || employeeId.length > 128
      || employeeId.trim() !== employeeId || seen.has(employeeId)) throw new Error('room-event-target-invalid')
    seen.add(employeeId)
    tags.push(['dsh-target', employeeId])
  }
}

function appendSourceCursor(tags: string[][], sourceCursor: string | undefined): void {
  if (sourceCursor === undefined) return
  const split = sourceCursor.lastIndexOf(':')
  const seq = sourceCursor.slice(split + 1)
  if (sourceCursor.length === 0 || sourceCursor.length > 256 || sourceCursor.trim() !== sourceCursor
    || /\s/.test(sourceCursor) || split < 1 || !/^(0|[1-9][0-9]*)$/.test(seq)
    || !Number.isSafeInteger(Number(seq))) throw new Error('room-event-source-invalid')
  tags.push(['dsh-source', sourceCursor])
}

function appendRequest(tags: string[][], requestId: string | undefined): void {
  if (requestId === undefined) return
  if (requestId.length === 0 || requestId.length > 256 || requestId.trim() !== requestId
    || /[\u0000-\u001f\u007f]/.test(requestId)) throw new Error('room-event-request-invalid')
  tags.push(['dsh-request', requestId])
}

function appendAttachments(tags: string[][], attachments: readonly RoomAttachmentTag[] | undefined): void {
  if (attachments === undefined || attachments.length === 0) return
  if (attachments.length > 8) throw new Error('room-event-attachment-invalid')
  for (const attachment of attachments) {
    const id = attachment.attachmentId
    if (typeof id !== 'string' || id.length === 0 || id.length > 128 || id.trim() !== id
      || attachment.name.length === 0 || attachment.name.length > 200
      || attachment.mimeType.length === 0 || attachment.mimeType.length > 100
      || !Number.isSafeInteger(attachment.size) || attachment.size < 0) {
      throw new Error('room-event-attachment-invalid')
    }
    tags.push(['attachment', id, attachment.name, attachment.mimeType, String(attachment.size)])
  }
}

function eventTemplate(roomId: string, input: RoomSigningInput): { readonly kind: number
  readonly tags: string[][]
  readonly content: string
  readonly created_at: number } {
  if (roomId.trim() === '' || (input.content.trim() === ''
    && !(input.type === 'text' && (input.attachments?.length ?? 0) > 0))) {
    throw new Error('room-event-content-invalid')
  }
  const createdAt = input.createdAt ?? Math.floor(Date.now() / 1000)
  if (!Number.isSafeInteger(createdAt) || createdAt < 0 || createdAt > MAX_CREATED_AT) {
    throw new Error('room-event-timestamp-invalid')
  }
  const tags: string[][] = [['h', roomId]]
  switch (input.type) {
    case 'text':
      if (input.threadRoot !== undefined) { validId(input.threadRoot); tags.push(['e', input.threadRoot, '', 'root']) }
      appendBotSource(tags, input)
      appendTargets(tags, input.targetEmployeeIds)
      if (input.mentionedUserIds !== undefined) {
        if (input.mentionedUserIds.length > 32 || new Set(input.mentionedUserIds).size !== input.mentionedUserIds.length
          || input.mentionedUserIds.some(id => id.trim() !== id || id.length === 0 || id.length > 128)) {
          throw new Error('room-event-mention-invalid')
        }
        for (const userId of input.mentionedUserIds) tags.push(['dsh-mention', userId])
      }
      appendSourceCursor(tags, input.sourceCursor)
      appendAttachments(tags, input.attachments)
      if (input.route !== undefined) {
        const route: string = input.route
        if (!['team', 'ingest'].includes(route) || (input.targetEmployeeIds?.length ?? 0) > 0) {
          throw new Error('room-event-route-invalid')
        }
        tags.push(['dsh-route', input.route])
      }
      appendRequest(tags, input.requestId)
      return { kind: 9, tags, content: input.content, created_at: createdAt }
    case 'reaction':
      validId(input.targetEventId)
      tags.push(['e', input.targetEventId])
      if (input.threadRoot !== undefined) { validId(input.threadRoot); tags.push(['e', input.threadRoot, '', 'root']) }
      appendRequest(tags, input.requestId)
      return { kind: 7, tags, content: input.content, created_at: createdAt }
    case 'workflow':
      if (input.stepId.trim() === '') throw new Error('room-event-reference-invalid')
      tags.push(['dsh', 'workflow'], ['step', input.stepId])
      if (input.threadRoot !== undefined) { validId(input.threadRoot); tags.push(['e', input.threadRoot, '', 'root']) }
      if (input.sourceEventId !== undefined) { validId(input.sourceEventId); tags.push(['e', input.sourceEventId]) }
      appendTargets(tags, input.targetEmployeeIds)
      appendSourceCursor(tags, input.sourceCursor)
      return { kind: 41000, tags, content: input.content, created_at: createdAt }
    case 'handoff':
      if (input.taskId.trim() === '' || input.targetEmployeeId.trim() === '') throw new Error('room-event-reference-invalid')
      tags.push(['dsh', 'handoff'], ['task', input.taskId], ['target', input.targetEmployeeId])
      appendBotSource(tags, input)
      appendSourceCursor(tags, input.sourceCursor)
      return { kind: 41001, tags, content: input.content, created_at: createdAt }
  }
}

/** Signs room events only for a currently authorized human, bound employee, or trusted service.
 * The browser receives the signed public event and never the custodial secret.
 */
export class CollaborationIdentity {
  /** @param credentials - Durable server-only credential records.
   * @param keys - PostgreSQL public-key bindings.
   * @param authorization - Current membership and native Session checks.
   */
  constructor(
    private readonly credentials: Pick<CredentialProvider, 'readRecord' | 'modifyRecord'>,
    private readonly keys: RoomActorKeyStore,
    private readonly authorization: RoomSigningAuthorization,
  ) {}

  /** Sign as the authenticated human after a current room access check.
   * @param principal - Authenticated Host principal.
   * @param roomId - Room containing the message.
   * @param input - Content and references.
   * @returns Verifiable NIP-01 event.
   */
  async signHuman(principal: EnterprisePrincipal, roomId: string, input: RoomSigningInput): Promise<RoomNostrEvent> {
    if (principal.actorType === 'employee' || !await this.authorization.human(principal, roomId)) {
      throw new Error('room-actor-forbidden')
    }
    return this.sign({ orgId: principal.orgId, actorKind: 'human', actorId: principal.userId }, roomId, input)
  }

  /** Sign as an employee only when the native destination remains bound to this room.
   * @param actor - Server-selected employee and native Session.
   * @param roomId - Room containing the message.
   * @param input - Content and references.
   * @returns Verifiable NIP-01 event.
   */
  async signEmployee(actor: RoomEmployeeSigner, roomId: string, input: RoomSigningInput): Promise<RoomNostrEvent> {
    if (!await this.authorization.employee(actor.orgId, actor.employeeId, actor.sessionId, roomId)) {
      throw new Error('room-actor-forbidden')
    }
    return this.sign({ orgId: actor.orgId, actorKind: 'employee', actorId: actor.employeeId }, roomId, input)
  }

  /** Sign an authenticated workflow or webhook fact as its own service actor.
   * @param actor - Server-selected service identity.
   * @param roomId - Room containing the fact.
   * @param input - Workflow content and references.
   * @returns Verifiable NIP-01 event.
   */
  async signService(actor: RoomServiceSigner, roomId: string, input: RoomSigningInput): Promise<RoomNostrEvent> {
    if (this.authorization.service === undefined || !await this.authorization.service(actor.orgId, actor.serviceId, roomId)) {
      throw new Error('room-actor-forbidden')
    }
    if (input.type !== 'workflow') throw new Error('room-service-event-invalid')
    return this.sign({ orgId: actor.orgId, actorKind: 'service', actorId: actor.serviceId }, roomId, input)
  }

  private async sign(address: SigningAddress, roomId: string, input: RoomSigningInput): Promise<RoomNostrEvent> {
    const credentialId = createHash('sha256').update(JSON.stringify([address.orgId, address.actorKind, address.actorId]))
      .digest('hex')
    const recordKey = credentialKey('api-enterprise-controller', `actor-${credentialId}`)
    const binding = await this.keys.getRoomActorKey(address.orgId, address.actorKind, address.actorId)
    if (binding !== undefined && !HEX_64.test(binding)) throw new Error('room-signing-key-mismatch')
    let stored = keyPayload(await this.credentials.readRecord(recordKey), address)
    if (binding !== undefined && stored === undefined) throw new Error('room-signing-key-unavailable')
    if (stored === undefined) {
      const record = await this.credentials.modifyRecord(recordKey, (current) => {
        if (current !== undefined) return Promise.resolve(undefined)
        const payload: SigningKeyPayload = { ...address, version: 1,
          secretHex: Buffer.from(generateSecretKey()).toString('hex') }
        return Promise.resolve({ kind: 'grant', payload })
      })
      stored = keyPayload(record, address)
    }
    if (stored === undefined) throw new Error('room-signing-key-unavailable')
    const secretKey = Buffer.from(stored.secretHex, 'hex')
    let pubkey: string
    try { pubkey = getPublicKey(secretKey) } catch { throw new Error('room-signing-key-unavailable') }
    if (binding !== undefined && binding !== pubkey) throw new Error('room-signing-key-mismatch')
    const persisted = await this.keys.ensureRoomActorKey({ ...address, pubkey })
    if (persisted !== pubkey) throw new Error('room-signing-key-mismatch')
    const signed = finalizeEvent(eventTemplate(roomId, input), secretKey)
    const result: RoomNostrEvent = { id: signed.id, pubkey: signed.pubkey,
      created_at: signed.created_at, kind: signed.kind, tags: signed.tags,
      content: signed.content, sig: signed.sig }
    if (!verifyEvent({ ...result, tags: result.tags.map(tag => [...tag]) })) throw new Error('room-signature-invalid')
    return result
  }
}
