/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web'
import type { ProgressReporter, TtsResult, Voice } from './types'
import { resolveVoiceUrl } from './voices'
import { estimateWordTimestamps } from './wordTimestamps'

interface PiperConfig {
  audio: { sample_rate: number }
  espeak: { voice: string }
  inference: { noise_scale: number; length_scale: number; noise_w: number }
  num_symbols: number
  num_speakers: number
  phoneme_id_map: Record<string, number[]>
  phoneme_map?: Record<string, string[]>
  speaker_id_map: Record<string, number>
}

const sessions = new Map<string, ort.InferenceSession>()
const configs = new Map<string, PiperConfig>()

export async function synthesize(text: string, voice: Voice, baseUrl: string, report: ProgressReporter, speed = 1): Promise<TtsResult> {
  ort.env.wasm.wasmPaths = `${baseUrl}ort/`
  ort.env.wasm.numThreads = 1
  const configUrl = resolveVoiceUrl(voice.modelUrls.config, baseUrl)
  const modelUrl = resolveVoiceUrl(voice.modelUrls.onnx, baseUrl)
  report({ phase: 'download', percent: 0 })

  const config = configs.get(voice.id) ?? await fetchConfig(configUrl)
  configs.set(voice.id, config)
  const session = sessions.get(voice.id) ?? await createSession(modelUrl, report)
  sessions.set(voice.id, session)
  report({ phase: 'download', percent: 100 })

  const ids = await phonemize(text, config, baseUrl)
  if (!ids.length || Math.max(...ids) >= config.num_symbols) throw new Error('Dữ liệu phát âm không tương thích với giọng đã chọn.')
  report({ phase: 'inference' })
  const feeds: Record<string, ort.Tensor> = {
    input: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]),
    input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
    scales: new ort.Tensor('float32', Float32Array.from([
      config.inference.noise_scale,
      config.inference.length_scale / Math.max(.25, Math.min(4, speed)),
      config.inference.noise_w,
    ]), [3]),
  }
  if (config.num_speakers > 1) feeds.sid = new ort.Tensor('int64', BigInt64Array.from([0n]), [1])
  const output = await session.run(feeds)
  const pcm = output.output?.data
  if (!(pcm instanceof Float32Array) || pcm.length === 0) throw new Error('Không tạo được dữ liệu âm thanh cho giọng đã chọn.')
  const result = new Float32Array(pcm)
  return { pcm: result, sampleRate: config.audio.sample_rate, wordTimestamps: estimateWordTimestamps(text, result.length / config.audio.sample_rate) }
}

async function fetchConfig(url: string): Promise<PiperConfig> {
  const response = await fetch(url)
  if (!response.ok || (response.headers.get('content-type') ?? '').includes('text/html')) throw new Error(`Không tải được cấu hình giọng đọc (${response.status}).`)
  return response.json() as Promise<PiperConfig>
}

async function createSession(url: string, report: ProgressReporter): Promise<ort.InferenceSession> {
  const response = await fetch(url)
  if (!response.ok || (response.headers.get('content-type') ?? '').includes('text/html')) throw new Error(`Không tải được dữ liệu giọng đọc (${response.status}).`)
  const total = Number(response.headers.get('content-length')) || 0
  if (!response.body) return ort.InferenceSession.create(await response.arrayBuffer(), { executionProviders: ['wasm'] })
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.byteLength
    report({ phase: 'download', percent: total ? Math.round(loaded / total * 100) : 0 })
  }
  const bytes = new Uint8Array(loaded)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] })
}

async function phonemize(text: string, config: PiperConfig, baseUrl: string): Promise<number[]> {
  const worker = new Worker(`${baseUrl}piper/phonemize.worker.js`)
  try {
    return await new Promise<number[]>((resolve, reject) => {
      const timeout = self.setTimeout(() => reject(new Error('Bộ xử lý phát âm không phản hồi.')), 30_000)
      worker.onmessage = (event: MessageEvent<{ ids?: number[]; error?: string }>) => {
        self.clearTimeout(timeout)
        if (event.data.error) reject(new Error(event.data.error))
        else resolve(event.data.ids ?? [])
      }
      worker.onerror = () => {
        self.clearTimeout(timeout)
        reject(new Error('Không khởi động được bộ xử lý phát âm.'))
      }
      worker.postMessage({
        text,
        config,
        scriptUrl: `${baseUrl}piper/piper_phonemize.js`,
        wasmUrl: `${baseUrl}piper/piper_phonemize.wasm`,
        dataUrl: `${baseUrl}piper/piper_phonemize.data`,
      })
    })
  } finally {
    worker.terminate()
  }
}
