import { decodeMaskRle } from './contracts'
import type { AnalysisResult, DrawUnit } from '../wasm/wasmClient'

/** Convert typed V2 units to the legacy canvas shape without losing role/null ownership. */
export function materializeAnalysisUnits(analysis: AnalysisResult): AnalysisResult {
  if (!analysis.unitsV2?.length) return analysis
  const units: DrawUnit[] = analysis.unitsV2.map((unit) => ({
    type: unit.type,
    role: unit.role,
    blockId: unit.blockId ?? -1,
    bbox: unit.bbox,
    pixels: decodeMaskRle(unit.pixelsRle),
    pixelsRle: unit.pixelsRle,
    path: Array.from(unit.path),
    pathData: unit.path,
    color: unit.color,
    cost: unit.cost,
    t0: unit.t0,
    t1: unit.t1,
    pauseAfterMs: unit.pauseAfterMs,
  }))
  return { ...analysis, units }
}
