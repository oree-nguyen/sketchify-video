import type { SegmentationLane, SegmentationInput, ProposalNode } from '../laneTypes'
import type { SegmentationModelManifest } from './manifest'
import { loadModel } from './loader'
import { createRuntimeSession } from './ortRuntime'
import { encodeMaskRle } from '../contracts'

/** PP-OCRv5 DB detector adapter. It returns text-line masks; recognition and
 * compound grouping remain separate graph stages. */
export function createTextDetectorLane(manifest?: SegmentationModelManifest): SegmentationLane {
  let executionProvider: 'webgpu' | 'wasm' | undefined
  return {
    id: 'ocr-text-lines', kind: 'text', get executionProvider() { return executionProvider },
    available: () => Boolean(manifest?.enabled && manifest.outputLayout === 'dbnet'),
    propose: async (input) => {
      if (!manifest?.enabled || manifest.outputLayout !== 'dbnet') throw new Error('PP-OCR DB model manifest is disabled')
      const model = await loadModel(manifest); const runtime = await createRuntimeSession(model); executionProvider = runtime.provider
      const ort = await import('onnxruntime-web'), prepared = prepareDbInput(input.image.rgba, input.image.w, input.image.h, manifest.inputLongSide ?? 960)
      const tensor = new ort.Tensor('float32', prepared.data, [1, 3, prepared.height, prepared.width])
      const output = (await runtime.session.run({ [manifest.inputName ?? 'x']: tensor }))[manifest.outputNames?.[0] ?? 'fetch_name_0']
      if (!output) throw new Error('PP-OCR DB output tensor is missing')
      return decodeDbOutput(output.data as Float32Array, output.dims, input.image.w, input.image.h, prepared)
    },
  }
}

interface PreparedDbInput { data: Float32Array; width: number; height: number; scale: number }

function prepareDbInput(rgba: Uint8Array, width: number, height: number, longSide: number): PreparedDbInput {
  const scale = Math.min(1, longSide / Math.max(width, height)), outWidth = Math.max(32, Math.ceil(width * scale / 32) * 32), outHeight = Math.max(32, Math.ceil(height * scale / 32) * 32)
  const data = new Float32Array(outWidth * outHeight * 3), mean = [.485, .456, .406], std = [.229, .224, .225], plane = outWidth * outHeight
  for (let y = 0; y < outHeight; y++) for (let x = 0; x < outWidth; x++) {
    const sx = Math.min(width - 1, Math.floor(x / scale)), sy = Math.min(height - 1, Math.floor(y / scale)), source = (sy * width + sx) * 4, target = y * outWidth + x
    data[target] = (rgba[source] / 255 - mean[0]) / std[0]; data[plane + target] = (rgba[source + 1] / 255 - mean[1]) / std[1]; data[plane * 2 + target] = (rgba[source + 2] / 255 - mean[2]) / std[2]
  }
  return { data, width: outWidth, height: outHeight, scale }
}

function decodeDbOutput(data: Float32Array, dims: readonly (number | string)[], width: number, height: number, prepared: PreparedDbInput): ProposalNode[] {
  const mapHeight = Number(dims.at(-2)), mapWidth = Number(dims.at(-1)); if (!Number.isFinite(mapWidth) || !Number.isFinite(mapHeight) || data.length < mapWidth * mapHeight) throw new Error('Unsupported PP-OCR DB output shape')
  const labels = new Int32Array(mapWidth * mapHeight); labels.fill(-1); const proposals: ProposalNode[] = []; let nextLabel = 0
  for (let y = 0; y < mapHeight; y++) for (let x = 0; x < mapWidth; x++) {
    const seed = y * mapWidth + x; if (labels[seed] >= 0 || sigmoid(data[seed]) < .3) continue
    const queue = [seed]; labels[seed] = nextLabel; let area = 0, score = 0, minX = x, minY = y, maxX = x, maxY = y
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head], cx = current % mapWidth, cy = Math.floor(current / mapWidth), value = sigmoid(data[current]); area++; score += value; minX = Math.min(minX, cx); minY = Math.min(minY, cy); maxX = Math.max(maxX, cx); maxY = Math.max(maxY, cy)
      for (const [nx, ny] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]]) { if (nx < 0 || ny < 0 || nx >= mapWidth || ny >= mapHeight) continue; const next = ny * mapWidth + nx; if (labels[next] < 0 && sigmoid(data[next]) >= .3) { labels[next] = nextLabel; queue.push(next) } }
    }
    const label = nextLabel++; if (area < 3 || score / area < .6) continue
    const bx = Math.max(0, Math.floor(minX / mapWidth * prepared.width / prepared.scale)), by = Math.max(0, Math.floor(minY / mapHeight * prepared.height / prepared.scale)), ex = Math.min(width, Math.ceil((maxX + 1) / mapWidth * prepared.width / prepared.scale)), ey = Math.min(height, Math.ceil((maxY + 1) / mapHeight * prepared.height / prepared.scale)), pixels: number[] = []
    for (let py = by; py < ey; py++) for (let px = bx; px < ex; px++) { const mx = Math.min(mapWidth - 1, Math.floor(px / width * mapWidth)), my = Math.min(mapHeight - 1, Math.floor(py / height * mapHeight)); if (labels[my * mapWidth + mx] === label) pixels.push(py * width + px) }
    if (pixels.length >= 8) proposals.push({ id: `ocr:${proposals.length}`, bbox: { x: bx, y: by, w: Math.max(1, ex - bx), h: Math.max(1, ey - by) }, maskRle: encodeMaskRle(pixels), confidence: score / area, evidence: [{ source: 'ocr', score: score / area, note: 'PP-OCRv5 DB text-line detector' }], roleHint: 'text-line' })
  }
  return proposals
}

function sigmoid(value: number): number { return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, value)))) }
