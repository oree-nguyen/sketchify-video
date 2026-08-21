import { describe, expect, it } from 'vitest'
import { encodeMaskRle, validateOwnership } from './contracts'

describe('V2 ownership contract', () => {
  it('detects duplicate ownership instead of masking it with a bbox count', () => {
    const object = (maskRle: Uint32Array) => ({ id: 1, role: 'thing' as const, bbox: { x: 0, y: 0, w: 2, h: 2 }, visibleMaskRle: maskRle, centroid: { x: 0, y: 0 }, confidence: 1, children: [], mergeHistory: null, kind: 'vector' as const, provenance: [] })
    const result = validateOwnership([object(encodeMaskRle([0, 1])), object(encodeMaskRle([1, 2]))], [], 3)
    expect(result.duplicatePixels).toBe(1)
    expect(result.exact).toBe(false)
  })
})
