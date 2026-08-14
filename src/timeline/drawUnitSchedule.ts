import type { DrawUnit } from '../wasm/wasmClient'

export interface ScheduledDrawUnit {
  unit: DrawUnit
  index: number
  startMs: number
  endMs: number
}

export interface DrawUnitSchedule {
  entries: ScheduledDrawUnit[]
  drawingDurationMs: number
  pauseDurationMs: number
  totalDurationMs: number
}

export function buildDrawUnitSchedule(units: DrawUnit[], drawDurationSec: number): DrawUnitSchedule {
  const drawingDurationMs = Math.max(0, drawDurationSec * 1000)
  let cursorMs = 0
  let pauseDurationMs = 0
  const entries = units.map((unit, index) => {
    const durationMs = Math.max(0, unit.t1 - unit.t0) * drawingDurationMs
    const entry = { unit, index, startMs: cursorMs, endMs: cursorMs + durationMs }
    const pauseAfterMs = Math.max(0, unit.pauseAfterMs ?? 0)
    cursorMs = entry.endMs + pauseAfterMs
    pauseDurationMs += pauseAfterMs
    return entry
  })
  return { entries, drawingDurationMs, pauseDurationMs, totalDurationMs: drawingDurationMs + pauseDurationMs }
}

export function drawingProgressAt(schedule: DrawUnitSchedule, elapsedMs: number): number {
  if (!schedule.entries.length || schedule.drawingDurationMs <= 0) return 1
  const elapsed = Math.max(0, elapsedMs)
  for (const entry of schedule.entries) {
    if (elapsed < entry.startMs) return entry.unit.t0
    if (elapsed <= entry.endMs) {
      const ratio = (elapsed - entry.startMs) / Math.max(.000001, entry.endMs - entry.startMs)
      return entry.unit.t0 + (entry.unit.t1 - entry.unit.t0) * Math.max(0, Math.min(1, ratio))
    }
  }
  return 1
}

export function activeScheduledUnit(schedule: DrawUnitSchedule, elapsedMs: number): ScheduledDrawUnit | undefined {
  return schedule.entries.find((entry) => elapsedMs >= entry.startMs && elapsedMs < entry.endMs)
}
