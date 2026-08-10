const page = (await fetch('http://127.0.0.1:9222/json/list').then((response) => response.json()))
  .find((item) => item.type === 'page' && item.url.startsWith('http://127.0.0.1:4173/'))
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
const expression = String.raw`(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const cards = document.querySelectorAll('.frame-card')
  if (cards.length !== 2) throw new Error('Test transition cần Project hiện có đúng hai Frame')
  cards[0].click()
  await wait(100)
  const transitions = document.querySelectorAll('.transition-option')
  if (transitions.length !== 4) throw new Error('Không tìm thấy đủ bốn transition')
  transitions[1].click()
  await wait(100)
  const previewButton = document.querySelector('.top-actions button.export')
  const initialDisabled = previewButton?.disabled
  previewButton?.click()
  await wait(250)
  const afterClickDisabled = previewButton?.disabled
  const afterClickText = document.querySelector('.duration')?.textContent ?? ''
  const samples = new Set()
  let transitionCanvasChanged = false
  let previousPixel = ''
  const deadline = performance.now() + 24000
  while (performance.now() < deadline) {
    const text = document.querySelector('.duration')?.textContent ?? ''
    if (text.startsWith('00:09') || text.startsWith('00:10') || text.startsWith('00:11')) samples.add(text)
    if (text.startsWith('00:10')) {
      const canvas = document.querySelector('.render-canvas')
      const pixel = [...canvas.getContext('2d', { willReadFrequently: true }).getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data].join(',')
      if (previousPixel && previousPixel !== pixel) transitionCanvasChanged = true
      previousPixel = pixel
    }
    const preview = document.querySelector('.top-actions button.export')
    if (text.startsWith('00:20') && preview && !preview.disabled) break
    await wait(50)
  }
  const finalText = document.querySelector('.duration')?.textContent ?? ''
  return {
    initialDisabled,
    afterClickDisabled,
    afterClickText,
    samples: [...samples],
    transitionCanvasChanged,
    finalText,
    passed: [...samples].some((text) => text.startsWith('00:09')) && [...samples].some((text) => text.startsWith('00:10')) && [...samples].some((text) => text.startsWith('00:11')) && finalText.startsWith('00:20'),
  }
})()`
const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
socket.close()
if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
console.log(JSON.stringify(result.result.value, null, 2))
if (!result.result.value?.passed) process.exitCode = 1
