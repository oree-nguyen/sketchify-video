import type { SegmentationLane, SegmentationInput, ProposalNode } from '../laneTypes'
import type { SegmentationModelManifest } from './manifest'
import { loadModel } from './loader'
import { createRuntimeSession } from './ortRuntime'
import { encodeMaskRle } from '../contracts'

interface Detection { bbox: { x: number; y: number; w: number; h: number }; score: number; classId: number; coeff: Float32Array }

/** YOLOv8-seg adapter for the verified output layout declared in the manifest. */
export function createObjectDetectorLane(manifest?: SegmentationModelManifest): SegmentationLane {
  let executionProvider: 'webgpu' | 'wasm' | undefined
  return {
    id: 'known-object-detector', kind: 'known-object',
    get executionProvider() { return executionProvider },
    available: () => Boolean(manifest?.enabled && manifest.outputLayout === 'yolov8-seg'),
    propose: async (input) => {
      if (!manifest?.enabled) throw new Error('YOLO segmentation manifest is disabled')
      if (manifest.outputLayout !== 'yolov8-seg') throw new Error('YOLO segmentation output layout is not declared')
      const model = await loadModel(manifest)
      const runtime = await createRuntimeSession(model)
      executionProvider = runtime.provider
      const ort = await import('onnxruntime-web')
      const inputSize = manifest.inputSize ?? 640
      const prepared = letterboxRgb(input.image.rgba, input.image.w, input.image.h, inputSize)
      const tensor = new ort.Tensor('float32', prepared.data, [1, 3, inputSize, inputSize])
      const outputs = await runtime.session.run({ [manifest.inputName ?? 'images']: tensor })
      const prediction = outputs[manifest.outputNames?.[0] ?? 'output']
      const prototype = outputs[manifest.outputNames?.[1] ?? 'proto']
      if (!prediction || !prototype) throw new Error('YOLO segmentation output tensors are missing')
      const detections = decodeYoloV8(prediction.data as Float32Array, prediction.dims, prototype.dims, input.image.w, input.image.h, prepared, manifest.classCount ?? 80)
      const selected = nonMaximumSuppression(detections, .55).slice(0, 100)
      const proposals: ProposalNode[] = []
      for (const [index, detection] of selected.entries()) {
        const mask = decodeMask(prototype.data as Float32Array, prototype.dims, detection.coeff, input.image.w, input.image.h, prepared)
        if (mask.length < 16) continue
        proposals.push({ id: `detector:${index}`, bbox: detection.bbox, maskRle: encodeMaskRle(mask), confidence: detection.score, evidence: [{ source: 'detector', score: detection.score, note: `YOLOv8-seg class ${detection.classId}` }], roleHint: 'thing' })
      }
      return proposals
    },
  }
}

function sigmoid(value: number): number { return 1 / (1 + Math.exp(-Math.max(-60, Math.min(60, value)))) }

function decodeYoloV8(data: Float32Array, dims: readonly (number | string)[], protoDims: readonly (number | string)[], width: number, height: number, prepared: Letterbox, classCount: number): Detection[] {
  const channels = Number(dims[1]), count = Number(dims[2]), protoChannels = Number(protoDims[1])
  if (!Number.isFinite(channels) || !Number.isFinite(count) || channels < 5 || protoChannels <= 0 || data.length < channels * count) throw new Error('Unsupported YOLOv8-seg output shape')
  const actualClasses = Math.min(classCount, channels - 4 - protoChannels)
  const result: Detection[] = []
  for (let i = 0; i < count; i++) {
    const cx = data[i], cy = data[count + i], bw = data[count * 2 + i], bh = data[count * 3 + i]
    let classId = -1, score = 0
    for (let classIndex = 0; classIndex < actualClasses; classIndex++) {
      const raw = data[(4 + classIndex) * count + i]
      const candidate = raw >= 0 && raw <= 1 ? raw : sigmoid(raw)
      if (candidate > score) { score = candidate; classId = classIndex }
    }
    if (score < .25 || classId < 0) continue
    const left = (cx - bw / 2 - prepared.padX) / prepared.scale, top = (cy - bh / 2 - prepared.padY) / prepared.scale
    const right = (cx + bw / 2 - prepared.padX) / prepared.scale, bottom = (cy + bh / 2 - prepared.padY) / prepared.scale
    const x = Math.max(0, Math.min(width - 1, left)), y = Math.max(0, Math.min(height - 1, top))
    const x2 = Math.max(x + 1, Math.min(width, right)), y2 = Math.max(y + 1, Math.min(height, bottom))
    const coeff = new Float32Array(protoChannels)
    for (let channel = 0; channel < protoChannels; channel++) coeff[channel] = data[(4 + actualClasses + channel) * count + i]
    result.push({ bbox: { x, y, w: x2 - x, h: y2 - y }, score, classId, coeff })
  }
  return result.sort((a, b) => b.score - a.score)
}

function nonMaximumSuppression(detections: readonly Detection[], threshold: number): Detection[] {
  const selected: Detection[] = []
  for (const candidate of detections) if (selected.every((other) => iou(candidate.bbox, other.bbox) < threshold || candidate.classId !== other.classId)) selected.push(candidate)
  return selected
}

function iou(a: Detection['bbox'], b: Detection['bbox']): number {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)), y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)), intersection = x * y
  return intersection / Math.max(1, a.w * a.h + b.w * b.h - intersection)
}

interface Letterbox { data: Float32Array; scale: number; padX: number; padY: number }

function letterboxRgb(rgba: Uint8Array, width: number, height: number, size: number): Letterbox {
  const scale = Math.min(size / width, size / height), resizedWidth = Math.max(1, Math.round(width * scale)), resizedHeight = Math.max(1, Math.round(height * scale)), padX = (size - resizedWidth) / 2, padY = (size - resizedHeight) / 2
  const data = new Float32Array(3 * size * size)
  for (let y = 0; y < resizedHeight; y++) for (let x = 0; x < resizedWidth; x++) {
    const sourceX = Math.min(width - 1, Math.floor(x / scale)), sourceY = Math.min(height - 1, Math.floor(y / scale)), source = (sourceY * width + sourceX) * 4, target = (Math.floor(y + padY) * size + Math.floor(x + padX))
    data[target] = rgba[source] / 255; data[size * size + target] = rgba[source + 1] / 255; data[size * size * 2 + target] = rgba[source + 2] / 255
  }
  return { data, scale, padX, padY }
}

function decodeMask(proto: Float32Array, dims: readonly (number | string)[], coeff: Float32Array, width: number, height: number, prepared: Letterbox): number[] {
  const channels = Number(dims[1]), protoHeight = Number(dims[2]), protoWidth = Number(dims[3]), mask: number[] = []
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const px = Math.max(0, Math.min(protoWidth - 1, Math.floor((x * prepared.scale + prepared.padX) / 4))), py = Math.max(0, Math.min(protoHeight - 1, Math.floor((y * prepared.scale + prepared.padY) / 4))), index = py * protoWidth + px
    let value = 0; for (let channel = 0; channel < channels; channel++) value += coeff[channel] * proto[channel * protoWidth * protoHeight + index]
    if (sigmoid(value) > .5) mask.push(y * width + x)
  }
  return mask
}
