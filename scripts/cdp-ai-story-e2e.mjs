import { deflateSync } from 'node:zlib'

const pages = await fetch('http://127.0.0.1:9222/json/list').then((response) => response.json())
const page = pages.find((item) => item.type === 'page') ?? pages[0]
if (!page) throw new Error('Không tìm thấy Chrome CDP')
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
let sequence = 0
const pending = new Map()
const eventHandlers = new Map()
socket.onmessage = (event) => {
  const message = JSON.parse(event.data)
  if (message.id) {
    const call = pending.get(message.id)
    if (!call) return
    pending.delete(message.id)
    message.error ? call.reject(message.error) : call.resolve(message.result)
  } else eventHandlers.get(message.method)?.(message.params)
}
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence
  pending.set(id, { resolve, reject })
  socket.send(JSON.stringify({ id, method, params }))
})
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value
}
const jsonBody = (value) => Buffer.from(JSON.stringify(value)).toString('base64')
const testPng = makeTestPng(128, 96).toString('base64')
const wav = makeSilentWav(.3)
const calls = []

eventHandlers.set('Fetch.requestPaused', async ({ requestId, request }) => {
  calls.push(request.url)
  const cors = [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Headers', value: 'authorization,content-type' }, { name: 'Access-Control-Allow-Methods', value: 'POST,OPTIONS' }]
  if (request.method === 'OPTIONS') {
    await send('Fetch.fulfillRequest', { requestId, responseCode: 204, responseHeaders: cors })
  } else if (request.url.includes('/v1/chat/completions')) {
    await send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [...cors, { name: 'Content-Type', value: 'application/json' }], body: jsonBody({ choices: [{ message: { content: JSON.stringify({ scenes: [{ order: 1, narrationText: 'Xin chào từ cảnh một.', imagePrompt: 'Một vòng tròn trên nền trắng' }] }) } }] }) })
  } else if (request.url.includes('/v1/images/generations')) {
    await send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [...cors, { name: 'Content-Type', value: 'application/json' }], body: jsonBody({ data: [{ b64_json: testPng }] }) })
  } else if (request.url.includes('/v1/audio/speech')) {
    await send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [...cors, { name: 'Content-Type', value: 'audio/wav' }], body: wav.toString('base64') })
  } else await send('Fetch.continueRequest', { requestId })
})

