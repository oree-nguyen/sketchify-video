import type { WordTimestamp } from '../tts/types'

export interface SubtitleCue {
  text: string
  startSec: number
  endSec: number
}

export function buildSubtitleCues(text: string, audioDurationSec: number, wordTimestamps: readonly WordTimestamp[] = []): SubtitleCue[] {
  if (!(audioDurationSec > 0)) return []
  const normalized = normalizeWordTimestamps(wordTimestamps, audioDurationSec)
  if (normalized.length) return groupWordTimestamps(normalized, audioDurationSec)

  // Temporary forced-alignment fallback. The current engines return PCM but
  // no trustworthy alignment tensor, so measured audio time is distributed by
  // word length and punctuation weight before captions are grouped.
  const words = text.trim().split(/\s+/u).filter(Boolean)
  if (!words.length) return []
  const weights = words.map((word) => {
    const letters = Array.from(word.replace(/[.,!?;:…]+$/u, '')).length
    const pause = /[.!?…]$/u.test(word) ? 4 : /[,;:]$/u.test(word) ? 2 : 0
    return Math.max(1, letters) + pause
  })
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  let cursor = 0
  const estimated = words.map((word, index) => {
    const startSec = cursor
    cursor = index === words.length - 1 ? audioDurationSec : cursor + audioDurationSec * weights[index] / totalWeight
    return { word, startSec, endSec: cursor }
  })
  return groupWordTimestamps(estimated, audioDurationSec)
}

function normalizeWordTimestamps(words: readonly WordTimestamp[], audioDurationSec: number): WordTimestamp[] {
  const valid = words.filter((word) => word.word.trim() && Number.isFinite(word.startSec) && Number.isFinite(word.endSec) && word.endSec > word.startSec)
  if (!valid.length) return []
  for (let index = 1; index < valid.length; index++) if (valid[index].startSec < valid[index - 1].startSec) return []
  const sourceDuration = valid.at(-1)!.endSec
  if (!(sourceDuration > 0)) return []
  const scale = audioDurationSec / sourceDuration
  return valid.map((word, index) => ({
    word: word.word,
    startSec: index === 0 ? 0 : Math.max(0, Math.min(audioDurationSec, word.startSec * scale)),
    endSec: index === valid.length - 1 ? audioDurationSec : Math.max(0, Math.min(audioDurationSec, word.endSec * scale)),
  }))
}

function groupWordTimestamps(words: readonly WordTimestamp[], audioDurationSec: number): SubtitleCue[] {
  const cues: SubtitleCue[] = []
  let group: WordTimestamp[] = []
  const flush = () => {
    if (!group.length) return
    cues.push({ text: group.map((item) => item.word).join(' '), startSec: group[0].startSec, endSec: group[group.length - 1].endSec })
    group = []
  }
  for (const word of words) {
    group.push(word)
    if (group.length >= 8 || (group.length >= 7 && /[.!?…]$/u.test(word.word))) flush()
  }
  flush()
  cues.forEach((cue, index) => {
    cue.startSec = index === 0 ? 0 : cues[index - 1].endSec
    if (index === cues.length - 1) cue.endSec = audioDurationSec
  })
  return cues
}

export function subtitleCueAt(cues: readonly SubtitleCue[], timeSec: number): SubtitleCue | undefined {
  return cues.find((cue, index) => timeSec >= cue.startSec && (timeSec < cue.endSec || (index === cues.length - 1 && timeSec <= cue.endSec)))
}
