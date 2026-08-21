import { describe, expect, it } from 'vitest'
import { encodeMaskRle } from './contracts'
import { evaluateEditorialObjects } from './evaluator'

const object = (id: number, x: number, y: number, w: number, h: number) => ({ id, role: 'thing' as const, bbox: { x, y, w, h }, visibleMaskRle: encodeMaskRle([y * 100 + x]), centroid: { x: x + w / 2, y: y + h / 2 }, confidence: .9, children: [], mergeHistory: null, kind: 'vector' as const, provenance: [] })

describe('V2 one-to-one segmentation evaluator', () => {
  it('does not let two predictions share one expected object', () => {
    const result = evaluateEditorialObjects([object(1, 0, 0, 20, 20), object(2, 1, 1, 18, 18)], [{ id: 'aircraft', bbox: { x: 0, y: 0, w: 20, h: 20 } }])
    expect(result.matched).toHaveLength(1)
    expect(result.passed).toBe(false)
    expect(result.extraPredicted).toHaveLength(1)
  })

  it('requires every expected object and rejects a merged box', () => {
    const result = evaluateEditorialObjects([object(1, 0, 0, 40, 20)], [{ id: 'left', bbox: { x: 0, y: 0, w: 20, h: 20 } }, { id: 'right', bbox: { x: 20, y: 0, w: 20, h: 20 } }])
    expect(result.missedExpected).toHaveLength(2)
    expect(result.passed).toBe(false)
  })

  it('accepts exact one-to-one boxes', () => {
    const result = evaluateEditorialObjects([object(1, 0, 0, 20, 20), object(2, 30, 0, 20, 20)], [{ id: 'left', bbox: { x: 0, y: 0, w: 20, h: 20 } }, { id: 'right', bbox: { x: 30, y: 0, w: 20, h: 20 } }])
    expect(result.passed).toBe(true)
  })
})
