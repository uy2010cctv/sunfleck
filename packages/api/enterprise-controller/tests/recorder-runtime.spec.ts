import { describe, expect, it, vi } from 'vitest'
import { RecorderRuntimeBridge, validateRecorderRuntimeSave } from '../src/recorder-runtime.ts'

const config = {
  expectedRevision: 0,
  asr: { mode: 'local' as const, model: 'paraformer-zh' },
  cam: { enabled: true, mode: 'local' as const, model: 'cam++', matchThreshold: 0.72 },
}

describe('recorder runtime bridge', () => {
  it('rejects online mode without an HTTPS endpoint and credential reference', () => {
    expect(() => validateRecorderRuntimeSave({
      ...config, asr: { mode: 'online', model: 'whisper', endpoint: 'http://vendor.test' },
    })).toThrow(/HTTPS endpoint and Credential reference/u)
  })

  it('sends admin authentication server-side and returns the redacted runtime view', async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('x-dsh-recorder-admin-token')).toBe('admin-secret')
      return Response.json({
        revision: 2, asr: { mode: 'local', model: 'paraformer-zh' },
        cam: { enabled: true, mode: 'local', model: 'cam++', matchThreshold: 0.72 },
        state: 'running', asrReady: true, camReady: true, credentialReady: true, checkedAt: 10,
      })
    })
    const bridge = new RecorderRuntimeBridge({ baseUrl: 'http://127.0.0.1:18765', adminToken: 'admin-secret', fetch })

    const value = await bridge.status()

    expect(value.state).toBe('running')
    expect(JSON.stringify(value)).not.toContain('admin-secret')
  })

  it('forwards resolved online secrets without returning them', async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(JSON.stringify(body)).toContain('resolved-secret')
      return Response.json({
        revision: 1, asr: config.asr, cam: config.cam,
        state: 'stopped', asrReady: false, camReady: false, credentialReady: true, checkedAt: 10,
      })
    })
    const bridge = new RecorderRuntimeBridge({ baseUrl: 'http://127.0.0.1:18765', adminToken: 'admin-secret', fetch })

    const value = await bridge.save(config, { asrCredential: 'resolved-secret' })

    expect(JSON.stringify(value)).not.toContain('resolved-secret')
  })
})
