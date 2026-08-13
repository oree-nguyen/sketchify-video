import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from './settingsDefaults'
import { frameDrawDurationSec, frameDurationSec, mergeFrameObjects, objectDropInsertionIndex, reconcileFrameObjects, reorderFrameObjects, retimeAnalysisForFrame, setFrameCameraPinned, setObjectOrder, setObjectZoomFollow, updateObjectSettings, type Frame, type Project } from './projectStore'
import type { Analysis, Block } from '../wasm/wasmClient'

const block = (id: number, x: number): Block => ({
  id, bbox: { x, y: 0, w: 10, h: 10 }, centroid: { x: x + 5, y: 5 }, inkArea: 100,
  pixels: [x], kind: 'vector', x, y: 0, width: 10, height: 10, area: 100,
})

const analysis = (blocks: Block[]): Analysis => ({
  img: { rgba: new Uint8Array(400), gray: new Uint8Array(100), ink: new Uint8Array(100), w: 100, h: 1, bg: [255, 255, 255] },
  blocks,
  units: blocks.flatMap((item) => [0, 1].map((part) => ({ type: 'path' as const, blockId: item.id, bbox: item.bbox, pixels: item.pixels, path: [item.bbox.x, 0, item.bbox.x + 1, 1], color: [0, 0, 0] as [number, number, number], cost: part + 1, t0: 0, t1: 0 }))),
  stats: { blocks: blocks.length, units: blocks.length * 2, mergeRadiusConfigured: 0, mergeRadiusApplied: 0, workingWidthActual: 100, openingApplied: false },
})

const makeFrame = (id: number, blocks: Block[]): Frame => ({
  id, name: `Frame ${id}`, sourceUrl: '', settings: structuredClone(DEFAULT_SETTINGS),
  objects: reconcileFrameObjects(id, blocks), transitionToNext: { type: 'none', durationSec: 1 },
  durationSec: 0, analysis: null, dirty: false, imageSource: 'upload',
})

