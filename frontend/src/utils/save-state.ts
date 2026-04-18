export interface SaveFingerprint {
  contentHash: string
  contentLength: number
}

export interface SaveStatusEventPayload {
  content_hash?: string
  content_length?: number
}

export function createSaveFingerprint(content: string): SaveFingerprint {
  const bytes = new TextEncoder().encode(content)
  let hash = 0x811c9dc5
  for (const byte of bytes) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return {
    contentHash: hash.toString(16).padStart(8, '0'),
    contentLength: bytes.length,
  }
}

export function saveEventMatchesContent(content: string, event: SaveStatusEventPayload): boolean {
  if (typeof event.content_hash !== 'string' || typeof event.content_length !== 'number') {
    return false
  }
  const fingerprint = createSaveFingerprint(content)
  return fingerprint.contentHash === event.content_hash && fingerprint.contentLength === event.content_length
}
