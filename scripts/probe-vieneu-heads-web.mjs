import fs from 'node:fs/promises'
import * as ort from 'onnxruntime-web'

ort.env.wasm.numThreads = 1
const embed = await ort.InferenceSession.create(await fs.readFile(new URL('../public/voices/vieneu-v3/embed.onnx', import.meta.url)), { executionProviders: ['wasm'] })
const heads = await ort.InferenceSession.create(await fs.readFile(new URL('../public/voices/vieneu-v3/heads.onnx', import.meta.url)), { executionProviders: ['wasm'] })
const rows = [8, ...Array(16).fill(1024), 3, ...Array(16).fill(1024)]
const embedded = await embed.run({ rows: new ort.Tensor('int64', BigInt64Array.from(rows, BigInt), [2, 17]) })
const output = await heads.run({
  hidden: new ort.Tensor('float32', embedded.embeddings.data.slice(0, 768), [1, 768]),
  channel: new ort.Tensor('int64', BigInt64Array.from([0n]), [1]),
  code: new ort.Tensor('int64', BigInt64Array.from([1n]), [1]),
  text_id: new ort.Tensor('int64', BigInt64Array.from([5n]), [1]),
})
if (embedded.embeddings.dims.join(',') !== '1,2,768') throw new Error(`Invalid embedding shape ${embedded.embeddings.dims}`)
if (output.audio_logits.dims.at(-1) !== 1024 || output.text_logits.dims.at(-1) !== 419) throw new Error('Invalid VieNeu head shapes')
if (![...output.audio_logits.data].every(Number.isFinite)) throw new Error('VieNeu audio head returned non-finite values')
console.log(JSON.stringify({ provider: 'onnxruntime-web/wasm', embeddingShape: embedded.embeddings.dims, audioLogitsShape: output.audio_logits.dims, textLogitsShape: output.text_logits.dims }))
