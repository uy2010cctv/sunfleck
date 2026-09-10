/** Local bootstrap login password verification using scrypt. */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const KEY_LENGTH = 32
const COST = 16_384
const BLOCK_SIZE = 8
const PARALLELISM = 1

/** Data used by `PasswordVerifierOptions`. */
export interface PasswordVerifierOptions {
  readonly salt?: Buffer
}

/** Create a salted scrypt verifier; the password is never embedded in the result.
 * @param options - Input value used by this API.
 * @param password - Input value used by this API.
 * @returns Result produced by this API.
 */
export function createPasswordVerifier(password: string, options: PasswordVerifierOptions = {}): string {
  if (password.length < 12) throw new Error('enterprise password must contain at least 12 characters')
  const salt = options.salt ?? randomBytes(16)
  const digest = scryptSync(password, salt, KEY_LENGTH, { N: COST, r: BLOCK_SIZE, p: PARALLELISM })
  return ['scrypt', COST, BLOCK_SIZE, PARALLELISM, salt.toString('base64'), digest.toString('base64')].join('$')
}

/** Compare a password against a stored verifier in constant time when the format is valid.
 * @param password - Input value used by this API.
 * @param verifier - Input value used by this API.
 * @returns Result produced by this API.
 */
export function verifyPassword(password: string, verifier: string): boolean {
  const [algorithm, costRaw, blockRaw, parallelRaw, saltRaw, digestRaw, ...extra] = verifier.split('$')
  if (algorithm !== 'scrypt' || extra.length > 0 || saltRaw === undefined || digestRaw === undefined) return false
  const cost = Number(costRaw)
  const blockSize = Number(blockRaw)
  const parallelism = Number(parallelRaw)
  if (!Number.isSafeInteger(cost) || !Number.isSafeInteger(blockSize) || !Number.isSafeInteger(parallelism)) return false
  try {
    const expected = Buffer.from(digestRaw, 'base64')
    if (expected.length !== KEY_LENGTH) return false
    const actual = scryptSync(password, Buffer.from(saltRaw, 'base64'), expected.length, {
      N: cost, r: blockSize, p: parallelism,
    })
    return timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}
