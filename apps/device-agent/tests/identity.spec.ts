import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { loadOrCreateDeviceIdentity } from '../src/identity.ts'

describe('device identity', () => {
  let root = ''
  afterEach(async () => { if (root !== '') await rm(root, { recursive: true, force: true }) })

  it('creates one reusable Ed25519 identity in a private file', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-device-identity-'))
    const path = join(root, 'state', 'identity.json')
    const first = await loadOrCreateDeviceIdentity(path)
    const second = await loadOrCreateDeviceIdentity(path)
    expect(second).toEqual(first)
    expect(first.publicKey).toContain('BEGIN PUBLIC KEY')
    expect(first.privateKey).toContain('BEGIN PRIVATE KEY')
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(first)
  })
})
