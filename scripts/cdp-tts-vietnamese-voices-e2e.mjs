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
await send('Page.navigate', { url: `http://127.0.0.1:4173/?tts-vi-e2e=${Date.now()}` })
await new Promise((resolve) => setTimeout(resolve, 900))
const result = await evaluate(`(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const waitFor = async (test, timeout, message) => {
    const deadline = performance.now() + timeout
    while (!test() && performance.now() < deadline) await wait(20)
    if (!test()) throw new Error(message)
  }
  window.__ttsAlerts = []
  window.alert = (message) => window.__ttsAlerts.push(String(message))
  const source = document.createElement('canvas')
  source.width = 320; source.height = 180
  const context = source.getContext('2d')
  context.fillStyle = '#fff'; context.fillRect(0, 0, 320, 180)
  context.fillStyle = '#111'; context.font = 'bold 34px sans-serif'; context.fillText('XIN CHÀO', 65, 100)
  const blob = await new Promise((resolve) => source.toBlob(resolve, 'image/png'))
  const transfer = new DataTransfer()
  transfer.items.add(new File([blob], 'tts-vi-test.png', { type: 'image/png' }))
  const input = document.querySelector('input[type=file]')
  const frameCount = document.querySelectorAll('.frame-card').length
  input.files = transfer.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
  await waitFor(() => document.querySelectorAll('.frame-card').length > frameCount, 3000, 'Frame test mới chưa được tạo')
  await waitFor(() => !document.querySelector('.narration-preview'), 3000, 'Frame test mới chưa trở thành frame hiện tại')
  await waitFor(() => document.querySelector('.narration-bar'), 30000, 'Không mở được thanh lồng tiếng')
  if (document.querySelector('.narration-preview')) throw new Error('Frame test mới không được chứa audio cũ')

  const selectSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
  const language = document.querySelector('select[aria-label="Ngôn ngữ giọng đọc"]')
  selectSetter.call(language, 'vi')
  language.dispatchEvent(new Event('change', { bubbles: true }))
  await wait(100)
  const voice = document.querySelector('select[aria-label="Giọng đọc"]')
  const textSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  const choices = [...voice.options].map((option) => ({ value: option.value, label: option.textContent }))
  const outputs = []
  for (let index = 0; index < choices.length; index++) {
    const choice = choices[index]
    const currentVoice = document.querySelector('select[aria-label="Giọng đọc"]')
    selectSetter.call(currentVoice, choice.value)
    currentVoice.dispatchEvent(new Event('change', { bubbles: true }))
    await waitFor(() => document.querySelector('select[aria-label="Giọng đọc"]')?.value === choice.value, 1000, 'Không đổi được giọng: ' + choice.label)
    const textarea = document.querySelector('.narration-bar textarea')
    textSetter.call(textarea, 'Xin chào, đây là lần kiểm tra giọng đọc số ' + (index + 1) + '.')
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    textarea.dispatchEvent(new Event('change', { bubbles: true }))
    await wait(100)
    const alertCount = window.__ttsAlerts.length
    const button = document.querySelector('.narration-actions button')
    const states = []
    const sampler = setInterval(() => {
      const label = button.textContent?.trim()
      if (label && states.at(-1) !== label) states.push(label)
    }, 20)
    button.click()
    await waitFor(() => button.disabled, 3000, 'Nút không chuyển sang trạng thái bận: ' + choice.label)
    await waitFor(() => !button.disabled || window.__ttsAlerts.length > alertCount, 240000, 'Tạo audio quá thời gian: ' + choice.label)
    clearInterval(sampler)
    const preview = document.querySelector('.narration-preview')
    const play = preview?.querySelector('button')
    if (preview) play?.click()
    await wait(80)
    outputs.push({
      label: choice.label,
      states,
      alert: window.__ttsAlerts[alertCount] ?? null,
      duration: preview?.querySelector('span')?.textContent ?? '',
      playbackStarted: Boolean(preview) && play?.disabled === true,
    })
  }
  return { choices, outputs }
})()`)
result.passed = result.choices.length === 3 && result.outputs.every((entry) => !entry.alert && entry.duration && entry.playbackStarted && entry.states.some((state) => state.includes('Đang')))
socket.close()
console.log(JSON.stringify(result, null, 2))
if (!result.passed) process.exitCode = 1
