const pages = await fetch('http://127.0.0.1:9222/json/list').then((response) => response.json())
const page = pages.find((item) => item.type === 'page') ?? pages[0]
if (!page) throw new Error('Không tìm thấy trang Chrome DevTools')

const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.onopen = resolve
  socket.onerror = reject
})

let sequence = 0
const pending = new Map()
socket.onmessage = (event) => {
  const message = JSON.parse(event.data)
  const call = pending.get(message.id)
  if (!call) return
  pending.delete(message.id)
  if (message.error) call.reject(message.error)
  else call.resolve(message.result)
}
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence
  pending.set(id, { resolve, reject })
  socket.send(JSON.stringify({ id, method, params }))
})

await send('Page.enable')
await send('Runtime.enable')
if (!page.url.startsWith('http://127.0.0.1:4173/')) {
  await send('Page.navigate', { url: 'http://127.0.0.1:4173/' })
  await new Promise((resolve) => setTimeout(resolve, 800))
}

const expression = String.raw`(async () => {
  const [{ analyzeFrame }, camera, defaults] = await Promise.all([
    import('/src/wasm/wasmClient.ts'),
    import('/src/camera/cameraTimeline.ts'),
    import('/src/state/settingsDefaults.ts'),
  ])
  const canvas = document.createElement('canvas')
  canvas.width = 800
  canvas.height = 450
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)

  // Hai vật thể có khoảng cách lớn hơn mergeRadius để buộc pipeline sinh hai block.
  context.fillStyle = '#172033'
  context.fillRect(70, 100, 170, 120)
  context.fillStyle = '#ea580c'
  context.fillRect(570, 245, 150, 120)
  context.fillStyle = '#0f172a'
  context.font = 'bold 32px sans-serif'
  context.fillText('A', 125, 175)
  context.fillText('B', 620, 315)

  const settings = structuredClone(defaults.DEFAULT_SETTINGS)
  settings.mergeRadius = 8
  settings.minBlockInk = 20
  settings.camera.mode = 'A-auto-follow'
  settings.pageZoom.enabled = false
  const rgba = new Uint8Array(context.getImageData(0, 0, canvas.width, canvas.height).data)
  const analysis = await analyzeFrame(rgba, canvas.width, canvas.height, settings)
  const timeline = camera.buildCameraTimeline(settings, analysis.blocks, analysis.units, canvas.width, canvas.height)
  const first = timeline.focusSpans[0]
  const second = timeline.focusSpans[1]
  if (!first || !second) throw new Error('WASM không sinh đủ hai block có DrawUnit')
  const firstCrop = camera.cameraAt(timeline.keys, first.t0)
  const secondCrop = camera.cameraAt(timeline.keys, second.t0)
  const center = (rect) => ({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 })
  const firstCenter = center(firstCrop)
  const secondCenter = center(secondCrop)
  const moved = Math.hypot(secondCenter.x - firstCenter.x, secondCenter.y - firstCenter.y)
  const secondKey = timeline.keys.find((key) => key.role === 'focus' && key.blockId === second.blockId)
  return {
    blocks: analysis.blocks.length,
    units: analysis.units.length,
    unitBlockIds: [...new Set(analysis.units.map((unit) => unit.blockId))],
    focusBlockIds: timeline.focusSpans.map((span) => span.blockId),
    focusTimes: timeline.focusSpans.map((span) => span.t0),
    secondKeyTime: secondKey?.t,
    firstCenter,
    secondCenter,
    movedPixels: moved,
    passed: analysis.blocks.length >= 2 && timeline.focusSpans.length >= 2 && secondKey?.t === second.t0 && moved > 100,
  }
})()`

const evaluation = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
socket.close()
if (evaluation.exceptionDetails) throw new Error(evaluation.exceptionDetails.exception?.description ?? evaluation.exceptionDetails.text)
const result = evaluation.result.value
console.log(JSON.stringify(result, null, 2))
if (!result?.passed) process.exitCode = 1
