import type { SegmentationInput, SegmentationLane, SegmentationPipelineResult } from './laneTypes'

/**
 * Orchestrator only. It does not know OCR tokenisation, detector tensor
 * layouts, or SAM prompts; each lane owns its adapter and can fail explicitly.
 */
export async function runSegmentationLanes(input: SegmentationInput, lanes: readonly SegmentationLane[]): Promise<SegmentationPipelineResult> {
  const proposals = [], lanesAttempted: string[] = [], lanesUsed: string[] = [], fallbackLanes: string[] = [], warnings: string[] = []
  for (const lane of lanes) {
    lanesAttempted.push(lane.id)
    try {
      if (!await lane.available()) { fallbackLanes.push(lane.id); warnings.push(`${lane.id}: model is not configured; lane skipped.`); continue }
      const output = await lane.propose(input)
      proposals.push(...output); lanesUsed.push(lane.id)
    } catch (error) {
      fallbackLanes.push(lane.id); warnings.push(`${lane.id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (!proposals.length) warnings.push('No semantic lane produced a proposal; keep classical coverage fallback and mark result provisional.')
  return { proposals, lanesAttempted, lanesUsed, fallbackLanes, warnings }
}
