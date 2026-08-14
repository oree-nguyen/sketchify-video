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
await send('Page.navigate', { url: `http://127.0.0.1:4173/?pause-e2e=${Date.now()}` })
await new Promise((resolve) => setTimeout(resolve, 800))
const result = await evaluate(`(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const source = document.createElement('canvas')
  source.width = 320; source.height = 180
  const context = source.getContext('2d')
  context.fillStyle = '#fff'; context.fillRect(0, 0, 320, 180)
  context.fillStyle = '#111'
  context.fillRect(20, 60, 40, 40)
  context.fillRect(64, 70, 20, 12)
  context.fillRect(230, 50, 50, 50)
  const blob = await new Promise((resolve) => source.toBlob(resolve, 'image/png'))
  const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'pause-test.png', { type: 'image/png' }))
  const fileInput = document.querySelector('input[type=file]'); fileInput.files = transfer.files
  fileInput.dispatchEvent(new Event('change', { bubbles: true }))
  const analysisDeadline = performance.now() + 30000
  while ((!document.querySelector('.inspector-title p')?.textContent.includes('pause-test.png') || document.querySelectorAll('.object-row').length !== 3) && performance.now() < analysisDeadline) await wait(100)
  const objectCount = document.querySelectorAll('.object-row').length
  const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  for (const duration of document.querySelectorAll('.object-duration input')) {
    inputSetter.call(duration, '0.5'); duration.dispatchEvent(new Event('input', { bubbles: true })); duration.dispatchEvent(new Event('change', { bubbles: true }))
    await wait(30)
  }
  ;[...document.querySelectorAll('[role=tab]')].find((button) => button.textContent.includes('Khung hình'))?.click()
  await wait(100)
  const frameSummary = () => [...document.querySelectorAll('.setting-section')].find((section) => section.querySelector('summary')?.textContent.includes('Khung hình'))?.querySelector('summary small')?.textContent ?? ''
  const beforeTotal = frameSummary()
  const groupRange = [...document.querySelectorAll('.range-field')].find((label) => label.textContent.includes('Nghỉ khi chuyển ý khác'))?.querySelector('input')
  inputSetter.call(groupRange, '800'); groupRange.dispatchEvent(new Event('input', { bubbles: true })); groupRange.dispatchEvent(new Event('change', { bubbles: true }))
  await wait(120)
  const afterTotal = frameSummary()
  const previewButton = [...document.querySelectorAll('.top-actions button')].find((button) => button.textContent.includes('Xem thử'))
  previewButton.click()
  const canvas = document.querySelector('.render-canvas')
  const started = performance.now(), samples = []
  while (performance.now() - started < 8000) {
    samples.push({ t: performance.now() - started, hash: canvas.toDataURL() })
    if (performance.now() - started > 500 && [...document.querySelectorAll('.top-actions button')].some((button) => button.textContent.includes('Xem thử'))) break
    await wait(30)
  }
  const stableRuns = []
  let runStart = samples[0]?.t ?? 0
  for (let index = 1; index < samples.length; index++) {
    if (samples[index].hash !== samples[index - 1].hash) {
      const duration = samples[index].t - runStart
      if (duration >= 120) stableRuns.push(Math.round(duration))
      runStart = samples[index].t
    }
  }
  return { objectCount, beforeTotal, afterTotal, elapsedMs: Math.round(performance.now() - started), stableRuns }
})()`)
const number = (text) => Number.parseFloat(String(text).replace(',', '.'))
result.totalIncreaseSec = Math.round((number(result.afterTotal) - number(result.beforeTotal)) * 10) / 10
result.passed = result.objectCount === 3 && result.totalIncreaseSec === 0.2 && result.stableRuns.some((ms) => ms >= 150 && ms <= 350) && result.stableRuns.some((ms) => ms >= 650 && ms <= 950)
socket.close()
console.log(JSON.stringify(result, null, 2))
if (!result.passed) process.exitCode = 1
