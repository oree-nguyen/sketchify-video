import { HAND_ASSETS } from '../assets/hands/registry'
import { analysisPauseDurationSec, frameDrawDurationSec, retimeAnalysisForFrame, type Frame, type Project } from '../state/projectStore'
import { buildProjectTimeline } from '../timeline/projectTimeline'
import type { Analysis } from '../wasm/wasmClient'
import { Player } from './Player'
import { buildSubtitleCues } from '../subtitles/subtitleTimeline'
import { drawSubtitleOverlay } from './subtitleRenderer'

export interface ProjectPlayResult {
  elapsedMs: number
  blob?: Blob
}

export class ProjectPlayer {
  private stopped = false
  private currentPlayer: Player | null = null

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly project: Project,
    private readonly analyses: Readonly<Record<number, Analysis>>,
    private readonly onCanvasReady?: () => void,
  ) {}

  stop(): void {
    this.stopped = true
    this.currentPlayer?.stop()
  }

  async play(record: boolean, onProgress?: (globalTimeSec: number) => void): Promise<ProjectPlayResult> {
    const timeline = buildProjectTimeline(this.project)
    const missing = this.project.frames.filter((frame) => !this.analyses[frame.id])
    if (missing.length) throw new Error(`Chưa phân tích xong Frame: ${missing.map((frame) => frame.name).join(', ')}`)
    if (!timeline.segments.length) return { elapsedMs: 0 }

    const requestedStartId = record ? this.project.frames[0]?.id : this.project.activeFrameId
    const startFrameIndex = Math.max(0, this.project.frames.findIndex((frame) => frame.id === requestedStartId))
    const firstSegment = timeline.segments[startFrameIndex] ?? timeline.segments[0]
    const audio = await ProjectAudioSession.create(this.project, record, firstSegment.startSec)
    const firstAnalysis = this.analyses[this.project.frames[firstSegment.frameIndex].id]
    if (record && firstAnalysis) {
      this.canvas.width = firstAnalysis.img.w
      this.canvas.height = firstAnalysis.img.h
      const context = this.canvas.getContext('2d', { willReadFrequently: true })
      if (context) { context.fillStyle = `rgb(${firstAnalysis.img.bg.join(',')})`; context.fillRect(0, 0, this.canvas.width, this.canvas.height) }
    }
    const recorder = record ? makeRecorder(this.canvas, this.project.frames[0].settings.fps, audio?.captureStream) : undefined
    const chunks: BlobPart[] = []
    if (record && !recorder) throw new Error('Trình duyệt không hỗ trợ MediaRecorder')
    if (recorder) {
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
      recorder.start(100)
    }
    audio?.start()

    const startedAt = performance.now()
    onProgress?.(firstSegment.startSec)
    for (const segment of timeline.segments.slice(startFrameIndex)) {
      if (this.stopped) break
      const frame = this.project.frames[segment.frameIndex]
      // Preview starts cleanly at the selected frame; an incoming transition
      // belongs to the previous frame and must not pull preview back to it.
      const previousHalf = segment.frameIndex === startFrameIndex ? 0 : previousTransitionHalf(this.project.frames, segment.frameIndex)
      const nextHalf = nextTransitionHalf(this.project.frames, segment.frameIndex)
      const playableDuration = Math.max(0.001, segment.durationSec - previousHalf - nextHalf)
      const naturalDrawDuration = frameDrawDurationSec(frame)
      const timedAnalysis = retimeAnalysisForFrame(this.analyses[frame.id], frame)
      const pauseDuration = analysisPauseDurationSec(timedAnalysis)
      const drawDuration = Math.min(naturalDrawDuration, Math.max(0.001, playableDuration - pauseDuration))
      const holdDuration = Math.max(0, playableDuration - drawDuration - pauseDuration)
      const globalStart = segment.startSec + previousHalf
      const subtitleCues = frame.narration?.audioBuffer
        ? buildSubtitleCues(frame.narration.text, frame.narration.audioBuffer.duration, frame.narration.wordTimestamps)
        : []

      const player = new Player(this.canvas, {
        sourceUrl: frame.sourceUrl,
        drawDurationSec: drawDuration,
        holdDurationSec: holdDuration,
        fps: frame.settings.fps,
        analysis: timedAnalysis,
        hand: HAND_ASSETS[this.project.handStyle],
        settings: { ...frame.settings, holdDurationSec: holdDuration },
        zoomBlockIds: frame.objects.filter((object) => object.settings.zoomFollow).map((object) => object.blockId),
        objectSettingsByBlockId: Object.fromEntries(frame.objects.map((object) => [object.blockId, object.settings])),
        subtitle: { settings: this.project.subtitle, track: { cues: subtitleCues, timeOffsetSec: previousHalf } },
        onCanvasReady: this.onCanvasReady,
      })
      this.currentPlayer = player
      await player.play(false, (localTimeSec) => onProgress?.(Math.min(timeline.totalDurationSec, globalStart + localTimeSec)))
      this.currentPlayer = null

      const nextFrame = this.project.frames[segment.frameIndex + 1]
      if (nextFrame && segment.transition !== 'none' && segment.transitionStartSec !== undefined && segment.transitionEndSec !== undefined) {
        await renderTransition(
          this.canvas,
          frame,
          nextFrame,
          segment.transitionStartSec,
          segment.transitionEndSec,
          onProgress,
          () => this.stopped,
          this.project,
          timeline,
        )
      }
    }

    const finalTime = this.stopped
      ? Math.min(timeline.totalDurationSec, firstSegment.startSec + (performance.now() - startedAt) / 1000)
      : timeline.totalDurationSec
    onProgress?.(finalTime)
    if (!recorder) {
      audio?.stop()
      return { elapsedMs: finalTime * 1000 }
    }
    // Giữ track AudioContext sống cho tới sau khi MediaRecorder phát dataavailable cuối.
    // Đóng audio sớm có thể khiến Chromium trả một WebM rỗng dù animation đã chạy xong.
    await stopRecorder(recorder)
    audio?.stop()
    return { elapsedMs: finalTime * 1000, blob: new Blob(chunks, { type: recorder.mimeType || 'video/webm' }) }
  }
}

