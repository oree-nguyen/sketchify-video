import type { TtsLanguage, Voice } from './types'

function currentDocumentBase(): string {
  if (typeof document !== 'undefined') return document.baseURI
  if (typeof location !== 'undefined') return location.href
  return 'http://localhost/'
}

export function ttsAssetBaseUrl(documentBase = currentDocumentBase(), viteBase = import.meta.env.BASE_URL): string {
  return new URL(viteBase, documentBase).href
}

export function ttsAssetUrl(path: string, documentBase = currentDocumentBase(), viteBase = import.meta.env.BASE_URL): string {
  return new URL(path, ttsAssetBaseUrl(documentBase, viteBase)).href
}

const piperRoot = 'https://huggingface.co/rhasspy/piper-voices/resolve/main'
const piper = (path: string, file: string) => ({
  onnx: `${piperRoot}/${path}/${file}.onnx?download=true`,
  config: `${piperRoot}/${path}/${file}.onnx.json?download=true`,
})

// Only displayName and language are exposed by the UI. Engine/checkpoint/model
// information remains internal and is documented in THIRD-PARTY-NOTICES.md.
export const TTS_VOICES: Voice[] = [
  {
    id: 'vi-default', displayName: 'Giọng Việt tiêu chuẩn', language: 'vi', engine: 'piper',
    sourceCheckpoint: 'vi_VN-vais1000-medium', piperId: 'vi_VN-vais1000-medium', sampleRate: 22050,
    modelUrls: { onnx: 'voices/vi-default.onnx', config: 'voices/vi-default.onnx.json' },
  },
  {
    id: 'vi-community-light', displayName: 'Giọng Việt nhẹ', language: 'vi', engine: 'piper',
    sourceCheckpoint: 'vi_VN-vivos-x_low', piperId: 'vi_VN-vivos-x_low', sampleRate: 16000,
    modelUrls: { onnx: 'voices/vi-vivos-x-low.onnx', config: 'voices/vi-vivos-x-low.onnx.json' },
  },
  {
    id: 'vi-community-narrator', displayName: 'Giọng Việt kể chuyện', language: 'vi', engine: 'piper',
    sourceCheckpoint: 'vi_VN-25hours_single-low', piperId: 'vi_VN-25hours_single-low', sampleRate: 16000,
    modelUrls: { onnx: 'voices/vi-25hours-low.onnx', config: 'voices/vi-25hours-low.onnx.json' },
  },
  {
    id: 'en-warm-female', displayName: 'Warm female voice', language: 'en', engine: 'matcha',
    sourceCheckpoint: 'matcha_ljspeech (Akjava community ONNX q8)', sampleRate: 22050,
    modelUrls: { onnx: 'voices/matcha-ljspeech-q8.onnx', dictionary: 'tts/cmudict-0.7b' },
  },
  {
    id: 'en-clear-neutral', displayName: 'Clear neutral voice', language: 'en', engine: 'piper',
    sourceCheckpoint: 'en_US-lessac-medium', piperId: 'en_US-lessac-medium', sampleRate: 22050,
    modelUrls: piper('en/en_US/lessac/medium', 'en_US-lessac-medium'),
  },
  {
    id: 'en-clear-detailed', displayName: 'Detailed neutral voice', language: 'en', engine: 'piper',
    sourceCheckpoint: 'en_US-lessac-high', piperId: 'en_US-lessac-high', sampleRate: 22050,
    modelUrls: piper('en/en_US/lessac/high', 'en_US-lessac-high'),
  },
  {
    id: 'en-calm-male', displayName: 'Calm male voice', language: 'en', engine: 'piper',
    sourceCheckpoint: 'en_US-joe-medium', piperId: 'en_US-joe-medium', sampleRate: 22050,
    modelUrls: piper('en/en_US/joe/medium', 'en_US-joe-medium'),
  },
  {
    id: 'en-soft-female', displayName: 'Soft female voice', language: 'en', engine: 'piper',
    sourceCheckpoint: 'en_US-ljspeech-medium', piperId: 'en_US-ljspeech-medium', sampleRate: 22050,
    modelUrls: piper('en/en_US/ljspeech/medium', 'en_US-ljspeech-medium'),
  },
  {
    id: 'en-soft-detailed', displayName: 'Detailed female voice', language: 'en', engine: 'piper',
    sourceCheckpoint: 'en_US-ljspeech-high', piperId: 'en_US-ljspeech-high', sampleRate: 22050,
    modelUrls: piper('en/en_US/ljspeech/high', 'en_US-ljspeech-high'),
  },
  {
    id: 'en-british-female', displayName: 'British female voice', language: 'en', engine: 'piper',
    sourceCheckpoint: 'en_GB-jenny_dioco-medium', piperId: 'en_GB-jenny_dioco-medium', sampleRate: 22050,
    modelUrls: piper('en/en_GB/jenny_dioco/medium', 'en_GB-jenny_dioco-medium'),
  },
]

export const DEFAULT_VOICE_BY_LANGUAGE: Record<TtsLanguage, string> = {
  vi: 'vi-default',
  en: 'en-warm-female',
}

export function voiceById(id: string): Voice {
  const voice = TTS_VOICES.find((candidate) => candidate.id === id)
  if (!voice) throw new Error('Không tìm thấy giọng đọc đã chọn.')
  return voice
}

export function resolveVoiceUrl(url: string, baseUrl: string): string {
  return /^https?:\/\//i.test(url) ? url : new URL(url, baseUrl).href
}
