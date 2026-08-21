import type { AnalysisResult } from '../wasm/wasmClient'
import type { SegmentationPipelineResult } from './laneTypes'

let worker: Worker | null = null
let sequence = 0
const pending = new Map<number, { resolve: (result: SegmentationPipelineResult) => void; reject: (error: Error) => void }>()

function getWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./segmentation.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<{ id: number; result?: SegmentationPipelineResult; error?: string }>) => {
    const call = pending.get(event.data.id); if (!call) return
    pending.delete(event.data.id)
    if (event.data.error) call.reject(new Error(event.data.error)); else if (event.data.result) call.resolve(event.data.result)
  }
  worker.onerror = (event) => { pending.forEach((call) => call.reject(new Error(event.message))); pending.clear() }
  return worker
}

/** Run semantic lanes after Go/WASM. A stale revision is never applied by the caller. */
export function runSemanticLanes(analysis: AnalysisResult, frameId: number, analysisRevision: number): Promise<SegmentationPipelineResult> {
  const id = ++sequence
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    getWorker().postMessage({ id, frameId, analysisRevision, analysis })
  })
}
