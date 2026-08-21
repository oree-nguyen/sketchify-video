import { describe, expect, it } from 'vitest'
import { validateModelManifest } from './manifest'

describe('segmentation model manifest', () => {
  it('rejects root-absolute URLs and missing hashes', () => {
    const errors = validateModelManifest({ id: 'x', lane: 'known-object', url: '/models/x.onnx', sha256: 'bad', bytes: 0, license: '', opset: 0, enabled: true })
    expect(errors).toEqual(expect.arrayContaining(['url must be BASE_URL-relative, not root-absolute', 'sha256 must be a 64-character hex digest']))
  })
})
