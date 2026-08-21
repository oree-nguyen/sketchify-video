import { legacyToV2, type AnalysisResultV2 } from './contracts'
import { runSegmentationLanes } from './pipeline'
import { editorialObjectsFromProposals } from './editorialGrouping'
import { createClassicalLane } from './adapters/classicalLane'
import type { AnalysisResult } from '../wasm/wasmClient'
import type { SegmentationLane } from './laneTypes'
import { buildProposalGraph } from './proposalGraph'
import { SEGMENTATION_MODEL_MANIFEST } from './models/manifest'
import { createObjectDetectorLane } from './models/objectDetector'
import { createTextDetectorLane } from './models/textDetector'
import { createMobileSamLane } from './models/mobileSam'

/**
 * Build the V2 view beside the legacy UI contract. Until model manifests are
 * configured this deliberately uses the classical adapter and exposes the
 * fallback diagnostics; callers must not treat it as a semantic benchmark.
 */
export async function buildAnalysisV2(analysis: AnalysisResult, extraLanes: readonly SegmentationLane[] = []): Promise<AnalysisResultV2> {
  const base = legacyToV2(analysis)
  const lanes = [
    createClassicalLane(analysis),
    createTextDetectorLane(SEGMENTATION_MODEL_MANIFEST.find((entry) => entry.lane === 'text')),
    createObjectDetectorLane(SEGMENTATION_MODEL_MANIFEST.find((entry) => entry.lane === 'known-object')),
    createMobileSamLane(SEGMENTATION_MODEL_MANIFEST.find((entry) => entry.lane === 'unknown-object')),
    ...extraLanes,
  ]
  const run = await runSegmentationLanes({ image: analysis.img, background: analysis.img.bg }, lanes)
  if (!run.proposals.length) return base
  const graph = buildProposalGraph(run.proposals, analysis.img.w)
  const objects = editorialObjectsFromProposals(run.proposals)
  const proposalCountsBySource = Object.fromEntries(run.lanesUsed.map((lane) => [lane, run.proposals.filter((proposal) => proposal.evidence.some((evidence) => evidence.source === lane || evidence.source === 'legacy-cascade')).length]))
  return { ...base, objects, diagnostics: {
    ...base.diagnostics, lanesAttempted: run.lanesAttempted, lanesUsed: run.lanesUsed, fallbackLanes: run.fallbackLanes,
    warnings: [...run.warnings, `Proposal graph built with ${graph.edges.length} mask-aware edges.`], timingsMs: { ...base.diagnostics.timingsMs, ...run.timingsMs }, executionProviders: { ...base.diagnostics.executionProviders, ...run.executionProviders }, proposalCount: run.proposals.length, objectCount: objects.length,
    proposalCountsBySource: proposalCountsBySource as Record<string, number>, finalObjectCount: objects.length,
  } }
}
