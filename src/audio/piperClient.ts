import { piperAssetBaseUrl, piperVoice } from './piperVoices'

export type PiperProgress = { phase: 'download' | 'inference'; percent?: number }

let worker: Worker | null = null
let nextId = 1

export async function synthesizePiper(text: string, voiceId: string, onProgress?: (progress: PiperProgress) => void): Promise<AudioBuffer> {
  const normalized = text.trim()
  if (!normalized) throw new Error('Hãy nhập lời thoại trước khi tạo audio.')
  worker ??= new Worker(new URL('./piper.worker.ts', import.meta.url), { type: 'module' })
  const id = nextId++
  const result = await new Promise<{ pcm: Float32Array; sampleRate: number }>((resolve, reject) => {
    const listener = (event: MessageEvent<{ id: number; type: string; phase?: 'download' | 'inference'; percent?: number; pcm?: Float32Array; sampleRate?: number; message?: string }>) => {
      if (event.data.id !== id) return
      if (event.data.type === 'progress') return onProgress?.({ phase: event.data.phase!, percent: event.data.percent })
      worker?.removeEventListener('message', listener)
      if (event.data.type === 'error') reject(new Error(event.data.message))
      else resolve({ pcm: event.data.pcm!, sampleRate: event.data.sampleRate! })
    }
    worker!.addEventListener('message', listener)
    worker!.postMessage({ id, text: normalized, voice: piperVoice(voiceId), baseUrl: piperAssetBaseUrl() })
  })
  const context = new AudioContext()
  try {
    const buffer = context.createBuffer(1, result.pcm.length, result.sampleRate)
    buffer.copyToChannel(new Float32Array(result.pcm), 0)
    return buffer
  } finally {
    await context.close()
  }
}
