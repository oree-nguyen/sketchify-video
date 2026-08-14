import { DEFAULT_SETTINGS } from './settingsDefaults'
import type { PushEdge } from './settingsDefaults'
import type { Analysis, Block, DrawUnit } from '../wasm/wasmClient'
import { buildPages } from '../camera/pageZoom'
import type { WordTimestamp } from '../tts/types'

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
  pushEntry: { enabled: boolean; edge: PushEdge; handStyle: PushHandStyle }
  zoomFollow: boolean
}

export type PushHandStyle = 'auto' | '1' | '2' | '3' | '4' | '5' | '6'

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
  narration?: FrameNarration
}

export interface FrameNarration {
  text: string
  voiceId: string
  speed: number
  wordTimestamps: WordTimestamp[]
  audioBuffer: AudioBuffer | null
  generatedAt: string
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

export interface SubtitleSettings {
  enabled: boolean
  xPct: number
  yPct: number
  fontFamily: string
  fontSizePx: number
  color: string
  bold: boolean
  italic: boolean
  underline: boolean
}

export const DEFAULT_SUBTITLE_SETTINGS: SubtitleSettings = {
  enabled: false,
  xPct: 0.5,
  yPct: 0.88,
  fontFamily: 'Oswald Sketchify',
  fontSizePx: 38,
  color: '#ffffff',
  bold: true,
  italic: false,
  underline: false,
}

export interface Project {
  frames: Frame[]
  activeFrameId: number | null
  handStyle: HandStyleId
  playhead: { globalTimeSec: number }
  audioClips: AudioClip[]
  subtitle: SubtitleSettings
}

export function createEmptyProject(): Project {
  return { frames: [], activeFrameId: null, handStyle: 'pencil', playhead: { globalTimeSec: 0 }, audioClips: [], subtitle: structuredClone(DEFAULT_SUBTITLE_SETTINGS) }
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
      pushEntry: { enabled: geometric.settings.pushEntry.enabled, edge: geometric.settings.pushEntry.edge, handStyle: geometric.settings.pushEntry.handStyle ?? 'auto' },
      zoomFollow: geometric.settings.zoomFollow ?? (geometric.settings as ObjectSettings & { pinCamera?: boolean }).pinCamera ?? true,
    } : {
      objectId,
      blockId: block.id,
      order: index,
      drawDurationSec: DEFAULT_OBJECT_DRAW_SEC,
      strokeColorMode: 'object',
      inkColor: '#111827',
      strokeWidth: 3,
      pushEntry: { enabled: false, edge: 'auto', handStyle: 'auto' },
      zoomFollow: true,
    }
    return { objectId, blockId: block.id, bbox: block.bbox, centroid: block.centroid, kind: block.kind, inkArea: block.inkArea, settings }
  })
  return matched.sort((a, b) => a.settings.order - b.settings.order).map((object, order) => ({ ...object, settings: { ...object.settings, order } }))
}

export function frameDrawDurationSec(frame: Pick<Frame, 'objects'>): number {
  return frame.objects.reduce((total, object) => total + Math.max(.05, object.settings.drawDurationSec), 0)
}

export function analysisPauseDurationSec(analysis: Pick<Analysis, 'units'> | null | undefined): number {
  return (analysis?.units.reduce((total, unit) => total + Math.max(0, unit.pauseAfterMs ?? 0), 0) ?? 0) / 1000
}

export function frameDurationSec(frame: Pick<Frame, 'objects' | 'settings'> & Partial<Pick<Frame, 'analysis'>>): number {
  const timed = frame.analysis && isAnalysis(frame.analysis) ? retimeAnalysisForFrame(frame.analysis, frame) : null
  return frameDrawDurationSec(frame) + analysisPauseDurationSec(timed) + Math.max(0, frame.settings.holdDurationSec)
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
  return updateProjectFrame(project, frameId, (frame) => syncFrameDuration({ ...frame, settings: { ...frame.settings, pageZoom: { ...frame.settings.pageZoom, ...pageZoomPatch }, mergeRadius: 0 } }))
}

