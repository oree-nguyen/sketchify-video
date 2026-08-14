const pages = await fetch('http://127.0.0.1:9333/json/list').then((response) => response.json())
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
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value
}

await send('Page.enable')
await send('Runtime.enable')
await send('Page.navigate', { url: `http://127.0.0.1:4173/?tts-matcha-overlay-e2e=${Date.now()}` })
await new Promise((resolve) => setTimeout(resolve, 900))
const result = await evaluate(`(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const waitFor = async (test, timeout, message) => {
    const deadline = performance.now() + timeout
    while (!test() && performance.now() < deadline) await wait(100)
    if (!test()) throw new Error(message)
  }
  window.__ttsAlerts = []
  window.alert = (message) => window.__ttsAlerts.push(String(message))
  const source = document.createElement('canvas')
  source.width = 480; source.height = 270
  const context = source.getContext('2d')
  context.fillStyle = '#fff'; context.fillRect(0, 0, 480, 270)
  context.fillStyle = '#111'; context.font = 'bold 48px sans-serif'; context.fillText('HELLO', 45, 110)
  context.beginPath(); context.arc(360, 155, 60, 0, Math.PI * 2); context.fill()
  const blob = await new Promise((resolve) => source.toBlob(resolve, 'image/png'))
  const transfer = new DataTransfer()
  transfer.items.add(new File([blob], 'tts-overlay-test.png', { type: 'image/png' }))
  const input = document.querySelector('input[type=file]')
  const frameCount = document.querySelectorAll('.frame-card').length
  input.files = transfer.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
  await waitFor(() => document.querySelectorAll('.frame-card').length > frameCount, 3000, 'Frame test mới chưa được tạo')
  await waitFor(() => !document.querySelector('.narration-preview'), 3000, 'Frame test mới chưa trở thành frame hiện tại')
  await waitFor(() => document.querySelector('.narration-bar') && document.querySelectorAll('.block-overlay .block').length > 0, 30000, 'Không có kết quả phân tích/overlay')

  const scrubber = document.querySelector('input[aria-label="Playhead"]')
  const rangeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  rangeSetter.call(scrubber, '0')
  scrubber.dispatchEvent(new Event('input', { bubbles: true }))
  scrubber.dispatchEvent(new Event('change', { bubbles: true }))
  await wait(50)
  document.querySelector('.play').click()
  await waitFor(() => document.querySelector('.preview')?.classList.contains('is-playing'), 3000, 'Preview không bắt đầu')
  await wait(300)
  const overlay = document.querySelector('.block-overlay')
  const overlayStyle = getComputedStyle(overlay)
  const overlayDuringPlayback = {
    blockCount: overlay.querySelectorAll('.block').length,
    display: overlayStyle.display,
    visibility: overlayStyle.visibility,
    opacity: overlayStyle.opacity,
    zIndex: overlayStyle.zIndex,
  }
  ;[...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Dừng')?.click()
  await waitFor(() => !document.querySelector('.preview')?.classList.contains('is-playing'), 30000, 'Không dừng được preview sau khi kiểm tra overlay')
  const cards = document.querySelectorAll('.frame-card')
  cards[cards.length - 1].click()
  await waitFor(() => !document.querySelector('.narration-preview'), 3000, 'Không quay lại được frame test sạch')

  const language = document.querySelector('select[aria-label="Ngôn ngữ giọng đọc"]')
  const selectSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
  selectSetter.call(language, 'en')
  language.dispatchEvent(new Event('change', { bubbles: true }))
  await wait(100)
  const voice = document.querySelector('select[aria-label="Giọng đọc"]')
  const visibleVoice = voice.selectedOptions[0]?.textContent ?? ''
  const textarea = document.querySelector('.narration-bar textarea')
  const previousPreview = document.querySelector('.narration-preview')
  if (previousPreview) throw new Error('Frame test mới không được chứa audio cũ')
  const textSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  textSetter.call(textarea, 'Hello world.')
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
  textarea.dispatchEvent(new Event('change', { bubbles: true }))
  await wait(100)
  const button = document.querySelector('.narration-actions button')
  const states = []
  const sampler = setInterval(() => {
    const label = document.querySelector('.narration-actions button')?.textContent?.trim()
    if (label && states.at(-1) !== label) states.push(label)
  }, 100)
  button.click()
  await waitFor(() => button.disabled, 3000, 'Nút tạo audio không chuyển sang trạng thái bận')
  await waitFor(() => (document.querySelector('.narration-preview') && document.querySelector('.narration-preview') !== previousPreview) || window.__ttsAlerts.length, 180000, 'Tạo audio quá thời gian')
  clearInterval(sampler)
  const audioPreview = document.querySelector('.narration-preview')
  const playAudio = audioPreview?.querySelector('button')
  playAudio?.click()
  await wait(100)
  return {
    overlayDuringPlayback,
    visibleVoice,
    states,
    alerts: window.__ttsAlerts,
    hasAudio: Boolean(audioPreview && audioPreview !== previousPreview),
    duration: audioPreview?.querySelector('span')?.textContent ?? '',
    audioPlaybackStarted: playAudio?.disabled === true,
  }
})()`)
result.passed = result.overlayDuringPlayback.blockCount > 0
  && result.overlayDuringPlayback.display !== 'none'
  && result.overlayDuringPlayback.visibility !== 'hidden'
  && result.overlayDuringPlayback.opacity !== '0'
  && result.hasAudio && result.audioPlaybackStarted && result.alerts.length === 0
  && result.states.some((state) => state.includes('Đang'))
  && !/piper|matcha|onnx|checkpoint/i.test(result.visibleVoice)
socket.close()
console.log(JSON.stringify(result, null, 2))
if (!result.passed) process.exitCode = 1
