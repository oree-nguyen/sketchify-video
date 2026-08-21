import { describe, expect, it } from 'vitest'
import { runSegmentationLanes } from './pipeline'

const input = { image: { rgba: new Uint8Array(4), gray: new Uint8Array(1), ink: new Uint8Array(1), saliency: new Uint8Array(1), w: 1, h: 1, bg: [255, 255, 255] as [number, number, number] }, background: [255, 255, 255] as [number, number, number] }

describe('segmentation lane orchestrator', () => {
  it('records unavailable lanes instead of pretending they ran', async () => {
    const result = await runSegmentationLanes(input, [{ id: 'detector', kind: 'known-object', available: () => false, propose: async () => [] }])
    expect(result.proposals).toHaveLength(0)
    expect(result.fallbackLanes).toEqual(['detector'])
    expect(result.warnings.join(' ')).toContain('not configured')
  })

  it('isolates a failing lane and keeps other proposals', async () => {
    const result = await runSegmentationLanes(input, [
      { id: 'broken', kind: 'text', available: () => true, propose: async () => { throw new Error('operator unsupported') } },
      { id: 'working', kind: 'classical', available: () => true, propose: async () => [{ id: 'p1', bbox: { x: 0, y: 0, w: 1, h: 1 }, maskRle: new Uint32Array([0, 1]), confidence: .1, evidence: [] }] },
    ])
    expect(result.proposals).toHaveLength(1)
    expect(result.fallbackLanes).toContain('broken')
    expect(result.lanesUsed).toContain('working')
  })
})
