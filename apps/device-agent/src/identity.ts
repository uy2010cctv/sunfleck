import { generateKeyPairSync } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface DeviceIdentity {
  readonly publicKey: string
  readonly privateKey: string
}

function parseIdentity(text: string): DeviceIdentity {
  const value: unknown = JSON.parse(text)
  if (typeof value !== 'object' || value === null) throw new Error('device identity file is invalid')
  const record = value as Record<string, unknown>
  if (typeof record['publicKey'] !== 'string' || typeof record['privateKey'] !== 'string') {
    throw new Error('device identity file is invalid')
  }
  return { publicKey: record['publicKey'], privateKey: record['privateKey'] }
}

export async function loadOrCreateDeviceIdentity(path: string): Promise<DeviceIdentity> {
  try { return parseIdentity(await readFile(path, 'utf8')) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const identity = {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  try {
    await writeFile(path, `${JSON.stringify(identity)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    return identity
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    return parseIdentity(await readFile(path, 'utf8'))
  }
}
