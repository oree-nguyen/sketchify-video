/// <reference lib="webworker" />
import { synthesize as synthesizeMatcha } from './matcha'
import { synthesize as synthesizePiper } from './piper'
import { synthesize as synthesizeVieNeu } from './vieneu'
import type { TtsProgress } from './types'
import { voiceById } from './voices'

type Request = { id: number; text: string; voiceId: string; baseUrl: string; speed: number }
type ResponseMessage =
  | { id: number; type: 'progress'; progress: TtsProgress }
  | { id: number; type: 'result'; pcm: Float32Array; sampleRate: number; wordTimestamps: import('./types').WordTimestamp[] }
  | { id: number; type: 'error'; message: string }

self.onmessage = async (event: MessageEvent<Request>) => {
  const { id, text, voiceId, baseUrl, speed } = event.data
  try {
    const voice = voiceById(voiceId)
    const report = (progress: TtsProgress) => post({ id, type: 'progress', progress })
    const result = voice.engine === 'piper'
      ? await synthesizePiper(text, voice, baseUrl, report, speed)
      : voice.engine === 'vieneu'
        ? await synthesizeVieNeu(text, voice, baseUrl, report, speed)
        : await synthesizeMatcha(text, voice, baseUrl, report, speed)
    post({ id, type: 'result', ...result }, [result.pcm.buffer])
  } catch (error) {
    post({ id, type: 'error', message: error instanceof Error ? error.message : 'Không thể tạo giọng đọc.' })
  }
}

function post(message: ResponseMessage, transfer: Transferable[] = []) {
  self.postMessage(message, { transfer })
}

export {}
