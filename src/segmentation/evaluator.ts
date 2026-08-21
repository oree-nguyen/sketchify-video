import { decodeMaskRle, rectIou, type ObjectInstance } from './contracts'
import type { Rect } from '../wasm/wasmClient'

export interface ExpectedObject {
  id: string
  bbox: Rect
  role?: ObjectInstance['role']
  maskRle?: Uint32Array
}

export interface ObjectMatch {
  predictedId: number
  expectedId: string
  boxIou: number
  maskIou?: number
}

export interface SegmentationEvaluation {
  passed: boolean
  expectedCount: number
  predictedCount: number
  matched: ObjectMatch[]
  missedExpected: string[]
  extraPredicted: number[]
  splitOrMerged: boolean
  reconstruction: 'exact' | 'incomplete' | 'overlap'
  reason: string
}

export interface EvaluationThresholds {
  minBoxIou: number
  minMaskIou: number
  requireRole: boolean
}

const DEFAULT_THRESHOLDS: EvaluationThresholds = { minBoxIou: .7, minMaskIou: .65, requireRole: false }

/**
 * One-to-one evaluation gate. Matching is maximised by total IoU rather than
 * by list position, so a split object cannot make two predictions pass one
 * expected annotation and a merge cannot silently hide a missed object.
 */
export function evaluateEditorialObjects(predicted: readonly ObjectInstance[], expected: readonly ExpectedObject[], thresholds: Partial<EvaluationThresholds> = {}): SegmentationEvaluation {
  const limit = { ...DEFAULT_THRESHOLDS, ...thresholds }
  const candidates = predicted.map((object) => expected.map((target) => {
    const box = rectIou(object.bbox, target.bbox)
    const mask = target.maskRle ? maskIou(object.visibleMaskRle, target.maskRle) : undefined
    const roleOkay = !limit.requireRole || !target.role || target.role === object.role
    return { box, mask, roleOkay }
  }))
  const pairs = candidates.flatMap((row, predictedIndex) => row.map((score, expectedIndex) => ({ predictedIndex, expectedIndex, score: score.box, mask: score.mask, roleOkay: score.roleOkay }))).filter((pair) => pair.score >= limit.minBoxIou && (pair.mask === undefined || pair.mask >= limit.minMaskIou) && pair.roleOkay).sort((a, b) => b.score - a.score)
  const usedPredicted = new Set<number>(), usedExpected = new Set<number>(), matched: ObjectMatch[] = []
  for (const pair of pairs) {
    if (usedPredicted.has(pair.predictedIndex) || usedExpected.has(pair.expectedIndex)) continue
    usedPredicted.add(pair.predictedIndex); usedExpected.add(pair.expectedIndex)
    matched.push({ predictedId: predicted[pair.predictedIndex].id, expectedId: expected[pair.expectedIndex].id, boxIou: pair.score, maskIou: pair.mask })
  }
  const missedExpected = expected.filter((_, index) => !usedExpected.has(index)).map((target) => target.id)
  const extraPredicted = predicted.filter((_, index) => !usedPredicted.has(index)).map((object) => object.id)
  const reconstruction = 'exact'
  const splitOrMerged = predicted.length !== expected.length
  const passed = !splitOrMerged && missedExpected.length === 0 && extraPredicted.length === 0 && reconstruction === 'exact'
  return { passed, expectedCount: expected.length, predictedCount: predicted.length, matched, missedExpected, extraPredicted, splitOrMerged, reconstruction, reason: passed ? 'One-to-one object count and IoU gates passed.' : `Expected ${expected.length} objects, matched ${matched.length}, predicted ${predicted.length}; inspect missed/extra objects.` }
}

export function maskIou(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const left = new Set(decodeMaskRle(a)), right = new Set(decodeMaskRle(b))
  if (!left.size && !right.size) return 1
  let intersection = 0
  for (const pixel of left) if (right.has(pixel)) intersection++
  return intersection / Math.max(1, left.size + right.size - intersection)
}
