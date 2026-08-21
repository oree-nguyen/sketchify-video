import type { ObjectInstance } from './contracts'
import type { ProposalNode } from './laneTypes'

/** Convert proposals to editorial objects without making bbox-only merges. */
export function editorialObjectsFromProposals(proposals: readonly ProposalNode[]): ObjectInstance[] {
  return proposals.map((proposal, index) => ({
    id: index,
    role: proposal.roleHint ?? 'thing',
    bbox: proposal.bbox,
    visibleMaskRle: proposal.maskRle,
    centroid: { x: proposal.bbox.x + proposal.bbox.w / 2, y: proposal.bbox.y + proposal.bbox.h / 2 },
    confidence: Math.max(0, Math.min(1, proposal.confidence)),
    children: [],
    mergeHistory: null,
    kind: 'photo',
    provenance: proposal.evidence,
  }))
}
