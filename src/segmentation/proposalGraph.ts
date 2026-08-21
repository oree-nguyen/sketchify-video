import { maskIou } from './evaluator'
import type { ProposalNode } from './laneTypes'

export interface ProposalEdge {
  from: string
  to: string
  maskIou: number
  bboxOverlap: number
  boundaryGap: number
  contact: boolean
  baselineDelta: number
  detectorConflict: boolean
  evidence: string[]
  mergeScore: number
}

export interface ProposalGraph {
  nodes: ProposalNode[]
  edges: ProposalEdge[]
}

/** Build a mask-aware graph. Bboxes are only a cheap prefilter, never ownership. */
export function buildProposalGraph(nodes: readonly ProposalNode[], width: number): ProposalGraph {
  const edges: ProposalEdge[] = []
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i], b = nodes[j]
    const bboxOverlap = rectOverlap(a.bbox, b.bbox)
    const boundaryGap = bboxDistance(a.bbox, b.bbox)
    if (bboxOverlap === 0 && boundaryGap > Math.max(4, width * .04)) continue
    const overlap = maskIou(a.maskRle, b.maskRle)
    const mergeScore = overlap * .6 + (bboxOverlap > .05 ? .25 : 0) + (boundaryGap <= 2 ? .15 : 0)
    const baselineDelta = Math.abs((a.bbox.y + a.bbox.h) - (b.bbox.y + b.bbox.h))
    const contact = boundaryGap === 0 && bboxOverlap === 0
    const detectorConflict = a.evidence.some((item) => item.source === 'detector') && b.evidence.some((item) => item.source === 'detector') && overlap < .05
    const evidence = [overlap > .05 ? 'mask-iou' : 'mask-disjoint', bboxOverlap > 0 ? 'bbox-overlap' : 'gap', contact ? 'boundary-contact' : 'separated', baselineDelta <= Math.max(a.bbox.h, b.bbox.h) ? 'baseline-aligned' : 'baseline-different']
    edges.push({ from: a.id, to: b.id, maskIou: overlap, bboxOverlap, boundaryGap, contact, baselineDelta, detectorConflict, evidence, mergeScore })
  }
  return { nodes: [...nodes], edges }
}

function rectOverlap(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): number {
  const area = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  return area / Math.max(1, Math.min(a.w * a.h, b.w * b.h))
}

function bboxDistance(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): number {
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w))
  const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h))
  return Math.hypot(dx, dy)
}
