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
export function buildSubtitleCues(text: string, audioDurationSec: number): SubtitleCue[] {
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

export function subtitleCueAt(cues: readonly SubtitleCue[], timeSec: number): SubtitleCue | undefined {
  return cues.find((cue, index) => timeSec >= cue.startSec && (timeSec < cue.endSec || (index === cues.length - 1 && timeSec <= cue.endSec)))
}
