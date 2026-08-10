const pages = await fetch('http://127.0.0.1:9222/json/list').then((response) => response.json())
const page = pages.find((item) => item.type === 'page' && item.url.startsWith('http://127.0.0.1:4173/'))
if (!page) throw new Error('Không tìm thấy tab Sketchify ở cổng CDP 9222')
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
  const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }))
})
await send('Runtime.enable')
await send('Page.bringToFront')
await send('Page.reload')
await new Promise((resolve) => setTimeout(resolve, 900))

const expression = String.raw`(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const waitFor = async (test, timeout = 15000) => {
    const deadline = performance.now() + timeout
    while (performance.now() < deadline) { const value = test(); if (value) return value; await wait(50) }
    throw new Error('Timeout project playback acceptance')
  }
  window.__projectErrors = []
  addEventListener('error', (event) => window.__projectErrors.push(String(event.error?.stack ?? event.message)))
  addEventListener('unhandledrejection', (event) => window.__projectErrors.push(String(event.reason?.stack ?? event.reason)))
  const makeFile = async (name, background, objectX) => {
    const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 270
    const context = canvas.getContext('2d'); context.fillStyle = background; context.fillRect(0, 0, 480, 270)
    context.fillStyle = '#111827'; context.fillRect(objectX, 80, 110, 100)
    context.fillStyle = '#fff'; context.font = 'bold 42px sans-serif'; context.fillText(name.at(-5), objectX + 38, 145)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
    return new File([blob], name, { type: 'image/png' })
  }
  const input = await waitFor(() => document.querySelector('input[type=file]'))
  const upload = (file) => {
    const transfer = new DataTransfer(); transfer.items.add(file)
    Object.defineProperty(input, 'files', { configurable: true, value: transfer.files })
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }
  upload(await makeFile('frame-1.png', '#fff7ed', 55))
  await waitFor(() => document.querySelectorAll('.frame-card').length === 1 && document.querySelectorAll('.object-row').length === 1)
  upload(await makeFile('frame-2.png', '#dbeafe', 315))
  await waitFor(() => document.querySelectorAll('.frame-card').length === 2 && document.querySelectorAll('.object-row').length === 1)
  const setInput = (input, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value))
    input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }))
  }
  for (const index of [0, 1]) {
    document.querySelectorAll('.frame-card')[index].click(); await wait(50)
    setInput(document.querySelector('.object-duration input'), .5)
    document.querySelectorAll('.edit-scope-tabs button')[1].click(); await wait(30)
    setInput(document.querySelector('.setting-section .range-input'), 0)
    await wait(50)
  }
  document.querySelectorAll('.frame-card')[0].click(); await wait(50)
  const totalBefore = document.querySelector('.duration')?.textContent ?? ''
  document.querySelector('.top-actions button.quiet')?.click()
  let crossedBoundary = false, boundaryText = '', boundaryFrame = '', boundaryPixel = []
  const progressSamples = []
  const deadline = performance.now() + 12000
  while (performance.now() < deadline) {
    const text = document.querySelector('.duration')?.textContent ?? ''
    const match = text.match(/(\d+):(\d+)\s*\/\s*(\d+):(\d+)/)
    const elapsed = match ? Number(match[1]) * 60 + Number(match[2]) : 0
    if (progressSamples.at(-1) !== text) progressSamples.push(text)
    const selectedFrame = document.querySelector('.frame-card.selected span:last-child')?.textContent ?? ''
    if (!crossedBoundary && selectedFrame === 'frame-2.png') {
      crossedBoundary = true; boundaryText = text
      boundaryFrame = selectedFrame
      const canvas = document.querySelector('.render-canvas')
      boundaryPixel = [...canvas.getContext('2d', { willReadFrequently: true }).getImageData(5, 5, 1, 1).data]
    }
    if (crossedBoundary && document.querySelector('.top-actions button.quiet')?.textContent === 'Xem thử') break
    await wait(50)
  }
  const finalText = document.querySelector('.duration')?.textContent ?? ''
  const finalFrame = document.querySelector('.frame-card.selected span:last-child')?.textContent ?? ''
  return {
    frameCount: document.querySelectorAll('.frame-card').length,
    totalBefore, crossedBoundary, boundaryText, boundaryFrame, boundaryPixel, finalText, finalFrame, progressSamples, errors: window.__projectErrors,
    passed: totalBefore.endsWith('/ 00:01') && (crossedBoundary || finalFrame === 'frame-2.png') && document.querySelector('.top-actions button.quiet')?.textContent === 'Xem thử',
  }
})()`
const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
socket.close()
if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text)
console.log(JSON.stringify(response.result.value, null, 2))
if (!response.result.value?.passed) process.exitCode = 1
