import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type FrameSettings } from '../state/settingsDefaults'
import type { Block, DrawUnit, Rect } from '../wasm/wasmClient'
import { buildBlockFocusSpans, buildCameraTimeline, cameraAt, cameraFocusBlockAt, fitRect } from './cameraTimeline'
import { buildPageZoomKeys } from './pageZoom'

const settings = (mode: FrameSettings['camera']['mode'] = 'A-auto-follow'): FrameSettings => {
  const copy = structuredClone(DEFAULT_SETTINGS)
  copy.camera.mode = mode
  return copy
}

const block = (id: number, bbox: Rect): Block => ({
  id,
  bbox,
  centroid: { x: bbox.x + bbox.w / 2, y: bbox.y + bbox.h / 2 },
  inkArea: bbox.w * bbox.h,
  pixels: [],
  kind: 'vector',
  x: bbox.x,
  y: bbox.y,
  width: bbox.w,
  height: bbox.h,
  area: bbox.w * bbox.h,
})

const unit = (blockId: number, t0: number, t1: number): DrawUnit => ({
  type: 'area',
  blockId,
  bbox: { x: 0, y: 0, w: 1, h: 1 },
  pixels: [0],
  path: [],
  color: [0, 0, 0],
  cost: 1,
  t0,
  t1,
})

const closeRect = (actual: Rect, expected: Rect) => {
  expect(actual.x).toBeCloseTo(expected.x, 5)
  expect(actual.y).toBeCloseTo(expected.y, 5)
  expect(actual.w).toBeCloseTo(expected.w, 5)
  expect(actual.h).toBeCloseTo(expected.h, 5)
}

describe('camera auto-follow theo DrawUnit thật', () => {
  it('chỉ focus vật thể bật zoom và cameraPinned luôn giữ toàn khung', () => {
    const blocks = [block(10, { x: 40, y: 80, w: 120, h: 100 }), block(20, { x: 800, y: 300, w: 120, h: 100 })]
    const units = [unit(10, 0, 0.5), unit(20, 0.5, 1)]
    const selective = buildCameraTimeline(settings(), blocks, units, 1000, 500, [20])
    expect(selective.focusSpans.map((span) => span.blockId)).toEqual([20])
    expect(buildCameraTimeline(settings(), blocks, units, 1000, 500, []).focusSpans).toHaveLength(0)
    const pinned = settings(); pinned.cameraPinned = true
    const fixed = buildCameraTimeline(pinned, blocks, units, 1000, 500, [20])
    expect(fixed.keys.every((key) => key.crop.x === 0 && key.crop.y === 0 && key.crop.w === 1000 && key.crop.h === 500)).toBe(true)
  })
  it('focus block 1 rồi chuyển đúng sang block 2 tại t0 của block 2', () => {
    const blocks = [block(10, { x: 40, y: 80, w: 120, h: 100 }), block(20, { x: 800, y: 300, w: 120, h: 100 })]
    const units = [unit(10, 0, 0.5), unit(20, 0.5, 1)]
    const timeline = buildCameraTimeline(settings(), blocks, units, 1000, 500)

    expect(timeline.focusSpans.map((span) => span.blockId)).toEqual([10, 20])
    const firstKey = timeline.keys.find((key) => key.role === 'focus' && key.blockId === 10)
    const secondKey = timeline.keys.find((key) => key.role === 'focus' && key.blockId === 20)
    expect(firstKey?.t).toBe(0)
    expect(secondKey?.t).toBe(0.5)
    closeRect(cameraAt(timeline.keys, 0), timeline.focusSpans[0].crop)
    closeRect(cameraAt(timeline.keys, 0.5), timeline.focusSpans[1].crop)
    expect(timeline.keys.some((key) => key.role === 'bridge' && key.t > 0 && key.t < 0.5)).toBe(false)
    expect(cameraFocusBlockAt(timeline.keys, 0.49)).toBe(10)
    expect(cameraFocusBlockAt(timeline.keys, 0.5)).toBe(20)
    expect(timeline.keys.every((key, index) => key.t >= 0 && key.t <= 1 && (index === 0 || key.t >= timeline.keys[index - 1].t))).toBe(true)
    for (const key of timeline.keys) expect(key.crop.w / key.crop.h).toBeCloseTo(2, 8)
  })

  it('lấy min t0/max t1 bất kể unit bị xáo thứ tự và bỏ block không có unit', () => {
    const blocks = [block(1, { x: 0, y: 0, w: 80, h: 80 }), block(2, { x: 300, y: 0, w: 80, h: 80 }), block(3, { x: 600, y: 0, w: 80, h: 80 })]
    const units = [unit(2, 0.7, 0.9), unit(1, 0.2, 0.4), unit(2, 0.5, 0.7)]
    const spans = buildBlockFocusSpans(blocks, units, settings(), 800, 450)

    expect(spans.map(({ blockId, t0, t1 }) => ({ blockId, t0, t1 }))).toEqual([
      { blockId: 1, t0: 0.2, t1: 0.4 },
      { blockId: 2, t0: 0.5, t1: 0.9 },
    ])
  })

  it('mode D dùng auto-follow với <=25 block và fallback C có lý do khi >25 block', () => {
    const fewBlocks = [block(0, { x: 0, y: 0, w: 50, h: 50 }), block(1, { x: 500, y: 200, w: 50, h: 50 })]
    const hybrid = buildCameraTimeline(settings('D-hybrid'), fewBlocks, [unit(0, 0, 0.5), unit(1, 0.5, 1)], 800, 450)
    expect(hybrid.fellBack).toBe(false)
    expect(hybrid.focusSpans).toHaveLength(2)
    expect(hybrid.keys.some((key) => key.role === 'focus' && key.blockId === 1)).toBe(true)

    const manyBlocks = Array.from({ length: 26 }, (_, id) => block(id, { x: (id % 10) * 60, y: Math.floor(id / 10) * 60, w: 40, h: 40 }))
    const fallback = buildCameraTimeline(settings('D-hybrid'), manyBlocks, manyBlocks.map((item, index) => unit(item.id, index / 26, (index + 1) / 26)), 800, 450)
    expect(fallback.fellBack).toBe(true)
    expect(fallback.reason).toContain('26 khối')
    expect(fallback.keys.filter((key) => key.role === 'focus')).toHaveLength(1)
  })
})

