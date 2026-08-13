export interface PiperVoice {
  id: string
  piperId: string
  displayName: string
  onnxUrl: string
  onnxConfigUrl: string
  sampleRate: number
}

const base = import.meta.env.BASE_URL

export const PIPER_VOICES: PiperVoice[] = [{
  id: 'vi-default',
  piperId: 'vi_VN-vais1000-medium',
  displayName: 'Giọng Việt mặc định (VAIS1000)',
  onnxUrl: `${base}voices/vi-default.onnx`,
  onnxConfigUrl: `${base}voices/vi-default.onnx.json`,
  sampleRate: 22050,
}]

export const DEFAULT_PIPER_VOICE_ID = PIPER_VOICES[0].id

export function piperVoice(id: string): PiperVoice {
  const voice = PIPER_VOICES.find((candidate) => candidate.id === id)
  if (!voice) throw new Error(`Không tìm thấy giọng Piper: ${id}`)
  return voice
}
