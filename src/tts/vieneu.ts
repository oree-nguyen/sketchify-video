/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web'
import type { ProgressReporter, TtsResult, Voice } from './types'
import { phonemizeWithEspeak } from './espeakPhonemizer'
import { estimateWordTimestamps } from './wordTimestamps'
import { createVieNeuTokenizer } from './vieneuTokenizer'
import { resolveVoiceUrl } from './voices'

interface Preset { codes: number[][] }
interface PresetsFile { presets: Record<string, Preset> }
interface Runtime {
  prefill: ort.InferenceSession
  decode: ort.InferenceSession
  acoustic: ort.InferenceSession
  embed: ort.InferenceSession
  heads: ort.InferenceSession
  codec: ort.InferenceSession
  tokenize: (text: string) => number[]
  presets: PresetsFile
}

const N_VQ = 16, HIDDEN = 768, LAYERS = 12, AUDIO_PAD = 1024
let runtimePromise: Promise<Runtime> | null = null

export async function synthesize(text: string, voice: Voice, baseUrl: string, report: ProgressReporter, speed = 1): Promise<TtsResult> {
  const runtime = await (runtimePromise ??= loadRuntime(voice, baseUrl, report))
  const preset = runtime.presets.presets[voice.presetVoice ?? '']
  if (!preset) throw new Error('Không tìm thấy dữ liệu giọng đọc đã chọn.')
  report({ phase: 'inference' })
  const phonemes = (await phonemizeWithEspeak(text, 'vi', baseUrl)).join(' ')
  const phoneIds = runtime.tokenize(phonemes)
  if (!phoneIds.length) throw new Error('Nội dung không tạo được chuỗi phát âm tiếng Việt.')
  const rows: number[][] = [[8, ...pads()], [3, ...pads()], ...phoneIds.map((id) => [id, ...pads()]), [4, ...pads()]]
  for (const codes of preset.codes) rows.push([7, ...codes])
  let embedded = await embedRows(runtime, rows)
  const pre = await runtime.prefill.run({ inputs_embeds: embedded })
  const preValues = runtime.prefill.outputNames.map((name) => pre[name])
  let hidden = sliceLastHidden(preValues[0])
  let pastK = preValues.slice(1, 1 + LAYERS)
  let pastV = preValues.slice(1 + LAYERS, 1 + LAYERS * 2)
  const promptLength = embedded.dims[1]
  const frames: number[][] = []
  const history = Array.from({ length: N_VQ }, () => new Set<number>())
  const maxFrames = Math.min(600, Math.max(40, Math.ceil(text.length * 7)))
  for (let frame = 0; frame < maxFrames; frame++) {
    const generated = await acousticFrame(runtime, hidden, history)
    frames.push(generated.codes)
    if (generated.eos && frame > 5) break
    const slot = [[5, ...generated.codes]]
    embedded = await embedRows(runtime, slot)
    const feed: Record<string, ort.Tensor> = {
      inputs_embeds: embedded,
      position_ids: int64([promptLength + frame], [1, 1]),
    }
    for (let index = 0; index < LAYERS; index++) { feed[`past_k_${index}`] = pastK[index]; feed[`past_v_${index}`] = pastV[index] }
    const decoded = await runtime.decode.run(feed)
    const values = runtime.decode.outputNames.map((name) => decoded[name])
    hidden = sliceFirstHidden(values[0])
    pastK = values.slice(1, 1 + LAYERS)
    pastV = values.slice(1 + LAYERS, 1 + LAYERS * 2)
  }
  const flat = Int32Array.from(frames.flat())
  const decoded = await runtime.codec.run({
    audio_codes: new ort.Tensor('int32', flat, [1, frames.length, N_VQ]),
    audio_code_lengths: new ort.Tensor('int32', Int32Array.from([frames.length]), [1]),
  })
  const audioTensor = decoded.audio ?? decoded[runtime.codec.outputNames[0]]
  if (!(audioTensor?.data instanceof Float32Array)) throw new Error('VieNeu không trả về PCM hợp lệ.')
  const mono = mixToMono(audioTensor.data, audioTensor.dims)
  const pcm = resampleSpeed(mono, speed)
  return { pcm, sampleRate: voice.sampleRate, wordTimestamps: estimateWordTimestamps(text, pcm.length / voice.sampleRate) }
}

