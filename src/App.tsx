import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type DragEvent, type PointerEvent } from 'react'
import { fitRect } from './camera/cameraTimeline'
import { EditPanel, HandPanel } from './components/EditorControls'
import { FramePanel } from './components/FrameTimeline'
import { AIGenerationDialog } from './components/AIGenerationDialog'
import { NarrationBar } from './components/NarrationBar'
import { SessionSwitcher } from './components/SessionSwitcher'
import { SubtitlePanel } from './components/SubtitlePanel'
import { beginPollinationsAuth, consumeAuthCallbackResult, disconnectPollinations, getPollinationsAccessKey, getPollinationsAppKey, getPollinationsRedirectUri, savePollinationsAppKey } from './ai/pollinationsAuth'
import { generateImage as pollinationsGenerateImage, generateSpeech, generateStoryScript } from './ai/pollinationsClient'
import type { StoryProgress, StoryScene, StorySceneFailure } from './ai/types'
import { ProjectPlayer } from './render/ProjectPlayer'
import { applyBlockOverridesToAnalysis, createEmptyProject, createFrame, createFrameFromSource, frameDrawDurationSec, mergeFrameObjects, objectDropInsertionIndex, reconcileFrameObjects, replaceFrameObjectWithRescan, setFrameCamera, setFrameCameraPinned, setFrameHold, setFramePageZoom, setFramePauseSettings, setFrameTransition, setObjectDuration, setObjectEffect, setObjectOrder, setObjectPush, setObjectZoomFollow, syncFrameDuration, translateLocalAnalysis, ungroupFrameObject, type AudioClip, type BlockOverrides, type Frame, type ObjectSettings, type Project, type SubtitleSettings } from './state/projectStore'
import type { FrameSettings } from './state/settingsDefaults'
import { buildProjectTimeline } from './timeline/projectTimeline'
import { analyzeImage, type Analysis, type AnalysisResult } from './wasm/wasmClient'
import { synthesizeSpeech } from './tts/ttsClient'
import { estimateWordTimestamps } from './tts/wordTimestamps'
import type { TtsProgress } from './tts/types'
import { createSession, deleteSession, listSessions, loadSession, makeSessionRecord, resolveInitialSession, restoreProject, saveSession, setActiveSessionId, type SessionSummary } from './state/sessionStore'

