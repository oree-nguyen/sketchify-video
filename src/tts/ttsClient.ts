import type { TtsProgress, WordTimestamp } from './types'
import { ttsAssetBaseUrl, voiceById } from './voices'

let worker: Worker | null = null
let nextId = 1

export interface SynthesizedSpeech { audioBuffer: AudioBuffer; wordTimestamps: WordTimestamp[] }

export async function synthesizeSpeech(text: string, voiceId: string, speed = 1, onProgress?: (progress: TtsProgress) => void): Promise<SynthesizedSpeech> {
  const normalized = text.trim()
  if (!normalized) throw new Error('Hãy nhập lời thoại trước khi tạo audio.')
  voiceById(voiceId)
  worker ??= new Worker(new URL('./ttsWorker.ts', import.meta.url), { type: 'module' })
  const id = nextId++
  const result = await new Promise<{ pcm: Float32Array; sampleRate: number; wordTimestamps: WordTimestamp[] }>((resolve, reject) => {
    const listener = (event: MessageEvent<{ id: number; type: string; progress?: TtsProgress; pcm?: Float32Array; sampleRate?: number; wordTimestamps?: WordTimestamp[]; message?: string }>) => {
      if (event.data.id !== id) return
      if (event.data.type === 'progress') { onProgress?.(event.data.progress!); return }
      worker?.removeEventListener('message', listener)
      if (event.data.type === 'error') { console.error('[Sketchify] TTS failed', { voiceId, detail: event.data.message }); reject(new Error(event.data.message)) }
      else resolve({ pcm: event.data.pcm!, sampleRate: event.data.sampleRate!, wordTimestamps: event.data.wordTimestamps ?? [] })
    }
    worker!.addEventListener('message', listener)
    worker!.postMessage({ id, text: normalized, voiceId, speed: Math.max(.25, Math.min(4, speed)), baseUrl: ttsAssetBaseUrl() })
  })
  const context = new AudioContext()
  try {
    const buffer = context.createBuffer(1, result.pcm.length, result.sampleRate)
    // Copy out of the transferable worker buffer so TypeScript and Web Audio
    // both see an ordinary ArrayBuffer-backed channel, never SharedArrayBuffer.
    buffer.copyToChannel(new Float32Array(result.pcm), 0)
    return { audioBuffer: buffer, wordTimestamps: result.wordTimestamps }
  } finally {
    await context.close()
  }
}