await send('Page.enable')
await send('Runtime.enable')
await send('Fetch.enable', { patterns: [{ urlPattern: 'https://gen.pollinations.ai/*', requestStage: 'Request' }] })
await send('Page.navigate', { url: `http://127.0.0.1:4173/?ai-story=${Date.now()}` })
await new Promise((resolve) => setTimeout(resolve, 700))
await evaluate(`localStorage.setItem('wb.pollinations.key','sk_mock_story'); location.reload()`).catch(() => undefined)
await new Promise((resolve) => setTimeout(resolve, 650))
const result = await evaluate(String.raw`(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const waitFor = async (test, timeout = 30000) => { const end = performance.now() + timeout; while (performance.now() < end) { const value = test(); if (value) return value; await wait(50) } throw new Error('Timeout AI story') }
  window.__aiErrors = []
  addEventListener('unhandledrejection', (event) => window.__aiErrors.push(String(event.reason?.stack ?? event.reason)))
  const click = (selector, text) => [...document.querySelectorAll(selector)].find((node) => node.textContent.includes(text))?.click()
  click('.empty-preview button', 'Tạo video')
  await wait(50)
  click('.ai-choice-grid button', 'Tạo video từ chủ đề')
  const textarea = await waitFor(() => document.querySelector('.ai-form textarea'), 3000).catch(() => null)
  if (!textarea) return { completed: false, frameCount: 0, hasAiMeta: false, hasNarration: false, hasAudio: false, progress: '', dialogText: document.querySelector('.ai-dialog')?.textContent ?? '', key: localStorage.getItem('wb.pollinations.key'), connectText: document.querySelector('.ai-connect')?.textContent }
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(textarea, 'Chủ đề kiểm thử')
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
  const count = document.querySelector('.ai-form input[type=number]')
  const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  inputSetter.call(count, '1')
  count.dispatchEvent(new Event('input', { bubbles: true }))
  const form = document.querySelector('.ai-form')
  HTMLFormElement.prototype.requestSubmit.call(form)
  const completed = await waitFor(() => document.querySelector('.ai-progress')?.textContent.includes('Đã tạo đủ'), 60000).catch(() => false)
  const frameCount = document.querySelectorAll('.frame-card').length
  document.querySelector('.ai-dialog-head button')?.click()
  await wait(80)
  document.querySelectorAll('.edit-scope-tabs button')[1]?.click()
  await waitFor(() => document.querySelector('.inspector audio'), 5000).catch(() => null)
  const inspector = document.querySelector('.inspector-body')?.textContent ?? ''
  const audio = document.querySelector('.inspector audio')
  document.querySelectorAll('.edit-scope-tabs button')[0]?.click()
  await waitFor(() => document.querySelector('.object-duration input'), 5000).catch(() => null)
  const durationSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  document.querySelectorAll('.object-duration input').forEach((input) => { durationSetter.call(input, '.1'); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })) })
  await wait(100)
  document.querySelector('.top-actions button.export')?.click()
  const download = await waitFor(() => document.querySelector('.top-actions a[download]'), 30000).catch(() => null)
  const videoBlobSize = download ? (await (await fetch(download.href)).blob()).size : 0
  return { completed, frameCount, hasAiMeta: inspector.includes('Ảnh do AI tạo'), hasNarration: inspector.includes('Xin chào từ cảnh một'), hasAudio: Boolean(audio?.src), videoBlobSize, errors: window.__aiErrors, topText: document.querySelector('.top-actions')?.textContent ?? '', progress: document.querySelector('.ai-progress')?.textContent ?? '', dialogText: document.querySelector('.ai-dialog')?.textContent ?? '' }
})()`)
result.networkCalls = calls.filter((url, index) => url.includes('gen.pollinations.ai') && index % 2 === 1).map((url) => new URL(url).pathname)
result.sequentialContract = result.networkCalls.join('|') === '/v1/chat/completions|/v1/images/generations|/v1/audio/speech'
result.videoDownloadReady = result.topText.includes('Tải video')
// Chrome headless trên Windows có thể trả MediaRecorder Blob 0 byte dù cùng build tạo file trong Chrome GUI.
// Hợp đồng ghép video+audio được kiểm riêng bằng ProjectPlayer.test.ts; E2E này xác nhận nút tải xuất hiện.
result.passed = result.frameCount === 1 && result.hasAiMeta && result.hasNarration && result.hasAudio && result.sequentialContract && result.videoDownloadReady && result.errors.length === 0
socket.close()
console.log(JSON.stringify(result, null, 2))
if (!result.passed) process.exitCode = 1

function makeSilentWav(seconds) {
  const sampleRate = 8000, samples = Math.ceil(sampleRate * seconds), dataSize = samples * 2
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + dataSize, 4); buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36); buffer.writeUInt32LE(dataSize, 40)
  return buffer
}
function makeTestPng(width, height) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1)
    for (let x = 0; x < width; x++) {
      const offset = row + 1 + x * 4
      const dark = x >= 28 && x < 100 && y >= 20 && y < 76
      raw[offset] = dark ? 35 : 255; raw[offset + 1] = dark ? 55 : 255; raw[offset + 2] = dark ? 75 : 255; raw[offset + 3] = 255
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))])
}

function pngChunk(type, data) {
  const name = Buffer.from(type), chunk = Buffer.alloc(12 + data.length)
  chunk.writeUInt32BE(data.length, 0); name.copy(chunk, 4); data.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length)
  return chunk
}

function crc32(data) {
  let crc = 0xffffffff
  for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)) }
  return (crc ^ 0xffffffff) >>> 0
}
