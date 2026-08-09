import type { Frame, Project, TransitionType } from '../state/projectStore'

export interface ProjectSegment { frameId: number; startSec: number; endSec: number; transition: TransitionType; transitionStartSec?: number; transitionEndSec?: number }

// Không cộng thêm thời lượng transition: mỗi nửa nằm trong cuối/đầu của hai frame kề nhau.
export function buildProjectTimeline(project: Project): ProjectSegment[] {
  let cursor = 0
  return project.frames.map((frame, index) => {
    const next = project.frames[index + 1]
    const duration = frame.durationSec
    const transitionDuration = next && frame.transitionToNext.type !== 'none' ? Math.min(frame.transitionToNext.durationSec, duration, next.durationSec) : 0
    const segment: ProjectSegment = { frameId: frame.id, startSec: cursor, endSec: cursor + duration, transition: frame.transitionToNext.type }
    if (transitionDuration) { segment.transitionStartSec = cursor + duration - transitionDuration / 2; segment.transitionEndSec = cursor + duration + transitionDuration / 2 }
    cursor += duration
    return segment
  })
}

export function updateFrameSettings(project: Project, frameId: number, settings: Frame['settings']): Project {
  return { ...project, frames: project.frames.map((frame) => frame.id === frameId ? { ...frame, settings, dirty: true } : frame) }
}
