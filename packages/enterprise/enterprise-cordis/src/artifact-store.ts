import { createHash, randomUUID } from 'node:crypto'
import { chmod, link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/** Data used by `CordisArtifactPayload`. */
export interface CordisArtifactPayload {
  readonly orgId: string
  readonly pluginId: string
  readonly name: string
  readonly purpose: string
  readonly hostCode?: string
  readonly clientCode?: string
}

/** Data used by `CordisArtifactReceipt`. */
export interface CordisArtifactReceipt {
  readonly artifactRef: string
  readonly digest: string
  readonly sizeBytes: number
  readonly storageUri: string
}

/** Data used by `EnterpriseCordisArtifactStore`. */
export interface EnterpriseCordisArtifactStore {
  put(payload: CordisArtifactPayload): Promise<CordisArtifactReceipt>
  read(artifactRef: string): Promise<CordisArtifactPayload>
}

function serialize(payload: CordisArtifactPayload): string {
  return JSON.stringify({
    orgId: payload.orgId, pluginId: payload.pluginId, name: payload.name, purpose: payload.purpose,
    hostCode: payload.hostCode ?? null, clientCode: payload.clientCode ?? null,
  })
}

function parse(serialized: string): CordisArtifactPayload {
  const value = JSON.parse(serialized) as Record<string, unknown>
  if (typeof value['orgId'] !== 'string' || typeof value['pluginId'] !== 'string'
    || typeof value['name'] !== 'string' || typeof value['purpose'] !== 'string'
    || (value['hostCode'] !== null && typeof value['hostCode'] !== 'string')
    || (value['clientCode'] !== null && typeof value['clientCode'] !== 'string')) {
    throw new Error('Cordis artifact payload is invalid')
  }
  return {
    orgId: value['orgId'], pluginId: value['pluginId'], name: value['name'], purpose: value['purpose'],
    ...(value['hostCode'] === null ? {} : { hostCode: value['hostCode'] as string }),
    ...(value['clientCode'] === null ? {} : { clientCode: value['clientCode'] as string }),
  }
}

function digest(serialized: string): string {
  return createHash('sha256').update(serialized).digest('hex')
}

function digestFromRef(artifactRef: string): string {
  const match = /^cordis-artifact:\/\/sha256\/(?<digest>[a-f0-9]{64})$/u.exec(artifactRef)
  if (match?.groups?.digest === undefined) throw new Error('Cordis artifact reference is invalid')
  return match.groups.digest
}

/** Single-node content-addressed store; the interface can be replaced by an object-store adapter. */
export class FilesystemEnterpriseCordisArtifactStore implements EnterpriseCordisArtifactStore {
  private readonly root: string

  constructor(root: string) {
    this.root = resolve(root)
  }

  async put(payload: CordisArtifactPayload): Promise<CordisArtifactReceipt> {
    const serialized = serialize(payload)
    const sourceDigest = digest(serialized)
    const directory = join(this.root, sourceDigest.slice(0, 2))
    const storageUri = join(directory, `${sourceDigest}.json`)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const temporary = join(directory, `.${sourceDigest}.${randomUUID()}.tmp`)
    await writeFile(temporary, serialized, { flag: 'wx', mode: 0o600 })
    try {
      await link(temporary, storageUri)
      await chmod(storageUri, 0o600)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      await this.verify(storageUri, sourceDigest)
    } finally {
      await unlink(temporary).catch(() => undefined)
    }
    return {
      artifactRef: `cordis-artifact://sha256/${sourceDigest}`,
      digest: sourceDigest, sizeBytes: Buffer.byteLength(serialized), storageUri,
    }
  }

  async read(artifactRef: string): Promise<CordisArtifactPayload> {
    const sourceDigest = digestFromRef(artifactRef)
    const storageUri = join(this.root, sourceDigest.slice(0, 2), `${sourceDigest}.json`)
    const serialized = await this.verify(storageUri, sourceDigest)
    return parse(serialized)
  }

  private async verify(storageUri: string, expected: string): Promise<string> {
    const serialized = await readFile(storageUri, 'utf8')
    if (digest(serialized) !== expected) throw new Error('Cordis artifact digest mismatch')
    return serialized
  }
}

/** Test/development adapter preserving the same content-addressed reference contract. */
export class InMemoryEnterpriseCordisArtifactStore implements EnterpriseCordisArtifactStore {
  private readonly values = new Map<string, string>()

  async put(payload: CordisArtifactPayload): Promise<CordisArtifactReceipt> {
    const serialized = serialize(payload)
    const sourceDigest = digest(serialized)
    const artifactRef = `cordis-artifact://sha256/${sourceDigest}`
    this.values.set(artifactRef, serialized)
    return { artifactRef, digest: sourceDigest, sizeBytes: Buffer.byteLength(serialized), storageUri: artifactRef }
  }

  async read(artifactRef: string): Promise<CordisArtifactPayload> {
    const serialized = this.values.get(artifactRef)
    if (serialized === undefined) throw new Error('Cordis artifact was not found')
    if (digest(serialized) !== digestFromRef(artifactRef)) throw new Error('Cordis artifact digest mismatch')
    return parse(serialized)
  }
}
