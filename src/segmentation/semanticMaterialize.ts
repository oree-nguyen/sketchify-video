import type { AnalysisResult, Block, DrawUnit } from '../wasm/wasmClient'
import { bboxFromPixels, decodeMaskRle, encodeMaskRle, type CoverageLayer, type DrawUnitV2, type ObjectInstance } from './contracts'
import type { ProposalNode } from './laneTypes'

/**
 * Materialise semantic proposals into the V2 ownership contract.  This is
 * deliberately mask-first: detector/OCR/SAM proposals own only their
 * exclusive pixels and every remaining source pixel is represented by one
 * coverage layer.  A proposal is never allowed to overwrite another proposal
 * or silently disappear from reconstruction.
 */
export function materializeSemanticProposals(base: AnalysisResult, proposals: readonly ProposalNode[]): AnalysisResult {
  const semantic = proposals.filter((proposal) => proposal.evidence.some((item) => item.source !== 'legacy-cascade'))
  if (!semantic.length) return base
  const selected = selectNonOverlapping(semantic)
  if (!selected.length) return base
  const total = base.img.w * base.img.h
  const owner = new Int32Array(total); owner.fill(-1)
  const objects: ObjectInstance[] = []
  const blocks: Block[] = []
  const unitsV2: DrawUnitV2[] = []
  const units: DrawUnit[] = []
  let clock = 0
  for (const [index, proposal] of selected.entries()) {
    const pixels = decodeMaskRle(proposal.maskRle).filter((pixel) => pixel >= 0 && pixel < total && owner[pixel] < 0)
    if (!pixels.length) continue
    for (const pixel of pixels) owner[pixel] = index
    const bbox = bboxFromPixels(pixels, base.img.w, base.img.h)
    const role = proposal.roleHint ?? 'thing'
    const id = index
    const rle = encodeMaskRle(pixels)
    const duration = Math.max(0.05, Math.min(2, Math.sqrt(pixels.length) / 300))
    const unit = { type: 'area' as const, role: 'object' as const, blockId: id, pixelsRle: rle, path: new Float32Array(), color: sampleColor(base.img.rgba, pixels[0]), bbox, cost: pixels.length, t0: clock, t1: clock + duration }
    clock += duration
    unitsV2.push(unit)
    units.push({ type: unit.type, role: unit.role, blockId: id, bbox, pixels, pixelsRle: rle, path: [], pathData: unit.path, color: unit.color, cost: unit.cost, t0: unit.t0, t1: unit.t1 })
    blocks.push({ id, bbox, centroid: { x: bbox.x + bbox.w / 2, y: bbox.y + bbox.h / 2 }, inkArea: pixels.length, pixels, kind: role === 'text-line' || role === 'compound' ? 'vector' : 'photo', x: bbox.x, y: bbox.y, width: bbox.w, height: bbox.h, area: pixels.length })
    objects.push({ id, role, bbox, visibleMaskRle: rle, centroid: { x: bbox.x + bbox.w / 2, y: bbox.y + bbox.h / 2 }, confidence: proposal.confidence, children: [], mergeHistory: null, kind: blocks.at(-1)!.kind, provenance: proposal.evidence })
  }
  const residual: number[] = []
  for (let pixel = 0; pixel < total; pixel++) if (owner[pixel] < 0) residual.push(pixel)
  const coverageLayers: CoverageLayer[] = residual.length ? [{ id: 'coverage:semantic-residual', maskRle: encodeMaskRle(residual), revealPolicy: 'base', reason: 'residual' }] : []
  if (residual.length) {
    const rle = encodeMaskRle(residual)
    const unit = { type: 'area' as const, role: 'coverage' as const, blockId: null, pixelsRle: rle, path: new Float32Array(), color: base.img.bg, bbox: { x: 0, y: 0, w: base.img.w, h: base.img.h }, cost: residual.length, t0: clock, t1: clock + Math.max(0.05, Math.min(2, Math.sqrt(residual.length) / 600)) }
    unitsV2.push(unit)
    units.push({ type: unit.type, role: unit.role, blockId: -1, bbox: unit.bbox, pixels: residual, pixelsRle: rle, path: [], pathData: unit.path, color: unit.color, cost: unit.cost, t0: unit.t0, t1: unit.t1 })
  }
  const diagnostics = base.diagnostics ? { ...base.diagnostics, proposalCount: proposals.length, finalObjectCount: objects.length, objectCount: objects.length, coveragePixelCount: residual.length, reconstruction: 'exact' as const, reconstructionMismatch: 0 } : undefined
  return { ...base, version: 2, blocks, units, unitsV2, objects, coverageLayers, stats: { ...base.stats, blocks: blocks.length, units: units.length, objectBlocks: blocks.length, coveragePixels: residual.length, architecture: 'v2-cascade' }, diagnostics }
}

function selectNonOverlapping(proposals: readonly ProposalNode[]): ProposalNode[] {
  const ranked = [...proposals].sort((a, b) => b.confidence - a.confidence)
  const selected: ProposalNode[] = []
  for (const proposal of ranked) {
    const pixels = new Set(decodeMaskRle(proposal.maskRle))
    const conflicts = selected.some((candidate) => {
      const candidatePixels = decodeMaskRle(candidate.maskRle)
      let overlap = 0
      for (const pixel of candidatePixels) if (pixels.has(pixel)) overlap++
      return overlap / Math.max(1, Math.min(candidatePixels.length, pixels.size)) > 0.6
    })
    if (!conflicts) selected.push(proposal)
  }
  return selected
}

function sampleColor(rgba: Uint8Array, pixel: number): [number, number, number] {
  const offset = pixel * 4
  return [rgba[offset] ?? 0, rgba[offset + 1] ?? 0, rgba[offset + 2] ?? 0]
}
