import { describe, expect, it } from 'vitest'
import { DEFAULT_VOICE_BY_LANGUAGE, TTS_VOICES, ttsAssetBaseUrl, ttsAssetUrl } from './voices'

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
    expect(new Set(TTS_VOICES.map((voice) => voice.engine))).toEqual(new Set(['piper', 'matcha', 'vieneu']))
  })

  it('registers all three verified Vietnamese checkpoints', () => {
    const vietnamese = TTS_VOICES.filter((voice) => voice.language === 'vi')
    expect(vietnamese.filter((voice) => voice.engine === 'piper').map((voice) => voice.sourceCheckpoint)).toEqual([
      'vi_VN-vais1000-medium',
      'vi_VN-vivos-x_low',
      'vi_VN-25hours_single-low',
    ])
  })

  it('registers the verified Korean voice with a friendly UI label only', () => {
    const korean = TTS_VOICES.filter((voice) => voice.language === 'ko')
    expect(korean).toHaveLength(1)
    expect(korean[0]).toMatchObject({
      id: 'ko-standard',
      displayName: 'Giọng Hàn tiêu chuẩn',
      engine: 'piper',
      sourceCheckpoint: 'ko_KR-kss-medium',
      sampleRate: 22050,
    })
    expect(korean[0].modelUrls).toEqual({
      onnx: expect.stringContaining('/ko/ko_KR/kss/medium/ko_KR-kss-medium.onnx'),
      config: expect.stringContaining('/ko/ko_KR/kss/medium/ko_KR-kss-medium.onnx.json'),
    })
    expect(DEFAULT_VOICE_BY_LANGUAGE.ko).toBe('ko-standard')
  })

  it('registers MC Ngọc Ngân and the ten named VieNeu presets', () => {
    const vietnamese = TTS_VOICES.filter((voice) => voice.language === 'vi')
    expect(vietnamese.some((voice) => voice.displayName === 'MC. Ngọc Ngân' && voice.engine === 'matcha')).toBe(true)
    expect(vietnamese.filter((voice) => voice.engine === 'vieneu').map((voice) => voice.displayName)).toEqual([
      'Ngọc Lan', 'Ngọc Linh', 'Trúc Ly', 'Mỹ Duyên', 'Xuân Vĩnh', 'Thái Sơn', 'Gia Bảo', 'Đức Trí', 'Trọng Hữu', 'Bình An',
    ])
  })
})
