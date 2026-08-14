const pages = await fetch('http://127.0.0.1:9333/json/list').then((response) => response.json())
const page = pages.find((item) => item.type === 'page')
if (!page) throw new Error('Không tìm thấy tab Edge CDP')
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
let sequence = 0
const pending = new Map()
socket.onmessage = (event) => { const message = JSON.parse(event.data), call = pending.get(message.id); if (!call) return; pending.delete(message.id); message.error ? call.reject(message.error) : call.resolve(message.result) }
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })) })
const evaluate = async (expression) => { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result.value }
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

await send('Page.enable')
await send('Runtime.enable')
await send('Page.navigate', { url: `http://127.0.0.1:4173/?subtitle-e2e=${Date.now()}` })
await wait(1200)

const prepared = await evaluate(`(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const upload = async (name, label) => {
    const source = document.createElement('canvas'); source.width = 420; source.height = 240
    const context = source.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, 420, 240); context.fillStyle = '#111'; context.font = '42px sans-serif'; context.fillText(label, 80, 125)
    const blob = await new Promise((resolve) => source.toBlob(resolve, 'image/png')); const transfer = new DataTransfer(); transfer.items.add(new File([blob], name, { type: 'image/png' }))
    const input = document.querySelector('input[type=file]'); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }))
    const deadline = performance.now() + 30000; while (!document.querySelector('.narration-bar') && performance.now() < deadline) await wait(100)
  }
  if (!document.querySelector('.frame-card')) await upload('subtitle-a.png', 'PHU DE A')
  if (!document.querySelector('.narration-preview')) {
    const textarea = document.querySelector('.narration-bar textarea'); if (!textarea) throw new Error('Không có ô lời thoại')
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(textarea, 'Câu thứ nhất, câu thứ hai dài hơn. Kết thúc!')
    textarea.dispatchEvent(new Event('input', { bubbles: true })); textarea.dispatchEvent(new Event('change', { bubbles: true }))
    await wait(100); document.querySelector('.narration-actions button').click()
    const deadline = performance.now() + 180000; while (!document.querySelector('.narration-preview') && performance.now() < deadline) await wait(250)
    if (!document.querySelector('.narration-preview')) throw new Error('Piper không tạo được audio')
  }
  if (document.querySelectorAll('.frame-card').length < 2) await upload('subtitle-b.png', 'PHU DE B')
  document.querySelector('[aria-label="Phụ đề"]').click(); await wait(80)
  const toggle = document.querySelector('[aria-label="Bật tắt phụ đề"]'); if (toggle.getAttribute('aria-pressed') !== 'true') toggle.click()
  const sample = document.querySelector('.subtitle-position-sample'), surface = sample?.parentElement
  if (!sample || !surface) throw new Error('Không có khung mẫu kéo thả')
  const a = sample.getBoundingClientRect(), b = surface.getBoundingClientRect()
  return { start: { x: a.left + a.width / 2, y: a.top + a.height / 2 }, target: { x: b.left + b.width * .28, y: b.top + b.height * .34 } }
})()`)

await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: prepared.start.x, y: prepared.start.y, button: 'left', clickCount: 1 })
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: prepared.target.x, y: prepared.target.y, button: 'left', buttons: 1 })
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: prepared.target.x, y: prepared.target.y, button: 'left', clickCount: 1 })
await wait(150)

