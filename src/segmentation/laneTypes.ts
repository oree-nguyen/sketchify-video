import type { ObjectInstance, ProposalEvidence } from './contracts'
import type { Rect, WorkImage } from '../wasm/wasmClient'

export interface SegmentationInput {
  image: WorkImage
  background: [number, number, number]
}

export interface ProposalNode {
  id: string
  bbox: Rect
  maskRle: Uint32Array
  confidence: number
  evidence: ProposalEvidence[]
  roleHint?: ObjectInstance['role']
}

export interface SegmentationLane {
  id: string
  kind: 'text' | 'known-object' | 'unknown-object' | 'classical'
  available(): boolean | Promise<boolean>
  propose(input: SegmentationInput): Promise<ProposalNode[]>
}

export interface SegmentationPipelineResult {
  proposals: ProposalNode[]
  lanesAttempted: string[]
  lanesUsed: string[]
  fallbackLanes: string[]
  warnings: string[]
}
