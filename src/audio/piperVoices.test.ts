import { describe, expect, it } from 'vitest'
import { piperAssetBaseUrl, piperAssetUrl } from './piperVoices'

describe('Piper deployment asset URLs', () => {
  it('keeps the GitHub Pages repository subpath', () => {
    const page = 'https://oree-nguyen.github.io/sketchify-video/'
    expect(piperAssetBaseUrl(page, './')).toBe(page)
    expect(piperAssetUrl('voices/vi-default.onnx.json', page, './')).toBe(`${page}voices/vi-default.onnx.json`)
  })

  it('also works at a root deployment', () => {
    expect(piperAssetUrl('voices/vi-default.onnx', 'https://example.pages.dev/', './')).toBe('https://example.pages.dev/voices/vi-default.onnx')
  })
})