const beforeReload = await evaluate(`(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const position = () => { const sample = document.querySelector('.subtitle-position-sample'); return { left: sample?.style.left, top: sample?.style.top } }
  const first = position()
  const cards = [...document.querySelectorAll('.frame-card')]
  cards[0].click(); await wait(80); document.querySelector('[aria-label="Phụ đề"]').click(); await wait(40); const onFirstFrame = position()
  cards[1].click(); await wait(80); document.querySelector('[aria-label="Phụ đề"]').click(); await wait(40); const onSecondFrame = position()
  await wait(5200)
  return { first, onFirstFrame, onSecondFrame, enabledBeforeReload: document.querySelector('[aria-label="Bật tắt phụ đề"]')?.getAttribute('aria-pressed') === 'true' }
})()`)
await send('Page.reload', { ignoreCache: true })
await wait(1400)
const persisted = await evaluate(`(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)); document.querySelector('[aria-label="Phụ đề"]').click(); await wait(80)
  const sample = document.querySelector('.subtitle-position-sample')
  return { afterReload: { left: sample?.style.left, top: sample?.style.top }, ccPersistent: document.querySelector('[aria-label="Bật tắt phụ đề"]')?.getAttribute('aria-pressed') === 'true', railAlwaysVisible: Boolean(document.querySelector('.tool-rail [aria-label="Phụ đề"]')) }
})()`)
const burn = await evaluate(`(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const cards = [...document.querySelectorAll('.frame-card')]; cards[0].click(); await wait(500)
  document.querySelector('[aria-label="Phụ đề"]').click(); await wait(50)
  const cc = document.querySelector('[aria-label="Bật tắt phụ đề"]'); if (cc.getAttribute('aria-pressed') !== 'true') { cc.click(); await wait(80) }
  const color = document.querySelector('[aria-label="Màu phụ đề"]')
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(color, '#ff00ff'); color.dispatchEvent(new Event('input', { bubbles: true })); color.dispatchEvent(new Event('change', { bubbles: true })); await wait(80)
  const sampleMagenta = () => {
    const canvas = document.querySelector('.render-canvas'), context = canvas.getContext('2d', { willReadFrequently: true }), data = context.getImageData(0, 0, canvas.width, canvas.height).data
    let count = 0, sx = 0, sy = 0
    for (let p = 0; p < data.length; p += 4) if (data[p] > 210 && data[p + 1] < 90 && data[p + 2] > 210) { const i = p / 4; count++; sx += i % canvas.width; sy += Math.floor(i / canvas.width) }
    return { count, x: count ? sx / count / canvas.width : 0, y: count ? sy / count / canvas.height : 0 }
  }
  const play = document.querySelector('.top-actions .quiet'); play.click(); await wait(700); const first = sampleMagenta(); await wait(700); const second = sampleMagenta(); play.click(); await wait(180)
  if (cc.getAttribute('aria-pressed') === 'true') cc.click(); await wait(80)
  play.click(); await wait(700); const disabled = sampleMagenta(); play.click(); await wait(120)
  return { first, second, disabled, canvasCapturedDirectly: document.querySelector('.render-canvas') instanceof HTMLCanvasElement }
})()`)
const recordAndInspect = async (enabled) => {
  const setup = await evaluate(`(() => {
    const cc = document.querySelector('[aria-label="Bật tắt phụ đề"]'); if ((cc.getAttribute('aria-pressed') === 'true') !== ${enabled}) cc.click()
    const button = document.querySelector('.top-actions .export'), bounds = button.getBoundingClientRect()
    return { oldHref: document.querySelector('a[download="sketchify-video.webm"]')?.href, x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2, disabled: button.disabled }
  })()`)
  if (setup.disabled) throw new Error('Nút Tạo .webm vẫn bị khóa trước khi ghi')
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: setup.x, y: setup.y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: setup.x, y: setup.y, button: 'left', clickCount: 1 })
  return evaluate(`(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), deadline = performance.now() + 90000
    while ((document.querySelector('.top-actions .export').disabled || document.querySelector('a[download="sketchify-video.webm"]')?.href === ${JSON.stringify(setup.oldHref)}) && performance.now() < deadline) await wait(200)
    const url = document.querySelector('a[download="sketchify-video.webm"]')?.href; if (!url || url === ${JSON.stringify(setup.oldHref)}) throw new Error('MediaRecorder không tạo URL WebM mới')
    const video = document.createElement('video'); video.muted = true; video.src = url; const loaded = await new Promise((resolve) => { video.onloadedmetadata = () => resolve(true); video.onerror = () => resolve(false) }); const blob = await fetch(url).then((response) => response.blob())
    if (!loaded) return { count: 0, duration: 0, blobSize: blob.size, mediaError: video.error?.code }
    video.currentTime = Math.min(.7, Math.max(.1, video.duration / 3)); await new Promise((resolve) => { video.onseeked = resolve })
    const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight; const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(video, 0, 0); const data = context.getImageData(0, 0, canvas.width, canvas.height).data; let count = 0
    for (let p = 0; p < data.length; p += 4) if (data[p] > 190 && data[p + 1] < 110 && data[p + 2] > 190) count++
    return { count, duration: video.duration, width: video.videoWidth, height: video.videoHeight, blobSize: blob.size }
  })()`)
}
const recording = { enabled: await recordAndInspect(true), disabled: await recordAndInspect(false) }
const result = { ...beforeReload, ...persisted, burn, recording }
result.passed = result.railAlwaysVisible && result.enabledBeforeReload && result.ccPersistent && result.first.left === result.onFirstFrame.left && result.first.left === result.onSecondFrame.left && result.first.left === result.afterReload.left && result.first.top === result.afterReload.top && parseFloat(result.first.left) < 40 && parseFloat(result.first.top) < 50 && burn.first.count > 10 && burn.second.count > 10 && Math.abs(burn.first.x - .28) < .08 && Math.abs(burn.second.x - .28) < .08 && burn.disabled.count === 0 && burn.canvasCapturedDirectly && recording.enabled.count > 10 && recording.disabled.count === 0 && recording.enabled.blobSize > 0 && recording.disabled.blobSize > 0
socket.close()
console.log(JSON.stringify(result, null, 2))
if (!result.passed) process.exitCode = 1
