/// <reference lib="webworker" />
import { TtsSession } from '@mintplex-labs/piper-tts-web'
import type { PiperVoice } from './piperVoices'

type Request = { id: number; text: string; voice: PiperVoice; baseUrl: string }
type ResponseMessage =
  | { id: number; type: 'progress'; phase: 'download' | 'inference'; percent?: number }
  | { id: number; type: 'result'; pcm: Float32Array; sampleRate: number }
  | { id: number; type: 'error'; message: string }

const nativeFetch = self.fetch.bind(self)
let activeVoice: PiperVoice | null = null
let activeBase = './'
let cachedSession: TtsSession | null = null
let cachedVoiceId = ''

// piper-tts-web owns the phonemizer/ORT inference pipeline. Redirect its
// published model/CDN requests to same-origin, lazily served project assets.
self.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (activeVoice) {
    const filename = new URL(raw, activeBase).pathname.split('/').pop() ?? ''
    if (filename === `${activeVoice.piperId}.onnx.json`) return fetchAsset(activeVoice.onnxConfigUrl, init)
    if (filename === `${activeVoice.piperId}.onnx`) return fetchAsset(activeVoice.onnxUrl, init)
    if (filename === 'piper_phonemize.data') return fetchAsset(`${activeBase}piper/piper_phonemize.data`, init)
    if (filename === 'piper_phonemize.wasm') return fetchAsset(`${activeBase}piper/piper_phonemize.wasm`, init)
    if (filename.startsWith('ort-') && filename.endsWith('.wasm')) return fetchAsset(`${activeBase}ort/${filename}`, init)
  }
  return fetchAsset(input, init)
}) as typeof fetch

async function fetchAsset(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await nativeFetch(input, init)
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const contentType = response.headers.get('content-type') ?? ''
  if (!response.ok || contentType.includes('text/html')) throw new Error(`Piper asset không hợp lệ: ${response.status} ${url} (${contentType || 'không có content-type'})`)
  return response
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const { id, text, voice, baseUrl } = event.data
  try {
    activeVoice = voice
    activeBase = baseUrl
    post({ id, type: 'progress', phase: 'download', percent: 0 })
    if (cachedVoiceId !== voice.id) { TtsSession._instance = null; cachedSession = null }
    const session = cachedSession ?? await TtsSession.create({
      voiceId: voice.piperId,
      wasmPaths: {
        onnxWasm: `${baseUrl}ort/`,
        piperData: `${baseUrl}piper/piper_phonemize.data`,
        piperWasm: `${baseUrl}piper/piper_phonemize.wasm`,
      },
      progress: ({ loaded, total }) => post({ id, type: 'progress', phase: 'download', percent: total ? Math.round(loaded / total * 100) : 0 }),
    })
    cachedSession = session; cachedVoiceId = voice.id
    post({ id, type: 'progress', phase: 'download', percent: 100 })
    await new Promise((resolve) => setTimeout(resolve, 80))
    post({ id, type: 'progress', phase: 'inference' })
    const wav = new Uint8Array(await (await session.predict(text)).arrayBuffer())
    const pcm = wavPcm16ToFloat32(wav)
    post({ id, type: 'result', pcm, sampleRate: voice.sampleRate }, [pcm.buffer])
  } catch (error) {
    post({ id, type: 'error', message: error instanceof Error ? error.message : 'Piper không thể tạo giọng đọc.' })
  }
}

function wavPcm16ToFloat32(wav: Uint8Array): Float32Array {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
  let offset = 12
  while (offset + 8 <= wav.byteLength) {
    const name = String.fromCharCode(...wav.subarray(offset, offset + 4))
    const size = view.getUint32(offset + 4, true)
    if (name === 'data') {
      const samples = new Float32Array(Math.floor(size / 2))
      for (let index = 0; index < samples.length; index++) samples[index] = view.getInt16(offset + 8 + index * 2, true) / 32768
      return samples
    }
    offset += 8 + size + (size & 1)
  }
  throw new Error('Piper trả WAV không có khối PCM data.')
}

function post(message: ResponseMessage, transfer?: Transferable[]) {
  self.postMessage(message, { transfer: transfer ?? [] })
}

export {}
