export interface Rect { x: number; y: number; w: number; h: number }
export interface Pt { x: number; y: number }
export interface WorkImage { rgba: Uint8Array; gray: Uint8Array; ink: Uint8Array; saliency: Uint8Array; w: number; h: number; bg: [number, number, number] }
export interface DrawUnit { type: 'path' | 'area'; blockId: number; bbox: Rect; pixels: number[]; path: number[]; color: [number, number, number]; cost: number; t0: number; t1: number; pauseAfterMs?: number; _tile?: HTMLCanvasElement; _pathScratch?: HTMLCanvasElement }
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
}
export interface AnalysisResult { img: WorkImage; blocks: Block[]; units: DrawUnit[]; stats: AnalysisStats }
export type Analysis = AnalysisResult

let worker: Worker | null = null
let sequence = 0
const pending = new Map<number, { resolve: (value: AnalysisResult) => void; reject: (reason: Error) => void }>()

export function analyzeFrame(rgba: Uint8Array, width: number, height: number, settings: Record<string, unknown>): Promise<AnalysisResult> {
  if (!worker) {
    // wasm_exec.js của Go là classic script và cần importScripts(), nên Worker cũng phải là classic.
    worker = new Worker(new URL('./imaging.worker.ts', import.meta.url))
    worker.onmessage = (event: MessageEvent<{ id?: number; result?: AnalysisResult }>) => { if (event.data.id !== undefined) { const call = pending.get(event.data.id); if (call && event.data.result) { pending.delete(event.data.id); const result = event.data.result; console.log('[Sketchify] AnalysisResult', { blocks: result.blocks.length, units: result.units.length, unitTypes: result.units.map((unit) => unit.type), segmentationMode: result.stats.segmentationMode, backgroundVariance: result.stats.backgroundVariance, backgroundEntropy: result.stats.backgroundEntropy, saliencyThreshold: result.stats.saliencyThreshold, mergeRadiusConfigured: result.stats.mergeRadiusConfigured, mergeRadiusApplied: result.stats.mergeRadiusApplied, workingWidthActual: result.stats.workingWidthActual, openingApplied: result.stats.openingApplied }); call.resolve(result) } } }
    worker.onerror = (event) => { pending.forEach(({ reject }) => reject(new Error(event.message))); pending.clear() }
    worker.postMessage({ type: 'init', execUrl: new URL('wasm/wasm_exec.js', document.baseURI).href, wasmUrl: new URL('wasm/imaging.wasm', document.baseURI).href })
  }
  return new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); worker!.postMessage({ id, rgba, width, height, settings }) })
}

// Giữ tương thích với chỗ gọi cũ; mọi luồng đều đi qua analyzeFrame và log ở trên.
export const analyzeImage = analyzeFrame
