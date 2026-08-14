import type { WordTimestamp } from './types'

const TOKEN_PATTERN = /[^\s]+/gu

/**
 * Models used by Sketchify do not expose forced-alignment tensors. Build a
 * deterministic word timeline from the measured PCM duration instead: words
 * receive time by character weight, while punctuation adds a short pause.
 * The result is generated after inference, so it remains correct when the
 * user changes speech speed.
 */
export function estimateWordTimestamps(text: string, durationSec: number): WordTimestamp[] {
  const words = text.match(TOKEN_PATTERN) ?? []
  if (!words.length || !(durationSec > 0)) return []
  const weights = words.map((word) => {
    const letters = Array.from(word.replace(/[.,!?;:…]+$/u, '')).length
    const pause = /[.!?…]$/u.test(word) ? 4 : /[,;:]$/u.test(word) ? 2 : 0
    return Math.max(1, letters) + pause
  })
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  let cursor = 0
  return words.map((word, index) => {
    const startSec = cursor
    cursor = index === words.length - 1 ? durationSec : cursor + durationSec * weights[index] / total
    return { word, startSec, endSec: cursor }
  })
}
