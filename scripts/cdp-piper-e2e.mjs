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
await send('Page.navigate', { url: `http://127.0.0.1:4173/?piper-e2e=${Date.now()}` })
await new Promise((resolve) => setTimeout(resolve, 900))
const result = await evaluate(`(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  window.__piperAlerts = []
  window.alert = (message) => window.__piperAlerts.push(String(message))
  const source = document.createElement('canvas')
  source.width = 320; source.height = 180
  const context = source.getContext('2d')
  context.fillStyle = '#fff'; context.fillRect(0, 0, 320, 180)
  context.fillStyle = '#111'; context.font = '32px sans-serif'; context.fillText('Xin chào', 70, 95)
  const blob = await new Promise((resolve) => source.toBlob(resolve, 'image/png'))
  const transfer = new DataTransfer()
  transfer.items.add(new File([blob], 'piper-test.png', { type: 'image/png' }))
  const input = document.querySelector('input[type=file]')
  input.files = transfer.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
  const analysisDeadline = performance.now() + 30000
  while (!document.querySelector('.narration-bar') && performance.now() < analysisDeadline) await wait(100)
  const textarea = document.querySelector('.narration-bar textarea')
  if (!textarea) throw new Error('Không mở được thanh lồng tiếng sau phân tích ảnh')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(textarea, 'Xin chào, đây là bản kiểm tra giọng đọc.')
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
  textarea.dispatchEvent(new Event('change', { bubbles: true }))
  await wait(200)
  const button = document.querySelector('.narration-actions button')
  if (!button || button.disabled) throw new Error('Nút Tạo audio vẫn bị khóa sau khi nhập lời thoại')
  const states = []
  const sampler = setInterval(() => {
    const text = document.querySelector('.narration-actions button')?.textContent?.trim()
    if (text && states.at(-1) !== text) states.push(text)
  }, 100)
  document.querySelector('.narration-actions button').click()
  const deadline = performance.now() + 180000
  while (!document.querySelector('.narration-preview') && performance.now() < deadline && window.__piperAlerts.length === 0) await wait(250)
  clearInterval(sampler)
  const preview = document.querySelector('.narration-preview')
  const playButton = preview?.querySelector('button')
  playButton?.click()
  await wait(80)
  const playbackStarted = playButton?.disabled === true
  return {
    states,
    alerts: window.__piperAlerts,
    hasPreview: Boolean(preview),
    durationText: preview?.querySelector('span')?.textContent ?? '',
    playbackStarted,
    voiceResources: performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => name.includes('/voices/') || name.includes('/piper/') || name.includes('/ort/')),
  }
})()`)
result.passed = result.hasPreview && result.playbackStarted && result.alerts.length === 0 && result.states.some((state) => state.includes('100%'))
socket.close()
console.log(JSON.stringify(result, null, 2))
if (!result.passed) process.exitCode = 1
