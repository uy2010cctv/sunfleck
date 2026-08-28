/** Strict session-cookie parsing and serialization. */

export function parseSessionCookie(header: string, name: string): string | undefined {
  for (const part of header.split(';')) {
    const at = part.indexOf('=')
    if (at < 0 || part.slice(0, at).trim() !== name) continue
    const value = part.slice(at + 1).trim()
    return value === '' ? undefined : decodeURIComponent(value)
  }
  return undefined
}

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

export function clearSessionCookie(name: string, secure: boolean): string {
  return serializeSessionCookie({ name, token: '', maxAgeSeconds: 0, secure })
}