export function setFramePauseSettings(project: Project, frameId: number, patch: Partial<Pick<Frame['settings'], 'microPauseMs' | 'groupPauseMs' | 'proximityThresholdPct'>>): Project {
  return updateProjectFrame(project, frameId, (frame) => syncFrameDuration({ ...frame, settings: { ...frame.settings, ...patch, mergeRadius: 0 } }))
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
    return syncFrameDuration({ ...frame, objects: objects.map((object, index) => ({ ...object, settings: { ...object.settings, order: index } })) })
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

export function setObjectZoomFollow(project: Project, frameId: number, objectId: string, enabled: boolean): Project {
  const frame = project.frames.find((candidate) => candidate.id === frameId)
  if (enabled && frame?.settings.cameraPinned) return project
  return updateProjectFrame(project, frameId, (frame) => updateObjectSettings(frame, objectId, { zoomFollow: enabled }))
}

export function setFrameCameraPinned(project: Project, frameId: number, enabled: boolean): Project {
  const frame = project.frames.find((candidate) => candidate.id === frameId)
  if (!frame || (enabled && frame.objects.some((object) => object.settings.zoomFollow))) return project
  return updateProjectFrame(project, frameId, (current) => ({ ...current, settings: { ...current.settings, cameraPinned: enabled } }))
}

export function mergeFrameObjects(frame: Frame, analysis: Analysis, objectIds: string[]): { frame: Frame; analysis: Analysis; objectId: string } | null {
  const selectedSet = new Set(objectIds)
  const selected = [...frame.objects].filter((object) => selectedSet.has(object.objectId)).sort((a, b) => a.settings.order - b.settings.order)
  if (selected.length < 2) return null
  const blockIds = new Set(selected.map((object) => object.blockId))
  const sourceBlocks = analysis.blocks.filter((block) => blockIds.has(block.id))
  if (sourceBlocks.length < 2) return null

  const x = Math.min(...sourceBlocks.map((block) => block.bbox.x))
  const y = Math.min(...sourceBlocks.map((block) => block.bbox.y))
  const right = Math.max(...sourceBlocks.map((block) => block.bbox.x + block.bbox.w))
  const bottom = Math.max(...sourceBlocks.map((block) => block.bbox.y + block.bbox.h))
  const inkArea = sourceBlocks.reduce((sum, block) => sum + block.inkArea, 0)
  const id = Math.min(...sourceBlocks.map((block) => block.id))
  const mergedBlock: Block = {
    ...sourceBlocks[0], id,
    bbox: { x, y, w: right - x, h: bottom - y }, x, y, width: right - x, height: bottom - y,
    centroid: {
      x: sourceBlocks.reduce((sum, block) => sum + block.centroid.x * block.inkArea, 0) / Math.max(1, inkArea),
      y: sourceBlocks.reduce((sum, block) => sum + block.centroid.y * block.inkArea, 0) / Math.max(1, inkArea),
    },
    inkArea, area: inkArea,
    pixels: sourceBlocks.flatMap((block) => block.pixels),
    kind: sourceBlocks.some((block) => block.kind === 'photo') ? 'photo' : 'vector',
  }
  const first = selected[0]
  const objectId = `group:${frame.id}:${[...blockIds].sort((a, b) => a - b).join('-')}`
  const grouped: FrameObject = {
    objectId, blockId: id, bbox: mergedBlock.bbox, centroid: mergedBlock.centroid,
    kind: mergedBlock.kind, inkArea,
    settings: {
      ...first.settings, objectId, blockId: id,
      order: Math.min(...selected.map((object) => object.settings.order)),
      drawDurationSec: selected.reduce((sum, object) => sum + object.settings.drawDurationSec, 0),
      zoomFollow: selected.some((object) => object.settings.zoomFollow),
      pushEntry: selected.find((object) => object.settings.pushEntry.enabled)?.settings.pushEntry ?? first.settings.pushEntry,
    },
  }
  const objects = [...frame.objects.filter((object) => !selectedSet.has(object.objectId)), grouped]
    .sort((a, b) => a.settings.order - b.settings.order)
    .map((object, order) => ({ ...object, settings: { ...object.settings, order } }))
  const blocks = [...analysis.blocks.filter((block) => !blockIds.has(block.id)), mergedBlock]
    .sort((a, b) => {
      const ao = objects.find((object) => object.blockId === a.id)?.settings.order ?? Number.MAX_SAFE_INTEGER
      const bo = objects.find((object) => object.blockId === b.id)?.settings.order ?? Number.MAX_SAFE_INTEGER
      return ao - bo
    })
  const units = analysis.units.map((unit) => blockIds.has(unit.blockId) ? { ...unit, blockId: id } : unit)
  const nextAnalysis: Analysis = { ...analysis, blocks, units, stats: { ...analysis.stats, blocks: blocks.length } }
  return {
    objectId,
    frame: syncFrameDuration({ ...frame, objects, analysis: nextAnalysis }),
    analysis: nextAnalysis,
  }
}

export function reorderFrameObjects(frame: Frame, fromObjectId: string, toObjectId: string): Frame {
  const objects = [...frame.objects].sort((a, b) => a.settings.order - b.settings.order)
  const from = objects.findIndex((object) => object.objectId === fromObjectId)
  const to = objects.findIndex((object) => object.objectId === toObjectId)
  if (from < 0 || to < 0 || from === to) return frame
  const [moved] = objects.splice(from, 1)
  objects.splice(to, 0, moved)
  return syncFrameDuration({ ...frame, objects: objects.map((object, order) => ({ ...object, settings: { ...object.settings, order } })) })
}

export function retimeAnalysisForFrame(analysis: Analysis, frame: Pick<Frame, 'objects' | 'settings'>): Analysis {
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
  const pageStarts = frame.settings.pageZoom.enabled
    ? new Set(buildPages(blocks, units, frame.settings).slice(1).map((page) => timeKey(page.t0)))
    : new Set<string>()
  const pausedUnits = units.map((unit, index) => {
    const next = units[index + 1]
    if (!next || next.blockId === unit.blockId) return { ...unit, pauseAfterMs: 0 }
    const forceGroupPause = pageStarts.has(timeKey(next.t0))
    const proximityRatio = bboxEdgeDistance(unit.bbox, next.bbox) / Math.max(1, unit.bbox.w, unit.bbox.h, next.bbox.w, next.bbox.h)
    const pauseAfterMs = forceGroupPause || proximityRatio > frame.settings.proximityThresholdPct / 100
      ? frame.settings.groupPauseMs
      : frame.settings.microPauseMs
    return { ...unit, pauseAfterMs }
  })
  return { ...analysis, blocks, units: pausedUnits, stats: { ...analysis.stats, units: pausedUnits.length, blocks: blocks.length } }
}

function bboxEdgeDistance(a: Block['bbox'], b: Block['bbox']): number {
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w))
  const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h))
  return Math.hypot(dx, dy)
}

function timeKey(value: number): string { return value.toFixed(9) }

function isAnalysis(value: unknown): value is Analysis {
  return Boolean(value && typeof value === 'object' && Array.isArray((value as Analysis).units) && Array.isArray((value as Analysis).blocks))
}
