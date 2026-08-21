import { runSegmentationLanes } from './pipeline'
import { createClassicalLane } from './adapters/classicalLane'
import type { AnalysisResult } from '../wasm/wasmClient'

interface SegmentationWorkerRequest { id: number; analysis: AnalysisResult }

/**
 * Separate worker boundary for model lanes. The imaging worker remains the
 * Go/WASM pixel worker; this worker owns future ONNX/OCR/SAM orchestration so
 * a slow model cannot block the Go result or the React main thread.
 *
 * No model is silently fabricated here: until a manifest-backed runtime is
 * registered, the response explicitly reports the classical fallback lane.
 */
self.onmessage = async (event: MessageEvent<SegmentationWorkerRequest>) => {
  const request = event.data
  if (!request?.analysis) return
  try {
    const result = await runSegmentationLanes({ image: request.analysis.img, background: request.analysis.img.bg }, [createClassicalLane(request.analysis)])
    self.postMessage({ id: request.id, result })
  } catch (error) {
    self.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) })
  }
}

export {}
