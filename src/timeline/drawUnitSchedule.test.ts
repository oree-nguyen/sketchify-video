import { describe, expect, it } from 'vitest'
import type { DrawUnit } from '../wasm/wasmClient'
import { activeScheduledUnit, buildDrawUnitSchedule, drawingProgressAt } from './drawUnitSchedule'

const unit = (blockId: number, t0: number, t1: number, pauseAfterMs = 0): DrawUnit => ({
  type: 'path', blockId, bbox: { x: blockId * 10, y: 0, w: 10, h: 10 }, pixels: [], path: [],
  color: [0, 0, 0], cost: 1, t0, t1, pauseAfterMs,
})

describe('DrawUnit real-time schedule', () => {
  it('adds pauses without shortening drawing and freezes progress during a pause', () => {
    const schedule = buildDrawUnitSchedule([unit(1, 0, .5, 200), unit(2, .5, 1)], 2)
    expect(schedule.drawingDurationMs).toBe(2000)
    expect(schedule.pauseDurationMs).toBe(200)
    expect(schedule.totalDurationMs).toBe(2200)
    expect(drawingProgressAt(schedule, 1000)).toBe(.5)
    expect(drawingProgressAt(schedule, 1100)).toBe(.5)
    expect(drawingProgressAt(schedule, 1200)).toBe(.5)
    expect(activeScheduledUnit(schedule, 1100)).toBeUndefined()
    expect(activeScheduledUnit(schedule, 1300)?.unit.blockId).toBe(2)
  })
})
