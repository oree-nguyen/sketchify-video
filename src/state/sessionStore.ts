import type { FrameSettings } from './settingsDefaults'
import { DEFAULT_SUBTITLE_SETTINGS, type BlockOverrides, type HandStyleId, type Project, type SubtitleSettings, type TransitionType } from './projectStore'
import { DEFAULT_SETTINGS } from './settingsDefaults'
import { audioBufferToBase64, base64ToAudioBuffer, bytesToBase64 } from './audioSerialization'
import type { WordTimestamp } from '../tts/types'

const DB_NAME = 'sketchify-sessions'
const STORE_NAME = 'sessions'
const VERSION = 1
const LEGACY_CURRENT_ID = '__current__'
export const ACTIVE_POINTER_ID = '__active_pointer__'

export interface SerializedFrame {
  id: number
  order: number
  name: string
  imageBase64: string
  imageMimeType: string
  imageSource: 'upload' | 'ai-generated'
  settings: FrameSettings
  transitionToNext: { type: TransitionType; durationSec: number }
  narration?: { text: string; voiceId: string; speed?: number; wordTimestamps?: WordTimestamp[]; audioBase64: string; generatedAt: string }
  blockOverrides?: BlockOverrides
}
export interface SerializedProject { handStyle: HandStyleId; activeFrameId: number | null; frames: SerializedFrame[]; subtitle?: SubtitleSettings }
export interface SessionRecord { id: string; name: string; createdAt: string; updatedAt: string; projectJson: SerializedProject }
export interface SessionSummary { id: string; name: string; updatedAt: string; frameCount: number }
interface ActivePointerRecord { id: typeof ACTIVE_POINTER_ID; activeSessionId: string }
type StoredRecord = SessionRecord | ActivePointerRecord

