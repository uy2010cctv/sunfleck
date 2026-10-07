import { describe, expect, it } from 'vitest'
import { readLocalRequestBody } from '../src/local-http.ts'

async function* bytes(...chunks: Uint8Array[]): AsyncGenerator<Uint8Array> {
  yield* chunks
}

describe('loopback request body limits', () => {
  it('retains a bounded JSON body', async () => {
    expect(await readLocalRequestBody(bytes(new Uint8Array([123]), new Uint8Array([125]))))
      .toMatchObject({ 0: 123, 1: 125, byteLength: 2 })
  })

  it('rejects an oversized request before buffering further chunks', async () => {
    let consumed = 0
    const chunks = (async function* () {
      consumed++; yield new Uint8Array(1024 * 1024)
      consumed++; yield new Uint8Array([120])
      consumed++; yield new Uint8Array([121])
    })()
    expect(await readLocalRequestBody(chunks)).toBeUndefined()
    expect(consumed).toBe(2)
  })
})
