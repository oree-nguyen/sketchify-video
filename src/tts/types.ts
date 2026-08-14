export type TtsEngine = 'piper' | 'matcha'
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
}

export interface TtsResult {
  pcm: Float32Array
  sampleRate: number
}

export interface TtsProgress {
  phase: 'download' | 'inference'
  percent?: number
}

export type ProgressReporter = (progress: TtsProgress) => void
