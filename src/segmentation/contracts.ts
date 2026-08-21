/**
 * Version 2 segmentation contract.
 *
 * The old WASM contract exposed a flat list of blocks and implicitly treated
 * every remaining pixel as belonging to one of those blocks.  V2 makes the
 * ownership decision explicit: editorial objects own exclusive masks and
 * residual pixels live in coverage layers.  This file contains only data
 * contracts and deterministic mask helpers; model adapters must not import
 * React or mutate project state.
 */

import type { AnalysisResult, Block, DrawUnit, Pt, Rect, WorkImage } from '../wasm/wasmClient'

export type EditorialRole = 'thing' | 'text-line' | 'compound'
export type CoverageRevealPolicy = 'base' | 'progressive' | 'terminal'

export interface ProposalEvidence {
  source: 'legacy-cascade' | 'ocr' | 'detector' | 'sam' | 'watershed' | 'manual'
  score?: number
  note?: string
}

export interface MergeNode {
  operation: 'merge' | 'split'
  sourceIds: string[]
  createdAt: number
  reason: string
}

export interface ObjectInstance {
  id: number
  role: EditorialRole
  bbox: Rect
  visibleMaskRle: Uint32Array
  centroid: Pt
  confidence: number
  children: string[]
  mergeHistory: MergeNode | null
  kind: 'vector' | 'photo'
  provenance: ProposalEvidence[]
}

export interface CoverageLayer {
  id: string
  maskRle: Uint32Array
  revealPolicy: CoverageRevealPolicy
  reason: 'residual' | 'background' | 'unclaimed'
}

export interface DrawUnitV2 {
  type: 'path' | 'area'
  role: 'object' | 'coverage'
  blockId: number | null
  pixelsRle: Uint32Array
  path: Float32Array
  color: [number, number, number]
  bbox: Rect
  cost: number
  t0: number
  t1: number
  pauseAfterMs?: number
}

export interface SegmentationDiagnostics {
  architecture: 'v2-cascade'
  mode: 'standard' | 'complex'
  lanesAttempted: string[]
  lanesUsed: string[]
  fallbackLanes: string[]
  warnings: string[]
  proposalCount: number
  objectCount: number
  coveragePixelCount: number
  reconstruction: 'exact' | 'incomplete' | 'overlap'
  evaluated: boolean
}

export interface AnalysisResultV2 {
  version: 2
  img: WorkImage
  objects: ObjectInstance[]
  coverageLayers: CoverageLayer[]
  units: DrawUnitV2[]
  diagnostics: SegmentationDiagnostics
}

/** Encode sorted pixel indices as [start,length,start,length,...]. */
export function encodeMaskRle(pixels: readonly number[]): Uint32Array {
  if (!pixels.length) return new Uint32Array()
  const sorted = [...pixels].filter(Number.isInteger).sort((a, b) => a - b)
  const runs: number[] = []
  let start = sorted[0]
  let previous = start
  for (let i = 1; i < sorted.length; i++) {
    const value = sorted[i]
    if (value === previous || value === previous + 1) {
      previous = value
      continue
    }
    runs.push(start, previous - start + 1)
    start = previous = value
  }
  runs.push(start, previous - start + 1)
  return Uint32Array.from(runs)
}

export function decodeMaskRle(rle: ArrayLike<number>): number[] {
  const pixels: number[] = []
  for (let i = 0; i + 1 < rle.length; i += 2) {
    const start = Math.max(0, Math.floor(Number(rle[i])))
    const length = Math.max(0, Math.floor(Number(rle[i + 1])))
    for (let offset = 0; offset < length; offset++) pixels.push(start + offset)
  }
  return pixels
}

export function bboxFromPixels(pixels: readonly number[], width: number, height: number): Rect {
  if (!pixels.length || width <= 0 || height <= 0) return { x: 0, y: 0, w: 0, h: 0 }
  let minX = width, minY = height, maxX = -1, maxY = -1
  for (const pixel of pixels) {
    if (!Number.isInteger(pixel) || pixel < 0 || pixel >= width * height) continue
    const x = pixel % width
    const y = Math.floor(pixel / width)
    minX = Math.min(minX, x); minY = Math.min(minY, y)
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
  }
  return maxX < 0 ? { x: 0, y: 0, w: 0, h: 0 } : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

export function rectIou(a: Rect, b: Rect): number {
  const left = Math.max(a.x, b.x), top = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.w, b.x + b.w), bottom = Math.min(a.y + a.h, b.y + b.h)
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top)
  const union = a.w * a.h + b.w * b.h - intersection
  return union > 0 ? intersection / union : 0
}

/**
 * Deterministic bridge for old persisted sessions.  It is intentionally
 * labelled provisional by diagnostics: a legacy bbox is not evidence of a
 * semantic object and must never be presented as a measured V2 score.
 */
export function legacyToV2(analysis: AnalysisResult): AnalysisResultV2 {
  const objects = analysis.blocks.map((block) => objectFromLegacyBlock(block))
  const owned = new Set<number>()
  for (const object of objects) for (const pixel of decodeMaskRle(object.visibleMaskRle)) owned.add(pixel)
  const total = analysis.img.w * analysis.img.h
  const residual: number[] = []
  for (let pixel = 0; pixel < total; pixel++) if (!owned.has(pixel)) residual.push(pixel)
  const coverageLayers: CoverageLayer[] = residual.length ? [{ id: 'coverage:legacy-residual', maskRle: encodeMaskRle(residual), revealPolicy: 'base', reason: 'residual' }] : []
  const units: DrawUnitV2[] = analysis.units.map((unit) => ({
    type: unit.type, role: unit.blockId >= 0 ? 'object' : 'coverage', blockId: unit.blockId >= 0 ? unit.blockId : null,
    pixelsRle: encodeMaskRle(unit.pixels), path: Float32Array.from(unit.path), color: unit.color, bbox: unit.bbox,
    cost: unit.cost, t0: unit.t0, t1: unit.t1, pauseAfterMs: unit.pauseAfterMs,
  }))
  return {
    version: 2, img: analysis.img, objects, coverageLayers, units,
    diagnostics: { architecture: 'v2-cascade', mode: analysis.stats.segmentationMode === 'saliency' ? 'complex' : 'standard', lanesAttempted: ['legacy-cascade'], lanesUsed: ['legacy-cascade'], fallbackLanes: ['legacy-cascade'], warnings: ['Legacy bridge: object ownership is provisional until OCR/detector/SAM lanes run.'], proposalCount: objects.length, objectCount: objects.length, coveragePixelCount: residual.length, reconstruction: 'exact', evaluated: false },
  }
}

function objectFromLegacyBlock(block: Block): ObjectInstance {
  return { id: block.id, role: 'thing', bbox: block.bbox, visibleMaskRle: encodeMaskRle(block.pixels), centroid: block.centroid, confidence: 0, children: [], mergeHistory: null, kind: block.kind, provenance: [{ source: 'legacy-cascade', note: 'provisional bridge' }] }
}

/** Keep the type imported above useful to consumers that only import contracts. */
export type LegacyDrawUnit = DrawUnit
