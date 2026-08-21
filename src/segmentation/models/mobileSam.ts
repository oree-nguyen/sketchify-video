import type { SegmentationLane } from '../laneTypes'
import type { SegmentationModelManifest } from './manifest'
import { loadModel } from './loader'
import { createRuntimeSession } from './ortRuntime'

/** MobileSAM is a mask refiner, never an owner. It must receive a detector,
 * OCR or cue prompt and return a typed mask to the proposal graph. */
export function createMobileSamLane(manifest?: SegmentationModelManifest): SegmentationLane {
  return {
    id: 'unknown-object-sam', kind: 'unknown-object',
    available: () => Boolean(manifest?.enabled),
    propose: async () => {
      if (!manifest?.enabled) throw new Error('MobileSAM manifest is disabled')
      const model = await loadModel(manifest)
      await createRuntimeSession(model)
      throw new Error('MobileSAM requires prompt-conditioned encoder/decoder wiring')
    },
  }
}
