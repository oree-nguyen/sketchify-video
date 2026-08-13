import { describe, expect, it } from 'vitest'
import { audioBufferToBase64, base64ToBytes } from './audioSerialization'

describe('audio serialization', () => {
  it('encodes an AudioBuffer-shaped PCM source as a valid WAV base64 payload', () => {
    const channels = [new Float32Array([0, .5, -1, 1]), new Float32Array([.25, -.25, 0, .75])]
    const buffer = { numberOfChannels: 2, length: 4, sampleRate: 22050, getChannelData: (channel: number) => channels[channel] } as AudioBuffer
    const bytes = base64ToBytes(audioBufferToBase64(buffer))
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('RIFF')
    expect(new TextDecoder().decode(bytes.subarray(8, 12))).toBe('WAVE')
    expect(new DataView(bytes.buffer).getUint32(40, true)).toBe(16)
    expect(bytes.length).toBe(60)
  })
})
