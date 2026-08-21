import type { SegmentationLane } from '../laneTypes'
import type { SegmentationModelManifest } from './manifest'
import { loadModel } from './loader'
import { createRuntimeSession } from './ortRuntime'

/** YOLO-seg adapter contract. Tensor decoding is model-specific and therefore
 * refuses to guess when a manifest has no declared output layout. */
export function createObjectDetectorLane(manifest?: SegmentationModelManifest): SegmentationLane {
  return {
    id: 'known-object-detector', kind: 'known-object',
    available: () => Boolean(manifest?.enabled),
    propose: async () => {
      if (!manifest?.enabled) throw new Error('YOLO segmentation manifest is disabled')
      const model = await loadModel(manifest)
      await createRuntimeSession(model)
      throw new Error('YOLO output decoder requires a declared model-specific tensor layout')
    },
  }
}
