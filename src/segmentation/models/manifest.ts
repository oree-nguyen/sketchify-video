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
}

// Models are opt-in and must be added with a verified hash. An empty registry
// is safer than shipping a guessed URL or silently using an incompatible model.
export const SEGMENTATION_MODEL_MANIFEST: readonly SegmentationModelManifest[] = []

export function validateModelManifest(entry: SegmentationModelManifest): string[] {
  const errors: string[] = []
  if (!entry.id.trim()) errors.push('id is empty')
  if (!entry.url || entry.url.startsWith('/')) errors.push('url must be BASE_URL-relative, not root-absolute')
  if (!/^[a-f0-9]{64}$/i.test(entry.sha256)) errors.push('sha256 must be a 64-character hex digest')
  if (!Number.isSafeInteger(entry.bytes) || entry.bytes <= 0) errors.push('bytes must be a positive integer')
  if (!entry.license.trim()) errors.push('license is required')
  if (!Number.isInteger(entry.opset) || entry.opset < 1) errors.push('opset must be a positive integer')
  return errors
}

export function getModelManifest(id: string): SegmentationModelManifest | undefined {
  return SEGMENTATION_MODEL_MANIFEST.find((entry) => entry.id === id)
}
