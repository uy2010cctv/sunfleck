/** Strict session-cookie parsing and serialization.
 * @param header - Input value used by this API.
 * @param name - Input value used by this API.
 * @returns Result produced by this API.
 */

export function parseSessionCookie(header: string, name: string): string | undefined {
  for (const part of header.split(';')) {
    const at = part.indexOf('=')
    if (at < 0 || part.slice(0, at).trim() !== name) continue
    const value = part.slice(at + 1).trim()
    return value === '' ? undefined : decodeURIComponent(value)
  }
  return undefined
}

/** Executes `serializeSessionCookie`.
 * @param input - Input value used by this API.
 * @returns Result produced by this API.
 */
export function serializeSessionCookie(input: {
  name: string
  token: string
  maxAgeSeconds: number
  secure: boolean
}): string {
  return [
    `${input.name}=${encodeURIComponent(input.token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${String(input.maxAgeSeconds)}`,
    ...(input.secure ? ['Secure'] : []),
  ].join('; ')
}

/** Executes `clearSessionCookie`.
 * @param name - Input value used by this API.
 * @param secure - Input value used by this API.
 * @returns Result produced by this API.
 */
export function clearSessionCookie(name: string, secure: boolean): string {
  return serializeSessionCookie({ name, token: '', maxAgeSeconds: 0, secure })
}
