import fs from 'node:fs/promises'
import * as ort from 'onnxruntime-web'

ort.env.wasm.numThreads = 1
ort.env.wasm.simd = true

const probes = [
  { id: 'mobilint-yolov8n-seg', file: '../public/segmentation/yolov8n-seg.onnx', input: 'input', shape: [1, 3, 640, 640], outputs: ['output', 'onnx::Shape_356'] },
  { id: 'paddleocrv5-mobile-det', file: '../public/segmentation/ppocrv5_mobile_det.onnx', input: 'x', shape: [1, 3, 640, 640], outputs: ['fetch_name_0'] },
]

const results = []
for (const probe of probes) {
  const bytes = await fs.readFile(new URL(probe.file, import.meta.url))
  const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] })
  const size = probe.shape.reduce((a, b) => a * b, 1)
  const started = performance.now()
  const outputs = await session.run({ [probe.input]: new ort.Tensor('float32', new Float32Array(size), probe.shape) })
  results.push({ id: probe.id, provider: 'onnxruntime-web/wasm', sessionInputs: session.inputNames, sessionOutputs: session.outputNames, outputShapes: probe.outputs.map((name) => outputs[name]?.dims ?? null), inferenceMs: Math.round(performance.now() - started) })
}
const performancePass = results.every((result) => result.inferenceMs <= 8000)
console.log(JSON.stringify({ results, performancePass }, null, 2))
if (!performancePass) process.exitCode = 1
