export type ModelLane = 'text' | 'known-object' | 'unknown-object'

export interface SegmentationModelManifest {
  id: string
  lane: ModelLane
  url: string
  sha256: string
  bytes: number
  license: string
  opset: number
  enabled: boolean
  inputName?: string
  outputNames?: string[]
  outputLayout?: 'yolov8-seg'
  inputSize?: number
  classCount?: number
}

// Models are opt-in and must be added with a verified hash. An empty registry
// is safer than shipping a guessed URL or silently using an incompatible model.
export const SEGMENTATION_MODEL_MANIFEST: readonly SegmentationModelManifest[] = [
  {
    id: 'mobilint-yolov8n-seg', lane: 'known-object',
    url: 'segmentation/yolov8n-seg.onnx',
    sha256: 'cb1e689c548b3fa019691c9c1762f38a76276981ce75d31f6c5aae396dbff78b',
    bytes: 13834790, license: 'AGPL-3.0', opset: 19, enabled: true,
    inputName: 'input', outputNames: ['output', 'onnx::Shape_356'], outputLayout: 'yolov8-seg', inputSize: 640, classCount: 80,
  },
]

export function validateModelManifest(entry: SegmentationModelManifest): string[] {
  const errors: string[] = []
  if (!entry.id.trim()) errors.push('id is empty')
  if (!entry.url || entry.url.startsWith('/')) errors.push('url must be BASE_URL-relative, not root-absolute')
  if (!/^[a-f0-9]{64}$/i.test(entry.sha256)) errors.push('sha256 must be a 64-character hex digest')
  if (!Number.isSafeInteger(entry.bytes) || entry.bytes <= 0) errors.push('bytes must be a positive integer')
  if (!entry.license.trim()) errors.push('license is required')
  if (!Number.isInteger(entry.opset) || entry.opset < 1) errors.push('opset must be a positive integer')
  if (entry.outputLayout === 'yolov8-seg' && (entry.inputSize ?? 0) <= 0) errors.push('YOLO layout requires inputSize')
  return errors
}

export function getModelManifest(id: string): SegmentationModelManifest | undefined {
  return SEGMENTATION_MODEL_MANIFEST.find((entry) => entry.id === id)
}
