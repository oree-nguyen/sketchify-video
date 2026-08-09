import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type DragEvent, type PointerEvent } from 'react'
import { HAND_ASSETS } from './assets/hands/registry'
import { EditPanel, HandPanel } from './components/EditorControls'
import { FramePanel, HorizontalTimeline } from './components/FrameTimeline'
import { fitRect } from './camera/cameraTimeline'
import { ProjectPlayer } from './render/ProjectPlayer'
import { createFrame, type Frame, type Project } from './state/projectStore'
import { buildProjectTimeline } from './timeline/projectTimeline'
import { analyzeImage, type Analysis } from './wasm/wasmClient'

export default function App() {
  const [project, setProject] = useState<Project>({ frames: [], activeFrameId: null, handStyle: 'pencil', playhead: { globalTimeSec: 0 } })
  const [analyses, setAnalyses] = useState<Record<number, Analysis>>({})
  const [analysisStatus, setAnalysisStatus] = useState<'idle' | 'working' | 'error'>('idle')
  const [isPlaying, setIsPlaying] = useState(false)
  const [horizontal, setHorizontal] = useState(false)
  const [panel, setPanel] = useState<'hand' | 'edit'>('hand')
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [showRender, setShowRender] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const active = project.frames.find((frame) => frame.id === project.activeFrameId) ?? null
  const analysis = active ? analyses[active.id] ?? null : null
  const timeline = useMemo(() => buildProjectTimeline(project), [project.frames])
  const total = timeline.totalDurationSec
  const progress = project.playhead.globalTimeSec
  const rangeProgress = total ? progress / total * 100 : 0
  const supported = 'MediaRecorder' in window

  const setProgress = (globalTimeSec: number) => setProject((current) => ({
    ...current,
    playhead: { globalTimeSec: Math.max(0, Math.min(buildProjectTimeline(current).totalDurationSec, globalTimeSec)) },
  }))

  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl) }, [videoUrl])
  useEffect(() => {
    const snapshot = {
      activeFrameId: project.activeFrameId,
      handStyle: project.handStyle,
      frames: project.frames.map((frame) => ({
        id: frame.id,
        name: frame.name,
        settings: frame.settings,
        pinnedBlockIds: frame.pinnedBlockIds,
        transitionToNext: frame.transitionToNext,
        durationSec: frame.durationSec,
        dirty: frame.dirty,
      })),
    }
    localStorage.setItem('sketchify-video-project', JSON.stringify(snapshot))
  }, [project.frames, project.activeFrameId, project.handStyle])

  const inspect = async (frameId: number, url: string, settings: Record<string, unknown>): Promise<Analysis | null> => {
    setAnalysisStatus('working')
    try {
      const image = new Image()
      image.src = url
      await image.decode()
      const scale = Math.min(1, Number(settings.workingWidth) / image.naturalWidth)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(image.naturalWidth * scale)
      canvas.height = Math.round(image.naturalHeight * scale)
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) throw new Error('Không tạo được Canvas2D')
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      const rgba = new Uint8Array(context.getImageData(0, 0, canvas.width, canvas.height).data)
      const result = await analyzeImage(rgba, canvas.width, canvas.height, settings as Record<string, number>)
      setAnalyses((current) => ({ ...current, [frameId]: result }))
      setProject((current) => ({ ...current, frames: current.frames.map((frame) => frame.id === frameId ? { ...frame, analysis: result, dirty: false } : frame) }))
      setAnalysisStatus('idle')
      return result
    } catch {
      setAnalysisStatus('error')
      return null
    }
  }

  const addFile = (file?: File) => {
    if (!file?.type.startsWith('image/')) return
    const id = Date.now()
    const frame = createFrame(file, id)
    setShowRender(false)
    setProject((current) => ({ ...current, frames: [...current.frames, frame], activeFrameId: id }))
    void inspect(id, frame.sourceUrl, frame.settings as unknown as Record<string, unknown>)
  }

  const selectFrame = (id: number) => {
    setShowRender(false)
    setProject((current) => ({ ...current, activeFrameId: id }))
    setPanel('edit')
  }

  useEffect(() => {
    const reorder = (event: Event) => {
      const { from, to } = (event as CustomEvent<{ from: number; to: number }>).detail
      setProject((current) => {
        const frames = [...current.frames]
        const item = frames.splice(from, 1)[0]
        frames.splice(to, 0, item)
        return { ...current, frames }
      })
    }
    window.addEventListener('sketchify-reorder', reorder)
    return () => window.removeEventListener('sketchify-reorder', reorder)
  }, [])

  const updateActive = (patch: Partial<Frame>) => setProject((current) => ({
    ...current,
    frames: current.frames.map((frame) => frame.id === current.activeFrameId ? { ...frame, ...patch, dirty: 'settings' in patch ? true : frame.dirty } : frame),
  }))

  useEffect(() => {
    if (!active?.dirty) return
    const timeout = window.setTimeout(() => void inspect(active.id, active.sourceUrl, active.settings as unknown as Record<string, unknown>), 250)
    return () => window.clearTimeout(timeout)
  }, [active?.id, active?.dirty, active?.sourceUrl, active?.settings])

  const play = async (record: boolean) => {
    if (!active || !canvasRef.current || (record && !supported)) return
    setShowRender(true)
    setIsPlaying(true)
    setProgress(0)
    const readyAnalyses = { ...analyses }
    for (const frame of project.frames) {
      if (!readyAnalyses[frame.id] || frame.dirty) {
        const result = await inspect(frame.id, frame.sourceUrl, frame.settings as unknown as Record<string, unknown>)
        if (!result) { setIsPlaying(false); return }
        readyAnalyses[frame.id] = result
      }
    }
    try {
      const result = await new ProjectPlayer(canvasRef.current, project, readyAnalyses).play(record, setProgress)
      if (result.blob) {
        if (videoUrl) URL.revokeObjectURL(videoUrl)
        setVideoUrl(URL.createObjectURL(result.blob))
      }
    } finally {
      setIsPlaying(false)
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
        <button className="quiet" disabled={!active || isPlaying} onClick={() => void play(false)}>Xem thử</button>
        <button className="export" disabled={!active || !supported || isPlaying} onClick={() => void play(true)}>Tạo .webm</button>
        {videoUrl && <a className="quiet" href={videoUrl} download="sketchify-video.webm">Tải video</a>}
        {!supported && <small>Trình duyệt không hỗ trợ MediaRecorder. Dùng Chrome hoặc Edge.</small>}
      </div>
    </header>

    <section className={`workspace ${horizontal ? 'is-horizontal' : ''}`}>
      {!horizontal && <FramePanel frames={project.frames} activeId={active?.id} select={selectFrame} upload={() => fileRef.current?.click()} drop={handleDrop} horizontal={() => setHorizontal(true)} onPointerMove={handleSpotlight} />}

      <section className="stage spotlight-surface" onPointerMove={handleSpotlight}>
        <div className="stage-topline"><span>{active ? `KHUNG ${project.frames.findIndex((frame) => frame.id === active.id) + 1}` : 'SẴN SÀNG'}</span><span>{analysisStatus === 'working' ? 'Đang phân tích bằng WASM…' : analysis ? `${analysis.blocks.length} khối đã tách` : analysisStatus === 'error' ? 'Không thể phân tích ảnh' : 'Thêm ảnh để bắt đầu'}</span></div>
        <div className={`preview ${showRender ? 'has-render' : ''}`}>
          <canvas ref={canvasRef} className="render-canvas" aria-label="Canvas xem thử" />
          {active && !showRender && <div className="analyzed-image">
            <img className="source-image" src={active.sourceUrl} alt="Khung hiện tại" />
            {analysis && <div className="block-overlay">{analysis.blocks.map((block) => <span
              className={`block ${block.kind}`}
              key={block.id}
              onClick={() => {
                if (active.settings.orderMode === 'custom') {
                  const order = active.settings.customOrder.filter((id) => id !== block.id)
                  updateActive({ settings: { ...active.settings, customOrder: [...order, block.id] } })
                }
                if (active.settings.camera.mode === 'B-manual-keyframe') {
                  const crop = fitRect(block.bbox, analysis.img.w / analysis.img.h, active.settings.camera.zoomPadding, analysis.img.w, analysis.img.h, active.settings.camera.zoomLevel)
                  const manualKeyframes = active.settings.camera.manualKeyframes.filter((key) => key.blockId !== block.id)
                  updateActive({ settings: { ...active.settings, camera: { ...active.settings.camera, manualKeyframes: [...manualKeyframes, { blockId: block.id, crop }] } } })
                }
              }}
              style={{ left: `${block.bbox.x / analysis.img.w * 100}%`, top: `${block.bbox.y / analysis.img.h * 100}%`, width: `${block.bbox.w / analysis.img.w * 100}%`, height: `${block.bbox.h / analysis.img.h * 100}%` }}
            ><b>{active.settings.orderMode === 'custom' ? active.settings.customOrder.indexOf(block.id) + 1 || '·' : block.id + 1}</b></span>)}</div>}
          </div>}
          {!active && <div className="empty-preview"><strong>Biến ảnh thành câu chuyện được vẽ</strong><p>Kéo ảnh vào timeline hoặc tải ảnh lên.</p><button className="export" onClick={() => fileRef.current?.click()}>Tải ảnh lên</button></div>}
        </div>
        <div className="transport">
          <button disabled={isPlaying} onClick={() => setProgress(Math.max(0, progress - 10))}>−10</button>
          <button className="play" disabled={isPlaying || !active} onClick={() => void play(false)}>{isPlaying ? 'Ⅱ' : '▶'}</button>
          <button disabled={isPlaying} onClick={() => setProgress(Math.min(total, progress + 10))}>+10</button>
          <span className="duration">{formatTime(progress)} / {formatTime(total)}</span>
        </div>
        <input aria-label="Playhead" className="scrubber range-input" type="range" min="0" max={Math.max(total, 1)} step=".1" value={Math.min(progress, total)} style={{ '--range-progress': `${rangeProgress}%` } as CSSProperties} onChange={(event) => setProgress(Number(event.target.value))} />
        {horizontal && <HorizontalTimeline frames={project.frames} activeId={active?.id} select={selectFrame} upload={() => fileRef.current?.click()} drop={handleDrop} vertical={() => setHorizontal(false)} />}
      </section>

      <aside className="inspector spotlight-surface" onPointerMove={handleSpotlight}>
        <nav className="tool-rail">
          <button className={panel === 'hand' ? 'active' : ''} onClick={() => setPanel('hand')} aria-label="Bàn tay" title="Bàn tay">✎</button>
          {active && <button className={panel === 'edit' ? 'active' : ''} onClick={() => setPanel('edit')} aria-label="Chỉnh sửa" title="Chỉnh sửa">☷</button>}
        </nav>
        <div className="inspector-body">{panel === 'hand' || !active
          ? <HandPanel style={project.handStyle} setStyle={(handStyle) => setProject((current) => ({ ...current, handStyle }))} />
          : <EditPanel frame={active} analysis={analysis} last={project.frames.at(-1)?.id === active.id} update={updateActive} />}
        </div>
      </aside>
    </section>
    <input ref={fileRef} hidden type="file" accept="image/png,image/jpeg" onChange={handleFile} />
  </main>
}

function formatTime(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}
