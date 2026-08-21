import type { SegmentationModelManifest } from './manifest'

export class ModelCompatibilityError extends Error {
  constructor(message: string, readonly modelId?: string) { super(message); this.name = 'ModelCompatibilityError' }
}

export interface ModelLoadProgress { loaded: number; total: number; phase: 'cache' | 'download' | 'hash' }

function resolveModelUrl(url: string): string {
  return new URL(url.replace(/^\.\//, ''), import.meta.env.BASE_URL).href
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource)
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

/** Fetch, hash and cache one immutable model. Hash mismatch is a hard error. */
export async function loadModel(entry: SegmentationModelManifest, onProgress?: (progress: ModelLoadProgress) => void): Promise<Uint8Array> {
  const url = resolveModelUrl(entry.url)
  const cacheName = 'sketchify-segmentation-models-v1'
  const cache = typeof caches !== 'undefined' ? await caches.open(cacheName) : null
  const cached = cache ? await cache.match(url) : undefined
  let response = cached
  if (!response) {
    response = await fetch(url)
    if (!response.ok) throw new ModelCompatibilityError(`Model ${entry.id} download failed (${response.status})`, entry.id)
    const total = Number(response.headers.get('content-length') ?? entry.bytes)
    const reader = response.body?.getReader()
    if (reader) {
      const parts: Uint8Array[] = []; let loaded = 0
      while (true) {
        const next = await reader.read(); if (next.done) break
        parts.push(next.value); loaded += next.value.byteLength; onProgress?.({ loaded, total, phase: 'download' })
      }
      const body = new Uint8Array(loaded); let offset = 0
      for (const part of parts) { body.set(part, offset); offset += part.byteLength }
      response = new Response(body, { headers: response.headers, status: response.status, statusText: response.statusText })
    }
  } else onProgress?.({ loaded: entry.bytes, total: entry.bytes, phase: 'cache' })
  const bytes = new Uint8Array(await response.arrayBuffer())
  onProgress?.({ loaded: bytes.byteLength, total: bytes.byteLength, phase: 'hash' })
  const actual = await sha256Hex(bytes)
  if (actual.toLowerCase() !== entry.sha256.toLowerCase()) {
    if (cache) await cache.delete(url)
    throw new ModelCompatibilityError(`Model ${entry.id} SHA-256 mismatch`, entry.id)
  }
  if (entry.bytes > 0 && bytes.byteLength !== entry.bytes) {
    if (cache) await cache.delete(url)
    throw new ModelCompatibilityError(`Model ${entry.id} byte-size mismatch`, entry.id)
  }
  // Only persist a verified immutable artifact. A corrupt response must not
  // poison the cache and make every subsequent inference fail identically.
  if (cache && !cached) await cache.put(url, new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } }))
  return bytes
}
