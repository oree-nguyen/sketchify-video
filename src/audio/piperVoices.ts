export interface PiperVoice {
  id: string
  piperId: string
  displayName: string
  onnxUrl: string
  onnxConfigUrl: string
  sampleRate: number
}

function currentDocumentBase(): string {
  if (typeof document !== 'undefined') return document.baseURI
  if (typeof location !== 'undefined') return location.href
  return 'http://localhost/'
}

export function piperAssetBaseUrl(documentBase = currentDocumentBase(), viteBase = import.meta.env.BASE_URL): string {
  return new URL(viteBase, documentBase).href
}

export function piperAssetUrl(path: string, documentBase = currentDocumentBase(), viteBase = import.meta.env.BASE_URL): string {
  return new URL(path, piperAssetBaseUrl(documentBase, viteBase)).href
}

export const PIPER_VOICES: PiperVoice[] = [{
  id: 'vi-default',
  piperId: 'vi_VN-vais1000-medium',
  displayName: 'Giọng Việt mặc định (VAIS1000)',
  onnxUrl: piperAssetUrl('voices/vi-default.onnx'),
  onnxConfigUrl: piperAssetUrl('voices/vi-default.onnx.json'),
  sampleRate: 22050,
}]

export const DEFAULT_PIPER_VOICE_ID = PIPER_VOICES[0].id

export function piperVoice(id: string): PiperVoice {
  const voice = PIPER_VOICES.find((candidate) => candidate.id === id)
  if (!voice) throw new Error(`Không tìm thấy giọng Piper: ${id}`)
  return voice
}
