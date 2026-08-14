import { describe, expect, it } from 'vitest'
import { estimateWordTimestamps } from './wordTimestamps'

describe('word-level timestamp estimation', () => {
  it('covers the measured PCM duration monotonically, word by word', () => {
    const words = estimateWordTimestamps('Xin chào, đây là phụ đề.', 4.8)
    expect(words.map((item) => item.word)).toEqual(['Xin', 'chào,', 'đây', 'là', 'phụ', 'đề.'])
    expect(words[0].startSec).toBe(0)
    expect(words.at(-1)?.endSec).toBe(4.8)
    for (let index = 1; index < words.length; index++) {
      expect(words[index].startSec).toBe(words[index - 1].endSec)
      expect(words[index].endSec).toBeGreaterThan(words[index].startSec)
    }
  })
})
