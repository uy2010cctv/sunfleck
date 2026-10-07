import { describe, expect, it, vi } from 'vitest'
import { readLocalDeviceStatus, type LocalStatusOptions } from '../src/status.ts'

const base = { serverOrigin: 'http://dsh.example', connectionPresent: () => true, agentVersion: '0.1.0' }

async function probe(options: Partial<LocalStatusOptions>) {
  return readLocalDeviceStatus({ ...base, ...options })
}

describe('local device readiness diagnostics', () => {
  it('reads browser presence and macOS permission flags without creating a driver', async () => {
    const permissions = vi.fn(() => ({ accessibility: false, screenRecording: true }))
    const loadCua = vi.fn(async () => ({ currentMacOsPermissionStatus: permissions }))
    const status = await probe({ platform: 'darwin', browserExecutable: () => '/private/browser', exists: () => true, loadCua })
    expect(status).toEqual({
      protocolVersion: 2, agentVersion: '0.1.0', platform: 'macos', serverOrigin: 'http://dsh.example',
      connectionPresent: true, browser: { available: true }, cua: { state: 'ready' },
      permissions: { state: 'available', accessibility: false, screenRecording: true },
    })
    expect(permissions).toHaveBeenCalledOnce()
    expect(JSON.stringify(status)).not.toContain('/private/browser')
  })

  it('reports unknown permissions and a safe code when the native SDK cannot load', async () => {
    const status = await probe({
      platform: 'darwin', browserExecutable: () => undefined,
      loadCua: async () => { throw new Error('/private/native-path') },
    })
    expect(status).toMatchObject({
      browser: { available: false }, cua: { state: 'failed' }, diagnosticErrorCode: 'cua_unavailable',
      permissions: { state: 'unknown', accessibility: 'unknown', screenRecording: 'unknown' },
    })
    expect(JSON.stringify(status)).not.toContain('/private/native-path')
  })

  it('reports unavailable native permissions without changing grants', async () => {
    const status = await probe({
      platform: 'darwin', browserExecutable: () => undefined,
      loadCua: async () => ({ currentMacOsPermissionStatus: () => { throw new Error('private permission error') } }),
    })
    expect(status).toMatchObject({ cua: { state: 'ready' }, permissions: { state: 'unknown' }, diagnosticErrorCode: 'permission_status_unavailable' })
  })

  it('does not query macOS permissions on Windows', async () => {
    const permissions = vi.fn(() => ({ accessibility: true, screenRecording: true }))
    const status = await probe({ platform: 'win32', browserExecutable: () => undefined, loadCua: async () => ({ currentMacOsPermissionStatus: permissions }) })
    expect(status).toMatchObject({ platform: 'windows', cua: { state: 'ready' }, permissions: { state: 'unsupported' } })
    expect(permissions).not.toHaveBeenCalled()
  })

  it('does not load the native SDK on an unsupported operating system', async () => {
    const loadCua = vi.fn(async () => ({ currentMacOsPermissionStatus: () => ({ accessibility: true, screenRecording: true }) }))
    const status = await probe({ platform: 'freebsd', browserExecutable: () => undefined, loadCua })
    expect(status).toMatchObject({ platform: 'unsupported', cua: { state: 'unsupported' }, permissions: { state: 'unsupported' } })
    expect(loadCua).not.toHaveBeenCalled()
  })
})
