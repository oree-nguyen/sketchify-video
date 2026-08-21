import { runSegmentationLanes } from './pipeline'
import { createClassicalLane } from './adapters/classicalLane'
import { createObjectDetectorLane } from './models/objectDetector'
import { createTextDetectorLane } from './models/textDetector'
import { createMobileSamLane } from './models/mobileSam'
import { SEGMENTATION_MODEL_MANIFEST } from './models/manifest'
import type { AnalysisResult } from '../wasm/wasmClient'

interface SegmentationWorkerRequest { id: number; frameId?: number; analysisRevision?: number; analysis: AnalysisResult }

const controllers = new Map<number, AbortController>()
const resultCache = new Map<string, Awaited<ReturnType<typeof runSegmentationLanes>>>()

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
  const key = `${request.frameId ?? 0}:${request.analysisRevision ?? 0}`
  const cached = resultCache.get(key)
  if (cached) { self.postMessage({ id: request.id, result: cached, cached: true }); return }
  const controller = new AbortController(); controllers.set(request.id, controller)
  try {
    const result = await runSegmentationLanes({ image: request.analysis.img, background: request.analysis.img.bg, signal: controller.signal, analysisRevision: request.analysisRevision }, [
      createClassicalLane(request.analysis),
      createTextDetectorLane(SEGMENTATION_MODEL_MANIFEST.find((entry) => entry.lane === 'text')),
      createObjectDetectorLane(SEGMENTATION_MODEL_MANIFEST.find((entry) => entry.lane === 'known-object')),
      createMobileSamLane(SEGMENTATION_MODEL_MANIFEST.find((entry) => entry.lane === 'unknown-object')),
    ])
    if (!controller.signal.aborted) { resultCache.set(key, result); self.postMessage({ id: request.id, result, cached: false, analysisRevision: request.analysisRevision }) }
  } catch (error) {
    if (!controller.signal.aborted) self.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) })
  } finally { controllers.delete(request.id) }
}

self.addEventListener('message', (event: MessageEvent<{ type: 'cancel'; id: number }>) => {
  if (event.data?.type === 'cancel') controllers.get(event.data.id)?.abort()
})

export {}
