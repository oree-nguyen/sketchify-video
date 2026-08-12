import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type DragEvent, type PointerEvent } from 'react'
import { fitRect } from './camera/cameraTimeline'
import { EditPanel, HandPanel } from './components/EditorControls'
import { FramePanel } from './components/FrameTimeline'
import { AIGenerationDialog } from './components/AIGenerationDialog'
import { beginPollinationsAuth, consumeAuthCallbackResult, disconnectPollinations, getPollinationsAccessKey, getPollinationsAppKey, getPollinationsRedirectUri, savePollinationsAppKey } from './ai/pollinationsAuth'
import { generateImage as pollinationsGenerateImage, generateSpeech, generateStoryScript } from './ai/pollinationsClient'
import type { StoryProgress, StoryScene, StorySceneFailure } from './ai/types'
import { ProjectPlayer } from './render/ProjectPlayer'
import { createFrame, createFrameFromSource, mergeFrameObjects, objectDropInsertionIndex, reconcileFrameObjects, setFrameCamera, setFrameHold, setFramePageZoom, setFrameTransition, setObjectDuration, setObjectEffect, setObjectOrder, setObjectPinCamera, setObjectPush, syncFrameDuration, type AudioClip, type Frame, type ObjectSettings, type Project } from './state/projectStore'
import type { FrameSettings } from './state/settingsDefaults'
import { buildProjectTimeline } from './timeline/projectTimeline'
import { analyzeImage, type Analysis } from './wasm/wasmClient'

