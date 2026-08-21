import { legacyToV2, type AnalysisResultV2 } from './contracts'
import { runSegmentationLanes } from './pipeline'
import { editorialObjectsFromProposals } from './editorialGrouping'
import { createClassicalLane } from './adapters/classicalLane'
import type { AnalysisResult } from '../wasm/wasmClient'
import type { SegmentationLane } from './laneTypes'

/**
 * Build the V2 view beside the legacy UI contract. Until model manifests are
 * configured this deliberately uses the classical adapter and exposes the
 * fallback diagnostics; callers must not treat it as a semantic benchmark.
 */
export async function buildAnalysisV2(analysis: AnalysisResult, extraLanes: readonly SegmentationLane[] = []): Promise<AnalysisResultV2> {
  const base = legacyToV2(analysis)
  const lanes = [createClassicalLane(analysis), ...extraLanes]
  const run = await runSegmentationLanes({ image: analysis.img, background: analysis.img.bg }, lanes)
  if (!run.proposals.length) return base
  const objects = editorialObjectsFromProposals(run.proposals)
  return { ...base, objects, diagnostics: { ...base.diagnostics, lanesAttempted: run.lanesAttempted, lanesUsed: run.lanesUsed, fallbackLanes: run.fallbackLanes, warnings: run.warnings, proposalCount: run.proposals.length, objectCount: objects.length } }
}