describe('các bất biến camera §11', () => {
  it('fitRect luôn giữ đúng aspect và chứa trọn bbox', () => {
    const bbox = { x: 300, y: 200, w: 80, h: 160 }
    const crop = fitRect(bbox, 16 / 9, 0.12, 1000, 600, 3)
    expect(crop.w / crop.h).toBeCloseTo(16 / 9, 8)
    expect(crop.x).toBeLessThanOrEqual(bbox.x)
    expect(crop.y).toBeLessThanOrEqual(bbox.y)
    expect(crop.x + crop.w).toBeGreaterThanOrEqual(bbox.x + bbox.w)
    expect(crop.y + crop.h).toBeGreaterThanOrEqual(bbox.y + bbox.h)
  })

  it('mode off giữ full-frame dù vật thể bật Zoom theo vật thể', () => {
    const blocks = [block(7, { x: 400, y: 200, w: 80, h: 80 })]
    const timeline = buildCameraTimeline(settings('off'), blocks, [unit(7, 0.35, 0.6)], 800, 450, [7])
    expect(timeline.keys.every((key) => key.crop.x === 0 && key.crop.y === 0 && key.crop.w === 800 && key.crop.h === 450)).toBe(true)
  })

  it('crop thủ công cũng bắt buộc đi qua fitRect', () => {
    const manualSettings = settings('B-manual-keyframe')
    manualSettings.camera.manualKeyframes = [{ blockId: 4, crop: { x: 200, y: 100, w: 100, h: 200 } }]
    const timeline = buildCameraTimeline(manualSettings, [block(4, { x: 200, y: 100, w: 100, h: 200 })], [unit(4, 0, 1)], 1000, 500)
    const manual = timeline.keys.find((key) => key.role === 'manual')
    expect(manual).toBeDefined()
    expect(manual!.crop.w / manual!.crop.h).toBeCloseTo(2, 8)
  })

  it('page zoom chỉ union hai trang kề và không tham chiếu trang thứ ba sớm', () => {
    const pageSettings = settings('off')
    pageSettings.pageZoom.enabled = true
    pageSettings.pageZoom.mode = 'manual'
    pageSettings.pageZoom.pageGroups = [[0], [1], [2]]
    const blocks = [block(0, { x: 50, y: 30, w: 100, h: 70 }), block(1, { x: 400, y: 200, w: 100, h: 70 }), block(2, { x: 800, y: 400, w: 100, h: 70 })]
    const keys = buildPageZoomKeys(blocks, [unit(0, 0, 0.3), unit(1, 0.3, 0.65), unit(2, 0.65, 1)], pageSettings, 1000, 600)
    const firstMid = keys[1]
    expect(firstMid.t).toBe(0.3)
    expect(firstMid.crop.x + firstMid.crop.w).toBeLessThan(blocks[2].bbox.x + blocks[2].bbox.w)
  })
})
