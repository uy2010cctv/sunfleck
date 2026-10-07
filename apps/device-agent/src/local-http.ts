/** Bounded request parsing for the loopback companion HTTP listener. */
const MAX_LOCAL_REQUEST_BYTES = 1024 * 1024

/**
 * Stop buffering when a loopback request exceeds the one-megabyte protocol limit.
 * @param chunks Request byte chunks; HTTP callers keep the stream open on iterator return.
 * @returns Complete bytes, or undefined when the request is too large.
 */
export async function readLocalRequestBody(chunks: AsyncIterable<Uint8Array>): Promise<Buffer<ArrayBuffer> | undefined> {
  const retained: Uint8Array[] = []
  let size = 0
  for await (const chunk of chunks) {
    size += chunk.byteLength
    if (size > MAX_LOCAL_REQUEST_BYTES) return undefined
    retained.push(chunk)
  }
  return Buffer.concat(retained)
}
