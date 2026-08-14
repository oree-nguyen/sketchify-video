/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web'
import type { ProgressReporter, TtsResult, Voice } from './types'
import { resolveVoiceUrl } from './voices'

const punctuation = ';:,.!?¡¿—…"«»“” '
const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const ipaLetters = "ɑɐɒæɓʙβɔɕçɗɖðʤəɘɚɛɜɝɞɟʄɡɠɢʛɦɧħɥʜɨɪʝɭɬɫɮʟɱɯɰŋɳɲɴøɵɸθœɶʘɹɺɾɻʀʁɽʂʃʈʧʉʊʋⱱʌɣɤʍχʎʏʑʐʒʔʡʕʢǀǁǂǃˈˌːˑʰʲʷˠˤ˞↓↑→↗↘'̩'ᵻ"
const symbols = ['_', ...punctuation, ...letters, ...ipaLetters]
const symbolToId = new Map(symbols.map((symbol, index) => [symbol, index]))

const arpaToIpa: Record<string, string> = {
  AA: 'ɑː', AE: 'æ', AH0: 'ə', AH1: 'ʌ', AH2: 'ə', AO: 'ɔ', AW: 'aʊ', AY: 'aɪ', EH: 'ɛ', ER0: 'ɝ', ER1: 'ɝː', ER2: 'ɝː',
  EY: 'eɪ', IH: 'ɪ', IY: 'iː', OW: 'oʊ', OY: 'ɔɪ', UH: 'ʊ', UW: 'uː', B: 'b', CH: 'tʃ', D: 'd', DH: 'ð', F: 'f', G: 'g', HH: 'h',
  JH: 'dʒ', K: 'k', L: 'l', M: 'm', N: 'n', NG: 'ŋ', P: 'p', R: 'r', S: 's', SH: 'ʃ', T: 't', TH: 'θ', V: 'v', W: 'w', Y: 'j', Z: 'z', ZH: 'ʒ',
}

let cachedVoiceId = ''
let cachedSession: ort.InferenceSession | null = null
let cachedDictionaryUrl = ''
let cachedDictionary: Map<string, string> | null = null

export async function synthesize(text: string, voice: Voice, baseUrl: string, report: ProgressReporter): Promise<TtsResult> {
  ort.env.wasm.wasmPaths = `${baseUrl}ort/`
  ort.env.wasm.numThreads = 1
  const modelUrl = resolveVoiceUrl(voice.modelUrls.onnx, baseUrl)
  const dictionaryUrl = resolveVoiceUrl(voice.modelUrls.dictionary, baseUrl)
  report({ phase: 'download', percent: 0 })
  const [session, dictionary] = await Promise.all([
    cachedVoiceId === voice.id && cachedSession ? cachedSession : createSession(modelUrl, report),
    cachedDictionaryUrl === dictionaryUrl && cachedDictionary ? cachedDictionary : loadDictionary(dictionaryUrl),
  ])
  cachedSession = session
  cachedVoiceId = voice.id
  cachedDictionary = dictionary
  cachedDictionaryUrl = dictionaryUrl
  report({ phase: 'download', percent: 100 })
  report({ phase: 'inference' })

  const phonemes = phonemizeEnglish(text, dictionary)
  const ids = intersperse([...phonemes].map((symbol) => symbolToId.get(symbol)).filter((id): id is number => id !== undefined))
  if (ids.length < 3) throw new Error('Nội dung chưa có từ tiếng Anh có thể phát âm.')
  const feeds: Record<string, ort.Tensor> = {
    x: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]),
    x_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
    scales: new ort.Tensor('float32', Float32Array.from([0.667, 0.95]), [2]),
  }
  const output = await session.run(feeds)
  const pcm = output.wav?.data
  if (!(pcm instanceof Float32Array) || pcm.length === 0) throw new Error('Không tạo được dữ liệu âm thanh cho giọng đã chọn.')
  return { pcm: new Float32Array(pcm), sampleRate: voice.sampleRate }
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
    chunks.push(value); loaded += value.byteLength
    report({ phase: 'download', percent: total ? Math.round(loaded / total * 100) : 0 })
  }
  const bytes = new Uint8Array(loaded)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] })
}

async function loadDictionary(url: string): Promise<Map<string, string>> {
  const response = await fetch(url)
  if (!response.ok) throw new Error('Không tải được từ điển phát âm.')
  const dictionary = new Map<string, string>()
  for (const line of (await response.text()).split(/\r?\n/)) {
    if (!line || line.startsWith(';;;')) continue
    const match = line.match(/^(\S+?)(?:\(\d+\))?\s{2}(.+)$/)
    if (match && !dictionary.has(match[1])) dictionary.set(match[1], match[2])
  }
  return dictionary
}

export function phonemizeEnglish(text: string, dictionary: Map<string, string>): string {
  const parts = text.toUpperCase().match(/[A-Z']+|[.,!?]/g) ?? []
  return parts.map((part) => {
    if (/^[.,!?]$/.test(part)) return part
    const arpa = dictionary.get(part) ?? [...part].map((letter) => dictionary.get(letter) ?? '').join(' ')
    return arpa.split(/\s+/).map(convertArpa).join('')
  }).join(' ')
}

function convertArpa(token: string): string {
  const stress = token.match(/[12]$/)?.[0]
  const base = token.replace(/[012]$/, '')
  const direct = arpaToIpa[token] ?? arpaToIpa[base] ?? ''
  return stress === '1' ? `ˈ${direct}` : stress === '2' ? `ˌ${direct}` : direct
}

function intersperse(sequence: number[]): number[] {
  const result = [0]
  for (const item of sequence) result.push(item, 0)
  return result
}
