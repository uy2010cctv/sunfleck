/** Encrypted-at-rest enterprise CredentialProvider with online key rotation. */

import { mkdir, readFile, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import {
  CredentialProvider,
  parseCredentialKey,
  type CredentialInfo,
  type CredentialKey,
  type CredentialRecord,
  type CredentialRecordEntry,
  type CredentialRecordInfo,
  type CredentialRef,
  type ResolvedCredential,
} from '@deepseek-ai/dsh-credentials'
import {
  decryptCredentialValue,
  encryptCredentialValue,
  type EncryptedCredentialEnvelope,
} from './crypto.ts'

export { decryptCredentialValue, encryptCredentialValue, type EncryptedCredentialEnvelope } from './crypto.ts'

interface EncryptedCredentialDocument {
  readonly version: 1
  readonly refs: Record<string, EncryptedCredentialEnvelope>
  readonly records: Record<string, EncryptedCredentialEnvelope>
}

/** Data used by `EncryptedCredentialConfig`. */
export interface EncryptedCredentialConfig {
  /** Owner-only path to the encrypted credential document. */
  readonly path: string
  /** Identifier of the AES-GCM key used for newly written values. */
  readonly currentKeyId: string
  /** In-memory 32-byte master keys indexed by identifier; never sourced from declarative config. */
  readonly keys: Readonly<Record<string, Buffer>>
  /** Optional environment overlay used only when resolving configured references. */
  readonly environment?: Readonly<Record<string, string | undefined>>
}

function emptyDocument(): EncryptedCredentialDocument {
  return { version: 1, refs: {}, records: {} }
}

function isEnvelope(value: unknown): value is EncryptedCredentialEnvelope {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return ['keyId', 'iv', 'tag', 'ciphertext'].every(key => typeof record[key] === 'string')
}

function parseDocument(text: string): EncryptedCredentialDocument {
  const value: unknown = JSON.parse(text)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('encrypted credentials must be an object')
  const root = value as Record<string, unknown>
  if (root['version'] !== 1) throw new Error('encrypted credentials document version is unsupported')
  const parseTable = (input: unknown, label: string): Record<string, EncryptedCredentialEnvelope> => {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error(`${label} must be an object`)
    const table = input as Record<string, unknown>
    for (const envelope of Object.values(table)) if (!isEnvelope(envelope)) throw new Error(`${label} contains an invalid envelope`)
    return table as Record<string, EncryptedCredentialEnvelope>
  }
  return { version: 1, refs: parseTable(root['refs'], 'refs'), records: parseTable(root['records'], 'records') }
}

function isENOENT(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

/** AES-GCM encrypted enterprise credential provider. */
export class EncryptedCredentialProvider extends CredentialProvider {
  private readonly environment: Readonly<Record<string, string | undefined>>

  constructor(ctx: Context, private readonly config: EncryptedCredentialConfig) {
    super(ctx)
    if (config.keys[config.currentKeyId] === undefined) throw new Error('current enterprise credential key is unavailable')
    for (const key of Object.values(config.keys)) {
      if (key.byteLength !== 32) throw new Error('enterprise credential master key must be exactly 32 bytes')
    }
    this.environment = config.environment ?? process.env
  }

  private currentKey(): Buffer {
    const key = this.config.keys[this.config.currentKeyId]
    if (key === undefined) throw new Error('current enterprise credential key is unavailable')
    return key
  }

  private async read(): Promise<EncryptedCredentialDocument> {
    try {
      const mode = (await stat(this.config.path)).mode
      if (process.platform !== 'win32' && (mode & 0o077) !== 0) {
        throw new Error('encrypted credentials file must be owner-only (chmod 600)')
      }
      return parseDocument(await readFile(this.config.path, 'utf8'))
    } catch (error) {
      if (isENOENT(error)) return emptyDocument()
      throw error
    }
  }

  private async write(document: EncryptedCredentialDocument): Promise<void> {
    await writeFileAtomic(this.config.path, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
  }

  private async locked<T>(operation: (document: EncryptedCredentialDocument) => Promise<T>): Promise<T> {
    await mkdir(dirname(this.config.path), { recursive: true, mode: 0o700 })
    return withFileLock(this.config.path, async () => operation(await this.read()), { waitMs: 30_000 })
  }

  private env(ref: CredentialRef): string | undefined {
    const value = this.environment[ref]
    return value === undefined || value === '' ? undefined : value
  }

  async resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    const inherited = this.env(ref)
    if (inherited !== undefined) return { value: inherited, source: 'env' }
    const envelope = (await this.read()).refs[ref]
    if (envelope === undefined) return undefined
    const value = decryptCredentialValue(envelope, `ref:${ref}`, this.config.keys)
    if (typeof value !== 'string' || value === '') throw new Error(`encrypted credential ref ${ref} is invalid`)
    return { value, source: 'encrypted-file' }
  }

  async describe(ref: CredentialRef): Promise<CredentialInfo> {
    const inherited = this.env(ref)
    if (inherited !== undefined) return { configured: true, source: 'env', writable: false }
    return (await this.read()).refs[ref] === undefined
      ? { configured: false, writable: true }
      : { configured: true, source: 'encrypted-file', writable: true }
  }

  async set(ref: CredentialRef, value: string): Promise<void> {
    if (this.env(ref) !== undefined) throw new Error(`credential ${ref} is shadowed by a read-only environment value`)
    if (value === '') throw new Error('empty credential values are not stored; use unset')
    await this.locked(async (document) => {
      document.refs[ref] = encryptCredentialValue(
        value, `ref:${ref}`, this.config.currentKeyId, this.currentKey(),
      )
      await this.write(document)
    })
    this.notifyUpdated(ref)
  }

  async unset(ref: CredentialRef): Promise<void> {
    if (this.env(ref) !== undefined) throw new Error(`credential ${ref} is shadowed by a read-only environment value`)
    const removed = await this.locked(async (document) => {
      if (!Object.hasOwn(document.refs, ref)) return false
      Reflect.deleteProperty(document.refs, ref)
      await this.write(document)
      return true
    })
    if (removed) this.notifyUpdated(ref)
  }

  async readRecord(key: CredentialKey): Promise<CredentialRecord | undefined> {
    const envelope = (await this.read()).records[key]
    return envelope === undefined
      ? undefined
      : decryptCredentialValue(envelope, `record:${key}`, this.config.keys) as CredentialRecord
  }

  async describeRecord(key: CredentialKey): Promise<CredentialRecordInfo> {
    const record = await this.readRecord(key)
    return record === undefined
      ? { configured: false, writable: true }
      : { configured: true, kind: record.kind, writable: true }
  }

  async listRecords(): Promise<readonly CredentialRecordEntry[]> {
    const document = await this.read()
    return Object.entries(document.records).sort(([left], [right]) => left.localeCompare(right)).map(([raw, envelope]) => {
      const key = parseCredentialKey(raw)
      const record = decryptCredentialValue(envelope, `record:${key}`, this.config.keys) as CredentialRecord
      return { key, kind: record.kind }
    })
  }

  async modifyRecord(
    key: CredentialKey,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    let result: CredentialRecord | undefined
    const changed = await this.locked(async (document) => {
      const envelope = document.records[key]
      const current = envelope === undefined
        ? undefined
        : decryptCredentialValue(envelope, `record:${key}`, this.config.keys) as CredentialRecord
      const next = await mutate(current)
      result = next ?? current
      if (next === undefined) return false
      document.records[key] = encryptCredentialValue(
        next, `record:${key}`, this.config.currentKeyId, this.currentKey(),
      )
      await this.write(document)
      return true
    })
    if (changed) this.notifyRecordUpdated(key)
    return result
  }

  async deleteRecord(key: CredentialKey): Promise<void> {
    const removed = await this.locked(async (document) => {
      if (!Object.hasOwn(document.records, key)) return false
      Reflect.deleteProperty(document.records, key)
      await this.write(document)
      return true
    })
    if (removed) this.notifyRecordUpdated(key)
  }

  /** Re-encrypt every stored value under the current key id in one atomic commit. */
  async rotate(): Promise<void> {
    await this.locked(async (document) => {
      for (const [ref, envelope] of Object.entries(document.refs)) {
        const value = decryptCredentialValue(envelope, `ref:${ref}`, this.config.keys)
        document.refs[ref] = encryptCredentialValue(
          value, `ref:${ref}`, this.config.currentKeyId, this.currentKey(),
        )
      }
      for (const [raw, envelope] of Object.entries(document.records)) {
        const key = parseCredentialKey(raw)
        const value = decryptCredentialValue(envelope, `record:${key}`, this.config.keys)
        document.records[raw] = encryptCredentialValue(
          value, `record:${key}`, this.config.currentKeyId, this.currentKey(),
        )
      }
      await this.write(document)
    })
  }
}

export default EncryptedCredentialProvider
