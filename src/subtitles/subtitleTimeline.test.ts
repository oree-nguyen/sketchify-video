import { describe, expect, it } from 'vitest'
import { buildSubtitleCues, subtitleCueAt } from './subtitleTimeline'

describe('subtitle fallback timing', () => {
  it('splits punctuation/newlines and fills the exact AudioBuffer duration', () => {
    const cues = buildSubtitleCues('Xin chào, đây là câu hai.\nKết thúc!', 12)
    expect(cues.map((cue) => cue.text)).toEqual(['Xin chào,', 'đây là câu hai.', 'Kết thúc!'])
    expect(cues[0].startSec).toBe(0)
    expect(cues.at(-1)?.endSec).toBe(12)
    expect(cues[1].endSec).toBeGreaterThan(cues[0].endSec)
  })

  it('selects the cue active at a given narration time', () => {
    const cues = buildSubtitleCues('Ngắn. Một câu dài hơn nhiều!', 10)
    expect(subtitleCueAt(cues, 0)?.text).toBe('Ngắn.')
    expect(subtitleCueAt(cues, 9.9)?.text).toBe('Một câu dài hơn nhiều!')
    expect(subtitleCueAt(cues, 10.1)).toBeUndefined()
  })

  it('uses generated word timestamps when the synthesizer supplies them', () => {
    const cues = buildSubtitleCues('ignored fallback text', 99, [
      { word: 'Xin', startSec: 0, endSec: .4 },
      { word: 'chào.', startSec: .4, endSec: 1 },
      { word: 'Bạn', startSec: 1, endSec: 1.4 },
    ])
    expect(cues).toEqual([
      { text: 'Xin chào.', startSec: 0, endSec: 1 },
      { text: 'Bạn', startSec: 1, endSec: 1.4 },
    ])
  })
})
