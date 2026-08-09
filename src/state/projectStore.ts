import { DEFAULT_SETTINGS } from './settingsDefaults'

export type HandStyleId = 'pencil' | 'feather-gray' | 'feather-white' | 'marker' | 'pen-blue'
export type TransitionType = 'none' | 'zoom-morph' | 'paper-airplane' | 'paper-fold'

export interface Frame {
  id: number
  name: string
  sourceUrl: string
  settings: typeof DEFAULT_SETTINGS
  pinnedBlockIds: number[]
  transitionToNext: { type: TransitionType; durationSec: number }
  durationSec: number
  analysis: unknown | null
  dirty: boolean
}

export interface Project {
  frames: Frame[]
  activeFrameId: number | null
  handStyle: HandStyleId
}

export function createFrame(file: File, id: number): Frame {
  return {
    id,
    name: file.name,
    sourceUrl: URL.createObjectURL(file),
    settings: { ...DEFAULT_SETTINGS },
    pinnedBlockIds: [],
    transitionToNext: { type: 'none', durationSec: 1 },
    durationSec: DEFAULT_SETTINGS.drawDurationSec + DEFAULT_SETTINGS.holdDurationSec,
    analysis: null,
    dirty: true,
  }
}
