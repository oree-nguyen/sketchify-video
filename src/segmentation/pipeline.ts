import type { SegmentationInput, SegmentationLane, SegmentationPipelineResult } from './laneTypes'

/**
 * Orchestrator only. It does not know OCR tokenisation, detector tensor
 * layouts, or SAM prompts; each lane owns its adapter and can fail explicitly.
 */
export async function runSegmentationLanes(input: SegmentationInput, lanes: readonly SegmentationLane[]): Promise<SegmentationPipelineResult> {
  const proposals = [], lanesAttempted: string[] = [], lanesUsed: string[] = [], fallbackLanes: string[] = [], warnings: string[] = [], timingsMs: Record<string, number> = {}
  const executionProviders: Record<string, 'webgpu' | 'wasm'> = {}
  for (const lane of lanes) {
    if (input.signal?.aborted) throw new DOMException('Segmentation cancelled', 'AbortError')
    lanesAttempted.push(lane.id)
    try {
      if (!await lane.available()) { fallbackLanes.push(lane.id); warnings.push(`${lane.id}: model is not configured; lane skipped.`); continue }
      const started = performance.now()
      const output = await lane.propose(input)
      timingsMs[lane.id] = performance.now() - started
      if (lane.executionProvider) executionProviders[lane.id] = lane.executionProvider
      proposals.push(...output); lanesUsed.push(lane.id)
    } catch (error) {
      fallbackLanes.push(lane.id); warnings.push(`${lane.id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (!proposals.length) warnings.push('No semantic lane produced a proposal; keep classical coverage fallback and mark result provisional.')
  return { proposals, lanesAttempted, lanesUsed, fallbackLanes, warnings, timingsMs, executionProviders }
}
