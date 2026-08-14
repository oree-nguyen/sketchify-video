export type TtsEngine = 'piper' | 'matcha' | 'vieneu'
export type TtsLanguage = 'vi' | 'en'

export interface Voice {
  id: string
  displayName: string
  language: TtsLanguage
  engine: TtsEngine
  sourceCheckpoint: string
  modelUrls: Record<string, string>
  sampleRate: number
  piperId?: string
  presetVoice?: string
  usageNotice?: string
}

export interface WordTimestamp {
  word: string
  startSec: number
  endSec: number
}

export interface TtsResult {
  pcm: Float32Array
  sampleRate: number
  wordTimestamps: WordTimestamp[]
}

export interface TtsProgress {
  phase: 'download' | 'inference'
  percent?: number
}

export type ProgressReporter = (progress: TtsProgress) => void
