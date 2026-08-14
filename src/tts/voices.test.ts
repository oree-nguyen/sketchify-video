import { describe, expect, it } from 'vitest'
import { TTS_VOICES, ttsAssetBaseUrl, ttsAssetUrl } from './voices'

describe('TTS voice registry', () => {
  it('keeps deployment assets under the GitHub Pages repository path', () => {
    const page = 'https://oree-nguyen.github.io/sketchify-video/'
    expect(ttsAssetBaseUrl(page, './')).toBe(page)
    expect(ttsAssetUrl('voices/vi-default.onnx', page, './')).toBe(`${page}voices/vi-default.onnx`)
  })

  it('never exposes internal engine/checkpoint names through display names', () => {
    for (const voice of TTS_VOICES) {
      expect(voice.displayName).not.toMatch(/piper|matcha|onnx|checkpoint/i)
    }
    expect(new Set(TTS_VOICES.map((voice) => voice.engine))).toEqual(new Set(['piper', 'matcha']))
  })
})
