import fs from 'node:fs/promises'
import * as ort from 'onnxruntime-web'

ort.env.wasm.numThreads = 1
ort.env.wasm.simd = true

const acousticBytes = await fs.readFile(new URL('../public/voices/matcha-ngoc-ngan.onnx', import.meta.url))
const vocoderBytes = await fs.readFile(new URL('../public/voices/hifigan-ngoc-ngan.onnx', import.meta.url))
const acoustic = await ort.InferenceSession.create(acousticBytes, { executionProviders: ['wasm'] })
const vocoder = await ort.InferenceSession.create(vocoderBytes, { executionProviders: ['wasm'] })

const ids = [0, 24, 0, 31, 0, 40, 0, 51, 0, 18, 0]
const acousticOutput = await acoustic.run({
  x: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]),
  x_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
  scales: new ort.Tensor('float32', Float32Array.from([0.667, 1]), [2]),
})
const fastOutput = await acoustic.run({
  x: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]),
  x_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
  scales: new ort.Tensor('float32', Float32Array.from([0.667, 1 / 1.5]), [2]),
})
const mel = acousticOutput.mel
if (!(mel?.data instanceof Float32Array) || mel.dims[1] !== 80 || mel.dims[2] < 2) throw new Error('Matcha Ngọc Ngân returned invalid mel output')
if (!(fastOutput.mel?.dims[2] < mel.dims[2])) throw new Error('Matcha speed multiplier did not shorten the generated timeline')
const output = await vocoder.run({ mel: new ort.Tensor('float32', mel.data, mel.dims) })
const pcm = output.wav?.data
if (!(pcm instanceof Float32Array) || pcm.length < 256) throw new Error('HiFi-GAN Ngọc Ngân returned invalid PCM')
const peak = pcm.reduce((value, sample) => Math.max(value, Math.abs(sample)), 0)
if (!Number.isFinite(peak) || peak <= 0) throw new Error('HiFi-GAN Ngọc Ngân returned silent PCM')

console.log(JSON.stringify({
  provider: 'onnxruntime-web/wasm',
  acousticInputs: acoustic.inputNames,
  vocoderInputs: vocoder.inputNames,
  melShape: mel.dims,
  fastMelShape: fastOutput.mel.dims,
  samples: pcm.length,
  durationSec: Number((pcm.length / 22050).toFixed(3)),
  peak: Number(peak.toFixed(6)),
}))