export default function App() {
  const [project, setProject] = useState<Project>({ frames: [], activeFrameId: null, handStyle: 'pencil', playhead: { globalTimeSec: 0 }, audioClips: [] })
  const [analyses, setAnalyses] = useState<Record<number, Analysis>>({})
  const [analysisStatus, setAnalysisStatus] = useState<'idle' | 'working' | 'error'>('idle')
  const [isPlaying, setIsPlaying] = useState(false)
  const [panel, setPanel] = useState<'hand' | 'edit'>('hand')
  const [editScope, setEditScope] = useState<'object' | 'frame'>('object')
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null)
  const [selectedObjectIds, setSelectedObjectIds] = useState<string[]>([])
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [showRender, setShowRender] = useState(false)
  const [showInkMask, setShowInkMask] = useState(false)
  const [aiDialogOpen, setAiDialogOpen] = useState(false)
  const [aiDialogMode, setAiDialogMode] = useState<'choose' | 'connection'>('choose')
  const [aiConnected, setAiConnected] = useState(() => Boolean(getPollinationsAccessKey()))
  const [aiBusy, setAiBusy] = useState(false)
  const [aiProgress, setAiProgress] = useState<StoryProgress | null>(null)
  const [aiFailures, setAiFailures] = useState<StorySceneFailure[]>([])
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
    const result = consumeAuthCallbackResult()
    if (result) {
      setAiConnected(result === 'connected')
      setAiDialogMode('choose')
      setAiDialogOpen(true)
      setAiProgress({ phase: result === 'connected' ? 'done' : 'script', message: result === 'connected' ? 'Đã kết nối Pollinations. Bạn có thể tạo nội dung.' : 'Kết nối bị từ chối hoặc state không hợp lệ.' })
    }
  }, [])
  useEffect(() => {
    const snapshot = {
      activeFrameId: project.activeFrameId,
      handStyle: project.handStyle,
      frames: project.frames.map(({ analysis: _analysis, sourceUrl: _sourceUrl, ...frame }) => frame),
      audioClips: project.audioClips.map(({ sourceUrl: _sourceUrl, ...clip }) => clip),
    }
    localStorage.setItem('sketchify-video-project', JSON.stringify(snapshot))
  }, [project.frames, project.activeFrameId, project.handStyle, project.audioClips])

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
    setShowRender(false); setSelectedObjectId(null); setSelectedObjectIds([]); setEditScope('object'); setPanel('edit')
    setProject((current) => ({ ...current, frames: [...current.frames, frame], activeFrameId: id }))
  }

  const selectFrame = (id: number) => {
    const chosen = project.frames.find((frame) => frame.id === id)
    const firstObjectId = chosen?.objects[0]?.objectId ?? null
    setShowRender(false); setShowInkMask(false); setSelectedObjectId(firstObjectId); setSelectedObjectIds(firstObjectId ? [firstObjectId] : []); setEditScope('object'); setPanel('edit')
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
    if (!selectedObjectId || !active.objects.some((object) => object.objectId === selectedObjectId)) {
      setSelectedObjectId(active.objects[0].objectId)
      setSelectedObjectIds([active.objects[0].objectId])
    }
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

  const reorderObject = (fromObjectId: string, toObjectId: string, position: 'before' | 'after') => setProject((current) => {
    const frame = current.frames.find((candidate) => candidate.id === current.activeFrameId)
    if (!frame) return current
    const insertionIndex = objectDropInsertionIndex(frame.objects, fromObjectId, toObjectId, position)
    if (insertionIndex === null) return current
    return setObjectOrder(current, frame.id, fromObjectId, insertionIndex)
  })

  const selectOnlyObject = (objectId: string | null) => {
    setSelectedObjectId(objectId)
    setSelectedObjectIds(objectId ? [objectId] : [])
  }

  const toggleObjectSelection = (objectId: string) => setSelectedObjectIds((current) => {
    const next = current.includes(objectId) ? current.filter((id) => id !== objectId) : [...current, objectId]
    setSelectedObjectId(next.at(-1) ?? null)
    return next
  })

  const groupSelectedObjects = () => {
    if (!active || !analysis || selectedObjectIds.length < 2) return
    const result = mergeFrameObjects(active, analysis, selectedObjectIds)
    if (!result) return
    setAnalyses((current) => ({ ...current, [active.id]: result.analysis }))
    setProject((current) => ({ ...current, frames: current.frames.map((frame) => frame.id === active.id ? result.frame : frame) }))
    setSelectedObjectId(result.objectId)
    setSelectedObjectIds([result.objectId])
  }

  const requireAiKey = (): string => {
    const key = getPollinationsAccessKey()
    if (!key) throw new Error('Hãy kết nối Pollinations trước khi tạo nội dung.')
    return key
  }

  const openAiDialog = (mode: 'choose' | 'connection' = 'choose') => {
    setAiDialogMode(mode)
    setAiDialogOpen(true)
  }

  const connectPollinations = () => {
    openAiDialog('connection')
  }

  const addGeneratedImage = async (prompt: string, replaceFrameId?: number): Promise<Frame> => {
    const blob = await pollinationsGenerateImage(requireAiKey(), prompt.trim())
    const id = replaceFrameId ?? Date.now()
    const generated = createFrameFromSource(blob, id, 'ai-generated', prompt.trim())
    setPanel('edit'); setEditScope('frame'); setSelectedObjectId(null); setSelectedObjectIds([]); setShowRender(false)
    setProject((current) => {
      if (replaceFrameId === undefined) return { ...current, frames: [...current.frames, generated], activeFrameId: id }
      const previous = current.frames.find((frame) => frame.id === replaceFrameId)
      if (previous) URL.revokeObjectURL(previous.sourceUrl)
      return { ...current, frames: current.frames.map((frame) => frame.id === replaceFrameId ? { ...generated, id: replaceFrameId, transitionToNext: frame.transitionToNext } : frame), activeFrameId: replaceFrameId }
    })
    const result = await inspect(id, generated.sourceUrl, generated.settings)
    if (!result) throw new AnalysisStageError('Ảnh đã tạo nhưng pipeline WASM không phân tích được cảnh này.', id)
    return generated
  }

  const generateAiImage = async (prompt: string) => {
    setAiBusy(true); setAiFailures([]); setAiProgress({ phase: 'image', scene: 1, total: 1, message: 'Đang tạo ảnh bằng Pollinations…' })
    try {
      await addGeneratedImage(prompt)
      setAiProgress({ phase: 'done', message: 'Ảnh đã tạo và đã đưa qua pipeline tách khối.' })
      setAiDialogOpen(false)
    } catch (error) {
      setAiProgress({ phase: 'script', message: error instanceof Error ? error.message : 'Không thể tạo ảnh.' })
    } finally { setAiBusy(false) }
  }

  const addNarration = async (frameId: number, scene: StoryScene): Promise<void> => {
    const blob = await generateSpeech(requireAiKey(), scene.narrationText)
    const durationSec = await measureAudioDuration(blob)
    const sourceUrl = URL.createObjectURL(blob)
    setProject((current) => {
      const frame = current.frames.find((item) => item.id === frameId)
      if (!frame) { URL.revokeObjectURL(sourceUrl); return current }
      const extraHold = Math.max(0, durationSec - frame.durationSec)
      const frames = current.frames.map((item) => item.id === frameId
        ? syncFrameDuration({ ...item, settings: { ...item.settings, holdDurationSec: item.settings.holdDurationSec + extraHold } })
        : item)
      const timeline = buildProjectTimeline({ ...current, frames })
      const startSec = timeline.segments.find((segment) => segment.frameId === frameId)?.startSec ?? 0
      const clip: AudioClip = { id: `ai-audio-${frameId}`, frameId, name: `Lời đọc cảnh ${scene.order}`, sourceUrl, startSec, durationSec, narrationText: scene.narrationText, source: 'ai-generated' }
      const old = current.audioClips.find((item) => item.frameId === frameId)
      if (old) URL.revokeObjectURL(old.sourceUrl)
      return { ...current, frames, audioClips: [...current.audioClips.filter((item) => item.frameId !== frameId), clip] }
    })
  }

  const generateStory = async (topic: string, targetSceneCount?: number) => {
    setAiBusy(true); setAiFailures([]); setAiProgress({ phase: 'script', message: 'Đang viết kịch bản…' })
    const failures: StorySceneFailure[] = []
    try {
      const script = await generateStoryScript(requireAiKey(), { topic: topic.trim(), targetSceneCount, language: 'vi' })
      for (let index = 0; index < script.scenes.length; index++) {
        const scene = script.scenes[index]
        let frame: Frame | undefined
        try {
          setAiProgress({ phase: 'image', scene: index + 1, total: script.scenes.length, message: `Đang tạo ảnh cảnh ${index + 1}/${script.scenes.length}…` })
          frame = await addGeneratedImage(scene.imagePrompt)
        } catch (error) {
          failures.push({ scene, stage: error instanceof AnalysisStageError ? 'analysis' : 'image', frameId: error instanceof AnalysisStageError ? error.frameId : frame?.id, message: errorMessage(error) })
          continue
        }
        try {
          setAiProgress({ phase: 'audio', scene: index + 1, total: script.scenes.length, message: `Đang tạo giọng đọc cảnh ${index + 1}/${script.scenes.length}…` })
          await addNarration(frame.id, scene)
        } catch (error) {
          failures.push({ scene, stage: 'audio', frameId: frame.id, message: errorMessage(error) })
        }
      }
      setAiFailures(failures)
      setAiProgress({ phase: 'done', message: failures.length ? `Đã giữ các cảnh thành công. ${failures.length} cảnh/bước cần thử lại.` : `Đã tạo đủ ${script.scenes.length} cảnh, ảnh và giọng đọc.` })
    } catch (error) {
      setAiProgress({ phase: 'script', message: errorMessage(error) })
    } finally { setAiBusy(false) }
  }

  const retryAiFailure = async (failure: StorySceneFailure) => {
    setAiBusy(true)
    try {
      let frameId = failure.frameId
      if (failure.stage === 'analysis' && frameId !== undefined) {
        const frame = project.frames.find((item) => item.id === frameId)
        if (!frame || !(await inspect(frame.id, frame.sourceUrl, frame.settings))) throw new AnalysisStageError('Pipeline WASM vẫn chưa phân tích được cảnh.', frameId)
      } else if (failure.stage === 'image' || frameId === undefined) {
        setAiProgress({ phase: 'image', scene: failure.scene.order, total: failure.scene.order, message: `Đang thử lại ảnh cảnh ${failure.scene.order}…` })
        frameId = (await addGeneratedImage(failure.scene.imagePrompt)).id
      }
      setAiProgress({ phase: 'audio', scene: failure.scene.order, total: failure.scene.order, message: `Đang thử lại giọng đọc cảnh ${failure.scene.order}…` })
      await addNarration(frameId, failure.scene)
      setAiFailures((current) => current.filter((item) => item !== failure))
      setAiProgress({ phase: 'done', message: `Cảnh ${failure.scene.order} đã hoàn tất.` })
    } catch (error) {
      setAiProgress({ phase: failure.stage, scene: failure.scene.order, total: failure.scene.order, message: errorMessage(error) })
    } finally { setAiBusy(false) }
  }

  const regenerateFrame = async (frame: Frame) => {
    const prompt = frame.aiGeneration?.prompt
    if (!prompt || !window.confirm('Tạo lại sẽ tiêu thêm Pollen và thay ảnh hiện tại. Tiếp tục?')) return
    openAiDialog('choose'); setAiBusy(true); setAiProgress({ phase: 'image', scene: 1, total: 1, message: 'Đang tạo lại ảnh…' })
    try { await addGeneratedImage(prompt, frame.id); setAiProgress({ phase: 'done', message: 'Đã tạo lại ảnh và phân tích lại khung.' }) }
    catch (error) { setAiProgress({ phase: 'script', message: errorMessage(error) }) }
    finally { setAiBusy(false) }
  }

  const removeActiveAudio = () => setProject((current) => {
    const clip = current.audioClips.find((item) => item.frameId === current.activeFrameId)
    if (clip) URL.revokeObjectURL(clip.sourceUrl)
    return { ...current, audioClips: current.audioClips.filter((item) => item.frameId !== current.activeFrameId) }
  })

  const removeActiveFrame = () => {
    if (!active || !window.confirm('Xoá khung hình này cùng giọng đọc đi kèm?')) return
    URL.revokeObjectURL(active.sourceUrl)
    project.audioClips.filter((clip) => clip.frameId === active.id).forEach((clip) => URL.revokeObjectURL(clip.sourceUrl))
    setAnalyses((all) => { const next = { ...all }; delete next[active.id]; return next })
    setSelectedObjectId(null)
    setSelectedObjectIds([])
    setProject((current) => {
      const index = current.frames.findIndex((frame) => frame.id === active.id)
      const frames = current.frames.filter((frame) => frame.id !== active.id)
      return { ...current, frames, activeFrameId: frames[Math.min(Math.max(0, index), frames.length - 1)]?.id ?? null, audioClips: current.audioClips.filter((clip) => clip.frameId !== active.id), playhead: { globalTimeSec: 0 } }
    })
  }

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
        <button className={`ai-connect ${aiConnected ? 'connected' : ''}`} onClick={() => aiConnected ? openAiDialog() : connectPollinations()}>{aiConnected ? 'AI đã kết nối' : 'Kết nối AI'}</button>
        <button className="quiet" disabled={!active} onClick={() => void play(false)}>{isPlaying ? 'Dừng' : 'Xem thử'}</button>
        <button className="export" disabled={!active || !supported || isPlaying} onClick={() => void play(true)}>Tạo .webm</button>
        {videoUrl && <a className="quiet" href={videoUrl} download="sketchify-video.webm">Tải video</a>}
        {!supported && <small>Trình duyệt không hỗ trợ MediaRecorder. Dùng Chrome hoặc Edge.</small>}
      </div>
    </header>

    <section className="workspace">
      <FramePanel frames={project.frames} activeId={active?.id} select={selectFrame} upload={() => fileRef.current?.click()} create={() => openAiDialog()} regenerate={(frame) => void regenerateFrame(frame)} drop={handleDrop} connectPollinations={connectPollinations} onPointerMove={handleSpotlight} />
      <section className="stage spotlight-surface" onPointerMove={handleSpotlight}>
        <div className="stage-topline"><span>{active ? `KHUNG ${project.frames.findIndex((frame) => frame.id === active.id) + 1}` : 'SẴN SÀNG'}</span><span className="stage-diagnostics">{analysis && !showRender && <button className={`mask-toggle ${showInkMask ? 'active' : ''}`} type="button" aria-pressed={showInkMask} onClick={() => setShowInkMask((value) => !value)}>Ink mask</button>}<span>{analysisStatus === 'working' ? 'Đang phân tích bằng WASM…' : analysis ? `${analysis.blocks.length} vật thể đã tách` : analysisStatus === 'error' ? 'Không thể phân tích ảnh' : 'Thêm ảnh để bắt đầu'}</span></span></div>
        <div className={`preview ${showRender ? 'has-render' : ''}`}>
          <canvas ref={canvasRef} className="render-canvas" aria-label="Canvas xem thử" />
          {active && !showRender && <div className="analyzed-image">
            <img className="source-image" src={active.sourceUrl} alt="Khung hiện tại" />
            {analysis && showInkMask && <InkMaskOverlay analysis={analysis} />}
            {analysis && <div className="block-overlay">{analysis.blocks.map((block) => {
              const object = active.objects.find((item) => item.blockId === block.id)
              return <button className={`block ${block.kind} ${object && selectedObjectIds.includes(object.objectId) ? 'selected' : ''}`} key={block.id} onClick={() => {
                if (object) { selectOnlyObject(object.objectId); setEditScope('object'); setPanel('edit') }
                if (active.settings.camera.mode === 'B-manual-keyframe') {
                  const crop = fitRect(block.bbox, analysis.img.w / analysis.img.h, active.settings.camera.zoomPadding, analysis.img.w, analysis.img.h, active.settings.camera.zoomLevel)
                  const manualKeyframes = active.settings.camera.manualKeyframes.filter((key) => key.blockId !== block.id)
                  updateFrameSettings({ camera: { ...active.settings.camera, manualKeyframes: [...manualKeyframes, { blockId: block.id, crop }] } })
                }
              }} style={{ left: `${block.bbox.x / analysis.img.w * 100}%`, top: `${block.bbox.y / analysis.img.h * 100}%`, width: `${block.bbox.w / analysis.img.w * 100}%`, height: `${block.bbox.h / analysis.img.h * 100}%` }}><b>{object ? object.settings.order + 1 : block.id + 1}</b></button>
            })}</div>}
          </div>}
          {!active && <div className="empty-preview"><strong>Biến ảnh thành câu chuyện được vẽ</strong><p>Tải ảnh của bạn hoặc để AI tạo trọn storyboard tiếng Việt.</p><div className="empty-actions"><button className="export" onClick={() => fileRef.current?.click()}>Tải ảnh lên</button><button className="quiet" onClick={() => openAiDialog()}>Tạo video từ chủ đề…</button></div></div>}
        </div>
        <div className="transport"><button disabled={isPlaying} onClick={() => setProgress(Math.max(0, progress - 10))}>−10</button><button className="play" disabled={!active} onClick={() => void play(false)}>{isPlaying ? 'Ⅱ' : '▶'}</button><button disabled={isPlaying} onClick={() => setProgress(Math.min(total, progress + 10))}>+10</button><span className="duration">{formatTime(progress)} / {formatTime(total)}</span></div>
        <input aria-label="Playhead" className="scrubber range-input" type="range" min="0" max={Math.max(total, 1)} step=".1" value={Math.min(progress, total)} style={{ '--range-progress': `${rangeProgress}%` } as CSSProperties} onChange={(event) => setProgress(Number(event.target.value))} />
      </section>
      <aside className="inspector spotlight-surface" onPointerMove={handleSpotlight}>
        <nav className="tool-rail"><button className={panel === 'hand' ? 'active' : ''} onClick={() => setPanel('hand')} aria-label="Bàn tay" title="Bàn tay">✎</button>{active && <button className={panel === 'edit' ? 'active' : ''} onClick={() => setPanel('edit')} aria-label="Chỉnh sửa" title="Chỉnh sửa">☷</button>}</nav>
        <div className="inspector-body">{panel === 'hand' || !active
          ? <HandPanel style={project.handStyle} setStyle={(handStyle) => setProject((current) => ({ ...current, handStyle }))} />
          : <EditPanel frame={active} analysis={analysis} last={project.frames.at(-1)?.id === active.id} scope={editScope} setScope={setEditScope} selectedObjectId={selectedObjectId} selectedObjectIds={selectedObjectIds} selectObject={selectOnlyObject} toggleObjectSelection={toggleObjectSelection} groupSelectedObjects={groupSelectedObjects} updateFrameSettings={updateFrameSettings} updateTransition={updateTransition} updateObject={updateObject} reorderObject={reorderObject} audioClip={project.audioClips.find((clip) => clip.frameId === active.id)} removeAudio={removeActiveAudio} removeFrame={removeActiveFrame} />}
        </div>
      </aside>
    </section>
    <input ref={fileRef} hidden type="file" accept="image/png,image/jpeg" onChange={handleFile} />
    <AIGenerationDialog open={aiDialogOpen} initialMode={aiDialogMode} redirectUri={getPollinationsRedirectUri()} savedAppKey={getPollinationsAppKey()} connected={aiConnected} busy={aiBusy} progress={aiProgress} failures={aiFailures}
      close={() => { if (!aiBusy) setAiDialogOpen(false) }} upload={() => fileRef.current?.click()}
      connect={(appKey) => { savePollinationsAppKey(appKey); beginPollinationsAuth(appKey) }}
      disconnect={() => { disconnectPollinations(); setAiConnected(false); setAiProgress({ phase: 'script', message: 'Đã ngắt kết nối Pollinations.' }) }}
      generateImage={generateAiImage} generateStory={generateStory} retryFailure={retryAiFailure} />
  </main>
}

function formatTime(seconds: number) { return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` }

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : 'Có lỗi không xác định.' }

class AnalysisStageError extends Error {
  constructor(message: string, readonly frameId: number) { super(message) }
}

async function measureAudioDuration(blob: Blob): Promise<number> {
  const context = new AudioContext()
  try { return (await context.decodeAudioData(await blob.arrayBuffer())).duration }
  finally { await context.close() }
}

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
