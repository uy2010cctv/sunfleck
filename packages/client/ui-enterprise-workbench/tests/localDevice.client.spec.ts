import { afterEach, describe, expect, it, vi } from 'vitest'
import { readLocalDeviceStatus, readDeviceAccountIdentity, LocalDeviceError } from '../src/client/localDevice.ts'

afterEach(() => { vi.unstubAllGlobals() })

describe('local device status', () => {
  it('reads the current authenticated organization and user from auth/status', async () => {
    const fetcher = vi.fn(async () => Response.json({ authenticated: true, principal: { orgId: 'org-a', userId: 'user-a' } }))
    vi.stubGlobal('fetch', fetcher)
    await expect(readDeviceAccountIdentity()).resolves.toBe(JSON.stringify(['org-a', 'user-a']))
    expect(fetcher).toHaveBeenCalledWith('/auth/status', { credentials: 'same-origin', cache: 'no-store' })
  })
  it('contains a failed authentication request as a coded setup failure', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('network unavailable') })
    await expect(readDeviceAccountIdentity()).rejects.toMatchObject({ code: 'account-changed' })
  })
  it('reports a signed-out account without an identity', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ authenticated: false }))
    await expect(readDeviceAccountIdentity()).resolves.toBeUndefined()
  })
  it.each([
    () => Response.json({ authenticated: true, principal: { orgId: 'org-a' } }),
    () => Response.json({ authenticated: true, principal: null }),
    () => new Response(null, { status: 403 }),
  ])('rejects an invalid or refused authentication response', async (response) => {
    vi.stubGlobal('fetch', async () => response())
    await expect(readDeviceAccountIdentity()).rejects.toBeInstanceOf(LocalDeviceError)
  })
  it('keeps an identity-only companion upgrade separate from permission success', async () => {
    await expect(readLocalDeviceStatus('http://127.0.0.1:47631', async () => new Response(null, { status: 404 })))
      .rejects.toMatchObject({ code: 'upgrade-required' })
  })
  it('preserves boolean OS probes and unknown browser availability', async () => {
    const status = await readLocalDeviceStatus('http://127.0.0.1:47631', async () => Response.json({
      protocolVersion: 2, agentVersion: '0.1.0', platform: 'macos', connectionPresent: true, serverOrigin: 'https://sunfleck.test',
      cua: { state: 'ready' }, browser: { available: 'unknown' },
      permissions: { state: 'available', accessibility: true, screenRecording: false },
    }))
    expect(status.permissions).toEqual({ accessibility: 'granted', screenRecording: 'denied' })
    expect(status.browser.available).toBe(false)
  })
  it('rejects malformed status without claiming permissions', async () => {
    await expect(readLocalDeviceStatus('http://127.0.0.1:47631', async () => Response.json({ connected: true })))
      .rejects.toBeInstanceOf(LocalDeviceError)
  })
})
