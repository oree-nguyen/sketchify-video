export interface SubtitleCue {
  text: string
  startSec: number
  endSec: number
}

/**
 * Temporary timing fallback: the Piper Web API currently returns only the
 * synthesized WAV/Blob, without word or phoneme alignment metadata. Split on
 * punctuation/newlines and allocate the measured AudioBuffer duration in
 * proportion to each sentence's character count. Replace this function when
 * the synthesizer exposes real word-level timestamps.
 */
export function buildSubtitleCues(text: string, audioDurationSec: number, wordTimestamps: readonly WordTimestamp[] = []): SubtitleCue[] {
  if (wordTimestamps.length) return groupWordTimestamps(wordTimestamps)
  const parts = (text.replace(/\r\n?/g, '\n').match(/[^.,!?\n]+[.,!?]?/gu) ?? [])
    .map((part) => part.trim())
    .filter(Boolean)
  if (!parts.length || audioDurationSec <= 0) return []
  const weights = parts.map((part) => Math.max(1, Array.from(part).length))
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  let cursor = 0
  return parts.map((part, index) => {
    const startSec = cursor
    cursor = index === parts.length - 1 ? audioDurationSec : cursor + audioDurationSec * weights[index] / totalWeight
    return { text: part, startSec, endSec: cursor }
  })
}

function groupWordTimestamps(words: readonly WordTimestamp[]): SubtitleCue[] {
  const cues: SubtitleCue[] = []
  let group: WordTimestamp[] = []
  const flush = () => {
    if (!group.length) return
    cues.push({ text: group.map((item) => item.word).join(' '), startSec: group[0].startSec, endSec: group[group.length - 1].endSec })
    group = []
  }
  for (const word of words) {
    group.push(word)
    if (group.length >= 7 || /[.!?…]$/u.test(word.word)) flush()
  }
  flush()
  return cues
}

export function subtitleCueAt(cues: readonly SubtitleCue[], timeSec: number): SubtitleCue | undefined {
  return cues.find((cue, index) => timeSec >= cue.startSec && (timeSec < cue.endSec || (index === cues.length - 1 && timeSec <= cue.endSec)))
}
import type { WordTimestamp } from '../tts/types'
