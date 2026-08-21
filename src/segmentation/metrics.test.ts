import { describe, expect, it } from 'vitest'
import { encodeMaskRle } from './contracts'
import { computeSegmentationMetrics, metricsPass } from './metrics'

const object = (id: number, x: number, role: 'thing' | 'text-line' | 'compound' = 'thing') => ({
  id, role, bbox: { x, y: 0, w: 10, h: 10 }, visibleMaskRle: encodeMaskRle(Array.from({ length: 100 }, (_, index) => index + x)),
  centroid: { x: x + 5, y: 5 }, confidence: .9, children: [], mergeHistory: null, kind: 'vector' as const, provenance: [],
})

describe('segmentation release metrics', () => {
  it('passes exact one-to-one objects and roles', () => {
    const predicted = [object(1, 0), object(2, 20, 'compound')]
    const expected = predicted.map((item, index) => ({ id: String(index), bbox: item.bbox, role: item.role, maskRle: item.visibleMaskRle }))
    const metrics = computeSegmentationMetrics(predicted, expected)
    expect(metrics.objectF1).toBe(1)
    expect(metrics.exactCountAccuracy).toBe(1)
    expect(metricsPass(metrics)).toBe(true)
  })

  it('fails a merged prediction and reports the merge error', () => {
    const merged = { ...object(1, 0), bbox: { x: 0, y: 0, w: 20, h: 10 } }
    const metrics = computeSegmentationMetrics([merged], [
      { id: 'a', bbox: { x: 0, y: 0, w: 10, h: 10 } },
      { id: 'b', bbox: { x: 10, y: 0, w: 10, h: 10 } },
    ])
    expect(metrics.exactCountAccuracy).toBe(0)
    expect(metrics.objectRecall).toBe(.5)
    expect(metrics.mergeErrorRate).toBe(1)
    expect(metricsPass(metrics)).toBe(false)
  })
})
