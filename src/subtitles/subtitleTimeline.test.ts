import { describe, expect, it } from 'vitest'
import { buildSubtitleCues, subtitleCueAt } from './subtitleTimeline'

describe('subtitle realtime timing', () => {
  it('groups fallback captions into continuous groups of 7-8 words', () => {
    const text = 'Một hai ba bốn năm sáu bảy tám chín mười A B C D E.'
    const cues = buildSubtitleCues(text, 12)
    expect(cues.map((cue) => cue.text.split(/\s+/u).length)).toEqual([8, 7])
    expect(cues[0].startSec).toBe(0)
    expect(cues[1].startSec).toBe(cues[0].endSec)
    expect(cues.at(-1)?.endSec).toBe(12)
  })

  it('keeps a cue active at every instant while narration is playing', () => {
    const cues = buildSubtitleCues('Một hai ba bốn năm sáu bảy tám chín mười.', 10)
    for (let time = 0; time <= 10; time += .1) expect(subtitleCueAt(cues, time)).toBeDefined()
    expect(subtitleCueAt(cues, 10.1)).toBeUndefined()
  })

  it('normalizes supplied timestamps to measured AudioBuffer duration', () => {
    const words = Array.from({ length: 16 }, (_, index) => ({ word: `t${index + 1}`, startSec: index * .25, endSec: (index + 1) * .25 }))
    const cues = buildSubtitleCues('ignored', 8, words)
    expect(cues).toHaveLength(2)
    expect(cues[0].text).toBe('t1 t2 t3 t4 t5 t6 t7 t8')
    expect(cues[1].endSec).toBe(8)
    expect(subtitleCueAt(cues, 7.9)?.text).toContain('t16')
  })
})