export async function listSessions(): Promise<SessionSummary[]> {
  const records = await request<StoredRecord[]>((await dbStore('readonly')).getAll())
  return records.filter(isSessionRecord).filter((record) => record.id !== LEGACY_CURRENT_ID)
    .map(({ id, name, updatedAt, projectJson }) => ({ id, name, updatedAt, frameCount: projectJson.frames.length }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function loadSession(id: string): Promise<SessionRecord | undefined> {
  const record = await request<StoredRecord | undefined>((await dbStore('readonly')).get(id))
  return isSessionRecord(record) ? record : undefined
}

export async function saveSession(record: SessionRecord): Promise<void> {
  if (isReservedId(record.id)) throw new Error('ID phiên trùng với ID hệ thống.')
  await request((await dbStore('readwrite')).put(record))
}

export async function deleteSession(id: string): Promise<void> {
  if (isReservedId(id)) return
  await request((await dbStore('readwrite')).delete(id))
  if (await getActiveSessionId() === id) await request((await dbStore('readwrite')).delete(ACTIVE_POINTER_ID))
}

export async function getActiveSessionId(): Promise<string | null> {
  const record = await request<StoredRecord | undefined>((await dbStore('readonly')).get(ACTIVE_POINTER_ID))
  return record && 'activeSessionId' in record ? record.activeSessionId : null
}

export async function setActiveSessionId(activeSessionId: string): Promise<void> {
  if (isReservedId(activeSessionId)) throw new Error('Không thể mở bản ghi hệ thống như một phiên.')
  await request((await dbStore('readwrite')).put({ id: ACTIVE_POINTER_ID, activeSessionId } satisfies ActivePointerRecord))
}

export async function createSession(project: Project, name: string): Promise<SessionRecord> {
  const record = await makeSessionRecord(project, crypto.randomUUID(), name)
  await saveSession(record)
  await setActiveSessionId(record.id)
  return record
}

export async function resolveInitialSession(emptyProject: Project): Promise<SessionRecord> {
  const activeId = await getActiveSessionId()
  if (activeId) {
    const active = await loadSession(activeId)
    if (active) return active
  }
  const legacy = await loadSession(LEGACY_CURRENT_ID)
  if (legacy) {
    const migrated = { ...legacy, id: crypto.randomUUID(), name: legacy.name === 'Phiên đang làm' ? 'Phiên được khôi phục' : legacy.name }
    await saveSession(migrated)
    await request((await dbStore('readwrite')).delete(LEGACY_CURRENT_ID))
    await setActiveSessionId(migrated.id)
    return migrated
  }
  const newest = (await listSessions())[0]
  if (newest) {
    const record = await loadSession(newest.id)
    if (record) { await setActiveSessionId(record.id); return record }
  }
  return createSession(emptyProject, 'Phiên mới 1')
}

export async function serializeProject(project: Project): Promise<SerializedProject> {
  return {
    handStyle: project.handStyle,
    activeFrameId: project.activeFrameId,
    subtitle: structuredClone(project.subtitle),
    frames: await Promise.all(project.frames.map(async (frame, order) => {
      const response = await fetch(frame.sourceUrl)
      const blob = await response.blob()
      return {
        id: frame.id, order, name: frame.name,
        imageBase64: bytesToBase64(new Uint8Array(await blob.arrayBuffer())), imageMimeType: blob.type || 'image/png',
        imageSource: frame.imageSource, settings: structuredClone(frame.settings), transitionToNext: structuredClone(frame.transitionToNext), blockOverrides: structuredClone(frame.blockOverrides),
        ...(frame.narration?.audioBuffer ? { narration: { text: frame.narration.text, voiceId: frame.narration.voiceId, speed: frame.narration.speed, wordTimestamps: frame.narration.wordTimestamps, audioBase64: audioBufferToBase64(frame.narration.audioBuffer), generatedAt: frame.narration.generatedAt } } : {}),
      }
    })),
  }
}

export async function restoreProject(serialized: SerializedProject): Promise<Project> {
  const subtitle = { ...structuredClone(DEFAULT_SUBTITLE_SETTINGS), ...serialized.subtitle }
  subtitle.fontSizePx = Math.max(7, Math.min(20, subtitle.fontSizePx))
  if (!serialized.frames.length) return { frames: [], activeFrameId: null, handStyle: serialized.handStyle ?? 'pencil', playhead: { globalTimeSec: 0 }, audioClips: [], subtitle }
  const audioContext = new AudioContext()
  try {
    const frames = await Promise.all([...serialized.frames].sort((a, b) => a.order - b.order).map(async (frame) => {
      const imageBytes = Uint8Array.from(atob(frame.imageBase64), (character) => character.charCodeAt(0))
      const sourceUrl = URL.createObjectURL(new Blob([imageBytes], { type: frame.imageMimeType }))
      const narration = frame.narration ? { text: frame.narration.text, voiceId: frame.narration.voiceId, speed: frame.narration.speed ?? 1, wordTimestamps: frame.narration.wordTimestamps ?? [], audioBuffer: await base64ToAudioBuffer(frame.narration.audioBase64, audioContext), generatedAt: frame.narration.generatedAt } : undefined
      const settings = { ...structuredClone(DEFAULT_SETTINGS), ...frame.settings, camera: { ...DEFAULT_SETTINGS.camera, ...frame.settings.camera }, pageZoom: { ...DEFAULT_SETTINGS.pageZoom, ...frame.settings.pageZoom }, cameraPinned: frame.settings.cameraPinned ?? false }
      return { id: frame.id, name: frame.name, sourceUrl, settings, objects: [], transitionToNext: frame.transitionToNext, durationSec: settings.holdDurationSec, analysis: null, dirty: true, imageSource: frame.imageSource, narration, blockOverrides: frame.blockOverrides ?? { splits: [] } }
    }))
    return { frames, activeFrameId: frames.some((frame) => frame.id === serialized.activeFrameId) ? serialized.activeFrameId : frames[0]?.id ?? null, handStyle: serialized.handStyle, playhead: { globalTimeSec: 0 }, audioClips: [], subtitle }
  } finally { await audioContext.close() }
}

export async function makeSessionRecord(project: Project, id: string, name: string, createdAt?: string): Promise<SessionRecord> {
  const now = new Date().toISOString()
  return { id, name, createdAt: createdAt ?? now, updatedAt: now, projectJson: await serializeProject(project) }
}

function isSessionRecord(record: StoredRecord | undefined): record is SessionRecord {
  return Boolean(record && 'projectJson' in record && typeof record.name === 'string')
}
function isReservedId(id: string): boolean { return id === ACTIVE_POINTER_ID || id === LEGACY_CURRENT_ID }

let databasePromise: Promise<IDBDatabase> | null = null
function database(): Promise<IDBDatabase> {
  databasePromise ??= new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, VERSION)
    open.onupgradeneeded = () => {
      const objectStore = open.result.createObjectStore(STORE_NAME, { keyPath: 'id' })
      objectStore.createIndex('updatedAt', 'updatedAt')
    }
    open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error)
  })
  return databasePromise
}
async function dbStore(mode: IDBTransactionMode): Promise<IDBObjectStore> { return (await database()).transaction(STORE_NAME, mode).objectStore(STORE_NAME) }
function request<T>(placeholder: IDBRequest<T>): Promise<T> { return new Promise((resolve, reject) => { placeholder.onsuccess = () => resolve(placeholder.result); placeholder.onerror = () => reject(placeholder.error) }) }