export default function App() {
  const [project, setProject] = useState<Project>(() => createEmptyProject())
  const [analyses, setAnalyses] = useState<Record<number, Analysis>>({})
  const [analysisStatus, setAnalysisStatus] = useState<'idle' | 'working' | 'error'>('idle')
  const [isPlaying, setIsPlaying] = useState(false)
  const [panel, setPanel] = useState<'hand' | 'edit' | 'subtitle'>('hand')
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
  const [ttsBusy, setTtsBusy] = useState(false)
  const [ttsProgress, setTtsProgress] = useState<TtsProgress | null>(null)
  const [audioOpen, setAudioOpen] = useState(false)
  const [objectGrid, setObjectGrid] = useState(false)
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [activeSessionId, setActiveSessionIdState] = useState<string | null>(null)
  const [activeSessionName, setActiveSessionName] = useState('')
  const [activeSessionCreatedAt, setActiveSessionCreatedAt] = useState('')
  const [sessionReady, setSessionReady] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const playerRef = useRef<{ stop(): void } | null>(null)
  const sessionSaveQueueRef = useRef<Promise<void>>(Promise.resolve())

  const queueSessionSave = (snapshot: Project, id: string, name: string, createdAt: string) => {
    const task = sessionSaveQueueRef.current.catch(() => undefined).then(async () => {
      await saveSession(await makeSessionRecord(snapshot, id, name, createdAt))
    })
    sessionSaveQueueRef.current = task
    return task
  }

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
    const onKey = (event: KeyboardEvent) => { if (event.ctrlKey && event.key.toLowerCase() === 'g') { event.preventDefault(); groupSelectedObjects() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, analysis, selectedObjectIds])
  useEffect(() => {
    void (async () => {
      try {
        const current = await resolveInitialSession(createEmptyProject())
        setActiveSessionIdState(current.id)
        setActiveSessionName(current.name)
        setActiveSessionCreatedAt(current.createdAt)
        setProject(await restoreProject(current.projectJson))
        setSessions(await listSessions())
      } catch (error) { console.error('[Sketchify] Không thể khôi phục phiên hiện tại', error) }
      finally { setSessionReady(true) }
    })()
  }, [])
  useEffect(() => {
    if (!sessionReady || !activeSessionId) return
    const timeout = window.setTimeout(() => void (async () => {
      try {
        await queueSessionSave(project, activeSessionId, activeSessionName, activeSessionCreatedAt)
        setSessions(await listSessions())
      }
      catch (error) { console.error('[Sketchify] Tự động lưu thất bại', error) }
    })(), 2000)
    return () => window.clearTimeout(timeout)
  }, [sessionReady, activeSessionId, activeSessionName, activeSessionCreatedAt, project.frames, project.activeFrameId, project.handStyle, project.audioClips, project.subtitle])

  const inspect = async (frameId: number, url: string, settings: FrameSettings, blockOverrides?: BlockOverrides): Promise<Analysis | null> => {
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
      // Raster wipe owns the entire image as one raster surface. Do not start
      // the imaging Worker/WASM or manufacture object/DrawUnit placeholders.
      const wasmResult = settings.rasterWipe?.enabled
        ? makeRasterAnalysis(rgba, canvas.width, canvas.height)
        : await analyzeImage(rgba, canvas.width, canvas.height, { ...settings, mergeRadius: 0 } as unknown as Record<string, unknown>)
      const result = settings.rasterWipe?.enabled ? wasmResult : applyBlockOverridesToAnalysis(wasmResult, blockOverrides)
      setAnalyses((current) => ({ ...current, [frameId]: result }))
      setProject((current) => ({
        ...current,
        frames: current.frames.map((frame) => frame.id === frameId
          ? syncFrameDuration({ ...frame, objects: settings.rasterWipe?.enabled ? frame.objects : reconcileFrameObjects(frame.id, result.blocks, frame.objects), analysis: result, dirty: false })
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
    const timeout = window.setTimeout(() => void inspect(active.id, active.sourceUrl, active.settings, active.blockOverrides), 120)
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
    if (patch.microPauseMs !== undefined || patch.groupPauseMs !== undefined || patch.proximityThresholdPct !== undefined) {
      next = setFramePauseSettings(next, frameId, {
        ...(patch.microPauseMs !== undefined ? { microPauseMs: patch.microPauseMs } : {}),
        ...(patch.groupPauseMs !== undefined ? { groupPauseMs: patch.groupPauseMs } : {}),
        ...(patch.proximityThresholdPct !== undefined ? { proximityThresholdPct: patch.proximityThresholdPct } : {}),
      })
    }
    if (patch.cameraPinned !== undefined) {
      if (patch.cameraPinned && active?.settings.cameraPinned !== true) {
        const hasZoom = active?.objects.some((object) => object.settings.zoomFollow)
        if (hasZoom && !window.confirm('Bật Ghim camera sẽ tắt hết hiệu ứng Zoom theo vật thể của TẤT CẢ vật thể trong khung hình này. Xác nhận?')) return current
        if (hasZoom) next = { ...next, frames: next.frames.map((frame) => frame.id === frameId ? { ...frame, objects: frame.objects.map((object) => ({ ...object, settings: { ...object.settings, zoomFollow: false } })) } : frame) }
      }
      next = setFrameCameraPinned(next, frameId, patch.cameraPinned)
    }
    const analysisPatch: Partial<FrameSettings> = {}
    for (const key of ['segmentationMode', 'bgVarianceThreshold', 'bgEntropyThreshold', 'saliencyPercentile', 'localRescanPaddingPct', 'rasterWipe', 'rasterWipeDurationSec'] as const) {
      if (patch[key] !== undefined) Object.assign(analysisPatch, { [key]: patch[key] })
    }
    if (Object.keys(analysisPatch).length) next = { ...next, frames: next.frames.map((frame) => frame.id === frameId ? { ...frame, settings: { ...frame.settings, ...analysisPatch, mergeRadius: 0 }, dirty: true } : frame) }
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
    if (patch.zoomFollow !== undefined) next = setObjectZoomFollow(next, frameId, objectId, patch.zoomFollow)
    return next
  })

  const reorderObject = (fromObjectId: string, toObjectId: string, position: 'before' | 'after') => setProject((current) => {
    const frame = current.frames.find((candidate) => candidate.id === current.activeFrameId)
    if (!frame) return current
    const insertionIndex = objectDropInsertionIndex(frame.objects, fromObjectId, toObjectId, position)
    if (insertionIndex === null) return current
    return setObjectOrder(current, frame.id, fromObjectId, insertionIndex)
  })
  const setObjectOrderDirect = (objectId: string, order: number) => setProject((current) => {
    const frame = current.frames.find((candidate) => candidate.id === current.activeFrameId)
    return frame ? setObjectOrder(current, frame.id, objectId, Math.max(0, Math.min(frame.objects.length - 1, Math.round(order)))) : current
  })

  const selectOnlyObject = (objectId: string | null) => {
    setSelectedObjectId(objectId)
    setSelectedObjectIds(objectId ? [objectId] : [])
  }

  const toggleObjectSelection = (objectId: string, modifiers: { range?: boolean; additive?: boolean } = {}) => setSelectedObjectIds((current) => {
    const ordered = [...(active?.objects ?? [])].sort((a, b) => a.settings.order - b.settings.order)
    let next: string[]
    if (modifiers.range && current.length) {
      const a = ordered.findIndex((object) => object.objectId === current[0]), b = ordered.findIndex((object) => object.objectId === objectId)
      const range = ordered.slice(Math.min(a, b), Math.max(a, b) + 1).map((object) => object.objectId)
      next = modifiers.additive ? [...new Set([...current, ...range])] : range
    } else next = modifiers.additive ? (current.includes(objectId) ? current.filter((id) => id !== objectId) : [...current, objectId]) : [objectId]
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
  const ungroupObject = (groupId: string) => {
    if (!active || !analysis) return
    const result = ungroupFrameObject(active, analysis, groupId)
    if (!result) return
    setAnalyses((current) => ({ ...current, [active.id]: result.analysis }))
    setProject((current) => ({ ...current, frames: current.frames.map((frame) => frame.id === active.id ? result.frame : frame) }))
    setSelectedObjectId(result.objectIds[0] ?? null); setSelectedObjectIds(result.objectIds)
  }

  const rescanObject = async (objectId: string) => {
    if (!active || !analysis || analysisStatus === 'working') return
    const object = active.objects.find((candidate) => candidate.objectId === objectId)
    if (!object) return
    setAnalysisStatus('working')
    try {
      const padding = Math.max(0, active.settings.localRescanPaddingPct) / 100
      const extraX = Math.round(object.bbox.w * padding), extraY = Math.round(object.bbox.h * padding)
      const x = Math.max(0, object.bbox.x - extraX), y = Math.max(0, object.bbox.y - extraY)
      const right = Math.min(analysis.img.w, object.bbox.x + object.bbox.w + extraX)
      const bottom = Math.min(analysis.img.h, object.bbox.y + object.bbox.h + extraY)
      const width = right - x, height = bottom - y
      const crop = new Uint8Array(width * height * 4)
      for (let row = 0; row < height; row++) {
        crop.set(analysis.img.rgba.subarray(((y + row) * analysis.img.w + x) * 4, ((y + row) * analysis.img.w + right) * 4), row * width * 4)
      }
      const local = await analyzeImage(crop, width, height, { ...active.settings, segmentationMode: 'saliency', mergeRadius: 0 } as unknown as Record<string, unknown>)
      const sourceInCrop = { x: object.bbox.x - x, y: object.bbox.y - y, w: object.bbox.w, h: object.bbox.h }
      const significant = local.blocks.filter((block) => {
        const overlapW = Math.max(0, Math.min(block.bbox.x + block.bbox.w, sourceInCrop.x + sourceInCrop.w) - Math.max(block.bbox.x, sourceInCrop.x))
        const overlapH = Math.max(0, Math.min(block.bbox.y + block.bbox.h, sourceInCrop.y + sourceInCrop.h) - Math.max(block.bbox.y, sourceInCrop.y))
        return block.inkArea >= active.settings.minBlockInk && overlapW * overlapH > 0
      })
      if (significant.length < 2) {
        window.alert('Không tách được tự động, vui lòng dùng Khoanh vùng tự do (lasso) để vẽ tay ranh giới.')
        return
      }
      const acceptedIds = new Set(significant.map((block) => block.id))
      const localAccepted = { ...local, blocks: significant, units: local.units.filter((unit) => acceptedIds.has(unit.blockId)) }
      const firstId = Math.max(-1, ...analysis.blocks.map((block) => block.id)) + 1
      const translated = translateLocalAnalysis(localAccepted, x, y, analysis.img.w, firstId)
      const replacement = replaceFrameObjectWithRescan(active, analysis, objectId, translated)
      if (!replacement) {
        window.alert('Không tách được tự động, vui lòng dùng Khoanh vùng tự do (lasso) để vẽ tay ranh giới.')
        return
      }
      setAnalyses((current) => ({ ...current, [active.id]: replacement.analysis }))
      setProject((current) => ({ ...current, frames: current.frames.map((frame) => frame.id === active.id ? replacement.frame : frame) }))
      setSelectedObjectIds(replacement.objectIds); setSelectedObjectId(replacement.objectIds[0] ?? null)
    } catch (error) {
      console.error('[Sketchify] local saliency rescan failed', error)
      window.alert(`Quét lại cục bộ thất bại: ${errorMessage(error)}`)
    } finally { setAnalysisStatus('idle') }
  }

  const createNarration = async (text: string, voiceId: string, speed: number) => {
    if (!active) return
    const frameId = active.id
    setTtsBusy(true); setTtsProgress({ phase: 'download', percent: 0 })
    try {
      const { audioBuffer, wordTimestamps } = await synthesizeSpeech(text, voiceId, speed, setTtsProgress)
      setProject((current) => ({ ...current, frames: current.frames.map((frame) => {
        if (frame.id !== frameId) return frame
        const requiredHold = Math.max(frame.settings.holdDurationSec, audioBuffer.duration - frameDrawDurationSec(frame))
        return syncFrameDuration({ ...frame, settings: { ...frame.settings, holdDurationSec: Math.max(0, requiredHold) }, narration: { text: text.trim(), voiceId, speed, wordTimestamps, audioBuffer, generatedAt: new Date().toISOString() } })
      }) }))
    } catch (error) { window.alert(errorMessage(error)) }
    finally { setTtsBusy(false); setTtsProgress(null) }
  }

  const refreshSessions = async () => setSessions(await listSessions())
  const persistActiveSession = async () => {
    if (!activeSessionId || !sessionReady) return
    await queueSessionSave(project, activeSessionId, activeSessionName, activeSessionCreatedAt)
  }
  const resetSessionRuntime = (nextProject: Project) => {
    project.frames.forEach((frame) => URL.revokeObjectURL(frame.sourceUrl))
    project.audioClips.forEach((clip) => URL.revokeObjectURL(clip.sourceUrl))
    if (videoUrl) { URL.revokeObjectURL(videoUrl); setVideoUrl(null) }
    playerRef.current?.stop()
    setAnalyses({}); setAnalysisStatus('idle'); setShowRender(false); setShowInkMask(false)
    setSelectedObjectId(null); setSelectedObjectIds([]); setEditScope('object'); setPanel('hand')
    setProject(nextProject)
  }
  const activateSession = async (id: string, saveCurrent = true) => {
    if (id === activeSessionId) return
    const record = await loadSession(id); if (!record) return
    setSessionReady(false)
    try {
      if (saveCurrent) await persistActiveSession()
      await setActiveSessionId(record.id)
      const restored = await restoreProject(record.projectJson)
      resetSessionRuntime(restored)
      setActiveSessionIdState(record.id); setActiveSessionName(record.name); setActiveSessionCreatedAt(record.createdAt)
      setSessions(await listSessions())
    } finally { setSessionReady(true) }
  }
  const newSession = async (saveCurrent = true) => {
    setSessionReady(false)
    try {
      if (saveCurrent) await persistActiveSession()
      const blank = createEmptyProject()
      const name = `Phiên mới ${(await listSessions()).length + 1}`
      const record = await createSession(blank, name)
      resetSessionRuntime(blank)
      setActiveSessionIdState(record.id); setActiveSessionName(record.name); setActiveSessionCreatedAt(record.createdAt)
      setSessions(await listSessions())
    } finally { setSessionReady(true) }
  }
  const renameSession = async (session: SessionSummary) => {
    const name = window.prompt('Đổi tên phiên', session.name)?.trim(); if (!name) return
    if (session.id === activeSessionId) setActiveSessionName(name)
    const task = sessionSaveQueueRef.current.catch(() => undefined).then(async () => {
      const record = await loadSession(session.id); if (!record) return
      await saveSession({ ...record, name, updatedAt: new Date().toISOString() })
    })
    sessionSaveQueueRef.current = task
    await task
    await refreshSessions()
  }
  const removeSession = async (id: string) => {
    const removingActive = id === activeSessionId
    if (!window.confirm(removingActive ? 'Xoá phiên đang mở? Bạn sẽ được chuyển sang phiên khác.' : 'Xoá phiên này?')) return
    if (removingActive) setSessionReady(false)
    await deleteSession(id)
    const remaining = await listSessions()
    if (!removingActive) { setSessions(remaining); return }
    if (remaining.length) await activateSession(remaining[0].id, false)
    else await newSession(false)
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
    const audioContext = new AudioContext()
    const audioBuffer = await audioContext.decodeAudioData(await blob.arrayBuffer())
    await audioContext.close()
    const durationSec = audioBuffer.duration
    const sourceUrl = URL.createObjectURL(blob)
    setProject((current) => {
      const frame = current.frames.find((item) => item.id === frameId)
      if (!frame) { URL.revokeObjectURL(sourceUrl); return current }
      const extraHold = Math.max(0, durationSec - frame.durationSec)
      const frames = current.frames.map((item) => item.id === frameId
        ? syncFrameDuration({ ...item, settings: { ...item.settings, holdDurationSec: item.settings.holdDurationSec + extraHold }, narration: { text: scene.narrationText, voiceId: 'pollinations', speed: 1, wordTimestamps: estimateWordTimestamps(scene.narrationText, audioBuffer.duration), audioBuffer, generatedAt: new Date().toISOString() } })
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
  const removeFrameById = (frameId: number) => {
    const frame = project.frames.find((item) => item.id === frameId)
    if (!frame || !window.confirm(`Xoá khung hình “${frame.name}”?`)) return
    project.audioClips.filter((clip) => clip.frameId === frameId).forEach((clip) => URL.revokeObjectURL(clip.sourceUrl))
    URL.revokeObjectURL(frame.sourceUrl)
    setProject((current) => {
      const index = current.frames.findIndex((item) => item.id === frameId)
      const frames = current.frames.filter((item) => item.id !== frameId)
      return { ...current, frames, activeFrameId: current.activeFrameId === frameId ? (frames[Math.min(index, frames.length - 1)]?.id ?? null) : current.activeFrameId, playhead: { globalTimeSec: 0 }, audioClips: current.audioClips.filter((clip) => clip.frameId !== frameId) }
    })
    setSelectedObjectId(null); setSelectedObjectIds([])
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
          ? syncFrameDuration({ ...candidate, objects: candidate.settings.rasterWipe?.enabled ? candidate.objects : reconcileFrameObjects(candidate.id, result.blocks, candidate.objects), analysis: result, dirty: false })
          : candidate) }
      }
    }
    try {
      const canvasReady = () => setShowRender(true)
      const playbackStartSec = record
        ? 0
        : buildProjectTimeline(playbackProject).segments.find((segment) => segment.frameId === playbackProject.activeFrameId)?.startSec ?? 0
      setProgress(playbackStartSec)
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

  const updateSubtitle = (patch: Partial<SubtitleSettings>) => setProject((current) => ({ ...current, subtitle: { ...current.subtitle, ...patch } }))
  const dragSubtitleSample = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    const sample = event.currentTarget
    const surface = sample.parentElement
    if (!surface) return
    sample.setPointerCapture(event.pointerId)
    const move = (pointer: globalThis.PointerEvent) => {
      const bounds = surface.getBoundingClientRect()
      updateSubtitle({
        xPct: Math.max(.1, Math.min(.9, (pointer.clientX - bounds.left) / bounds.width)),
        yPct: Math.max(.08, Math.min(.94, (pointer.clientY - bounds.top) / bounds.height)),
      })
    }
    const finish = () => { sample.removeEventListener('pointermove', move); sample.removeEventListener('pointerup', finish); sample.removeEventListener('pointercancel', finish) }
    sample.addEventListener('pointermove', move)
    sample.addEventListener('pointerup', finish)
    sample.addEventListener('pointercancel', finish)
    move(event.nativeEvent)
  }

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark">S</span><span>Sketchify <b>Video</b></span><SessionSwitcher activeSessionId={activeSessionId} activeSessionName={activeSessionName} sessions={sessions} refresh={() => void refreshSessions()} select={(id) => void activateSession(id)} create={() => void newSession()} rename={(session) => void renameSession(session)} remove={(id) => void removeSession(id)} /></div>
      <div className="top-actions">
        <button className={`ai-connect ${aiConnected ? 'connected' : ''}`} onClick={() => aiConnected ? openAiDialog() : connectPollinations()}>{aiConnected ? 'AI đã kết nối' : 'Kết nối AI'}</button>
        <button className="quiet" disabled={!active} onClick={() => void play(false)}>{isPlaying ? 'Dừng' : 'Xem thử'}</button>
        <button className="export" disabled={!active || !supported || isPlaying} onClick={() => void play(true)}>Tạo .webm</button>
        {videoUrl && <a className="quiet" href={videoUrl} download="sketchify-video.webm">Tải video</a>}
        {!supported && <small>Trình duyệt không hỗ trợ MediaRecorder. Dùng Chrome hoặc Edge.</small>}
      </div>
    </header>

    <section className="workspace">
          <FramePanel frames={project.frames} activeId={active?.id} select={selectFrame} upload={() => fileRef.current?.click()} create={() => openAiDialog()} regenerate={(frame) => void regenerateFrame(frame)} remove={(frame) => removeFrameById(frame.id)} drop={handleDrop} connectPollinations={connectPollinations} onPointerMove={handleSpotlight} />
      <section className="stage spotlight-surface" onPointerMove={handleSpotlight}>
        <div className="stage-topline"><span>{active ? `KHUNG ${project.frames.findIndex((frame) => frame.id === active.id) + 1}` : 'SẴN SÀNG'}</span><span className="stage-diagnostics">{analysis && !showRender && !active?.settings.rasterWipe?.enabled && <button className={`mask-toggle ${showInkMask ? 'active' : ''}`} type="button" aria-pressed={showInkMask} onClick={() => setShowInkMask((value) => !value)}>Ink mask</button>}{active && analysis && !active.settings.rasterWipe?.enabled && <select className="algorithm-mode" aria-label="Chế độ tách vật thể" value={active.settings.segmentationMode} onChange={(event) => updateFrameSettings({ segmentationMode: event.target.value as FrameSettings['segmentationMode'] })}><option value="auto">Tự động</option><option value="standard">Thuật toán chuẩn</option><option value="saliency">Thuật toán saliency</option></select>}<span>{analysisStatus === 'working' ? (active?.settings.rasterWipe?.enabled ? 'Đang chuẩn bị ảnh raster…' : 'Đang phân tích bằng WASM…') : analysis ? (active?.settings.rasterWipe?.enabled ? <>Vẽ nguyên khung hình <small className="algorithm-status">· không tách vật thể</small></> : <>{analysis.blocks.length} vật thể đã tách <small className="algorithm-status">· {analysis.stats.segmentationMode === 'saliency' ? 'Nền phức tạp · thuật toán saliency' : 'Nền đơn giản · thuật toán chuẩn'}</small></>) : analysisStatus === 'error' ? 'Không thể phân tích ảnh' : 'Thêm ảnh để bắt đầu'}</span></span></div>
        <div className={`preview ${showRender ? 'has-render' : ''} ${isPlaying ? 'is-playing' : ''}`}>
          {active && <div className="analyzed-image">
            <canvas ref={canvasRef} className="render-canvas" aria-label="Canvas xem thử" />
            {!showRender && <img className="source-image" src={active.sourceUrl} alt="Khung hiện tại" />}
            {analysis && showInkMask && !active.settings.rasterWipe?.enabled && <InkMaskOverlay analysis={analysis} />}
            {analysis && !isPlaying && !active.settings.rasterWipe?.enabled && <div className="block-overlay">{analysis.blocks.map((block) => {
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
            {project.subtitle.enabled && !isPlaying && <button type="button" className="subtitle-position-sample" aria-label="Kéo vị trí phụ đề" onClick={() => setPanel('subtitle')} onPointerDown={dragSubtitleSample} style={{ left: `${project.subtitle.xPct * 100}%`, top: `${project.subtitle.yPct * 100}%`, color: project.subtitle.color, fontFamily: project.subtitle.fontFamily, fontSize: `${Math.max(7, Math.min(20, project.subtitle.fontSizePx))}px`, fontWeight: project.subtitle.bold ? 700 : 400, fontStyle: project.subtitle.italic ? 'italic' : 'normal', textDecoration: project.subtitle.underline ? 'underline' : 'none' }}>Đây là tiêu đề mẫu</button>}
          </div>}
          {!active && <canvas ref={canvasRef} className="render-canvas" aria-label="Canvas xem thử" />}
          {!active && <div className="empty-preview"><strong>Biến ảnh thành câu chuyện được vẽ</strong><p>Tải ảnh của bạn hoặc để AI tạo trọn storyboard tiếng Việt.</p><div className="empty-actions"><button className="export" onClick={() => fileRef.current?.click()}>Tải ảnh lên</button><button className="quiet" onClick={() => openAiDialog()}>Tạo video từ chủ đề…</button></div></div>}
        </div>
        <div className="transport"><div className="transport-left"><button className={`cc-toggle ${project.subtitle.enabled ? 'active' : ''}`} aria-label="Bật tắt phụ đề" aria-pressed={project.subtitle.enabled} onClick={() => updateSubtitle({ enabled: !project.subtitle.enabled })}>CC</button><button className={`mic-toggle ${audioOpen ? 'active' : ''}`} aria-label="Mở bảng tạo audio" aria-pressed={audioOpen} onClick={() => setAudioOpen((value) => !value)}>♩</button></div><div className="transport-center"><button disabled={isPlaying} onClick={() => setProgress(Math.max(0, progress - 10))}>−10</button><button className="play" disabled={!active} onClick={() => void play(false)}>{isPlaying ? 'Ⅱ' : '▶'}</button><button disabled={isPlaying} onClick={() => setProgress(Math.min(total, progress + 10))}>+10</button></div><span className="duration">{formatTime(progress)} / {formatTime(total)}</span></div>
        {active && <div className="raster-wipe-control"><details className="raster-wipe-menu"><summary aria-label="Vẽ nguyên khung hình" title="Vẽ nguyên khung hình">▤ <span>Vẽ nguyên khung</span></summary><div className="raster-wipe-options">{([{ value: 'ttb', label: 'Trên xuống dưới' }, { value: 'ltr', label: 'Trái sang phải' }, { value: 'rtl', label: 'Phải sang trái' }, { value: 'btt', label: 'Dưới lên trên' }, { value: 'off', label: 'Tắt · vẽ theo vật thể' }] as const).map((option) => <button key={option.value} type="button" aria-pressed={option.value === 'off' ? !active.settings.rasterWipe?.enabled : active.settings.rasterWipe?.direction === option.value} onClick={(event) => { updateFrameSettings({ rasterWipe: option.value === 'off' ? null : { enabled: true, direction: option.value } }); event.currentTarget.closest('details')?.removeAttribute('open') }}>{option.label}</button>)}</div></details></div>}
        <input aria-label="Playhead" className="scrubber range-input" type="range" min="0" max={Math.max(total, 1)} step=".1" value={Math.min(progress, total)} style={{ '--range-progress': `${rangeProgress}%` } as CSSProperties} onChange={(event) => setProgress(Number(event.target.value))} />
        {active && audioOpen && <NarrationBar frame={active} busy={ttsBusy} progress={ttsProgress} onClose={() => setAudioOpen(false)} create={(text, voiceId, speed) => void createNarration(text, voiceId, speed)} />}
      </section>
      <aside className="inspector spotlight-surface" onPointerMove={handleSpotlight}>
        <nav className="tool-rail"><button className={panel === 'hand' ? 'active' : ''} onClick={() => setPanel('hand')} aria-label="Bàn tay" title="Bàn tay">✎</button>{active && <button className={panel === 'edit' ? 'active' : ''} onClick={() => setPanel('edit')} aria-label="Chỉnh sửa" title="Chỉnh sửa">☷</button>}<button className={panel === 'subtitle' ? 'active' : ''} onClick={() => setPanel('subtitle')} aria-label="Phụ đề" title="Phụ đề">CC</button></nav>
        <div className="inspector-body">{panel === 'subtitle'
          ? <SubtitlePanel settings={project.subtitle} update={updateSubtitle} />
          : panel === 'hand' || !active
          ? <HandPanel style={project.handStyle} setStyle={(handStyle) => setProject((current) => ({ ...current, handStyle }))} />
          : <EditPanel frame={active} analysis={analysis} last={project.frames.at(-1)?.id === active.id} scope={editScope} setScope={setEditScope} selectedObjectId={selectedObjectId} selectedObjectIds={selectedObjectIds} selectObject={selectOnlyObject} toggleObjectSelection={toggleObjectSelection} groupSelectedObjects={groupSelectedObjects} ungroupObject={ungroupObject} rescanObject={(objectId) => void rescanObject(objectId)} updateFrameSettings={updateFrameSettings} updateTransition={updateTransition} updateObject={updateObject} reorderObject={reorderObject} setObjectOrderDirect={setObjectOrderDirect} audioClip={project.audioClips.find((clip) => clip.frameId === active.id)} removeAudio={removeActiveAudio} removeFrame={removeActiveFrame} />}
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

function makeRasterAnalysis(rgba: Uint8Array, w: number, h: number): AnalysisResult {
  // This is intentionally not an analysis result from WASM: raster mode has no
  // semantic blocks and no DrawUnits. Player only needs source RGBA and a
  // stable background to initialize its canvas.
  const samples = [0, w - 1, (h - 1) * w, w * h - 1]
  const bg = samples.reduce<[number, number, number]>((sum, pixel) => [sum[0] + rgba[pixel * 4], sum[1] + rgba[pixel * 4 + 1], sum[2] + rgba[pixel * 4 + 2]], [0, 0, 0]).map((value) => Math.round(value / samples.length)) as [number, number, number]
  return {
    img: { rgba, gray: new Uint8Array(w * h), ink: new Uint8Array(w * h), saliency: new Uint8Array(w * h), w, h, bg },
    blocks: [], units: [],
    stats: { blocks: 0, units: 0, mergeRadiusConfigured: 0, mergeRadiusApplied: 0, workingWidthActual: w, openingApplied: false, segmentationMode: 'standard', backgroundVariance: 0, backgroundEntropy: 0, saliencyThreshold: 0 },
  }
}

function formatTime(seconds: number) { return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` }

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : 'Có lỗi không xác định.' }

class AnalysisStageError extends Error {
  constructor(message: string, readonly frameId: number) { super(message) }
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
