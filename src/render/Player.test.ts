import { describe, expect, it } from 'vitest'
import { usesStandardReveal } from './Player'
import type { ObjectSettings } from '../state/projectStore'

const settings = (push: boolean): ObjectSettings => ({
  objectId: 'object', blockId: 1, order: 0, drawDurationSec: 2,
  strokeColorMode: 'object', inkColor: '#111827', strokeWidth: 3,
  pushEntry: { enabled: push, edge: 'auto', handStyle: '1' }, zoomFollow: true,
})

describe('Player effect exclusivity', () => {
  it('vật thể push không chạy path/area reveal, vật thể thường vẫn reveal', () => {
    expect(usesStandardReveal(settings(true))).toBe(false)
    expect(usesStandardReveal(settings(false))).toBe(true)
    expect(usesStandardReveal(undefined)).toBe(true)
  })
})
