import { describe, expect, it } from 'vitest'
import { wrapSubtitleLines } from './subtitleRenderer'

describe('subtitle wrapping', () => {
  const context = { measureText: (text: string) => ({ width: Array.from(text).length * 10 }) as TextMetrics }
  it('keeps every rendered line inside 80-percent style width', () => {
    const lines = wrapSubtitleLines(context, 'Một dòng phụ đề dài cần tự xuống dòng', 100)
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.every((line) => context.measureText(line).width <= 100)).toBe(true)
  })
})
