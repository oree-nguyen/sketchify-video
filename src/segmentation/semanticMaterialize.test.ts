import { describe, expect, it } from 'vitest'
import { materializeSemanticProposals } from './semanticMaterialize'
import { encodeMaskRle, decodeMaskRle } from './contracts'
import type { AnalysisResult } from '../wasm/wasmClient'

const base: AnalysisResult = {
  img: { w: 4, h: 2, rgba: new Uint8Array(32).fill(255), gray: new Uint8Array(8), ink: new Uint8Array(8), saliency: new Uint8Array(8), bg: [255, 255, 255] },
  blocks: [], units: [], stats: { blocks: 0, units: 0, mergeRadiusConfigured: 0, mergeRadiusApplied: 0, workingWidthActual: 4, openingApplied: false, segmentationMode: 'saliency', backgroundVariance: 0, backgroundEntropy: 0, saliencyThreshold: 0 },
  diagnostics: { architecture: 'v2-cascade', mode: 'complex', route: { mode: 'complex', confidence: 1, reasons: [] }, timingsMs: {}, proposalCountsBySource: {}, rejected: [], mergeEvents: [], splitEvents: [], lanesAttempted: [], lanesUsed: [], fallbackLanes: [], warnings: [], proposalCount: 0, finalObjectCount: 0, objectCount: 0, coveragePixelCount: 0, reconstruction: 'exact', reconstructionMismatch: 0, executionProviders: {}, evaluated: false },
}

describe('semantic proposal materialization', () => {
  it('keeps semantic masks exclusive and adds residual coverage', () => {
    const result = materializeSemanticProposals(base, [{ id: 'd', bbox: { x: 0, y: 0, w: 2, h: 2 }, maskRle: encodeMaskRle([0, 1]), confidence: .9, roleHint: 'thing', evidence: [{ source: 'detector', score: .9 }] }])
    expect(result.objects).toHaveLength(1)
    expect(decodeMaskRle(result.objects![0].visibleMaskRle)).toEqual([0, 1])
    expect(result.coverageLayers).toHaveLength(1)
    expect(result.stats.coveragePixels).toBe(6)
    expect(result.unitsV2).toHaveLength(2)
    expect(result.diagnostics?.reconstruction).toBe('exact')
  })

  it('does not replace legacy output when no semantic proposal exists', () => {
    expect(materializeSemanticProposals(base, [{ id: 'legacy', bbox: { x: 0, y: 0, w: 1, h: 1 }, maskRle: encodeMaskRle([0]), confidence: 0, evidence: [{ source: 'legacy-cascade' }] }])).toBe(base)
  })
})
