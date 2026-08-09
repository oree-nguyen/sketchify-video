import type { Rect } from '../wasm/wasmClient'

export type CameraEasing = 'linear' | 'easeInOutCubic'
export type CameraKeyRole = 'full' | 'focus' | 'manual' | 'pin' | 'bridge' | 'page' | 'zoom-out'

export interface CamKey {
  t: number
  crop: Rect
  easing: CameraEasing
  role?: CameraKeyRole
  blockId?: number
}

export const fullFrame = (width: number, height: number): Rect => ({ x: 0, y: 0, w: width, h: height })

export function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  const right = Math.max(a.x + a.w, b.x + b.w)
  const bottom = Math.max(a.y + a.h, b.y + b.h)
  return { x, y, w: right - x, h: bottom - y }
}

export function rectIou(a: Rect, b: Rect): number {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.w, b.x + b.w)
  const bottom = Math.min(a.y + a.h, b.y + b.h)
  const intersection = Math.max(0, right - x) * Math.max(0, bottom - y)
  return intersection / (a.w * a.h + b.w * b.h - intersection || 1)
}

// fitRect chỉ mở rộng bbox để giữ đúng tỉ lệ display; tuyệt đối không cắt nội dung.
export function fitRect(box: Rect, aspect: number, paddingPct: number, frameW: number, frameH: number, maxZoom: number): Rect {
  let width = Math.max(1, box.w * (1 + paddingPct * 2))
  let height = Math.max(1, box.h * (1 + paddingPct * 2))
  const centerX = box.x + box.w / 2
  const centerY = box.y + box.h / 2

  if (width / height < aspect) width = height * aspect
  else height = width / aspect

  const minWidth = frameW / Math.max(1, maxZoom)
  if (width < minWidth) {
    width = minWidth
    height = width / aspect
  }
  if (width > frameW || height > frameH) return fullFrame(frameW, frameH)

  return {
    x: Math.max(0, Math.min(frameW - width, centerX - width / 2)),
    y: Math.max(0, Math.min(frameH - height, centerY - height / 2)),
    w: width,
    h: height,
  }
}
