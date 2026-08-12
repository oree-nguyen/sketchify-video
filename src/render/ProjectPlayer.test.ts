import { describe, expect, it } from 'vitest'
import { recordingTracks } from './ProjectPlayer'

describe('ProjectPlayer recording stream', () => {
  it('ghép track canvas và track audio vào cùng MediaRecorder stream', () => {
    const video = { kind: 'video' } as MediaStreamTrack
    const audio = { kind: 'audio' } as MediaStreamTrack
    expect(recordingTracks({ getVideoTracks: () => [video] }, { getAudioTracks: () => [audio] }).map((track) => track.kind)).toEqual(['video', 'audio'])
  })
})
