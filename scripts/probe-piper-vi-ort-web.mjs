import fs from 'node:fs/promises'
import * as ort from 'onnxruntime-web'

ort.env.wasm.numThreads = 1
ort.env.wasm.simd = true

const ids = [1, 31, 0, 120, 0, 21, 0, 26, 0, 3, 0, 31, 0, 121, 0, 18, 0, 20, 0, 120, 0, 14, 0, 62, 0, 32, 0, 120, 0, 54, 0, 2]
const voices = [
  { file: 'vi-vivos-x-low.onnx', sampleRate: 16000, speaker: true },
  { file: 'vi-25hours-low.onnx', sampleRate: 16000, speaker: false },
]

const results = []
for (const voice of voices) {
  const model = await fs.readFile(new URL(`../public/voices/${voice.file}`, import.meta.url))
  const session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'] })
  const feeds = {
    input: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]),
    input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
    scales: new ort.Tensor('float32', Float32Array.from([0.667, 1, 0.8]), [3]),
  }
  if (voice.speaker) feeds.sid = new ort.Tensor('int64', BigInt64Array.from([0n]), [1])
  const started = performance.now()
  const output = await session.run(feeds)
  const pcm = output.output?.data
  if (!(pcm instanceof Float32Array) || pcm.length === 0) throw new Error(`${voice.file}: PCM không hợp lệ`)
  const peak = pcm.reduce((value, sample) => Math.max(value, Math.abs(sample)), 0)
  results.push({ file: voice.file, inputs: session.inputNames, samples: pcm.length, durationSec: Number((pcm.length / voice.sampleRate).toFixed(3)), inferenceMs: Math.round(performance.now() - started), peak: Number(peak.toFixed(6)) })
}

console.log(JSON.stringify(results))