function previousTransitionHalf(frames: Frame[], frameIndex: number): number {
  if (frameIndex === 0) return 0
  const previous = frames[frameIndex - 1]
  return previous.transitionToNext.type === 'none' ? 0 : previous.transitionToNext.durationSec / 2
}

function nextTransitionHalf(frames: Frame[], frameIndex: number): number {
  const frame = frames[frameIndex]
  return frames[frameIndex + 1] && frame.transitionToNext.type !== 'none' ? frame.transitionToNext.durationSec / 2 : 0
}

async function renderTransition(
  canvas: HTMLCanvasElement,
  current: Frame,
  next: Frame,
  startSec: number,
  endSec: number,
  onProgress: ((globalTimeSec: number) => void) | undefined,
  isStopped: () => boolean,
  project: Project,
  timeline: ReturnType<typeof buildProjectTimeline>,
): Promise<void> {
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Không tạo được Canvas2D cho transition')
  const snapshot = document.createElement('canvas')
  snapshot.width = canvas.width
  snapshot.height = canvas.height
  snapshot.getContext('2d')!.drawImage(canvas, 0, 0)
  const nextImage = await loadImage(next.sourceUrl)
  const durationMs = Math.max(1, (endSec - startSec) * 1000)
  const startedAt = performance.now()

  await new Promise<void>((resolve) => {
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / durationMs)
      onProgress?.(startSec + progress * (endSec - startSec))
      drawTransitionFrame(context, canvas, snapshot, nextImage, current.transitionToNext.type, progress)
      drawProjectSubtitleAt(context, project, timeline, startSec + progress * (endSec - startSec))
      if (!isStopped() && progress < 1) requestAnimationFrame(tick)
      else resolve()
    }
    requestAnimationFrame(tick)
  })
}

function drawProjectSubtitleAt(context: CanvasRenderingContext2D, project: Project, timeline: ReturnType<typeof buildProjectTimeline>, globalTimeSec: number): void {
  if (!project.subtitle.enabled) return
  const segment = [...timeline.segments].reverse().find((candidate) => globalTimeSec >= candidate.startSec)
  if (!segment) return
  const frame = project.frames[segment.frameIndex]
  const narration = frame.narration
  if (!narration?.audioBuffer) return
  const cues = buildSubtitleCues(narration.text, narration.audioBuffer.duration, narration.wordTimestamps)
  drawSubtitleOverlay(context, project.subtitle, { cues }, globalTimeSec - segment.startSec)
}

