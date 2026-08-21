import { describe, expect, it } from 'vitest'
import { SEGMENTATION_MODEL_MANIFEST, validateModelManifest } from './manifest'

describe('segmentation model manifest', () => {
  it('rejects root-absolute URLs and missing hashes', () => {
    const errors = validateModelManifest({ id: 'x', lane: 'known-object', url: '/models/x.onnx', sha256: 'bad', bytes: 0, license: '', opset: 0, enabled: true })
    expect(errors).toEqual(expect.arrayContaining(['url must be BASE_URL-relative, not root-absolute', 'sha256 must be a 64-character hex digest']))
  })

  it('ships the verified known-object artifact with a relative URL and matching metadata', () => {
    const model = SEGMENTATION_MODEL_MANIFEST.find((entry) => entry.id === 'mobilint-yolov8n-seg')
    expect(model).toBeDefined()
    expect(validateModelManifest(model!)).toEqual([])
    expect(model?.outputLayout).toBe('yolov8-seg')
    expect(model?.inputName).toBe('input')
    expect(model?.bytes).toBe(13_834_790)
  })
})