async function loadRuntime(voice: Voice, baseUrl: string, report: ProgressReporter): Promise<Runtime> {
  ort.env.wasm.wasmPaths = `${baseUrl}ort/`; ort.env.wasm.numThreads = 1
  report({ phase: 'download', percent: 0 })
  const local = (key: string) => resolveVoiceUrl(voice.modelUrls[key], baseUrl)
  // Load the large sessions sequentially. Creating all of them concurrently
  // can make Chromium abort otherwise-valid fetches under memory pressure.
  const [backbone0, backbone1] = await Promise.all([fetchBytes(local('backbone0')), fetchBytes(local('backbone1'))])
  const backbone = [
    { path: 'vieneu-backbone-0.data', data: backbone0 },
    { path: 'vieneu-backbone-1.data', data: backbone1 },
  ]
  report({ phase: 'download', percent: 35 })
  const prefill = await createExternalSession(local('prefill'), backbone)
  report({ phase: 'download', percent: 48 })
  const decode = await createExternalSession(local('decode'), backbone)
  const acoustic = await createSession(local('acoustic'))
  report({ phase: 'download', percent: 60 })
  const embed = await createSession(local('embed'))
  const heads = await createSession(local('heads'))
  report({ phase: 'download', percent: 82 })
  const codecData = await fetchBytes(local('codecData'))
  const codec = await createExternalSession(local('codec'), [{ path: 'moss_audio_tokenizer_decode_shared.data', data: codecData }])
  const tokenizerJson = await fetchJson(local('tokenizer'))
  const presets = await fetchJson(local('presets')) as PresetsFile
  report({ phase: 'download', percent: 100 })
  return { prefill, decode, acoustic, embed, heads, codec, tokenize: createVieNeuTokenizer(tokenizerJson as never), presets }
}

async function createSession(url: string) { return ort.InferenceSession.create(url, { executionProviders: ['wasm'] }) }
async function createExternalSession(model: string, externalData: Array<{ path: string; data: Uint8Array }>) {
  return ort.InferenceSession.create(model, { executionProviders: ['wasm'], externalData })
}
async function fetchJson(url: string): Promise<unknown> { const response = await fetch(url); if (!response.ok) throw new Error(`Không tải được dữ liệu giọng (${response.status}).`); return response.json() }
async function fetchBytes(url: string): Promise<Uint8Array> { const response = await fetch(url); if (!response.ok) throw new Error(`Không tải được dữ liệu giọng (${response.status}).`); return new Uint8Array(await response.arrayBuffer()) }

async function embedRows(runtime: Runtime, rows: number[][]): Promise<ort.Tensor> {
  const tensor = int64(rows.flat(), [rows.length, N_VQ + 1])
  const output = await runtime.embed.run({ rows: tensor })
  return output.embeddings ?? output[runtime.embed.outputNames[0]]
}

async function acousticFrame(runtime: Runtime, hidden: ort.Tensor, history: Set<number>[]) {
  const textEmbedding = await head(runtime, hidden, 0, 0, 5)
  const first = new Float32Array(HIDDEN * 2)
  first.set(hidden.data as Float32Array, 0); first.set(textEmbedding.text, HIDDEN)
  let feed: Record<string, ort.Tensor> = { token_emb: new ort.Tensor('float32', first, [1, 2, HIDDEN]), position_ids: int64([0, 1], [1, 2]) }
  addEmptyPast(runtime.acoustic, feed)
  let result = await runtime.acoustic.run(feed)
  let values = runtime.acoustic.outputNames.map((name) => result[name])
  let acousticHidden = values[0]
  let [pastK, pastV] = splitPast(values, runtime.acoustic)
  const slot0 = vectorAt(acousticHidden, 0)
  let h = vectorAt(acousticHidden, 1)
  const codes: number[] = []
  for (let channel = 0; channel < N_VQ; channel++) {
    const projected = await head(runtime, new ort.Tensor('float32', h, [1, HIDDEN]), channel, codes.at(-1) ?? 0, 5)
    const code = sample(projected.audio, history[channel]); codes.push(code); history[channel].add(code)
    if (channel === N_VQ - 1) break
    feed = { token_emb: new ort.Tensor('float32', projected.audioEmbedding, [1, 1, HIDDEN]), position_ids: int64([channel + 1], [1, 1]) }
    addPast(feed, pastK, pastV)
    result = await runtime.acoustic.run(feed)
    values = runtime.acoustic.outputNames.map((name) => result[name]); acousticHidden = values[0]
    ;[pastK, pastV] = splitPast(values, runtime.acoustic); h = vectorAt(acousticHidden, 0)
  }
  const end = await head(runtime, new ort.Tensor('float32', slot0, [1, HIDDEN]), 0, 0, 5)
  return { codes, eos: argmax(end.text) === 6 }
}

