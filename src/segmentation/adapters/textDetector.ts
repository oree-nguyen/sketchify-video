import type { SegmentationInput, SegmentationLane, ProposalNode } from '../laneTypes'

/** PaddleOCR/DBNet adapter seam. Text-line proposals are masks, not characters. */
export interface TextDetectorRuntime { detectTextLines(input: SegmentationInput): Promise<ProposalNode[]> }
export function createTextDetectorLane(runtime?: TextDetectorRuntime): SegmentationLane {
  return { id: 'text-line-detector', kind: 'text', available: () => Boolean(runtime), propose: async (input) => runtime ? runtime.detectTextLines(input) : [] }
}
