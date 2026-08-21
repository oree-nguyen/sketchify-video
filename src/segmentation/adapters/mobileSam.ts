import type { SegmentationInput, SegmentationLane, ProposalNode } from '../laneTypes'

/** MobileSAM adapter seam. It refines proposals; it is never an owner by itself. */
export interface MobileSamRuntime { refine(input: SegmentationInput): Promise<ProposalNode[]> }
export function createMobileSamLane(runtime?: MobileSamRuntime): SegmentationLane {
  return { id: 'mobile-sam-refiner', kind: 'unknown-object', available: () => Boolean(runtime), propose: async (input) => runtime ? runtime.refine(input) : [] }
}
