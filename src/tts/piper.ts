/// <reference lib="webworker" />
import { TtsSession } from '@mintplex-labs/piper-tts-web'
import type { ProgressReporter, TtsResult, Voice } from './types'
import { resolveVoiceUrl } from './voices'

const nativeFetch = self.fetch.bind(self)
let activeVoice: Voice | null = null
let activeBase = './'
let cachedSession: TtsSession | null = null
let cachedVoiceId = ''
let interceptionInstalled = false

function installAssetInterception() {
  if (interceptionInstalled) return
  interceptionInstalled = true
  self.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (activeVoice) {
      const filename = new URL(raw, activeBase).pathname.split('/').pop() ?? ''
      if (filename === `${activeVoice.piperId}.onnx.json`) return fetchAsset(resolveVoiceUrl(activeVoice.modelUrls.config, activeBase), init)
      if (filename === `${activeVoice.piperId}.onnx`) return fetchAsset(resolveVoiceUrl(activeVoice.modelUrls.onnx, activeBase), init)
      if (filename === 'piper_phonemize.data') return fetchAsset(`${activeBase}piper/piper_phonemize.data`, init)
      if (filename === 'piper_phonemize.wasm') return fetchAsset(`${activeBase}piper/piper_phonemize.wasm`, init)
      if (filename.startsWith('ort-') && filename.endsWith('.wasm')) return fetchAsset(`${activeBase}ort/${filename}`, init)
    }
    return fetchAsset(input, init)
  }) as typeof fetch
}

async function fetchAsset(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await nativeFetch(input, init)
  const contentType = response.headers.get('content-type') ?? ''
  if (!response.ok || contentType.includes('text/html')) throw new Error(`Không tải được dữ liệu giọng đọc (${response.status}).`)
  return response
}

export async function synthesize(text: string, voice: Voice, baseUrl: string, report: ProgressReporter): Promise<TtsResult> {
  if (!voice.piperId) throw new Error('Cấu hình giọng đọc không hợp lệ.')
  installAssetInterception()
  activeVoice = voice
  activeBase = baseUrl
  report({ phase: 'download', percent: 0 })
  if (cachedVoiceId !== voice.id) { TtsSession._instance = null; cachedSession = null }
  const session = cachedSession ?? await TtsSession.create({
    voiceId: voice.piperId,
    wasmPaths: {
      onnxWasm: `${baseUrl}ort/`,
      piperData: `${baseUrl}piper/piper_phonemize.data`,
      piperWasm: `${baseUrl}piper/piper_phonemize.wasm`,
    },
    progress: ({ loaded, total }) => report({ phase: 'download', percent: total ? Math.round(loaded / total * 100) : 0 }),
  })
  cachedSession = session
  cachedVoiceId = voice.id
  report({ phase: 'download', percent: 100 })
  report({ phase: 'inference' })
  const wav = new Uint8Array(await (await session.predict(text)).arrayBuffer())
  return { pcm: wavPcm16ToFloat32(wav), sampleRate: voice.sampleRate }
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
  throw new Error('Dữ liệu âm thanh trả về không hợp lệ.')
}
