import type { Block, DrawUnit, Rect } from '../wasm/wasmClient'
import type { FrameSettings } from '../state/settingsDefaults'
import { fitRect, unionRect, type CamKey } from './cameraGeometry'

export interface Page {
  blockIds: number[]
  rect: Rect
  t0: number
  t1: number
}

function blockTime(blockId: number, units: DrawUnit[]): { t0: number; t1: number } | null {
  const ownUnits = units.filter((unit) => unit.blockId === blockId)
  if (!ownUnits.length) return null
  return {
    t0: Math.min(...ownUnits.map((unit) => unit.t0)),
    t1: Math.max(...ownUnits.map((unit) => unit.t1)),
  }
}

export function buildPages(blocks: Block[], units: DrawUnit[], settings: FrameSettings): Page[] {
  const groups = settings.pageZoom.mode === 'manual' && settings.pageZoom.pageGroups.length
    ? settings.pageZoom.pageGroups
    : rowGroups(blocks)
  const pages: Page[] = []

  for (const ids of groups) {
    const selected = ids.map((id) => blocks.find((block) => block.id === id)).filter((block): block is Block => Boolean(block))
    const timed = ids.map((id) => ({ id, time: blockTime(id, units) })).filter((entry): entry is { id: number; time: { t0: number; t1: number } } => Boolean(entry.time))
    if (!selected.length || !timed.length) continue
    const rect = selected.slice(1).reduce((current, block) => unionRect(current, block.bbox), selected[0].bbox)
    pages.push({
      blockIds: timed.map((entry) => entry.id),
      rect,
      t0: Math.min(...timed.map((entry) => entry.time.t0)),
      t1: Math.max(...timed.map((entry) => entry.time.t1)),
    })
  }
  return pages.sort((a, b) => a.t0 - b.t0)
}

function rowGroups(blocks: Block[]): number[][] {
  const sorted = [...blocks].sort((a, b) => a.centroid.y - b.centroid.y || a.centroid.x - b.centroid.x)
  const groups: number[][] = []
  for (const block of sorted) {
    const row = groups.at(-1)
    const anchor = row?.length ? blocks.find((candidate) => candidate.id === row[0]) : undefined
    if (!row || !anchor || Math.abs(block.centroid.y - anchor.centroid.y) > Math.max(12, (block.bbox.h + anchor.bbox.h) * 0.45)) groups.push([block.id])
    else row.push(block.id)
  }
  return groups
}

export function buildPageZoomKeys(blocks: Block[], units: DrawUnit[], settings: FrameSettings, w: number, h: number, drawDurationSec = 1): CamKey[] {
  if (!settings.pageZoom.enabled) return []
  const pages = buildPages(blocks, units, settings)
  if (pages.length < 2) return []
  const aspect = w / h
  const out: CamKey[] = []
  for (let index = 0; index < pages.length - 1; index++) {
    const current = pages[index]
    const next = pages[index + 1]
    const half = settings.pageZoom.transitionSec / (2 * Math.max(0.001, drawDurationSec))
    const middle = Math.min(current.t1, next.t0)
    out.push(
      { t: Math.max(current.t0, middle - half), crop: fitRect(current.rect, aspect, settings.pageZoom.padding, w, h, settings.camera.zoomLevel), easing: 'easeInOutCubic', role: 'page' },
      { t: middle, crop: fitRect(unionRect(current.rect, next.rect), aspect, settings.pageZoom.padding, w, h, settings.camera.zoomLevel), easing: 'easeInOutCubic', role: 'page' },
      { t: Math.min(next.t1, middle + half), crop: fitRect(next.rect, aspect, settings.pageZoom.padding, w, h, settings.camera.zoomLevel), easing: 'easeInOutCubic', role: 'page' },
    )
  }
  return out
}
