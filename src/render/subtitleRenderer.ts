import type { SubtitleSettings } from '../state/projectStore'
import { subtitleCueAt, type SubtitleCue } from '../subtitles/subtitleTimeline'

export interface SubtitleTrack {
  cues: SubtitleCue[]
  timeOffsetSec?: number
}

export function drawSubtitleOverlay(
  context: CanvasRenderingContext2D,
  settings: SubtitleSettings,
  track: SubtitleTrack | undefined,
  elapsedSec: number,
): void {
  if (!settings.enabled || !track) return
  const cue = subtitleCueAt(track.cues, elapsedSec + (track.timeOffsetSec ?? 0))
  if (!cue) return
  const width = context.canvas.width
  const height = context.canvas.height
  const scale = width / 960
  const fontSize = Math.max(14, settings.fontSizePx * scale)
  const maxWidth = width * 0.8
  context.save()
  context.font = `${settings.italic ? 'italic ' : ''}${settings.bold ? '700' : '400'} ${fontSize}px "${settings.fontFamily}", sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.lineJoin = 'round'
  const lines = wrapSubtitleLines(context, cue.text, maxWidth)
  const lineHeight = fontSize * 1.22
  const renderedWidth = Math.min(maxWidth, Math.max(...lines.map((line) => context.measureText(line).width), 0))
  const centerX = Math.max(renderedWidth / 2, Math.min(width - renderedWidth / 2, settings.xPct * width))
  const halfBlock = (lines.length - 1) * lineHeight / 2
  const centerY = Math.max(halfBlock + fontSize / 2, Math.min(height - halfBlock - fontSize / 2, settings.yPct * height))
  lines.forEach((line, index) => {
    const y = centerY - halfBlock + index * lineHeight
    context.strokeStyle = 'rgba(0,0,0,.82)'
    context.lineWidth = Math.max(3, fontSize * 0.13)
    context.strokeText(line, centerX, y, maxWidth)
    context.fillStyle = settings.color
    context.fillText(line, centerX, y, maxWidth)
    if (settings.underline) {
      const measured = Math.min(maxWidth, context.measureText(line).width)
      context.strokeStyle = settings.color
      context.lineWidth = Math.max(1.5, fontSize * 0.055)
      context.beginPath()
      context.moveTo(centerX - measured / 2, y + fontSize * 0.58)
      context.lineTo(centerX + measured / 2, y + fontSize * 0.58)
      context.stroke()
    }
  })
  context.restore()
}

export function wrapSubtitleLines(context: Pick<CanvasRenderingContext2D, 'measureText'>, text: string, maxWidth: number): string[] {
  const words = text.trim().split(/\s+/u).filter(Boolean)
  if (!words.length) return []
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (context.measureText(candidate).width <= maxWidth) { line = candidate; continue }
    if (line) lines.push(line)
    if (context.measureText(word).width <= maxWidth) { line = word; continue }
    let fragment = ''
    for (const character of Array.from(word)) {
      const next = fragment + character
      if (fragment && context.measureText(next).width > maxWidth) { lines.push(fragment); fragment = character }
      else fragment = next
    }
    line = fragment
  }
  if (line) lines.push(line)
  return lines
}
