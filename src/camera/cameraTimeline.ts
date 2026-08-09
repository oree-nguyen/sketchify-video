import type { Block, DrawUnit, Rect } from '../wasm/wasmClient'
import type { FrameSettings } from '../state/settingsDefaults'
import { buildPageZoomKeys } from './pageZoom'
import { fitRect, fullFrame, rectIou, unionRect, type CamKey } from './cameraGeometry'

export { fitRect, type CamKey } from './cameraGeometry'

export interface BlockFocusSpan {
  blockId: number
  t0: number
  t1: number
  firstUnitIndex: number
  crop: Rect
}

export interface CameraTimeline {
  keys: CamKey[]
  focusSpans: BlockFocusSpan[]
  fellBack: boolean
  reason?: string
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))

// Lịch focus phải xuất phát từ DrawUnit thật. Không gán t=0 giả cho block không có unit.
export function buildBlockFocusSpans(
  blocks: Block[],
  units: DrawUnit[],
  settings: FrameSettings,
  frameW: number,
  frameH: number,
): BlockFocusSpan[] {
  const blockById = new Map(blocks.map((block) => [block.id, block]))
  const spanById = new Map<number, Omit<BlockFocusSpan, 'crop'>>()

  units.forEach((unit, unitIndex) => {
    if (!blockById.has(unit.blockId) || !Number.isFinite(unit.t0) || !Number.isFinite(unit.t1)) return
    const t0 = clamp01(Math.min(unit.t0, unit.t1))
    const t1 = clamp01(Math.max(unit.t0, unit.t1))
    const current = spanById.get(unit.blockId)
    if (current) {
      current.t0 = Math.min(current.t0, t0)
      current.t1 = Math.max(current.t1, t1)
      current.firstUnitIndex = Math.min(current.firstUnitIndex, unitIndex)
    } else {
      spanById.set(unit.blockId, { blockId: unit.blockId, t0, t1, firstUnitIndex: unitIndex })
    }
  })

  const aspect = frameW / frameH
  return [...spanById.values()]
    .sort((a, b) => a.t0 - b.t0 || a.firstUnitIndex - b.firstUnitIndex)
    .map((span) => ({
      ...span,
      crop: fitRect(
        blockById.get(span.blockId)!.bbox,
        aspect,
        settings.camera.zoomPadding,
        frameW,
        frameH,
        settings.camera.zoomLevel,
      ),
    }))
}

function keyPriority(key: CamKey): number {
  if (key.role === 'full' && key.t >= 1) return 6
  if (key.role === 'pin') return 5
  if (key.role === 'page') return 4
  if (key.role === 'focus' || key.role === 'manual') return 3
  if (key.role === 'zoom-out') return 2
  if (key.role === 'full') return 1
  return 0
}

function sortAndResolveSameTime(keys: CamKey[]): CamKey[] {
  const sorted = keys
    .map((key, index) => ({ key: { ...key, t: clamp01(key.t) }, index }))
    .sort((a, b) => a.key.t - b.key.t || a.index - b.index)
  const out: CamKey[] = []
  for (const { key } of sorted) {
    const previous = out.at(-1)
    if (previous && Math.abs(previous.t - key.t) < 1e-7) {
      if (keyPriority(key) >= keyPriority(previous)) out[out.length - 1] = key
      continue
    }
    out.push(key)
  }
  return out
}

function mergeRedundantAndBridge(keys: CamKey[], aspect: number, frameW: number, frameH: number, maxZoom: number): CamKey[] {
  const out: CamKey[] = []
  for (const key of sortAndResolveSameTime(keys)) {
    const previous = out.at(-1)
    if (previous && rectIou(previous.crop, key.crop) > 0.8) continue
    if (previous && rectIou(previous.crop, key.crop) < 0.25) {
      out.push({
        t: (previous.t + key.t) / 2,
        crop: fitRect(unionRect(previous.crop, key.crop), aspect, 0, frameW, frameH, maxZoom),
        easing: 'easeInOutCubic',
        role: 'bridge',
      })
    }
    out.push(key)
  }
  return out
}

// Nếu pan/zoom nhanh hơn §11.1, đẩy key sau ra xa thay vì cắt biên độ crop.
function limitCameraSpeed(keys: CamKey[], durationSec: number, frameW: number): CamKey[] {
  if (keys.length < 2) return keys
  const out: CamKey[] = [{ ...keys[0] }]
  for (let index = 1; index < keys.length; index++) {
    const previous = out[index - 1]
    const key = { ...keys[index] }
    const previousCenterX = previous.crop.x + previous.crop.w / 2
    const previousCenterY = previous.crop.y + previous.crop.h / 2
    const centerX = key.crop.x + key.crop.w / 2
    const centerY = key.crop.y + key.crop.h / 2
    const panDistance = Math.hypot(centerX - previousCenterX, centerY - previousCenterY)
    const panSeconds = panDistance / Math.max(1, frameW * 0.6)
    const zoomRatio = Math.max(previous.crop.w / key.crop.w, key.crop.w / previous.crop.w)
    const zoomSeconds = zoomRatio > 1 ? Math.log(zoomRatio) / Math.log(2.2) : 0
    const minimumDelta = Math.max(panSeconds, zoomSeconds) / Math.max(0.001, durationSec)
    key.t = clamp01(Math.max(key.t, previous.t + minimumDelta))
    out.push(key)
  }
  return sortAndResolveSameTime(out)
}

