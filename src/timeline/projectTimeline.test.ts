import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../state/settingsDefaults'
import { DEFAULT_SUBTITLE_SETTINGS, setFrameCamera, setFrameHold, setFrameTransition, type Frame, type FrameObject, type Project, type TransitionType } from '../state/projectStore'
import { buildProjectTimeline, projectTimeAt } from './projectTimeline'

function frame(id: number, transition: TransitionType = 'none', transitionDuration = 1): Frame {
  const settings = structuredClone(DEFAULT_SETTINGS)
  settings.holdDurationSec = 2
  const objects: FrameObject[] = Array.from({ length: 4 }, (_, index) => ({
    objectId: `${id}:${index}`, blockId: index, bbox: { x: index * 10, y: 0, w: 8, h: 8 },
    centroid: { x: index * 10 + 4, y: 4 }, kind: 'vector', inkArea: 20,
    settings: { objectId: `${id}:${index}`, blockId: index, order: index, drawDurationSec: 2, strokeColorMode: 'object', inkColor: '#111827', strokeWidth: 3, pushEntry: { enabled: false, edge: 'auto', handStyle: 'auto' }, zoomFollow: true },
  }))
  return {
    id,
    name: `Frame ${id}`,
    sourceUrl: '',
    settings,
    objects,
    transitionToNext: { type: transition, durationSec: transitionDuration },
    durationSec: 10,
    analysis: null,
    dirty: false,
    imageSource: 'upload',
  }
}

const project = (frames: Frame[]): Project => ({ frames, activeFrameId: frames[0]?.id ?? null, handStyle: 'pencil', playhead: { globalTimeSec: 0 }, audioClips: [], subtitle: structuredClone(DEFAULT_SUBTITLE_SETTINGS) })

describe('buildProjectTimeline §11.6', () => {
  it('hai Frame 10 giây chạy liên tục trên trục 0→20 giây', () => {
    const timeline = buildProjectTimeline(project([frame(1), frame(2)]))
    expect(timeline.totalDurationSec).toBe(20)
    expect(timeline.segments.map(({ frameId, startSec, endSec }) => ({ frameId, startSec, endSec }))).toEqual([
      { frameId: 1, startSec: 0, endSec: 10 },
      { frameId: 2, startSec: 10, endSec: 20 },
    ])
    expect(projectTimeAt(timeline, 9.999)?.segment.frameId).toBe(1)
    expect(projectTimeAt(timeline, 10)?.segment.frameId).toBe(2)
    expect(projectTimeAt(timeline, 15)?.localTimeSec).toBe(5)
  })

  it('transition 1 giây phủ 9.5→10.5 nhưng tổng vẫn là 20 giây', () => {
    const timeline = buildProjectTimeline(project([frame(1, 'zoom-morph', 1), frame(2)]))
    expect(timeline.totalDurationSec).toBe(20)
    expect(timeline.segments[0].transitionStartSec).toBe(9.5)
    expect(timeline.segments[0].transitionEndSec).toBe(10.5)
    expect(projectTimeAt(timeline, 10)?.transition?.progress).toBeCloseTo(0.5)
    expect(projectTimeAt(timeline, 10.5)?.segment.frameId).toBe(2)
  })

  it('ba Frame không cộng thêm thời lượng transition', () => {
    const timeline = buildProjectTimeline(project([frame(1, 'paper-fold', 1.2), frame(2, 'paper-airplane', 2), frame(3)]))
    expect(timeline.totalDurationSec).toBe(30)
    expect(timeline.segments.map((segment) => segment.startSec)).toEqual([0, 10, 20])
  })
  it('đổi hold/camera Frame #2 không dirty hoặc sửa Frame #1/#3', () => {
    const before = project([frame(1), frame(2), frame(3)])
    const afterHold = setFrameHold(before, 2, 5)
    const afterCamera = setFrameCamera(afterHold, 2, { mode: 'off' })
    const after = setFrameTransition(afterCamera, 2, { type: 'paper-fold', durationSec: 1.2 })
    expect(after.frames[0]).toBe(before.frames[0])
    expect(after.frames[2]).toBe(before.frames[2])
    expect(after.frames[1].dirty).toBe(false)
    expect(after.frames[1].durationSec).toBe(13)
  })
})