function drawTransitionFrame(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  current: HTMLCanvasElement,
  next: HTMLImageElement,
  type: Frame['transitionToNext']['type'],
  progress: number,
): void {
  context.save()
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.drawImage(current, 0, 0, canvas.width, canvas.height)
  if (type === 'paper-airplane') {
    context.globalAlpha = Math.min(1, progress + 0.15)
    context.beginPath()
    context.moveTo(0, 0)
    context.lineTo(canvas.width * progress, canvas.height * 0.5)
    context.lineTo(0, canvas.height)
    context.closePath()
    context.clip()
    context.drawImage(next, 0, 0, canvas.width, canvas.height)
  } else if (type === 'paper-fold') {
    context.beginPath()
    context.moveTo(0, 0)
    context.lineTo(canvas.width, 0)
    context.lineTo(canvas.width * progress, canvas.height)
    context.lineTo(0, canvas.height)
    context.closePath()
    context.clip()
    context.drawImage(next, 0, 0, canvas.width, canvas.height)
  } else {
    // zoom-morph dùng cùng nhịp zoom-out/zoom-in ba pha, đồng thời cross-fade hai texture.
    const scale = progress < 0.5 ? 1 - progress * 0.12 : 0.94 + (progress - 0.5) * 0.12
    context.globalAlpha = progress
    const width = canvas.width * scale
    const height = canvas.height * scale
    context.drawImage(next, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height)
  }
  context.restore()
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Không tải được ảnh Frame kế tiếp'))
    image.src = source
  })
}

function makeRecorder(canvas: HTMLCanvasElement, fps: number, audioStream?: MediaStream): MediaRecorder | undefined {
  if (!('MediaRecorder' in window)) return undefined
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', ''].find((type) => !type || MediaRecorder.isTypeSupported(type)) ?? ''
  const videoStream = canvas.captureStream(fps)
  const stream = audioStream ? new MediaStream(recordingTracks(videoStream, audioStream)) : videoStream
  return new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
}

export function recordingTracks(videoStream: Pick<MediaStream, 'getVideoTracks'>, audioStream: Pick<MediaStream, 'getAudioTracks'>): MediaStreamTrack[] {
  return [...videoStream.getVideoTracks(), ...audioStream.getAudioTracks()]
}

function stopRecorder(recorder: MediaRecorder): Promise<void> {
  return new Promise((resolve) => {
    recorder.onstop = () => resolve()
    if (recorder.state === 'recording') recorder.requestData()
    recorder.stop()
  })
}

class ProjectAudioSession {
  private readonly sources: Array<{ source: AudioBufferSourceNode; startSec: number }> = []
  readonly captureStream?: MediaStream

  private constructor(private readonly context: AudioContext, destination?: MediaStreamAudioDestinationNode) {
    this.captureStream = destination?.stream
  }

  static async create(project: Project, capture: boolean, playbackStartSec = 0): Promise<ProjectAudioSession | null> {
    if (!project.audioClips.length && !project.frames.some((frame) => frame.narration?.audioBuffer)) return null
    const context = new AudioContext()
    const captureDestination = capture ? context.createMediaStreamDestination() : undefined
    const session = new ProjectAudioSession(context, captureDestination)
    const timeline = buildProjectTimeline(project)
    try {
      for (const clip of project.audioClips) {
        const response = await fetch(clip.sourceUrl)
        const buffer = await context.decodeAudioData(await response.arrayBuffer())
        const source = context.createBufferSource()
        source.buffer = buffer
        source.connect(context.destination)
        if (captureDestination) source.connect(captureDestination)
        const startSec = timeline.segments.find((segment) => segment.frameId === clip.frameId)?.startSec ?? clip.startSec
        session.sources.push({ source, startSec: Math.max(0, startSec - playbackStartSec) })
      }
      for (const frame of project.frames) {
        const buffer = frame.narration?.audioBuffer
        if (!buffer || project.audioClips.some((clip) => clip.frameId === frame.id)) continue
        const source = context.createBufferSource()
        source.buffer = buffer
        source.connect(context.destination)
        if (captureDestination) source.connect(captureDestination)
        const startSec = timeline.segments.find((segment) => segment.frameId === frame.id)?.startSec ?? 0
        if (startSec + buffer.duration >= playbackStartSec) session.sources.push({ source, startSec: Math.max(0, startSec - playbackStartSec) })
      }
      return session
    } catch (error) {
      await context.close()
      throw new Error(`Không thể chuẩn bị track giọng đọc: ${error instanceof Error ? error.message : 'lỗi audio'}`)
    }
  }

  start(): void {
    void this.context.resume()
    const origin = this.context.currentTime + .04
    for (const item of this.sources) item.source.start(origin + Math.max(0, item.startSec))
  }

  stop(): void {
    for (const item of this.sources) { try { item.source.stop() } catch { /* nguồn đã tự kết thúc */ } }
    void this.context.close()
  }
}
