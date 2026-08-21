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

const vieneuRevision = '75ff82a72f54d55ed389e1eeb12041d3c4bac7d4'
const vieneuModelUrls = {
  prefill: 'voices/vieneu-v3/runtime/vieneu_prefill.onnx',
  decode: 'voices/vieneu-v3/runtime/vieneu_decode_step.onnx',
  acoustic: 'voices/vieneu-v3/runtime/vieneu_acoustic_cached.onnx',
  backbone0: 'voices/vieneu-v3/runtime/vieneu-backbone-0.data',
  backbone1: 'voices/vieneu-v3/runtime/vieneu-backbone-1.data',
  codec: 'voices/vieneu-v3/runtime/moss_audio_tokenizer_decode_full.onnx',
  codecData: 'voices/vieneu-v3/runtime/moss_audio_tokenizer_decode_shared.data',
  embed: 'voices/vieneu-v3/embed.onnx',
  heads: 'voices/vieneu-v3/heads.onnx',
  tokenizer: 'voices/vieneu-v3/tokenizer.json',
  presets: 'voices/vieneu-v3/voices.json',
}
const vieneuVoice = (id: string, displayName: string, presetVoice: string): Voice => ({
  id, displayName, presetVoice, language: 'vi', engine: 'vieneu', sampleRate: 48000,
  sourceCheckpoint: `pnnbao-ump/VieNeu-TTS-v3-Turbo@${vieneuRevision}`,
  modelUrls: vieneuModelUrls,
})

// Only displayName and language are exposed by the UI. Engine/checkpoint/model
// information remains internal and is documented in THIRD-PARTY-NOTICES.md.
export const TTS_VOICES: Voice[] = [
  {
    id: 'vi-mc-ngoc-ngan', displayName: 'MC. Ngọc Ngân', language: 'vi', engine: 'matcha',
    sourceCheckpoint: 'doof-ferb/matcha_ngngngan checkpoint_epoch420_slim', sampleRate: 22050,
    modelUrls: {
      onnx: 'voices/matcha-ngoc-ngan.onnx',
      vocoder: 'voices/hifigan-ngoc-ngan.onnx',
      symbols: 'voices/matcha-ngoc-ngan-symbols.json',
    },
    usageNotice: 'Giọng này chỉ được dùng phi thương mại theo giấy phép CC BY-NC-SA 4.0 của checkpoint.',
  },
  vieneuVoice('vi-vieneu-ngoc-lan', 'Ngọc Lan', 'Ngọc Lan'),
  vieneuVoice('vi-vieneu-ngoc-linh', 'Ngọc Linh', 'Ngọc Linh'),
  vieneuVoice('vi-vieneu-truc-ly', 'Trúc Ly', 'Trúc Ly'),
  vieneuVoice('vi-vieneu-my-duyen', 'Mỹ Duyên', 'Mỹ Duyên'),
  vieneuVoice('vi-vieneu-xuan-vinh', 'Xuân Vĩnh', 'Xuân Vĩnh'),
  vieneuVoice('vi-vieneu-thai-son', 'Thái Sơn', 'Thái Sơn'),
  vieneuVoice('vi-vieneu-gia-bao', 'Gia Bảo', 'Gia Bảo'),
  vieneuVoice('vi-vieneu-duc-tri', 'Đức Trí', 'Đức Trí'),
  vieneuVoice('vi-vieneu-trong-huu', 'Trọng Hữu', 'Trọng Hữu'),
  vieneuVoice('vi-vieneu-binh-an', 'Bình An', 'Bình An'),
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
  {
    id: 'ko-standard', displayName: 'Giọng Hàn tiêu chuẩn', language: 'ko', engine: 'piper',
    sourceCheckpoint: 'ko_KR-kss-medium', piperId: 'ko_KR-kss-medium', sampleRate: 22050,
    modelUrls: piper('ko/ko_KR/kss/medium', 'ko_KR-kss-medium'),
  },
]

export const DEFAULT_VOICE_BY_LANGUAGE: Record<TtsLanguage, string> = {
  vi: 'vi-default',
  en: 'en-warm-female',
  ko: 'ko-standard',
}

export function voiceById(id: string): Voice {
  const voice = TTS_VOICES.find((candidate) => candidate.id === id)
  if (!voice) throw new Error('Không tìm thấy giọng đọc đã chọn.')
  return voice
}

export function resolveVoiceUrl(url: string, baseUrl: string): string {
  return /^https?:\/\//i.test(url) ? url : new URL(url, baseUrl).href
}
