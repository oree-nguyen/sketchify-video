import { DEFAULT_SETTINGS } from './settingsDefaults'
import type { PushEdge } from './settingsDefaults'
import type { Analysis, Block, DrawUnit } from '../wasm/wasmClient'

export type HandStyleId = 'pencil' | 'feather-gray' | 'feather-white' | 'marker' | 'pen-blue'
export type TransitionType = 'none' | 'zoom-morph' | 'paper-airplane' | 'paper-fold'

export interface ObjectSettings {
  objectId: string
  blockId: number
  order: number
  drawDurationSec: number
  kindOverride?: 'vector' | 'photo'
  strokeColorMode: 'object' | 'custom'
  inkColor: string
  strokeWidth: number
  pushEntry: { enabled: boolean; edge: PushEdge }
  pinCamera: boolean
}

export interface FrameObject {
  objectId: string
  blockId: number
  bbox: Block['bbox']
  centroid: Block['centroid']
  kind: Block['kind']
  inkArea: number
  settings: ObjectSettings
}

export interface Frame {
  id: number
  name: string
  sourceUrl: string
  settings: typeof DEFAULT_SETTINGS
  objects: FrameObject[]
  transitionToNext: { type: TransitionType; durationSec: number }
  durationSec: number
  analysis: unknown | null
  dirty: boolean
  imageSource: 'upload' | 'ai-generated'
  aiGeneration?: { prompt: string; generatedAt: string }
}

export interface AudioClip {
  id: string
  frameId: number
  name: string
  sourceUrl: string
  startSec: number
  durationSec: number
  narrationText?: string
  source: 'upload' | 'ai-generated'
}

export interface Project {
  frames: Frame[]
  activeFrameId: number | null
  handStyle: HandStyleId
  playhead: { globalTimeSec: number }
  audioClips: AudioClip[]
}

export function createFrame(file: File, id: number): Frame {
  return createFrameFromSource(file, id, 'upload')
}

export function createFrameFromSource(source: Blob, id: number, imageSource: Frame['imageSource'], prompt?: string, name?: string): Frame {
  return {
    id,
    name: name ?? (source instanceof File ? source.name : `Ảnh AI ${new Date().toLocaleTimeString('vi-VN')}.png`),
    sourceUrl: URL.createObjectURL(source),
    settings: structuredClone(DEFAULT_SETTINGS),
    objects: [],
    transitionToNext: { type: 'none', durationSec: 1 },
    durationSec: DEFAULT_SETTINGS.holdDurationSec,
    analysis: null,
    dirty: true,
    imageSource,
    ...(imageSource === 'ai-generated' && prompt ? { aiGeneration: { prompt, generatedAt: new Date().toISOString() } } : {}),
  }
}

const DEFAULT_OBJECT_DRAW_SEC = 2

function blockFingerprint(frameId: number, block: Block): string {
  const { x, y, w, h } = block.bbox
  return `${frameId}:${x}:${y}:${w}:${h}`
}

function overlapScore(a: Block['bbox'], b: Block['bbox']): number {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y)
  const x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h)
  const intersection = Math.max(0, x1 - x0) * Math.max(0, y1 - y0)
  const union = a.w * a.h + b.w * b.h - intersection
  return union > 0 ? intersection / union : 0
}

