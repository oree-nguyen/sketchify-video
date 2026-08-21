import type { SegmentationInput, SegmentationLane, ProposalNode } from '../laneTypes'

/** Ultralytics segmentation ONNX adapter seam. Model URLs are supplied by a manifest. */
export interface ObjectDetectorRuntime { detect(input: SegmentationInput): Promise<ProposalNode[]> }
export function createObjectDetectorLane(runtime?: ObjectDetectorRuntime): SegmentationLane {
  return { id: 'known-object-detector', kind: 'known-object', available: () => Boolean(runtime), propose: async (input) => runtime ? runtime.detect(input) : [] }
}
