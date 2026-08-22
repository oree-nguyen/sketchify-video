import { describe, expect, it } from 'vitest'
import { legacyToV2, validateOwnership, encodeMaskRle, decodeMaskRle } from './contracts'
import { materializeSemanticProposals } from './semanticMaterialize'
import type { AnalysisResult, Block } from '../wasm/wasmClient'

const block = (id: number, pixels: number[]): Block => ({
  id, pixels, bbox: { x: Math.min(...pixels), y: 0, w: pixels.length, h: 1 },
  centroid: { x: pixels[0] ?? 0, y: 0 }, inkArea: pixels.length, kind: 'vector',
  x: Math.min(...pixels), y: 0, width: pixels.length, height: 1, area: pixels.length,
})

const base = (blocks: Block[] = []): AnalysisResult => ({
  img: { w: 4, h: 2, rgba: new Uint8Array(32).fill(255), gray: new Uint8Array(8), ink: new Uint8Array(8), saliency: new Uint8Array(8), bg: [255, 255, 255] },
  blocks, units: [], stats: { blocks: blocks.length, units: 0, mergeRadiusConfigured: 0, mergeRadiusApplied: 0, workingWidthActual: 4, openingApplied: false, segmentationMode: 'saliency', backgroundVariance: 0, backgroundEntropy: 0, saliencyThreshold: 0 },
  diagnostics: { architecture: 'v2-cascade', mode: 'complex', route: { mode: 'complex', confidence: 1, reasons: [] }, timingsMs: {}, proposalCountsBySource: {}, rejected: [], mergeEvents: [], splitEvents: [], lanesAttempted: [], lanesUsed: [], fallbackLanes: [], warnings: [], proposalCount: 0, finalObjectCount: 0, objectCount: 0, coveragePixelCount: 0, reconstruction: 'exact', reconstructionMismatch: 0, executionProviders: {}, evaluated: false },
})

describe('Phase 1 ownership gate', () => {
  it('keeps semantic objects exclusive and assigns every residual pixel to coverage', () => {
    const result = materializeSemanticProposals(base(), [{ id: 'object', bbox: { x: 0, y: 0, w: 2, h: 1 }, maskRle: encodeMaskRle([0, 1]), confidence: 1, roleHint: 'thing', evidence: [{ source: 'detector', score: 1 }] }])
    const ownership = validateOwnership(result.objects ?? [], result.coverageLayers ?? [], result.img.w * result.img.h, result.img.w, result.img.h)
    expect(ownership).toMatchObject({ duplicatePixels: 0, missingPixels: 0, invalidPixels: 0, bboxViolations: 0, exact: true })
    expect(result.objects).toHaveLength(1)
    expect(result.coverageLayers).toHaveLength(1)
    expect(result.unitsV2?.filter((unit) => unit.role === 'coverage')).toHaveLength(1)
    expect(result.diagnostics?.reconstruction).toBe('exact')
  })

  it('keeps residual pixels out of the editorial object list on legacy migration', () => {
    const result = legacyToV2({ ...base([block(4, [0, 1])]), units: [{ type: 'area', blockId: 4, bbox: { x: 0, y: 0, w: 2, h: 1 }, pixels: [0, 1], path: [], color: [0, 0, 0], cost: 2, t0: 0, t1: 1 }] })
    expect(result.objects).toHaveLength(1)
    expect(result.objects[0].visibleMaskRle).toEqual(encodeMaskRle([0, 1]))
    expect(result.coverageLayers).toHaveLength(1)
    expect(decodeMaskRle(result.coverageLayers[0].maskRle)).toHaveLength(6)
    expect(result.diagnostics.reconstruction).toBe('exact')
    expect(result.diagnostics.warnings.some((warning) => warning.includes('Legacy bridge'))).toBe(true)
  })
})