async function head(runtime: Runtime, hidden: ort.Tensor, channel: number, code: number, textId: number) {
  const output = await runtime.heads.run({ hidden, channel: int64([channel], [1]), code: int64([code], [1]), text_id: int64([textId], [1]) })
  return {
    audio: output.audio_logits.data as Float32Array,
    text: output.text_logits.data as Float32Array,
    audioEmbedding: output.audio_embedding.data as Float32Array,
  }
}

function addEmptyPast(session: ort.InferenceSession, feed: Record<string, ort.Tensor>) {
  for (const name of session.inputNames) if (/^past_[kv]_\d+$/.test(name)) feed[name] = new ort.Tensor('float32', new Float32Array(), [1, 8, 0, 96])
}
function splitPast(values: ort.Tensor[], session: ort.InferenceSession): [ort.Tensor[], ort.Tensor[]] {
  const count = session.inputNames.filter((name) => /^past_k_/.test(name)).length
  return [values.slice(1, 1 + count), values.slice(1 + count, 1 + count * 2)]
}
function addPast(feed: Record<string, ort.Tensor>, keys: ort.Tensor[], values: ort.Tensor[]) { keys.forEach((value, index) => { feed[`past_k_${index}`] = value }); values.forEach((value, index) => { feed[`past_v_${index}`] = value }) }
function pads() { return Array(N_VQ).fill(AUDIO_PAD) as number[] }
function int64(data: number[], dims: readonly number[]) { return new ort.Tensor('int64', BigInt64Array.from(data, BigInt), dims) }
function vectorAt(tensor: ort.Tensor, index: number) { return (tensor.data as Float32Array).slice(index * HIDDEN, (index + 1) * HIDDEN) }
function sliceLastHidden(tensor: ort.Tensor) { const length = tensor.dims[1]; return new ort.Tensor('float32', vectorAt(tensor, length - 1), [1, HIDDEN]) }
function sliceFirstHidden(tensor: ort.Tensor) { return new ort.Tensor('float32', vectorAt(tensor, 0), [1, HIDDEN]) }
function argmax(values: Float32Array) { let best = 0; for (let i = 1; i < values.length; i++) if (values[i] > values[best]) best = i; return best }
function sample(source: Float32Array, history: Set<number>) {
  const logits = Float32Array.from(source, (value, index) => history.has(index) ? (value < 0 ? value * 1.2 : value / 1.2) : value)
  const candidates = [...logits.keys()].sort((a, b) => logits[b] - logits[a]).slice(0, 25)
  const max = logits[candidates[0]], weights = candidates.map((index) => Math.exp((logits[index] - max) / .8))
  let pick = Math.random() * weights.reduce((a, b) => a + b, 0)
  for (let index = 0; index < candidates.length; index++) { pick -= weights[index]; if (pick <= 0) return candidates[index] }
  return candidates[0]
}
function mixToMono(data: Float32Array, dims: readonly number[]) { const samples = dims.at(-1) ?? data.length, channels = dims.length > 2 ? dims[dims.length - 2] : 1; const mono = new Float32Array(samples); for (let channel = 0; channel < channels; channel++) for (let index = 0; index < samples; index++) mono[index] += data[channel * samples + index] / channels; return mono }
function resampleSpeed(input: Float32Array, speed: number) { const rate = Math.max(.25, Math.min(4, speed)); if (Math.abs(rate - 1) < .001) return input; const output = new Float32Array(Math.max(1, Math.round(input.length / rate))); for (let i = 0; i < output.length; i++) { const at = i * rate, left = Math.floor(at), right = Math.min(input.length - 1, left + 1), mix = at - left; output[i] = input[left] * (1 - mix) + input[right] * mix } return output }
