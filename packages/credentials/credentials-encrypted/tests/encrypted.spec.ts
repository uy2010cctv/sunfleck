import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { credentialKey, credentialRef } from '@deepseek-ai/dsh-credentials'
import {
  EncryptedCredentialProvider,
  decryptCredentialValue,
  encryptCredentialValue,
} from '../src/index.ts'

const KEY_ONE = Buffer.alloc(32, 1)
const KEY_TWO = Buffer.alloc(32, 2)
const REF = credentialRef('WE_COM_TOKEN')
const RECORD = credentialKey('enterprise-sso', 'oidc-main')

describe('credential encryption', () => {
  it('uses AES-256-GCM with address-bound AAD', () => {
    const envelope = encryptCredentialValue({ token: 'secret' }, 'ref:WE_COM_TOKEN', 'k1', KEY_ONE, Buffer.alloc(12, 3))
    expect(JSON.stringify(envelope)).not.toContain('secret')
    expect(decryptCredentialValue(envelope, 'ref:WE_COM_TOKEN', { k1: KEY_ONE })).toEqual({ token: 'secret' })
    expect(() => decryptCredentialValue(envelope, 'ref:OTHER', { k1: KEY_ONE })).toThrow()
    expect(() => decryptCredentialValue(envelope, 'ref:WE_COM_TOKEN', { k1: KEY_TWO })).toThrow()
  })
})

describe('EncryptedCredentialProvider', () => {
  const cleanups: Array<() => Promise<void>> = []

  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!()
  })

  async function boot(path: string, currentKeyId: string, keys: Record<string, Buffer>): Promise<Context> {
    const ctx = new Context()
    const fiber = ctx.plugin(EncryptedCredentialProvider, { path, currentKeyId, keys })
    cleanups.push(async () => { await fiber.dispose() })
    await fiber.await()
    return ctx
  }

  it('persists references and opaque credential records without plaintext', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-encrypted-credentials-'))
    cleanups.push(() => rm(root, { recursive: true, force: true }))
    const path = join(root, 'credentials.enc.json')
    const ctx = await boot(path, 'k1', { k1: KEY_ONE })
    await ctx.credentials.set(REF, 'wecom-secret')
    await ctx.credentials.modifyRecord(RECORD, () => Promise.resolve({
      kind: 'grant', payload: { accessToken: 'access-secret', refreshToken: 'refresh-secret' },
    }))

    const text = await readFile(path, 'utf8')
    expect(text).not.toContain('wecom-secret')
    expect(text).not.toContain('access-secret')
    expect(await ctx.credentials.resolve(REF)).toEqual({ value: 'wecom-secret', source: 'encrypted-file' })
    expect(await ctx.credentials.readRecord(RECORD)).toEqual({
      kind: 'grant', payload: { accessToken: 'access-secret', refreshToken: 'refresh-secret' },
    })
  })

  it('rotates every envelope to the current key and can drop the old key afterwards', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-encrypted-rotation-'))
    cleanups.push(() => rm(root, { recursive: true, force: true }))
    const path = join(root, 'credentials.enc.json')
    const old = await boot(path, 'k1', { k1: KEY_ONE })
    await old.credentials.set(REF, 'secret')

    const rotating = await boot(path, 'k2', { k1: KEY_ONE, k2: KEY_TWO })
    await (rotating.credentials as EncryptedCredentialProvider).rotate()
    const text = await readFile(path, 'utf8')
    expect(text).toContain('"keyId": "k2"')
    expect(text).not.toContain('"keyId": "k1"')

    const current = await boot(path, 'k2', { k2: KEY_TWO })
    expect(await current.credentials.resolve(REF)).toEqual({ value: 'secret', source: 'encrypted-file' })
  })

  it('keeps an inherited environment credential read-only and never stores it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-encrypted-env-'))
    cleanups.push(() => rm(root, { recursive: true, force: true }))
    const ctx = new Context()
    const fiber = ctx.plugin(EncryptedCredentialProvider, {
      path: join(root, 'credentials.enc.json'), currentKeyId: 'k1', keys: { k1: KEY_ONE },
      environment: { WE_COM_TOKEN: 'environment-secret' },
    })
    cleanups.push(async () => { await fiber.dispose() })
    await fiber.await()

    expect(await ctx.credentials.describe(REF)).toEqual({ configured: true, source: 'env', writable: false })
    await expect(ctx.credentials.set(REF, 'other')).rejects.toThrow(/read-only environment/)
  })
})
