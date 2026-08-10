const pages = await fetch('http://127.0.0.1:9222/json/list').then((response) => response.json())
const page = pages.find((item) => item.type === 'page' && item.url.startsWith('http://127.0.0.1:4173/'))
if (!page) throw new Error('Không tìm thấy tab Sketchify ở cổng CDP 9222')
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
let sequence = 0
const pending = new Map()
socket.onmessage = (event) => {
  const message = JSON.parse(event.data)
  const call = pending.get(message.id)
  if (!call) return
  pending.delete(message.id)
  message.error ? call.reject(message.error) : call.resolve(message.result)
}
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence
  pending.set(id, { resolve, reject })
  socket.send(JSON.stringify({ id, method, params }))
})
await send('Runtime.enable')
const existingFrames = await send('Runtime.evaluate', { expression: `document.querySelectorAll('.frame-card').length`, returnByValue: true })
if (existingFrames.result.value > 0) {
  await send('Page.reload')
  await new Promise((resolve) => setTimeout(resolve, 1500))
}

const expression = String.raw`(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  if (document.querySelectorAll('.frame-card').length) throw new Error('Tab test phải bắt đầu với Project trống')
  const makeFile = async (name, background, objectX) => {
    const canvas = document.createElement('canvas')
    canvas.width = 480
    canvas.height = 270
    const context = canvas.getContext('2d')
    context.fillStyle = background
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = '#111827'
    context.fillRect(objectX, 80, 110, 100)
    context.font = 'bold 42px sans-serif'
    context.fillStyle = '#ffffff'
    context.fillText(name.at(-1), objectX + 38, 145)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
    return new File([blob], name, { type: 'image/png' })
  }
  const upload = (file) => {
    const input = document.querySelector('input[type=file]')
    if (!input) throw new Error('Khong tim thay input upload dang hoat dong')
    const transfer = new DataTransfer()
    transfer.items.add(file)
    Object.defineProperty(input, 'files', { configurable: true, value: transfer.files })
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }
  upload(await makeFile('frame-1.png', '#fff7ed', 55))
  await wait(150)
  upload(await makeFile('frame-2.png', '#dbeafe', 315))

  const deadline = performance.now() + 15000
  while (performance.now() < deadline) {
    const cards = document.querySelectorAll('.frame-card').length
    const status = document.querySelector('.stage-topline span:last-child')?.textContent ?? ''
    if (cards === 2 && status.includes('khối đã tách')) break
    await wait(100)
  }
  const totalBefore = document.querySelector('.duration')?.textContent ?? ''
  document.querySelector('.top-actions button.export')?.click()

  let crossedBoundary = false
  let boundaryText = ''
  let boundaryPixel = []
  const playbackDeadline = performance.now() + 24000
  while (performance.now() < playbackDeadline) {
    const text = document.querySelector('.duration')?.textContent ?? ''
    const match = text.match(/(\d+):(\d+)\s*\/\s*(\d+):(\d+)/)
    const elapsed = match ? Number(match[1]) * 60 + Number(match[2]) : 0
    if (!crossedBoundary && elapsed >= 11) {
      crossedBoundary = true
      boundaryText = text
      const canvas = document.querySelector('.render-canvas')
      boundaryPixel = [...canvas.getContext('2d', { willReadFrequently: true }).getImageData(5, 5, 1, 1).data]
    }
    if (!document.querySelector('.top-actions button.export')?.disabled && elapsed >= 19) break
    await wait(100)
  }
  const finalText = document.querySelector('.duration')?.textContent ?? ''
  const canvas = document.querySelector('.render-canvas')
  const finalPixel = [...canvas.getContext('2d', { willReadFrequently: true }).getImageData(5, 5, 1, 1).data]
  return {
    frameCount: document.querySelectorAll('.frame-card').length,
    totalBefore,
    crossedBoundary,
    boundaryText,
    boundaryPixel,
    finalText,
    finalPixel,
    passed: totalBefore.endsWith('/ 00:20') && crossedBoundary && boundaryText.startsWith('00:11') && finalText.startsWith('00:20'),
  }
})()`
const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
socket.close()
if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
console.log(JSON.stringify(result.result.value, null, 2))
if (!result.result.value?.passed) process.exitCode = 1
