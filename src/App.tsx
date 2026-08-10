import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type DragEvent, type PointerEvent } from 'react'
import { fitRect } from './camera/cameraTimeline'
import { EditPanel, HandPanel } from './components/EditorControls'
import { FramePanel, HorizontalTimeline } from './components/FrameTimeline'
import { ProjectPlayer } from './render/ProjectPlayer'
import { createFrame, reconcileFrameObjects, setFrameCamera, setFrameHold, setFramePageZoom, setFrameTransition, setObjectDuration, setObjectEffect, setObjectOrder, setObjectPinCamera, setObjectPush, syncFrameDuration, type Frame, type ObjectSettings, type Project } from './state/projectStore'
import type { FrameSettings } from './state/settingsDefaults'
import { buildProjectTimeline } from './timeline/projectTimeline'
import { analyzeImage, type Analysis } from './wasm/wasmClient'

export default function App() {
  const [project, setProject] = useState<Project>({ frames: [], activeFrameId: null, handStyle: 'pencil', playhead: { globalTimeSec: 0 } })
  const [analyses, setAnalyses] = useState<Record<number, Analysis>>({})
  const [analysisStatus, setAnalysisStatus] = useState<'idle' | 'working' | 'error'>('idle')
  const [isPlaying, setIsPlaying] = useState(false)
  const [horizontal, setHorizontal] = useState(false)
  const [panel, setPanel] = useState<'hand' | 'edit'>('hand')
  const [editScope, setEditScope] = useState<'object' | 'frame'>('object')
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [showRender, setShowRender] = useState(false)
  const [showInkMask, setShowInkMask] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const playerRef = useRef<{ stop(): void } | null>(null)

  const active = project.frames.find((frame) => frame.id === project.activeFrameId) ?? null
  const analysis = active ? analyses[active.id] ?? null : null
  const timeline = useMemo(() => buildProjectTimeline(project), [project.frames])
  const total = timeline.totalDurationSec
  const progress = project.playhead.globalTimeSec
  const rangeProgress = total ? progress / total * 100 : 0
  const supported = 'MediaRecorder' in window

  const setProgress = (globalTimeSec: number) => setProject((current) => {
    const currentTimeline = buildProjectTimeline(current)
    const time = Math.max(0, Math.min(currentTimeline.totalDurationSec, globalTimeSec))
    const segment = [...currentTimeline.segments].reverse().find((item) => time >= item.startSec)
    return { ...current, activeFrameId: segment?.frameId ?? current.activeFrameId, playhead: { globalTimeSec: time } }
  })

  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl) }, [videoUrl])
  useEffect(() => {
    const snapshot = {
      activeFrameId: project.activeFrameId,
      handStyle: project.handStyle,
      frames: project.frames.map(({ analysis: _analysis, sourceUrl: _sourceUrl, ...frame }) => frame),
    }
    localStorage.setItem('sketchify-video-project', JSON.stringify(snapshot))
  }, [project.frames, project.activeFrameId, project.handStyle])

  const inspect = async (frameId: number, url: string, settings: FrameSettings): Promise<Analysis | null> => {
    setAnalysisStatus('working')
    try {
      console.log('[Sketchify] analyzeFrame start', { frameId })
      const image = new Image(); image.src = url; await image.decode()
      const scale = Math.min(1, settings.workingWidth / image.naturalWidth)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale)
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) throw new Error('Không tạo được Canvas2D')
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      const rgba = new Uint8Array(context.getImageData(0, 0, canvas.width, canvas.height).data)
      const result = await analyzeImage(rgba, canvas.width, canvas.height, { ...settings, mergeRadius: 0 } as unknown as Record<string, number>)
      setAnalyses((current) => ({ ...current, [frameId]: result }))
      setProject((current) => ({
        ...current,
        frames: current.frames.map((frame) => frame.id === frameId
          ? syncFrameDuration({ ...frame, objects: reconcileFrameObjects(frame.id, result.blocks, frame.objects), analysis: result, dirty: false })
          : frame),
      }))
      setAnalysisStatus('idle')
      return result
    } catch (error) {
      console.error('[Sketchify] analyzeFrame failed', error)
      setAnalysisStatus('error')
      return null
    }
  }

  const addFile = (file?: File) => {
    if (!file?.type.startsWith('image/')) return
    const id = Date.now(), frame = createFrame(file, id)
    setShowRender(false); setSelectedObjectId(null); setEditScope('object'); setPanel('edit')
    setProject((current) => ({ ...current, frames: [...current.frames, frame], activeFrameId: id }))
  }

  const selectFrame = (id: number) => {
    const chosen = project.frames.find((frame) => frame.id === id)
    setShowRender(false); setShowInkMask(false); setSelectedObjectId(chosen?.objects[0]?.objectId ?? null); setEditScope('object'); setPanel('edit')
    setProject((current) => ({ ...current, activeFrameId: id }))
  }

  useEffect(() => {
    const reorder = (event: Event) => {
      const { from, to } = (event as CustomEvent<{ from: number; to: number }>).detail
      setProject((current) => {
        const frames = [...current.frames], item = frames.splice(from, 1)[0]
        frames.splice(to, 0, item)
        return { ...current, frames }
      })
    }
    window.addEventListener('sketchify-reorder', reorder)
    return () => window.removeEventListener('sketchify-reorder', reorder)
  }, [])

  useEffect(() => {
    if (!active?.dirty) return
    const timeout = window.setTimeout(() => void inspect(active.id, active.sourceUrl, active.settings), 120)
    return () => window.clearTimeout(timeout)
  }, [active?.id, active?.dirty, active?.sourceUrl])

  useEffect(() => {
    if (!active?.objects.length || editScope === 'frame') return
    if (!selectedObjectId || !active.objects.some((object) => object.objectId === selectedObjectId)) setSelectedObjectId(active.objects[0].objectId)
  }, [active?.id, active?.objects, selectedObjectId, editScope])

  const updateFrameSettings = (patch: Partial<FrameSettings>) => setProject((current) => {
    const frameId = current.activeFrameId
    if (frameId === null) return current
    let next = current
    if (patch.holdDurationSec !== undefined) next = setFrameHold(next, frameId, patch.holdDurationSec)
    if (patch.camera) next = setFrameCamera(next, frameId, patch.camera)
    if (patch.pageZoom) next = setFramePageZoom(next, frameId, patch.pageZoom)
    return next
  })

  const updateTransition = (patch: Partial<Frame['transitionToNext']>) => setProject((current) => current.activeFrameId === null ? current : setFrameTransition(current, current.activeFrameId, patch))

  const updateObject = (objectId: string, patch: Partial<ObjectSettings>) => setProject((current) => {
    const frameId = current.activeFrameId
    if (frameId === null) return current
    let next = current
    if (patch.drawDurationSec !== undefined) next = setObjectDuration(next, frameId, objectId, patch.drawDurationSec)
    const { kindOverride, strokeColorMode, inkColor, strokeWidth } = patch
    const effectPatch: Partial<Pick<ObjectSettings, 'kindOverride' | 'strokeColorMode' | 'inkColor' | 'strokeWidth'>> = {}
    if (kindOverride !== undefined) effectPatch.kindOverride = kindOverride
    if (strokeColorMode !== undefined) effectPatch.strokeColorMode = strokeColorMode
    if (inkColor !== undefined) effectPatch.inkColor = inkColor
    if (strokeWidth !== undefined) effectPatch.strokeWidth = strokeWidth
    if (Object.keys(effectPatch).length) next = setObjectEffect(next, frameId, objectId, effectPatch)
    if (patch.pushEntry) next = setObjectPush(next, frameId, objectId, patch.pushEntry)
    if (patch.pinCamera !== undefined) next = setObjectPinCamera(next, frameId, objectId, patch.pinCamera)
    return next
  })

  const reorderObject = (fromObjectId: string, toObjectId: string) => setProject((current) => {
    const frame = current.frames.find((candidate) => candidate.id === current.activeFrameId)
    const target = frame?.objects.find((object) => object.objectId === toObjectId)
    return frame && target ? setObjectOrder(current, frame.id, fromObjectId, target.settings.order) : current
  })

  const stopPlayback = () => playerRef.current?.stop()

  const play = async (record: boolean) => {
    if (isPlaying) { stopPlayback(); return }
    if (!active || !canvasRef.current || (record && !supported)) return
    setIsPlaying(true)
    let playbackProject = project
    const readyAnalyses = { ...analyses }
    const framesToPrepare = project.frames
    for (const frame of framesToPrepare) {
      if (!readyAnalyses[frame.id] || frame.dirty) {
        const result = await inspect(frame.id, frame.sourceUrl, frame.settings)
        if (!result) { setIsPlaying(false); return }
        readyAnalyses[frame.id] = result
        playbackProject = { ...playbackProject, frames: playbackProject.frames.map((candidate) => candidate.id === frame.id
          ? syncFrameDuration({ ...candidate, objects: reconcileFrameObjects(candidate.id, result.blocks, candidate.objects), analysis: result, dirty: false })
          : candidate) }
      }
    }
    try {
      const canvasReady = () => setShowRender(true)
      setProgress(0)
      console.log('[Sketchify] project playback start', { record, frames: playbackProject.frames.length, totalDurationSec: buildProjectTimeline(playbackProject).totalDurationSec })
      const player = new ProjectPlayer(canvasRef.current, playbackProject, readyAnalyses, canvasReady)
      playerRef.current = player
      const result = await player.play(record, setProgress)
      if (result.blob) {
        if (videoUrl) URL.revokeObjectURL(videoUrl)
        setVideoUrl(URL.createObjectURL(result.blob))
      }
    } finally {
      playerRef.current = null; setIsPlaying(false)
    }
  }

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => { addFile(event.target.files?.[0]); event.target.value = '' }
  const handleDrop = (event: DragEvent) => { event.preventDefault(); addFile(event.dataTransfer.files[0]) }
  const handleSpotlight = (event: PointerEvent<HTMLElement>) => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || !matchMedia('(hover: hover)').matches) return
    const bounds = event.currentTarget.getBoundingClientRect()
    event.currentTarget.style.setProperty('--spot-x', `${event.clientX - bounds.left}px`)
    event.currentTarget.style.setProperty('--spot-y', `${event.clientY - bounds.top}px`)
  }

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark">S</span><span>Sketchify <b>Video</b></span><small>LOCAL EDITOR</small></div>
      <div className="top-actions">
        <button className="quiet" disabled={!active} onClick={() => void play(false)}>{isPlaying ? 'Dừng' : 'Xem thử'}</button>
        <button className="export" disabled={!active || !supported || isPlaying} onClick={() => void play(true)}>Tạo .webm</button>
        {videoUrl && <a className="quiet" href={videoUrl} download="sketchify-video.webm">Tải video</a>}
        {!supported && <small>Trình duyệt không hỗ trợ MediaRecorder. Dùng Chrome hoặc Edge.</small>}
      </div>
    </header>

    <section className={`workspace ${horizontal ? 'is-horizontal' : ''}`}>
      {!horizontal && <FramePanel frames={project.frames} activeId={active?.id} select={selectFrame} upload={() => fileRef.current?.click()} drop={handleDrop} horizontal={() => setHorizontal(true)} onPointerMove={handleSpotlight} />}
      <section className="stage spotlight-surface" onPointerMove={handleSpotlight}>
        <div className="stage-topline"><span>{active ? `KHUNG ${project.frames.findIndex((frame) => frame.id === active.id) + 1}` : 'SẴN SÀNG'}</span><span className="stage-diagnostics">{analysis && !showRender && <button className={`mask-toggle ${showInkMask ? 'active' : ''}`} type="button" aria-pressed={showInkMask} onClick={() => setShowInkMask((value) => !value)}>Ink mask</button>}<span>{analysisStatus === 'working' ? 'Đang phân tích bằng WASM…' : analysis ? `${analysis.blocks.length} vật thể đã tách` : analysisStatus === 'error' ? 'Không thể phân tích ảnh' : 'Thêm ảnh để bắt đầu'}</span></span></div>
        <div className={`preview ${showRender ? 'has-render' : ''}`}>
          <canvas ref={canvasRef} className="render-canvas" aria-label="Canvas xem thử" />
          {active && !showRender && <div className="analyzed-image">
            <img className="source-image" src={active.sourceUrl} alt="Khung hiện tại" />
            {analysis && showInkMask && <InkMaskOverlay analysis={analysis} />}
            {analysis && <div className="block-overlay">{analysis.blocks.map((block) => {
              const object = active.objects.find((item) => item.blockId === block.id)
              return <button className={`block ${block.kind} ${object?.objectId === selectedObjectId ? 'selected' : ''}`} key={block.id} onClick={() => {
                if (object) { setSelectedObjectId(object.objectId); setEditScope('object'); setPanel('edit') }
                if (active.settings.camera.mode === 'B-manual-keyframe') {
                  const crop = fitRect(block.bbox, analysis.img.w / analysis.img.h, active.settings.camera.zoomPadding, analysis.img.w, analysis.img.h, active.settings.camera.zoomLevel)
                  const manualKeyframes = active.settings.camera.manualKeyframes.filter((key) => key.blockId !== block.id)
                  updateFrameSettings({ camera: { ...active.settings.camera, manualKeyframes: [...manualKeyframes, { blockId: block.id, crop }] } })
                }
              }} style={{ left: `${block.bbox.x / analysis.img.w * 100}%`, top: `${block.bbox.y / analysis.img.h * 100}%`, width: `${block.bbox.w / analysis.img.w * 100}%`, height: `${block.bbox.h / analysis.img.h * 100}%` }}><b>{object ? object.settings.order + 1 : block.id + 1}</b></button>
            })}</div>}
          </div>}
          {!active && <div className="empty-preview"><strong>Biến ảnh thành câu chuyện được vẽ</strong><p>Kéo ảnh vào timeline hoặc tải ảnh lên.</p><button className="export" onClick={() => fileRef.current?.click()}>Tải ảnh lên</button></div>}
        </div>
        <div className="transport"><button disabled={isPlaying} onClick={() => setProgress(Math.max(0, progress - 10))}>−10</button><button className="play" disabled={!active} onClick={() => void play(false)}>{isPlaying ? 'Ⅱ' : '▶'}</button><button disabled={isPlaying} onClick={() => setProgress(Math.min(total, progress + 10))}>+10</button><span className="duration">{formatTime(progress)} / {formatTime(total)}</span></div>
        <input aria-label="Playhead" className="scrubber range-input" type="range" min="0" max={Math.max(total, 1)} step=".1" value={Math.min(progress, total)} style={{ '--range-progress': `${rangeProgress}%` } as CSSProperties} onChange={(event) => setProgress(Number(event.target.value))} />
        {horizontal && <HorizontalTimeline frames={project.frames} activeId={active?.id} select={selectFrame} upload={() => fileRef.current?.click()} drop={handleDrop} vertical={() => setHorizontal(false)} />}
      </section>
      <aside className="inspector spotlight-surface" onPointerMove={handleSpotlight}>
        <nav className="tool-rail"><button className={panel === 'hand' ? 'active' : ''} onClick={() => setPanel('hand')} aria-label="Bàn tay" title="Bàn tay">✎</button>{active && <button className={panel === 'edit' ? 'active' : ''} onClick={() => setPanel('edit')} aria-label="Chỉnh sửa" title="Chỉnh sửa">☷</button>}</nav>
        <div className="inspector-body">{panel === 'hand' || !active
          ? <HandPanel style={project.handStyle} setStyle={(handStyle) => setProject((current) => ({ ...current, handStyle }))} />
          : <EditPanel frame={active} analysis={analysis} last={project.frames.at(-1)?.id === active.id} scope={editScope} setScope={setEditScope} selectedObjectId={selectedObjectId} selectObject={setSelectedObjectId} updateFrameSettings={updateFrameSettings} updateTransition={updateTransition} updateObject={updateObject} reorderObject={reorderObject} />}
        </div>
      </aside>
    </section>
    <input ref={fileRef} hidden type="file" accept="image/png,image/jpeg" onChange={handleFile} />
  </main>
}

function formatTime(seconds: number) { return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` }

function InkMaskOverlay({ analysis }: { analysis: Analysis }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    canvas.width = analysis.img.w; canvas.height = analysis.img.h
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return
    const pixels = context.createImageData(analysis.img.w, analysis.img.h)
    for (let index = 0; index < analysis.img.ink.length; index++) {
      if (!analysis.img.ink[index]) continue
      const offset = index * 4
      pixels.data[offset] = 255; pixels.data[offset + 1] = 35; pixels.data[offset + 2] = 35; pixels.data[offset + 3] = 102
    }
    context.putImageData(pixels, 0, 0)
  }, [analysis])
  return <canvas ref={ref} className="ink-mask-overlay" aria-label="Ink mask trước dilation" />
}