function autoFollowKeys(spans: BlockFocusSpan[], all: Rect, zoomOutPortion: number): CamKey[] {
  if (!spans.length) return [{ t: 0, crop: all, easing: 'linear', role: 'full' }, { t: 1, crop: all, easing: 'linear', role: 'full' }]
  const keys: CamKey[] = spans.map((span, index) => ({
    t: index === 0 ? 0 : span.t0,
    crop: span.crop,
    easing: index === 0 ? 'linear' : 'easeInOutCubic',
    role: 'focus',
    blockId: span.blockId,
  }))
  keys.push(
    { t: 1 - zoomOutPortion, crop: all, easing: 'easeInOutCubic', role: 'zoom-out' },
    { t: 1, crop: all, easing: 'linear', role: 'full' },
  )
  return keys
}

export function buildCameraTimeline(
  settings: FrameSettings,
  blocks: Block[],
  units: DrawUnit[],
  frameW: number,
  frameH: number,
  pinnedBlockIds: number[] = [],
): CameraTimeline {
  const aspect = frameW / frameH
  const all = fullFrame(frameW, frameH)
  const focusSpans = buildBlockFocusSpans(blocks, units, settings, frameW, frameH)
  const spanById = new Map(focusSpans.map((span) => [span.blockId, span]))
  let mode = settings.camera.mode
  let fellBack = false
  let reason: string | undefined

  if (mode === 'D-hybrid') {
    if (blocks.length > settings.camera.maxBlocksForAutoFollow) {
      mode = 'C-two-stage'
      fellBack = true
      reason = `Ảnh có ${blocks.length} khối (>${settings.camera.maxBlocksForAutoFollow}) nên camera chuyển sang chế độ zoom đơn giản để video không bị giật.`
    } else mode = 'A-auto-follow'
  }

  let keys: CamKey[]
  if (mode === 'off') {
    keys = [{ t: 0, crop: all, easing: 'linear', role: 'full' }, { t: 1, crop: all, easing: 'linear', role: 'full' }]
  } else if (mode === 'C-two-stage' || !focusSpans.length) {
    keys = [
      { t: 0, crop: focusSpans[0]?.crop ?? all, easing: 'linear', role: focusSpans[0] ? 'focus' : 'full', blockId: focusSpans[0]?.blockId },
      { t: 1 - settings.camera.zoomOutPortion, crop: all, easing: 'easeInOutCubic', role: 'zoom-out' },
      { t: 1, crop: all, easing: 'linear', role: 'full' },
    ]
  } else if (mode === 'B-manual-keyframe') {
    keys = focusSpans.map((span, index) => ({
      t: index === 0 ? 0 : span.t0,
      crop: (() => {
        const manual = settings.camera.manualKeyframes.find((key) => key.blockId === span.blockId)?.crop
        return manual ? fitRect(manual, aspect, 0, frameW, frameH, settings.camera.zoomLevel) : span.crop
      })(),
      easing: index === 0 ? 'linear' : 'easeInOutCubic',
      role: 'manual',
      blockId: span.blockId,
    }))
    keys.push({ t: 1, crop: all, easing: 'easeInOutCubic', role: 'full' })
  } else {
    keys = autoFollowKeys(focusSpans, all, settings.camera.zoomOutPortion)
  }

  keys.push(...buildPageZoomKeys(blocks, units, settings, frameW, frameH))
  for (const blockId of pinnedBlockIds) {
    const span = spanById.get(blockId)
    if (span) keys.push({ t: span.t0, crop: span.crop, easing: 'easeInOutCubic', role: 'pin', blockId })
  }

  keys = mergeRedundantAndBridge(keys, aspect, frameW, frameH, settings.camera.zoomLevel)
  keys = limitCameraSpeed(keys, settings.drawDurationSec, frameW)
  return { keys, focusSpans, fellBack, reason }
}

export function cameraAt(keys: CamKey[], t: number): Rect {
  if (!keys.length) return { x: 0, y: 0, w: 1, h: 1 }
  if (keys.length === 1 || t <= keys[0].t) return { ...keys[0].crop }
  const last = keys.at(-1)!
  if (t >= last.t) return { ...last.crop }

  let left = 0
  let right = keys.length - 1
  while (left + 1 < right) {
    const middle = Math.floor((left + right) / 2)
    if (t <= keys[middle].t) right = middle
    else left = middle
  }
  const previous = keys[left]
  const next = keys[right]
  let progress = clamp01((t - previous.t) / Math.max(0.000001, next.t - previous.t))
  if (next.easing === 'easeInOutCubic') progress = progress < 0.5 ? 4 * progress ** 3 : 1 - ((-2 * progress + 2) ** 3) / 2
  return {
    x: previous.crop.x + (next.crop.x - previous.crop.x) * progress,
    y: previous.crop.y + (next.crop.y - previous.crop.y) * progress,
    w: previous.crop.w + (next.crop.w - previous.crop.w) * progress,
    h: previous.crop.h + (next.crop.h - previous.crop.h) * progress,
  }
}

// Helper kiểm thử hợp đồng keyMid: mỗi ranh giới chỉ union đúng hai trang kề nhau.
export function injectPageTransitions(keys: CamKey[], pages: Rect[], starts: number[], aspect: number, w: number, h: number, maxZoom: number): CamKey[] {
  const out = [...keys]
  for (let index = 0; index < pages.length - 1; index++) {
    out.push({ t: starts[index + 1], crop: fitRect(unionRect(pages[index], pages[index + 1]), aspect, 0, w, h, maxZoom), easing: 'easeInOutCubic', role: 'page' })
  }
  return out.sort((a, b) => a.t - b.t)
}
