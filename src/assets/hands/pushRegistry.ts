import type { PushHandStyle } from '../../state/projectStore'

export interface PushHandAsset { id: Exclude<PushHandStyle, 'auto'>; label: string; src: string | null; anchorPct: { x: number; y: number } }

// Placeholder 1-6 until the six PNG filenames are supplied.
export const PUSH_HAND_ASSETS = Object.fromEntries((['1', '2', '3', '4', '5', '6'] as const).map((id) => [id, {
  id, label: `Tay đẩy số ${id}`, src: null, anchorPct: { x: 50, y: 50 },
}])) as Record<Exclude<PushHandStyle, 'auto'>, PushHandAsset>

export function resolvePushHand(style: PushHandStyle, edge: 'left' | 'right' | 'top' | 'bottom'): PushHandAsset {
  if (style !== 'auto') return PUSH_HAND_ASSETS[style]
  return PUSH_HAND_ASSETS[edge === 'left' ? '1' : edge === 'right' ? '2' : edge === 'top' ? '3' : '4']
}
