import type { FrameSettings } from './settingsDefaults'
import type { HandStyleId, Project, TransitionType } from './projectStore'
import { DEFAULT_SETTINGS } from './settingsDefaults'
import { audioBufferToBase64, base64ToAudioBuffer, bytesToBase64 } from './audioSerialization'

const DB_NAME = 'sketchify-sessions'
const STORE_NAME = 'sessions'
const VERSION = 1
export const CURRENT_SESSION_ID = '__current__'

export interface SerializedFrame {
  id: number
  order: number
  name: string
  imageBase64: string
  imageMimeType: string
  imageSource: 'upload' | 'ai-generated'
  settings: FrameSettings
  transitionToNext: { type: TransitionType; durationSec: number }
  narration?: { text: string; voiceId: string; audioBase64: string; generatedAt: string }
}
export interface SerializedProject { handStyle: HandStyleId; activeFrameId: number | null; frames: SerializedFrame[] }
export interface SessionRecord { id: string; name: string; createdAt: string; updatedAt: string; projectJson: SerializedProject }
export interface SessionSummary { id: string; name: string; updatedAt: string }

export async function listSessions(): Promise<SessionSummary[]> {
  const records = await request<SessionRecord[]>((await dbStore('readonly')).getAll())
  return records.filter((record) => record.id !== CURRENT_SESSION_ID).map(({ id, name, updatedAt }) => ({ id, name, updatedAt })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}
export async function loadSession(id: string): Promise<SessionRecord | undefined> { return request((await dbStore('readonly')).get(id)) }
export async function saveSession(record: SessionRecord): Promise<void> { await request((await dbStore('readwrite')).put(record)) }
export async function deleteSession(id: string): Promise<void> { if (id !== CURRENT_SESSION_ID) await request((await dbStore('readwrite')).delete(id)) }

export async function serializeProject(project: Project): Promise<SerializedProject> {
  return {
    handStyle: project.handStyle,
    activeFrameId: project.activeFrameId,
    frames: await Promise.all(project.frames.map(async (frame, order) => {
      const response = await fetch(frame.sourceUrl)
      const blob = await response.blob()
      return {
        id: frame.id, order, name: frame.name,
        imageBase64: bytesToBase64(new Uint8Array(await blob.arrayBuffer())), imageMimeType: blob.type || 'image/png',
        imageSource: frame.imageSource, settings: structuredClone(frame.settings), transitionToNext: structuredClone(frame.transitionToNext),
        ...(frame.narration?.audioBuffer ? { narration: { text: frame.narration.text, voiceId: frame.narration.voiceId, audioBase64: audioBufferToBase64(frame.narration.audioBuffer), generatedAt: frame.narration.generatedAt } } : {}),
      }
    })),
  }
}

export async function restoreProject(serialized: SerializedProject): Promise<Project> {
  const audioContext = new AudioContext()
  try {
    const frames = await Promise.all([...serialized.frames].sort((a, b) => a.order - b.order).map(async (frame) => {
      const imageBytes = Uint8Array.from(atob(frame.imageBase64), (character) => character.charCodeAt(0))
      const sourceUrl = URL.createObjectURL(new Blob([imageBytes], { type: frame.imageMimeType }))
      const narration = frame.narration ? { text: frame.narration.text, voiceId: frame.narration.voiceId, audioBuffer: await base64ToAudioBuffer(frame.narration.audioBase64, audioContext), generatedAt: frame.narration.generatedAt } : undefined
      const settings = { ...structuredClone(DEFAULT_SETTINGS), ...frame.settings, camera: { ...DEFAULT_SETTINGS.camera, ...frame.settings.camera }, pageZoom: { ...DEFAULT_SETTINGS.pageZoom, ...frame.settings.pageZoom }, cameraPinned: frame.settings.cameraPinned ?? false }
      return { id: frame.id, name: frame.name, sourceUrl, settings, objects: [], transitionToNext: frame.transitionToNext, durationSec: settings.holdDurationSec, analysis: null, dirty: true, imageSource: frame.imageSource, narration }
    }))
    return { frames, activeFrameId: frames.some((frame) => frame.id === serialized.activeFrameId) ? serialized.activeFrameId : frames[0]?.id ?? null, handStyle: serialized.handStyle, playhead: { globalTimeSec: 0 }, audioClips: [] }
  } finally { await audioContext.close() }
}

export async function makeSessionRecord(project: Project, id: string, name: string, createdAt?: string): Promise<SessionRecord> {
  const now = new Date().toISOString()
  return { id, name, createdAt: createdAt ?? now, updatedAt: now, projectJson: await serializeProject(project) }
}

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
