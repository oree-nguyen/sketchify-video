import { readFile } from 'node:fs/promises'

const fixture = (await readFile(new URL('../testthuattoanmoi (1).png', import.meta.url))).toString('base64')
const pages = await fetch('http://localhost:9333/json/list').then((response) => response.json())
const page = pages.find((item) => item.type === 'page')
if (!page) throw new Error('Không tìm thấy tab Edge CDP')
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
let sequence = 0
const pending = new Map()
socket.onmessage = (event) => {
  const message = JSON.parse(event.data), call = pending.get(message.id)
  if (!call) return
  pending.delete(message.id)
  message.error ? call.reject(message.error) : call.resolve(message.result)
}
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence
  pending.set(id, { resolve, reject })
  socket.send(JSON.stringify({ id, method, params }))
})
const evaluate = async (expression) => {
  const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text)
  return response.result.value
}

await send('Page.enable')
await send('Runtime.enable')
await send('Page.navigate', { url: `http://127.0.0.1:4174/?cascade-e2e=${Date.now()}` })
await new Promise((resolve) => setTimeout(resolve, 1000))
const result = await evaluate(`(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const waitFor = async (predicate, timeout = 150000) => {
    const deadline = performance.now() + timeout
    while (performance.now() < deadline) {
      const value = predicate()
      if (value) return value
      await wait(100)
    }
    throw new Error('Timeout cascade browser test')
  }
  window.__cascadeLogs = []
  const originalLog = console.log.bind(console)
  console.log = (...args) => { window.__cascadeLogs.push(args); originalLog(...args) }
  const bytes = Uint8Array.from(atob('${fixture}'), (char) => char.charCodeAt(0))
  const file = new File([bytes], 'tai-sao-99-may-bay.png', { type: 'image/png' })
  const transfer = new DataTransfer(); transfer.items.add(file)
  const input = await waitFor(() => document.querySelector('input[type=file]'))
  Object.defineProperty(input, 'files', { configurable: true, value: transfer.files })
  input.dispatchEvent(new Event('change', { bubbles: true }))
  await waitFor(() => document.querySelectorAll('.object-row').length >= 8 && !document.body.textContent.includes('Đang phân tích bằng WASM'))
  const objectCount = document.querySelectorAll('.object-row').length
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  for (const duration of document.querySelectorAll('.object-duration input')) {
    setter.call(duration, '0.1')
    duration.dispatchEvent(new Event('input', { bubbles: true }))
    duration.dispatchEvent(new Event('change', { bubbles: true }))
  }
  const preview = [...document.querySelectorAll('.top-actions button')].find((button) => button.textContent.includes('Xem thử'))
  preview.click()
  await waitFor(() => window.__cascadeLogs.some((entry) => entry[0] === '[Sketchify] final render verification'), 60000)
  const verification = [...window.__cascadeLogs].reverse().find((entry) => entry[0] === '[Sketchify] final render verification')[1]
  await waitFor(() => [...document.querySelectorAll('.top-actions button')].some((button) => button.textContent.includes('Xem thử')), 60000)
  return { objectCount, verification, status: document.querySelector('.stage-topline')?.textContent ?? '' }
})()`)
result.passed = result.objectCount >= 8 && result.objectCount <= 36
  && result.verification.coveredPixels === 960 * 540
  && result.verification.mismatchedPixels === 0
  && result.verification.maxChannelDiff <= 2
socket.close()
console.log(JSON.stringify(result, null, 2))
if (!result.passed) process.exitCode = 1