export function reconcileFrameObjects(frameId: number, blocks: Block[], previous: FrameObject[] = []): FrameObject[] {
  const remaining = new Set(previous.map((object) => object.objectId))
  const matched = blocks.map((block, index) => {
    const fingerprint = blockFingerprint(frameId, block)
    const exact = previous.find((object) => remaining.has(object.objectId) && (object.objectId === fingerprint || (object.blockId === block.id && overlapScore(object.bbox, block.bbox) >= .45)))
    const geometric = exact ?? previous
      .filter((object) => remaining.has(object.objectId))
      .map((object) => ({ object, score: overlapScore(object.bbox, block.bbox) }))
      .filter((entry) => entry.score >= .45)
      .sort((a, b) => b.score - a.score)[0]?.object
    if (geometric) remaining.delete(geometric.objectId)
    const objectId = geometric?.objectId ?? fingerprint
    const settings: ObjectSettings = geometric ? {
      ...geometric.settings,
      objectId,
      blockId: block.id,
    } : {
      objectId,
      blockId: block.id,
      order: index,
      drawDurationSec: DEFAULT_OBJECT_DRAW_SEC,
      strokeColorMode: 'object',
      inkColor: '#111827',
      strokeWidth: 3,
      pushEntry: { enabled: false, edge: 'auto' },
      pinCamera: false,
    }
    return { objectId, blockId: block.id, bbox: block.bbox, centroid: block.centroid, kind: block.kind, inkArea: block.inkArea, settings }
  })
  return matched.sort((a, b) => a.settings.order - b.settings.order).map((object, order) => ({ ...object, settings: { ...object.settings, order } }))
}

export function frameDrawDurationSec(frame: Pick<Frame, 'objects'>): number {
  return frame.objects.reduce((total, object) => total + Math.max(.05, object.settings.drawDurationSec), 0)
}

export function frameDurationSec(frame: Pick<Frame, 'objects' | 'settings'>): number {
  return frameDrawDurationSec(frame) + Math.max(0, frame.settings.holdDurationSec)
}

export function syncFrameDuration<T extends Frame>(frame: T): T {
  return { ...frame, durationSec: frameDurationSec(frame) }
}

export function updateObjectSettings(frame: Frame, objectId: string, patch: Partial<ObjectSettings>): Frame {
  const objects = frame.objects.map((object) => object.objectId === objectId
    ? { ...object, settings: { ...object.settings, ...patch, objectId: object.objectId, blockId: object.blockId } }
    : object)
  return syncFrameDuration({ ...frame, objects })
}

function updateProjectFrame(project: Project, frameId: number, update: (frame: Frame) => Frame): Project {
  return { ...project, frames: project.frames.map((frame) => frame.id === frameId ? update(frame) : frame) }
}

export function setFrameHold(project: Project, frameId: number, holdDurationSec: number): Project {
  return updateProjectFrame(project, frameId, (frame) => syncFrameDuration({ ...frame, settings: { ...frame.settings, holdDurationSec: Math.max(0, holdDurationSec), mergeRadius: 0 } }))
}

export function setFrameCamera(project: Project, frameId: number, cameraPatch: Partial<Frame['settings']['camera']>): Project {
  return updateProjectFrame(project, frameId, (frame) => ({ ...frame, settings: { ...frame.settings, camera: { ...frame.settings.camera, ...cameraPatch }, mergeRadius: 0 } }))
}

export function setFramePageZoom(project: Project, frameId: number, pageZoomPatch: Partial<Frame['settings']['pageZoom']>): Project {
  return updateProjectFrame(project, frameId, (frame) => ({ ...frame, settings: { ...frame.settings, pageZoom: { ...frame.settings.pageZoom, ...pageZoomPatch }, mergeRadius: 0 } }))
}

export function setFrameTransition(project: Project, frameId: number, transitionPatch: Partial<Frame['transitionToNext']>): Project {
  return updateProjectFrame(project, frameId, (frame) => ({ ...frame, transitionToNext: { ...frame.transitionToNext, ...transitionPatch } }))
}

export function setObjectDuration(project: Project, frameId: number, objectId: string, seconds: number): Project {
  return updateProjectFrame(project, frameId, (frame) => updateObjectSettings(frame, objectId, { drawDurationSec: Math.max(.1, seconds) }))
}

