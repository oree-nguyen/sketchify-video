export function audioBufferToBase64(buffer: AudioBuffer): string {
  const channels = buffer.numberOfChannels
  const frames = buffer.length
  const bytes = new ArrayBuffer(44 + frames * channels * 2)
  const view = new DataView(bytes)
  writeAscii(view, 0, 'RIFF'); view.setUint32(4, 36 + frames * channels * 2, true)
  writeAscii(view, 8, 'WAVE'); writeAscii(view, 12, 'fmt '); view.setUint32(16, 16, true)
  view.setUint16(20, 1, true); view.setUint16(22, channels, true); view.setUint32(24, buffer.sampleRate, true)
  view.setUint32(28, buffer.sampleRate * channels * 2, true); view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data'); view.setUint32(40, frames * channels * 2, true)
  let offset = 44
  for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < channels; channel++) {
    const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[frame]))
    view.setInt16(offset, sample < 0 ? sample * 32768 : sample * 32767, true); offset += 2
  }
  return bytesToBase64(new Uint8Array(bytes))
}

export async function base64ToAudioBuffer(base64: string, context: AudioContext): Promise<AudioBuffer> {
  const bytes = base64ToBytes(base64)
  return context.decodeAudioData(Uint8Array.from(bytes).buffer)
}

export function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  return new Blob([Uint8Array.from(base64ToBytes(audioBufferToBase64(buffer))).buffer], { type: 'audio/wav' })
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunk) binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
  return btoa(binary)
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function writeAscii(view: DataView, offset: number, text: string) {
  for (let index = 0; index < text.length; index++) view.setUint8(offset + index, text.charCodeAt(index))
}