describe('FrameObject contract', () => {
  it('store chặn xung đột Ghim camera và Zoom theo vật thể ở cả hai chiều', () => {
    const frame = makeFrame(99, [block(1, 0)])
    let project: Project = { frames: [frame], activeFrameId: frame.id, handStyle: 'pencil', playhead: { globalTimeSec: 0 }, audioClips: [] }
    expect(setFrameCameraPinned(project, frame.id, true)).toBe(project)
    project = setObjectZoomFollow(project, frame.id, frame.objects[0].objectId, false)
    project = setFrameCameraPinned(project, frame.id, true)
    expect(project.frames[0].settings.cameraPinned).toBe(true)
    expect(setObjectZoomFollow(project, frame.id, frame.objects[0].objectId, true)).toBe(project)
  })
  it('suy ra 15 giây vẽ và 17 giây tổng từ [1,2,3,4,5] + hold 2', () => {
    let frame = makeFrame(1, [0, 1, 2, 3, 4].map((id) => block(id, id * 15)))
    frame.objects.forEach((object, index) => { frame = updateObjectSettings(frame, object.objectId, { drawDurationSec: index + 1 }) })
    expect(frameDrawDurationSec(frame)).toBe(15)
    expect(frameDurationSec(frame)).toBe(17)
    const timed = retimeAnalysisForFrame(analysis(frame.objects.map((object) => block(object.blockId, object.bbox.x))), frame)
    const boundaries = frame.objects.map((object) => {
      const own = timed.units.filter((unit) => unit.blockId === object.blockId)
      return [own[0].t0 * 15, own.at(-1)!.t1 * 15]
    })
    expect(boundaries).toEqual([[0, 1], [1, 3], [3, 6], [6, 10], [10, 15]])
  })

  it('đổi Object #2 không sửa Object khác và không đặt dirty/reanalyze', () => {
    const before = makeFrame(2, [block(0, 0), block(1, 20), block(2, 40)])
    const changed = updateObjectSettings(before, before.objects[1].objectId, { drawDurationSec: 7, zoomFollow: true })
    expect(changed.objects[0]).toEqual(before.objects[0])
    expect(changed.objects[2]).toEqual(before.objects[2])
    expect(changed.objects[1].settings.drawDurationSec).toBe(7)
    expect(changed.dirty).toBe(false)
  })

  it('kéo đổi thứ tự giữ nguyên objectId và blockId', () => {
    const before = makeFrame(3, [block(10, 0), block(20, 20), block(30, 40)])
    const ids = before.objects.map(({ objectId, blockId }) => ({ objectId, blockId }))
    const changed = reorderFrameObjects(before, before.objects[2].objectId, before.objects[0].objectId)
    expect(changed.objects.map((object) => object.blockId)).toEqual([30, 10, 20])
    expect(changed.objects.map(({ objectId, blockId }) => ({ objectId, blockId })).sort((a, b) => a.blockId - b.blockId)).toEqual(ids.sort((a, b) => a.blockId - b.blockId))
  })

  it('tính đúng vị trí thả trước/sau khi kéo lên và kéo xuống', () => {
    const frame = makeFrame(31, [block(10, 0), block(20, 20), block(30, 40), block(40, 60)])
    const [first, second, third, fourth] = frame.objects
    expect(objectDropInsertionIndex(frame.objects, first.objectId, third.objectId, 'before')).toBe(1)
    expect(objectDropInsertionIndex(frame.objects, first.objectId, third.objectId, 'after')).toBe(2)
    expect(objectDropInsertionIndex(frame.objects, fourth.objectId, second.objectId, 'before')).toBe(1)
    expect(objectDropInsertionIndex(frame.objects, fourth.objectId, second.objectId, 'after')).toBe(2)
    const project: Project = { frames: [frame], activeFrameId: frame.id, handStyle: 'pencil', playhead: { globalTimeSec: 0 }, audioClips: [] }
    const insertion = objectDropInsertionIndex(frame.objects, first.objectId, third.objectId, 'after')!
    const moved = setObjectOrder(project, frame.id, first.objectId, insertion).frames[0]
    expect(moved.objects.map((object) => object.blockId)).toEqual([20, 30, 10, 40])
    const timed = retimeAnalysisForFrame(analysis([block(10, 0), block(20, 20), block(30, 40), block(40, 60)]), moved)
    expect([...new Set(timed.units.map((unit) => unit.blockId))]).toEqual([20, 30, 10, 40])
  })

  it('reconcile giữ settings theo hình học dù blockId đổi', () => {
    let frame = makeFrame(4, [block(0, 0), block(1, 50)])
    frame = updateObjectSettings(frame, frame.objects[1].objectId, { drawDurationSec: 9, pushEntry: { enabled: true, edge: 'right', handStyle: '2' } })
    const moved = [block(90, 1), block(91, 51)]
    const reconciled = reconcileFrameObjects(frame.id, moved, frame.objects)
    expect(reconciled.find((object) => object.blockId === 91)?.settings.drawDurationSec).toBe(9)
    expect(reconciled.find((object) => object.blockId === 91)?.settings.pushEntry).toEqual({ enabled: true, edge: 'right', handStyle: '2' })
  })

  it('gom nhiều vật thể thành một block thật và giữ toàn bộ DrawUnit', () => {
    const frame = makeFrame(5, [block(10, 0), block(20, 14), block(30, 60)])
    const source = analysis([block(10, 0), block(20, 14), block(30, 60)])
    const result = mergeFrameObjects(frame, source, [frame.objects[0].objectId, frame.objects[1].objectId])
    expect(result).not.toBeNull()
    expect(result!.frame.objects).toHaveLength(2)
    expect(result!.analysis.blocks).toHaveLength(2)
    expect(result!.analysis.blocks.find((item) => item.id === 10)?.bbox).toEqual({ x: 0, y: 0, w: 24, h: 10 })
    expect(result!.analysis.units.filter((unit) => unit.blockId === 10)).toHaveLength(4)
    expect(result!.frame.objects[0].settings.drawDurationSec).toBe(4)
  })
})
