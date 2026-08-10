import { frameDurationSec, type Project, type TransitionType } from '../state/projectStore'

export interface ProjectSegment {
  frameId: number
  frameIndex: number
  startSec: number
  endSec: number
  durationSec: number
  transition: TransitionType
  transitionStartSec?: number
  transitionEndSec?: number
}

export interface ProjectTimeline {
  segments: ProjectSegment[]
  totalDurationSec: number
}

export interface ProjectTime {
  segment: ProjectSegment
  localTimeSec: number
  transition?: { from: ProjectSegment; to: ProjectSegment; progress: number }
}

// Timeline dùng tổng duration của Frame; transition chỉ ăn vào hai bên ranh giới và không cộng thêm giây.
export function buildProjectTimeline(project: Pick<Project, 'frames'>): ProjectTimeline {
  let cursor = 0
  const segments = project.frames.map((frame, frameIndex) => {
    const next = project.frames[frameIndex + 1]
    const durationSec = frameDurationSec(frame)
    const transitionDuration = next && frame.transitionToNext.type !== 'none'
      ? Math.min(frame.transitionToNext.durationSec, durationSec, frameDurationSec(next))
      : 0
    const segment: ProjectSegment = {
      frameId: frame.id,
      frameIndex,
      startSec: cursor,
      endSec: cursor + durationSec,
      durationSec,
      transition: frame.transitionToNext.type,
    }
    if (transitionDuration > 0) {
      segment.transitionStartSec = segment.endSec - transitionDuration / 2
      segment.transitionEndSec = segment.endSec + transitionDuration / 2
    }
    cursor = segment.endSec
    return segment
  })
  return { segments, totalDurationSec: cursor }
}

export function projectTimeAt(timeline: ProjectTimeline, globalTimeSec: number): ProjectTime | null {
  if (!timeline.segments.length) return null
  const time = Math.max(0, Math.min(timeline.totalDurationSec, globalTimeSec))
  const transitionFrom = timeline.segments.find((segment, index) => {
    return index < timeline.segments.length - 1
      && segment.transitionStartSec !== undefined
      && segment.transitionEndSec !== undefined
      && time >= segment.transitionStartSec
      && time <= segment.transitionEndSec
  })
  if (transitionFrom) {
    const to = timeline.segments[transitionFrom.frameIndex + 1]
    const duration = transitionFrom.transitionEndSec! - transitionFrom.transitionStartSec!
    return {
      segment: time < to.startSec ? transitionFrom : to,
      localTimeSec: Math.max(0, time - (time < to.startSec ? transitionFrom.startSec : to.startSec)),
      transition: { from: transitionFrom, to, progress: duration > 0 ? (time - transitionFrom.transitionStartSec!) / duration : 1 },
    }
  }
  const segment = [...timeline.segments].reverse().find((candidate) => time >= candidate.startSec) ?? timeline.segments[0]
  return { segment, localTimeSec: Math.max(0, Math.min(segment.durationSec, time - segment.startSec)) }
}
