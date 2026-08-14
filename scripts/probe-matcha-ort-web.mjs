import fs from 'node:fs/promises'
import * as ort from 'onnxruntime-web'

ort.env.wasm.numThreads = 1
ort.env.wasm.simd = true

const model = await fs.readFile(new URL('../public/voices/matcha-ljspeech-q8.onnx', import.meta.url))
const session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'] })

// The community graph uses the official Matcha text-id contract: int64 x,
// int64 x_lengths and float32 [temperature, speakingRate]. Interspersed zeroes
// are the blank symbols expected by Matcha.
const ids = [0, 45, 0, 42, 0, 49, 0, 49, 0, 52, 0]
const feeds = {
  x: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]),
  x_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
  scales: new ort.Tensor('float32', Float32Array.from([0.667, 0.95]), [2]),
}
const output = await session.run(feeds)
const pcm = output.wav?.data
if (!(pcm instanceof Float32Array) || pcm.length < 2205) {
  throw new Error(`Matcha web probe returned invalid PCM (${pcm?.length ?? 0} samples)`)
}
const peak = pcm.reduce((value, sample) => Math.max(value, Math.abs(sample)), 0)
if (!Number.isFinite(peak) || peak <= 0) throw new Error('Matcha web probe returned silent/invalid PCM')

console.log(JSON.stringify({
  provider: 'onnxruntime-web/wasm',
  inputs: session.inputNames,
  outputs: session.outputNames,
  samples: pcm.length,
  durationSec: Number((pcm.length / 22050).toFixed(3)),
  peak: Number(peak.toFixed(6)),
}))