export function setObjectOrder(project: Project, frameId: number, objectId: string, order: number): Project {
  return updateProjectFrame(project, frameId, (frame) => {
    const objects = [...frame.objects].sort((a, b) => a.settings.order - b.settings.order)
    const from = objects.findIndex((object) => object.objectId === objectId)
    if (from < 0) return frame
    const [moved] = objects.splice(from, 1)
    objects.splice(Math.max(0, Math.min(objects.length, order)), 0, moved)
    return { ...frame, objects: objects.map((object, index) => ({ ...object, settings: { ...object.settings, order: index } })) }
  })
}

export function objectDropInsertionIndex(objects: FrameObject[], fromObjectId: string, toObjectId: string, position: 'before' | 'after'): number | null {
  const ordered = [...objects].sort((a, b) => a.settings.order - b.settings.order)
  const sourceIndex = ordered.findIndex((object) => object.objectId === fromObjectId)
  const targetIndex = ordered.findIndex((object) => object.objectId === toObjectId)
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return null
  let insertionIndex = targetIndex + (position === 'after' ? 1 : 0)
  if (sourceIndex < insertionIndex) insertionIndex--
  return insertionIndex
}

export function setObjectEffect(project: Project, frameId: number, objectId: string, effectPatch: Partial<Pick<ObjectSettings, 'kindOverride' | 'strokeColorMode' | 'inkColor' | 'strokeWidth'>>): Project {
  return updateProjectFrame(project, frameId, (frame) => updateObjectSettings(frame, objectId, effectPatch))
}

export function setObjectPush(project: Project, frameId: number, objectId: string, pushPatch: Partial<ObjectSettings['pushEntry']>): Project {
  return updateProjectFrame(project, frameId, (frame) => {
    const object = frame.objects.find((candidate) => candidate.objectId === objectId)
    return object ? updateObjectSettings(frame, objectId, { pushEntry: { ...object.settings.pushEntry, ...pushPatch } }) : frame
  })
}

export function setObjectPinCamera(project: Project, frameId: number, objectId: string, pinned: boolean): Project {
  return updateProjectFrame(project, frameId, (frame) => updateObjectSettings(frame, objectId, { pinCamera: pinned }))
}

export function reorderFrameObjects(frame: Frame, fromObjectId: string, toObjectId: string): Frame {
  const objects = [...frame.objects].sort((a, b) => a.settings.order - b.settings.order)
  const from = objects.findIndex((object) => object.objectId === fromObjectId)
  const to = objects.findIndex((object) => object.objectId === toObjectId)
  if (from < 0 || to < 0 || from === to) return frame
  const [moved] = objects.splice(from, 1)
  objects.splice(to, 0, moved)
  return { ...frame, objects: objects.map((object, order) => ({ ...object, settings: { ...object.settings, order } })) }
}

export function retimeAnalysisForFrame(analysis: Analysis, frame: Pick<Frame, 'objects'>): Analysis {
  const ordered = [...frame.objects].sort((a, b) => a.settings.order - b.settings.order)
  const total = Math.max(.000001, frameDrawDurationSec(frame))
  let cursorSec = 0
  const units: DrawUnit[] = []
  for (const object of ordered) {
    const own = analysis.units.filter((unit) => unit.blockId === object.blockId)
    const duration = Math.max(.05, object.settings.drawDurationSec)
    const costTotal = own.reduce((sum, unit) => sum + Math.max(.000001, unit.cost), 0)
    let unitCursorSec = cursorSec
    own.forEach((unit, index) => {
      const slice = duration * Math.max(.000001, unit.cost) / Math.max(.000001, costTotal)
      const endSec = index === own.length - 1 ? cursorSec + duration : unitCursorSec + slice
      units.push({ ...unit, t0: unitCursorSec / total, t1: endSec / total })
      unitCursorSec = endSec
    })
    cursorSec += duration
  }
  const blockById = new Map(analysis.blocks.map((block) => [block.id, block]))
  const blocks = ordered.map((object) => blockById.get(object.blockId)).filter((block): block is Block => Boolean(block))
  return { ...analysis, blocks, units, stats: { ...analysis.stats, units: units.length, blocks: blocks.length } }
}
