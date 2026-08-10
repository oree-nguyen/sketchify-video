import { writeFile } from 'node:fs/promises'

const pages = await fetch('http://127.0.0.1:9222/json/list').then((response) => response.json())
const page = pages.find((item) => item.type === 'page') ?? pages[0]
if (!page) throw new Error('Không tìm thấy tab Chrome DevTools')
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
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value
}

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: 'http://127.0.0.1:4173/' })
await new Promise((resolve) => setTimeout(resolve, 1200))

const setup = await evaluate(String.raw`(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const waitFor = async (test, timeout = 15000) => {
    const deadline = performance.now() + timeout
    while (performance.now() < deadline) {
      const value = test()
      if (value) return value
      await wait(50)
    }
    throw new Error('Hết thời gian chờ điều kiện rubric')
  }
  window.__rubricLogs = []
  const originalLog = console.log.bind(console)
  console.log = (...args) => {
    window.__rubricLogs.push(args.map((value) => {
      try { return structuredClone(value) } catch { return String(value) }
    }))
    originalLog(...args)
  }

  const makeFrame = async (name, draw) => {
    const canvas = document.createElement('canvas')
    canvas.width = 480
    canvas.height = 220
    const context = canvas.getContext('2d')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    draw(context)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
    return new File([blob], name, { type: 'image/png' })
  }
  const upload = (file) => {
    const input = document.querySelector('input[type=file]')
    const transfer = new DataTransfer()
    transfer.items.add(file)
    Object.defineProperty(input, 'files', { configurable: true, value: transfer.files })
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }
  const animal = (context, x, kind) => {
    context.save()
    context.fillStyle = ['#172033', '#7c2d12', '#164e63', '#3f3f46'][kind]
    context.beginPath(); context.ellipse(x + 34, 119, 31, 39, 0, 0, Math.PI * 2); context.fill()
    context.beginPath(); context.arc(x + 38, 77, 24, 0, Math.PI * 2); context.fill()
    if (kind === 0 || kind === 1) {
      context.beginPath(); context.moveTo(x + 20, 62); context.lineTo(x + 19, 34); context.lineTo(x + 34, 58); context.fill()
      context.beginPath(); context.moveTo(x + 43, 57); context.lineTo(x + 58, 34); context.lineTo(x + 57, 65); context.fill()
    } else if (kind === 2) {
      context.fillRect(x + 23, 24, 12, 45); context.fillRect(x + 43, 18, 12, 50)
    } else {
      context.beginPath(); context.moveTo(x + 10, 113); context.lineTo(x - 10, 91); context.lineTo(x + 18, 98); context.fill()
      context.beginPath(); context.moveTo(x + 55, 75); context.lineTo(x + 76, 83); context.lineTo(x + 55, 89); context.fill()
    }
    context.restore()
  }

  upload(await makeFrame('frame-1-red.png', (context) => {
    context.fillStyle = '#ef4444'; context.fillRect(40, 35, 400, 150)
  }))
  await waitFor(() => document.querySelectorAll('.frame-card').length === 1 && /khối đã tách/.test(document.querySelector('.stage-topline')?.textContent ?? ''))
  upload(await makeFrame('frame-2-four-animals.png', (context) => {
    for (let index = 0; index < 4; index++) animal(context, 42 + index * 108, index)
    context.fillStyle = '#e6e6e6'
    for (let index = 0; index < 4; index++) {
      context.beginPath(); context.ellipse(76 + index * 108, 163, 34, 5, 0, 0, Math.PI * 2); context.fill()
    }
  }))
  await waitFor(() => document.querySelectorAll('.frame-card').length === 2 && /4 khối đã tách/.test(document.querySelector('.stage-topline')?.textContent ?? ''))

  document.querySelectorAll('.frame-card')[0].click()
  await wait(80)
  document.querySelectorAll('.frame-card')[1].click()
  await wait(80)
  document.querySelector('.mask-toggle')?.click()
  await waitFor(() => document.querySelector('.ink-mask-overlay'))
  await wait(100)

  const overlay = document.querySelector('.ink-mask-overlay')
  const overlayContext = overlay.getContext('2d', { willReadFrequently: true })
  const clearColumnsInGaps = [136, 244, 352].map((center) => {
    let clear = 0
    for (let x = center - 8; x <= center + 8; x++) {
      let ink = false
      for (let y = 25; y < 175; y++) if (overlayContext.getImageData(x, y, 1, 1).data[3]) { ink = true; break }
      if (!ink) clear++
    }
    return clear
  })
  const analysisLog = [...window.__rubricLogs].reverse().find((entry) => entry[0] === '[Sketchify] AnalysisResult')?.[1]
  return {
    frameCount: document.querySelectorAll('.frame-card').length,
    selectedFrame: document.querySelector('.frame-card.selected span:last-child')?.textContent,
    blockCount: analysisLog?.blocks,
    mergeRadiusConfigured: analysisLog?.mergeRadiusConfigured,
    mergeRadiusApplied: analysisLog?.mergeRadiusApplied,
    workingWidthActual: analysisLog?.workingWidthActual,
    openingApplied: analysisLog?.openingApplied,
    clearColumnsInGaps,
    overlayBounds: overlay.getBoundingClientRect().toJSON(),
  }
})()`)

