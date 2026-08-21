import { decodeMaskRle, rectIou, type ObjectInstance } from './contracts'
import type { ExpectedObject } from './evaluator'

export interface SegmentationMetrics {
  objectPrecision: number
  objectRecall: number
  objectF1: number
  boxAp50: number
  boxAp75: number
  maskMeanIou: number
  panopticQuality: number
  fragmentationRate: number
  mergeErrorRate: number
  exactCountAccuracy: number
  textCompoundAccuracy: number
  finalReconstructionMismatch: number
  matchedAt50: number
}

export interface MetricThresholds {
  box: number
  mask: number
}

const DEFAULT_THRESHOLDS: MetricThresholds = { box: .5, mask: .5 }

/**
 * Computes the release-gate metrics from a single image.  Matching is
 * one-to-one and maximises total box IoU before thresholding; a second
 * prediction cannot silently reuse a ground-truth object.
 */
export function computeSegmentationMetrics(
  predicted: readonly ObjectInstance[],
  expected: readonly ExpectedObject[],
  reconstructionMismatch = 0,
  thresholds: Partial<MetricThresholds> = {},
): SegmentationMetrics {
  const limit = { ...DEFAULT_THRESHOLDS, ...thresholds }
  const scores = predicted.map((prediction) => expected.map((target) => ({
    box: rectIou(prediction.bbox, target.bbox),
    mask: target.maskRle ? maskIou(prediction.visibleMaskRle, target.maskRle) : undefined,
  })))
  const assignment = hungarianMax(scores.map((row) => row.map((score) => score.box)))
  const accepted = assignment.filter(([pi, gi]) => {
    const score = scores[pi]?.[gi]
    return !!score && score.box >= limit.box && (score.mask === undefined || score.mask >= limit.mask)
  })
  const tp = accepted.length
  const fp = Math.max(0, predicted.length - tp)
  const fn = Math.max(0, expected.length - tp)
  const precision = tp / Math.max(1, tp + fp)
  const recall = tp / Math.max(1, tp + fn)
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0
  const maskValues = accepted.map(([pi, gi]) => scores[pi][gi].mask).filter((value): value is number => value !== undefined)
  const maskMeanIou = maskValues.length ? maskValues.reduce((sum, value) => sum + value, 0) / maskValues.length : 0

  const pqMatches = assignment.filter(([pi, gi]) => scores[pi][gi].box >= .5 && (scores[pi][gi].mask === undefined || scores[pi][gi].mask >= .5))
  const pqSum = pqMatches.reduce((sum, [pi, gi]) => sum + (scores[pi][gi].mask ?? scores[pi][gi].box), 0)
  const panopticQuality = pqSum / Math.max(1, pqMatches.length + .5 * fp + .5 * fn)

  let fragmented = 0
  for (let gi = 0; gi < expected.length; gi++) {
    const matches = predicted.filter((prediction) => scores[predicted.indexOf(prediction)]?.[gi].box >= .5)
    if (matches.length > 1) fragmented++
  }
  let merged = 0
  for (let pi = 0; pi < predicted.length; pi++) {
    const matches = expected.filter((_, gi) => scores[pi]?.[gi].box >= .5)
    if (matches.length > 1) merged++
  }
  const roles = expected.filter((target) => target.role)
  const roleCorrect = roles.filter((target) => {
    const gi = expected.indexOf(target)
    const match = accepted.find(([, expectedIndex]) => expectedIndex === gi)
    return match ? predicted[match[0]].role === target.role : false
  }).length

  return {
    objectPrecision: precision,
    objectRecall: recall,
    objectF1: f1,
    boxAp50: averagePrecision(predicted, scores, .5),
    boxAp75: averagePrecision(predicted, scores, .75),
    maskMeanIou,
    panopticQuality,
    fragmentationRate: expected.length ? fragmented / expected.length : 0,
    mergeErrorRate: predicted.length ? merged / predicted.length : 0,
    exactCountAccuracy: predicted.length === expected.length ? 1 : 0,
    textCompoundAccuracy: roles.length ? roleCorrect / roles.length : 1,
    finalReconstructionMismatch: Math.max(0, Math.floor(reconstructionMismatch)),
    matchedAt50: tp,
  }
}

export function metricsPass(metrics: SegmentationMetrics): boolean {
  return metrics.objectF1 >= .9 && metrics.panopticQuality >= .8 && metrics.textCompoundAccuracy >= .95 &&
    metrics.fragmentationRate <= .03 && metrics.mergeErrorRate <= .03 && metrics.finalReconstructionMismatch === 0
}

function averagePrecision(predicted: readonly ObjectInstance[], scores: readonly (readonly { box: number }[])[], threshold: number): number {
  const ranked = predicted.map((prediction, predictionIndex) => ({ predictionIndex, confidence: prediction.confidence, row: scores[predictionIndex] ?? [] }))
    .sort((a, b) => b.confidence - a.confidence)
  const used = new Set<number>(), total = scores[0]?.length ?? 0
  if (!total) return 0
  let tp = 0, sum = 0, rank = 0
  for (const candidate of ranked) {
    rank++
    let best = -1, bestScore = threshold
    for (let expectedIndex = 0; expectedIndex < candidate.row.length; expectedIndex++) {
      const score = candidate.row[expectedIndex].box
      if (!used.has(expectedIndex) && score >= bestScore) { best = expectedIndex; bestScore = score }
    }
    if (best >= 0) {
      used.add(best); tp++; sum += tp / rank
    }
  }
  return sum / total
}

function maskIou(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const left = new Set(decodeMaskRle(a)), right = new Set(decodeMaskRle(b))
  if (!left.size && !right.size) return 1
  let intersection = 0
  for (const pixel of left) if (right.has(pixel)) intersection++
  return intersection / Math.max(1, left.size + right.size - intersection)
}

function hungarianMax(weights: readonly (readonly number[])[]): Array<[number, number]> {
  const rows = weights.length, cols = weights[0]?.length ?? 0
  if (!rows || !cols) return []
  if (rows <= cols) return hungarianMin(weights.map((row) => row.map((value) => 1 - value)))
  const transposed = Array.from({ length: cols }, (_, col) => Array.from({ length: rows }, (_, row) => 1 - weights[row][col]))
  return hungarianMin(transposed).map(([col, row]) => [row, col])
}

function hungarianMin(cost: readonly (readonly number[])[]): Array<[number, number]> {
  const n = cost.length, m = cost[0]?.length ?? 0
  const u = new Array(n + 1).fill(0), v = new Array(m + 1).fill(0), p = new Array(m + 1).fill(0), way = new Array(m + 1).fill(0)
  for (let i = 1; i <= n; i++) {
    p[0] = i; let j0 = 0
    const minv = new Array(m + 1).fill(Infinity), used = new Array(m + 1).fill(false)
    do {
      used[j0] = true; const i0 = p[j0]; let delta = Infinity, j1 = 0
      for (let j = 1; j <= m; j++) if (!used[j]) {
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j]
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0 }
        if (minv[j] < delta) { delta = minv[j]; j1 = j }
      }
      for (let j = 0; j <= m; j++) { if (used[j]) { u[p[j]] += delta; v[j] -= delta } else minv[j] -= delta }
      j0 = j1
    } while (p[j0] !== 0)
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1 } while (j0 !== 0)
  }
  const result: Array<[number, number]> = []
  for (let j = 1; j <= m; j++) if (p[j] !== 0) result.push([p[j] - 1, j - 1])
  return result
}
