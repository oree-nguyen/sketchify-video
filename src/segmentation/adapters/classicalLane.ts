import { encodeMaskRle } from '../contracts'
import type { AnalysisResult } from '../../wasm/wasmClient'
import type { SegmentationInput, SegmentationLane } from '../laneTypes'

/** Explicitly provisional adapter for persisted/legacy WASM results. */
export function createClassicalLane(analysis: AnalysisResult): SegmentationLane {
  return { id: 'legacy-cascade', kind: 'classical', available: () => true, propose: async (_input: SegmentationInput) => analysis.blocks.map((block) => ({ id: `legacy:${block.id}`, bbox: block.bbox, maskRle: encodeMaskRle(block.pixels), confidence: 0, roleHint: 'thing' as const, evidence: [{ source: 'legacy-cascade' as const, note: 'provisional adapter' }] })) }
}
