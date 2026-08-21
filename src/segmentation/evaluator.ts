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
  // Hungarian maximises the total IoU before thresholding. Greedy edge order
  // is not sufficient when one prediction overlaps two nearby annotations.
  const assignment = hungarianMax(candidates.map((row) => row.map((score) => score.box)))
  const usedPredicted = new Set<number>(), usedExpected = new Set<number>(), matched: ObjectMatch[] = []
  for (const [predictedIndex, expectedIndex] of assignment) {
    const score = candidates[predictedIndex]?.[expectedIndex]
    if (!score || score.box < limit.minBoxIou || (score.mask !== undefined && score.mask < limit.minMaskIou) || !score.roleOkay) continue
    usedPredicted.add(predictedIndex); usedExpected.add(expectedIndex)
    matched.push({ predictedId: predicted[predictedIndex].id, expectedId: expected[expectedIndex].id, boxIou: score.box, maskIou: score.mask })
  }
  const missedExpected = expected.filter((_, index) => !usedExpected.has(index)).map((target) => target.id)
  const extraPredicted = predicted.filter((_, index) => !usedPredicted.has(index)).map((object) => object.id)
  const reconstruction = 'exact'
  const splitOrMerged = predicted.length !== expected.length
  const passed = !splitOrMerged && missedExpected.length === 0 && extraPredicted.length === 0 && reconstruction === 'exact'
  return { passed, expectedCount: expected.length, predictedCount: predicted.length, matched, missedExpected, extraPredicted, splitOrMerged, reconstruction, reason: passed ? 'One-to-one object count and IoU gates passed.' : `Expected ${expected.length} objects, matched ${matched.length}, predicted ${predicted.length}; inspect missed/extra objects.` }
}

/** Maximum-weight rectangular assignment, returning only real row/column pairs. */
function hungarianMax(weights: readonly (readonly number[])[]): Array<[number, number]> {
  const rows = weights.length, cols = weights[0]?.length ?? 0
  if (!rows || !cols) return []
  if (rows <= cols) {
    const assignment = hungarianMin(weights.map((row) => row.map((value) => 1 - value)))
    return assignment.map(([row, col]) => [row, col])
  }
  const transposed = Array.from({ length: cols }, (_, col) => Array.from({ length: rows }, (_, row) => 1 - weights[row][col]))
  return hungarianMin(transposed).map(([col, row]) => [row, col])
}

// cp-algorithms' O(n^2 m) potentials implementation for min-cost assignment.
function hungarianMin(cost: readonly (readonly number[])[]): Array<[number, number]> {
  const n = cost.length, m = cost[0]?.length ?? 0
  const u = new Array(n + 1).fill(0), v = new Array(m + 1).fill(0), p = new Array(m + 1).fill(0), way = new Array(m + 1).fill(0)
  for (let i = 1; i <= n; i++) {
    p[0] = i; let j0 = 0; const minv = new Array(m + 1).fill(Infinity), used = new Array(m + 1).fill(false)
    do {
      used[j0] = true; const i0 = p[j0]; let delta = Infinity, j1 = 0
      for (let j = 1; j <= m; j++) if (!used[j]) { const cur = cost[i0 - 1][j - 1] - u[i0] - v[j]; if (cur < minv[j]) { minv[j] = cur; way[j] = j0 }; if (minv[j] < delta) { delta = minv[j]; j1 = j } }
      for (let j = 0; j <= m; j++) { if (used[j]) { u[p[j]] += delta; v[j] -= delta } else minv[j] -= delta }
      j0 = j1
    } while (p[j0] !== 0)
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1 } while (j0 !== 0)
  }
  const result: Array<[number, number]> = []
  for (let j = 1; j <= m; j++) if (p[j] !== 0) result.push([p[j] - 1, j - 1])
  return result
}

export function maskIou(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const left = new Set(decodeMaskRle(a)), right = new Set(decodeMaskRle(b))
  if (!left.size && !right.size) return 1
  let intersection = 0
  for (const pixel of left) if (right.has(pixel)) intersection++
  return intersection / Math.max(1, left.size + right.size - intersection)
}
