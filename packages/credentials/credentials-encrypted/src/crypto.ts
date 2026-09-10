/** AES-256-GCM envelope encryption with address-bound associated data. */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/** Data used by `EncryptedCredentialEnvelope`. */
export interface EncryptedCredentialEnvelope {
  readonly keyId: string
  readonly iv: string
  readonly tag: string
  readonly ciphertext: string
}

function assertKey(key: Buffer): void {
  if (key.byteLength !== 32) throw new Error('enterprise credential master key must be exactly 32 bytes')
}

/** Executes `encryptCredentialValue`.
 * @param aad - Input value used by this API.
 * @param iv - Input value used by this API.
 * @param key - Input value used by this API.
 * @param keyId - Input value used by this API.
 * @param value - Input value used by this API.
 * @returns Result produced by this API.
 */
export function encryptCredentialValue(
  value: unknown,
  aad: string,
  keyId: string,
  key: Buffer,
  iv = randomBytes(12),
): EncryptedCredentialEnvelope {
  assertKey(key)
  if (iv.byteLength !== 12) throw new Error('AES-GCM IV must be exactly 12 bytes')
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(aad))
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return {
    keyId,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  }
}

/** Executes `decryptCredentialValue`.
 * @param aad - Input value used by this API.
 * @param envelope - Input value used by this API.
 * @param keys - Input value used by this API.
 * @returns Result produced by this API.
 */
export function decryptCredentialValue(
  envelope: EncryptedCredentialEnvelope,
  aad: string,
  keys: Readonly<Record<string, Buffer>>,
): unknown {
  const key = keys[envelope.keyId]
  if (key === undefined) throw new Error(`enterprise credential key id ${envelope.keyId} is unavailable`)
  assertKey(key)
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'))
  decipher.setAAD(Buffer.from(aad))
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final(),
  ])
  return JSON.parse(plaintext.toString('utf8')) as unknown
}
