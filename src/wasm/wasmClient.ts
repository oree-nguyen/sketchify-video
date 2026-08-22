export interface Rect { x: number; y: number; w: number; h: number }
export interface Pt { x: number; y: number }
export interface WorkImage { rgba: Uint8Array; gray: Uint8Array; ink: Uint8Array; saliency: Uint8Array; w: number; h: number; bg: [number, number, number] }
export interface DrawUnit { type: 'path' | 'area'; /** -1 denotes a coverage unit with no editorial object owner. */ blockId: number; role?: 'object' | 'coverage'; bbox: Rect; pixels: number[]; pixelsRle?: Uint32Array; path: number[]; pathData?: Float32Array; color: [number, number, number]; cost: number; t0: number; t1: number; pauseAfterMs?: number; _tile?: HTMLCanvasElement; _pathScratch?: HTMLCanvasElement }
export interface Block { id: number; bbox: Rect; centroid: Pt; inkArea: number; pixels: number[]; kind: 'vector' | 'photo'; x: number; y: number; width: number; height: number; area: number }
export interface AnalysisStats {
  blocks: number
  units: number
  mergeRadiusConfigured: number
  mergeRadiusApplied: number
  workingWidthActual: number
  openingApplied: boolean
  segmentationMode: 'standard' | 'saliency'
  backgroundVariance: number
  backgroundEntropy: number
  saliencyThreshold: number
  architecture?: 'legacy' | 'legacy-candidates+coverage' | 'v2-cascade'
  objectBlocks?: number
  coveragePixels?: number
  atomicRegions?: number
}
import type { CoverageLayer, DrawUnitV2, ObjectInstance, SegmentationDiagnostics } from '../segmentation/contracts'
import { validateOwnership } from '../segmentation/contracts'
export interface AnalysisResult { img: WorkImage; blocks: Block[]; units: DrawUnit[]; unitsV2?: DrawUnitV2[]; stats: AnalysisStats; version?: 1 | 2; objects?: ObjectInstance[]; coverageLayers?: CoverageLayer[]; diagnostics?: SegmentationDiagnostics }
export type Analysis = AnalysisResult

let worker: Worker | null = null
let sequence = 0
const pending = new Map<number, { resolve: (value: AnalysisResult) => void; reject: (reason: Error) => void }>()

export function analyzeFrame(rgba: Uint8Array, width: number, height: number, settings: Record<string, unknown>): Promise<AnalysisResult> {
  if (!worker) {
    // wasm_exec.js của Go là classic script và cần importScripts(), nên Worker cũng phải là classic.
    worker = new Worker(new URL('./imaging.worker.ts', import.meta.url))
    worker.onmessage = (event: MessageEvent<{ id?: number; result?: AnalysisResult }>) => { if (event.data.id !== undefined) { const call = pending.get(event.data.id); if (call && event.data.result) { pending.delete(event.data.id); const result = normalizeAnalysisResult(event.data.result); console.log('[Sketchify] AnalysisResult', { blocks: result.blocks.length, units: result.units.length, unitTypes: result.units.map((unit) => unit.type), unitRoles: result.units.map((unit) => unit.role ?? 'object'), segmentationMode: result.stats.segmentationMode, architecture: result.stats.architecture, objectBlocks: result.stats.objectBlocks ?? result.blocks.length, coveragePixels: result.stats.coveragePixels ?? result.units.filter((unit) => unit.role === 'coverage' || unit.blockId < 0).reduce((sum, unit) => sum + unit.pixels.length, 0), backgroundVariance: result.stats.backgroundVariance, backgroundEntropy: result.stats.backgroundEntropy, saliencyThreshold: result.stats.saliencyThreshold, mergeRadiusConfigured: result.stats.mergeRadiusConfigured, mergeRadiusApplied: result.stats.mergeRadiusApplied, workingWidthActual: result.stats.workingWidthActual, openingApplied: result.stats.openingApplied }); call.resolve(result) } } }
    worker.onerror = (event) => { pending.forEach(({ reject }) => reject(new Error(event.message))); pending.clear() }
    worker.postMessage({ type: 'init', execUrl: new URL('wasm/wasm_exec.js', document.baseURI).href, wasmUrl: new URL('wasm/imaging.wasm', document.baseURI).href })
  }
  return new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); worker!.postMessage({ id, rgba, width, height, settings }) })
}

// Giữ tương thích với chỗ gọi cũ; mọi luồng đều đi qua analyzeFrame và log ở trên.
export const analyzeImage = analyzeFrame

function normalizeAnalysisResult(result: AnalysisResult): AnalysisResult {
  const img = { ...result.img, rgba: toUint8(result.img.rgba), gray: toUint8(result.img.gray), ink: toUint8(result.img.ink), saliency: toUint8(result.img.saliency) }
  const objects = result.objects?.map((object) => ({ ...object, visibleMaskRle: toUint32(object.visibleMaskRle) }))
  const coverageLayers = result.coverageLayers?.map((layer) => ({ ...layer, maskRle: toUint32(layer.maskRle) }))
  const unitsV2 = result.unitsV2?.map((unit) => ({ ...unit, pixelsRle: toUint32(unit.pixelsRle), path: toFloat32(unit.path) }))
  const blocks = result.blocks.map((block) => ({ ...block, pixels: Array.from(block.pixels ?? []) }))
  const ownership = validateOwnership(objects ?? [], coverageLayers ?? [], img.w * img.h, img.w, img.h)
  const diagnostics = result.diagnostics ? { ...result.diagnostics, finalObjectCount: objects?.length ?? result.diagnostics.finalObjectCount, objectCount: objects?.length ?? result.diagnostics.objectCount, coveragePixelCount: result.stats.coveragePixels ?? result.diagnostics.coveragePixelCount, reconstruction: ownership.exact ? 'exact' as const : ownership.duplicatePixels || ownership.invalidPixels ? 'overlap' as const : 'incomplete' as const, reconstructionMismatch: ownership.duplicatePixels + ownership.invalidPixels + ownership.missingPixels, warnings: ownership.exact ? result.diagnostics.warnings : [...result.diagnostics.warnings, `Ownership invariant failed: ${ownership.duplicatePixels} duplicate, ${ownership.invalidPixels} invalid, ${ownership.missingPixels} missing pixels.`] } : undefined
  return { ...result, img, blocks, objects, coverageLayers, diagnostics, unitsV2, units: result.units.map((unit) => ({ ...unit, role: unit.role ?? (unit.blockId < 0 ? 'coverage' : 'object'), pixels: Array.from(unit.pixels ?? []), path: Array.from(unit.path ?? []), color: [Number(unit.color?.[0] ?? 0), Number(unit.color?.[1] ?? 0), Number(unit.color?.[2] ?? 0)] as [number, number, number], pixelsRle: unit.pixelsRle ? toUint32(unit.pixelsRle) : undefined, pathData: unit.pathData ? toFloat32(unit.pathData) : undefined })) }
}

function toUint8(value: ArrayLike<number>): Uint8Array {
  return value instanceof Uint8Array ? value : Uint8Array.from(Array.from(value ?? []))
}

function toUint32(value: ArrayLike<number>): Uint32Array {
  return value instanceof Uint32Array ? value : Uint32Array.from(Array.from(value ?? []))
}

function toFloat32(value: ArrayLike<number>): Float32Array {
  return value instanceof Float32Array ? value : Float32Array.from(Array.from(value ?? []))
}
