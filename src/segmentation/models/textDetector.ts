import type { SegmentationLane } from '../laneTypes'
import type { SegmentationModelManifest } from './manifest'
import { loadModel } from './loader'
import { createRuntimeSession } from './ortRuntime'

/** PaddleOCR/DBNet lane. Recognition is intentionally not used as the mask
 * boundary; polygons remain the source of text-line proposals. */
export function createTextDetectorLane(manifest?: SegmentationModelManifest): SegmentationLane {
  return {
    id: 'ocr-text-lines', kind: 'text',
    available: () => Boolean(manifest?.enabled),
    propose: async () => {
      if (!manifest?.enabled) throw new Error('OCR model manifest is disabled')
      const model = await loadModel(manifest)
      await createRuntimeSession(model)
      throw new Error('OCR polygon decoder requires the selected Paddle/DBNet output schema')
    },
  }
}
