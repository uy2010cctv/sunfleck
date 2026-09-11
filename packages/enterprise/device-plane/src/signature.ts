import { createHash, createPublicKey, verify } from 'node:crypto'

/** Canonical signed request fields supplied by one paired Device Agent. */
export interface DeviceRequestContent {
  readonly method: string
  readonly path: string
  readonly timestamp: number
  readonly nonce: string
  readonly body: string
}

/** Serialize signed request fields in a deterministic order.
 * @param input - Signed request fields.
 * @returns canonical signature payload.
 */
export function canonicalDeviceRequest(input: DeviceRequestContent): string {
  const digest = createHash('sha256').update(input.body).digest('base64url')
  return `${input.method.toUpperCase()}\n${input.path}\n${String(input.timestamp)}\n${input.nonce}\n${digest}`
}

/** Validate and normalize an Ed25519 public key PEM document.
 * @param value - Untrusted PEM text.
 * @returns canonical public key PEM.
 */
export function normalizeDevicePublicKey(value: string): string {
  if (value.length > 4096) throw new Error('device public key must be Ed25519')
  try {
    const key = createPublicKey(value)
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('type')
    return key.export({ type: 'spki', format: 'pem' }).toString()
  } catch {
    throw new Error('device public key must be Ed25519')
  }
}

/** Verify freshness, nonce shape, and Ed25519 signature for one device request.
 * @param input - Signed request plus public key and trusted current time.
 * @returns whether all authentication checks pass.
 */
export function verifyDeviceSignature(input: DeviceRequestContent & {
  readonly publicKey: string
  readonly signature: string
  readonly now: number
}): boolean {
  if (!Number.isSafeInteger(input.timestamp) || Math.abs(input.now - input.timestamp) > 60_000) return false
  if (!/^[A-Za-z0-9_-]{12,128}$/u.test(input.nonce)) return false
  try {
    const supplied = Buffer.from(input.signature, 'base64url')
    if (supplied.length !== 64 || supplied.toString('base64url') !== input.signature) return false
    const key = createPublicKey(input.publicKey)
    return key.asymmetricKeyType === 'ed25519'
      && verify(null, Buffer.from(canonicalDeviceRequest(input)), key, supplied)
  } catch {
    return false
  }
}
