import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { canonicalDeviceRequest, normalizeDevicePublicKey, verifyDeviceSignature } from '../src/signature.ts'

describe('device request signatures', () => {
  it('accepts only canonical Ed25519 public keys', () => {
    const { publicKey } = generateKeyPairSync('ed25519')
    const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
    expect(normalizeDevicePublicKey(pem)).toBe(pem)
    expect(() => normalizeDevicePublicKey('not-a-key')).toThrow(/Ed25519/)
  })
  it('verifies an Ed25519 signature bound to method, path, timestamp, nonce, and body', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const input = { method: 'POST', path: '/device-agent/v1/heartbeat', timestamp: 1000, nonce: 'nonce-12345678', body: '{"ok":true}' }
    const signature = sign(null, Buffer.from(canonicalDeviceRequest(input)), privateKey).toString('base64url')
    expect(verifyDeviceSignature({
      ...input, signature, publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(), now: 1000,
    })).toBe(true)
    expect(verifyDeviceSignature({
      ...input, body: '{"ok":false}', signature,
      publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(), now: 1000,
    })).toBe(false)
  })

  it('rejects stale signed requests', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const input = { method: 'POST', path: '/device-agent/v1/heartbeat', timestamp: 1000, nonce: 'nonce-12345678', body: '' }
    const signature = sign(null, Buffer.from(canonicalDeviceRequest(input)), privateKey).toString('base64url')
    expect(verifyDeviceSignature({
      ...input, signature, publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(), now: 70_001,
    })).toBe(false)
  })
})