const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
await writeFile('.tmp-rubric-ink-mask.png', Buffer.from(screenshot.data, 'base64'))

const playback = await evaluate(String.raw`(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const waitFor = async (test, timeout = 5000) => {
    const deadline = performance.now() + timeout
    while (performance.now() < deadline) {
      const value = test()
      if (value) return value
      await wait(20)
    }
    throw new Error('Hết thời gian chờ Play')
  }
  const analyzeBefore = window.__rubricLogs.filter((entry) => entry[0] === '[Sketchify] analyzeFrame start').length
  const runs = []
  for (let run = 0; run < 3; run++) {
    document.querySelector('.top-actions .quiet').click()
    await waitFor(() => document.querySelector('.preview.has-render canvas.render-canvas')?.width > 0)
    const samples = []
    const duration = run === 2 ? 4700 : 500
    const deadline = performance.now() + duration
    while (performance.now() < deadline) {
      const canvas = document.querySelector('canvas.render-canvas')
      const context = canvas.getContext('2d', { willReadFrequently: true })
      const points = [[2, 2], [canvas.width - 3, 2], [2, canvas.height - 3], [canvas.width - 3, canvas.height - 3]]
      const rgba = points.map(([x, y]) => [...context.getImageData(x, y, 1, 1).data])
      const transparent = rgba.every((pixel) => pixel[3] === 0)
      const black = rgba.every((pixel) => pixel[3] > 0 && pixel[0] < 5 && pixel[1] < 5 && pixel[2] < 5)
      samples.push({ transparent, black, rgba, canvasCursor: getComputedStyle(canvas).cursor, bodyCursor: getComputedStyle(document.body).cursor })
      await wait(40)
    }
    document.querySelector('.top-actions .quiet').click()
    await waitFor(() => document.querySelector('.top-actions .quiet')?.textContent === 'Xem thử')
    runs.push({ samples: samples.length, blankFrames: samples.filter((item) => item.transparent || item.black).length, forbiddenCursorFrames: samples.filter((item) => item.canvasCursor === 'not-allowed' || item.bodyCursor === 'not-allowed').length, firstPixel: samples[0]?.rgba[0] })
  }
  const analyzeAfter = window.__rubricLogs.filter((entry) => entry[0] === '[Sketchify] analyzeFrame start').length
  const starts = window.__rubricLogs.filter((entry) => entry[0] === '[Sketchify] preview start').slice(-3).map((entry) => entry[1])
  const cameraSamples = window.__rubricLogs.filter((entry) => entry[0] === '[Sketchify] camera alignment').map((entry) => entry[1])
  const comparable = cameraSamples.filter((sample) => !sample.inTransition && sample.cameraBlockId !== undefined)
  return {
    runs,
    analyzeCallsDuringThreePlays: analyzeAfter - analyzeBefore,
    previewStarts: starts,
    cameraSamples: comparable,
    cameraMatches: comparable.filter((sample) => sample.drawBlockId === sample.cameraBlockId).length,
    passed: runs.every((run) => run.blankFrames === 0 && run.forbiddenCursorFrames === 0)
      && analyzeAfter === analyzeBefore
      && starts.length === 3 && starts.every((start) => start.frameName === 'frame-2-four-animals.png' && start.blockCount === 4)
      && comparable.length >= 5 && comparable.every((sample) => sample.drawBlockId === sample.cameraBlockId),
  }
})()`)

const result = {
  setup,
  playback,
  screenshot: '.tmp-rubric-ink-mask.png',
  passed: setup.frameCount === 2
    && setup.selectedFrame === 'frame-2-four-animals.png'
    && setup.blockCount === 4
    && setup.mergeRadiusConfigured === 14
    && setup.mergeRadiusApplied === 7
    && setup.workingWidthActual === 480
    && setup.openingApplied === true
    && setup.clearColumnsInGaps.every((count) => count > 0)
    && playback.passed,
}
socket.close()
console.log(JSON.stringify(result, null, 2))
if (!result.passed) process.exitCode = 1
