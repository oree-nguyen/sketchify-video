import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from './settingsDefaults'
import { analysisPauseDurationSec, frameDurationSec, reconcileFrameObjects, retimeAnalysisForFrame, type Frame } from './projectStore'
import type { Analysis, Block } from '../wasm/wasmClient'

const block = (id: number, x: number): Block => ({
  id, bbox: { x, y: 0, w: 10, h: 10 }, centroid: { x: x + 5, y: 5 }, inkArea: 100,
  pixels: [x], kind: 'vector', x, y: 0, width: 10, height: 10, area: 100,
})

const analysis = (blocks: Block[]): Analysis => ({
  img: { rgba: new Uint8Array(400), gray: new Uint8Array(100), ink: new Uint8Array(100), w: 100, h: 1, bg: [255, 255, 255] },
  blocks,
  units: blocks.flatMap((item) => [0, 1].map((part) => ({
    type: 'path' as const, blockId: item.id, bbox: item.bbox, pixels: item.pixels,
    path: [item.bbox.x, 0, item.bbox.x + 1, 1], color: [0, 0, 0] as [number, number, number],
    cost: part + 1, t0: 0, t1: 0,
  }))),
  stats: { blocks: blocks.length, units: blocks.length * 2, mergeRadiusConfigured: 0, mergeRadiusApplied: 0, workingWidthActual: 100, openingApplied: false },
})

const frameWith = (blocks: Block[], source: Analysis): Frame => ({
  id: 101, name: 'pause-test', sourceUrl: '', settings: structuredClone(DEFAULT_SETTINGS),
  objects: reconcileFrameObjects(101, blocks), transitionToNext: { type: 'none', durationSec: 1 },
  durationSec: 0, analysis: source, dirty: false, imageSource: 'upload',
})

describe('two-tier inter-block pauses', () => {
  it('uses micro pause for a nearby label, group pause for a far object, and adds both to duration', () => {
    const blocks = [block(1, 0), block(2, 12), block(3, 70)]
    const source = analysis(blocks)
    let frame = frameWith(blocks, source)
    const timed = retimeAnalysisForFrame(source, frame)
    expect(timed.units.filter((unit) => (unit.pauseAfterMs ?? 0) > 0).map((unit) => unit.pauseAfterMs)).toEqual([200, 600])
    expect(analysisPauseDurationSec(timed)).toBe(.8)
    expect(frameDurationSec(frame)).toBe(8.8)

    frame = { ...frame, settings: { ...frame.settings, groupPauseMs: 800 } }
    expect(frameDurationSec(frame)).toBe(9)
  })

  it('forces group pause at an enabled page-zoom boundary', () => {
    const blocks = [block(1, 0), block(2, 12)]
    const source = analysis(blocks)
    const frame = frameWith(blocks, source)
    frame.settings.pageZoom = { ...frame.settings.pageZoom, enabled: true, mode: 'manual', pageGroups: [[1], [2]] }
    const timed = retimeAnalysisForFrame(source, frame)
    expect(timed.units.find((unit) => unit.blockId === 1 && unit.pauseAfterMs)?.pauseAfterMs).toBe(600)
  })
})
