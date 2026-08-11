import { writeFile } from 'node:fs/promises'

const pages = await fetch('http://127.0.0.1:9222/json/list').then((response) => response.json())
const page = pages.find((item) => item.type === 'page') ?? pages[0]
if (!page) throw new Error('Không tìm thấy Chrome CDP trên cổng 9222')
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
  const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text)
  return response.result.value
}

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: `http://127.0.0.1:4173/?object-settings=${Date.now()}` })
await new Promise((resolve) => setTimeout(resolve, 1000))

const result = await evaluate(String.raw`(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const waitFor = async (test, timeout = 20000) => {
    const deadline = performance.now() + timeout
    while (performance.now() < deadline) {
      const value = test()
      if (value) return value
      await wait(50)
    }
    throw new Error('Timeout browser acceptance')
  }
  window.__objectLogs = []
  const originalLog = console.log.bind(console)
  console.log = (...args) => { window.__objectLogs.push(args); originalLog(...args) }
  const canvas = document.createElement('canvas')
  canvas.width = 900; canvas.height = 360
  const context = canvas.getContext('2d')
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height)
  const colors = ['#172033', '#7c2d12', '#164e63', '#3f3f46', '#4d7c0f']
  colors.forEach((color, index) => {
    const x = 45 + index * 172
    context.fillStyle = color
    context.beginPath(); context.roundRect(x, 70 + (index % 2) * 35, 105, 150, 25); context.fill()
    context.fillStyle = '#fff'; context.beginPath(); context.arc(x + 35, 120 + (index % 2) * 35, 7, 0, Math.PI * 2); context.fill()
  })
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  const file = new File([blob], 'five-objects.png', { type: 'image/png' })
  const transfer = new DataTransfer(); transfer.items.add(file)
  const input = await waitFor(() => document.querySelector('input[type=file]'))
  Object.defineProperty(input, 'files', { configurable: true, value: transfer.files })
  input.dispatchEvent(new Event('change', { bubbles: true }))
  await waitFor(() => document.querySelectorAll('.object-row').length > 0)
  const rows = [...document.querySelectorAll('.object-row')]
  const analysisCallsBefore = window.__objectLogs.filter((entry) => entry[0] === '[Sketchify] analyzeFrame start').length
  rows.forEach((row, index) => {
    const duration = row.querySelector('.object-duration input')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(duration, String(index + 1))
    duration.dispatchEvent(new Event('input', { bubbles: true }))
    duration.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await wait(150)
  const durations = [...document.querySelectorAll('.object-duration input')].map((input) => Number(input.value))
  const reorderBefore = [...document.querySelectorAll('.object-row')].map((row) => row.dataset.objectId)
  const sourceRow = document.querySelectorAll('.object-row')[0]
  const targetRow = document.querySelectorAll('.object-row')[2]
  const targetBounds = targetRow.getBoundingClientRect()
  const dragData = new DataTransfer()
  sourceRow.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dragData }))
  targetRow.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dragData, clientY: targetBounds.bottom - 2 }))
  targetRow.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dragData, clientY: targetBounds.bottom - 2 }))
  sourceRow.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dragData }))
  await wait(150)
  const reorderAfter = [...document.querySelectorAll('.object-row')].map((row) => row.dataset.objectId)
  const pushButtons = [...document.querySelectorAll('.object-row')].map((row) => row.querySelector('.object-flags button:first-child'))
  pushButtons[1]?.click(); pushButtons[3]?.click()
  const pinButton = document.querySelectorAll('.object-row')[2]?.querySelector('.object-flags button:last-child')
  pinButton?.click()
  await wait(100)
  const analysisCallsAfter = window.__objectLogs.filter((entry) => entry[0] === '[Sketchify] analyzeFrame start').length
  const analysisLog = [...window.__objectLogs].reverse().find((entry) => entry[0] === '[Sketchify] AnalysisResult')?.[1]
  document.querySelectorAll('.edit-scope-tabs button')[1]?.click()
  await wait(80)
  const frameText = document.querySelector('.inspector-body')?.textContent ?? ''
  const noMergeControl = ![...document.querySelectorAll('.inspector input,.inspector button,.inspector label')].some((node) => /gộp vùng|mergeRadius/i.test(node.textContent ?? node.getAttribute('name') ?? ''))
  return {
    objectRows: rows.length,
    durations,
    reorderBefore,
    reorderAfter,
    dragReordered: reorderAfter.join('|') === [reorderBefore[1], reorderBefore[2], reorderBefore[0], ...reorderBefore.slice(3)].join('|'),
    drawAndTotalVisible: frameText.includes('15s') && frameText.includes('17s'),
    analysisCallsBefore,
    analysisCallsAfter,
    noReanalysis: analysisCallsAfter === analysisCallsBefore,
    mergeRadiusConfigured: analysisLog?.mergeRadiusConfigured,
    mergeRadiusApplied: analysisLog?.mergeRadiusApplied,
    pushed: pushButtons.map((button) => button?.getAttribute('aria-pressed')),
    pinnedThird: pinButton?.getAttribute('aria-pressed'),
    framePanelHasForbiddenDrawSlider: [...document.querySelectorAll('.setting-section .range-field > span')].some((node) => node.textContent?.startsWith('Thời gian vẽ')),
    noMergeControl,
  }
})()`)

const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
await writeFile('.tmp-frame-settings-e2e.png', Buffer.from(screenshot.data, 'base64'))
await evaluate(`document.querySelectorAll('.edit-scope-tabs button')[0]?.click()`)
await new Promise((resolve) => setTimeout(resolve, 120))
const objectScreenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
await writeFile('.tmp-object-settings-e2e.png', Buffer.from(objectScreenshot.data, 'base64'))
result.passed = result.objectRows === 5
  && JSON.stringify(result.durations) === JSON.stringify([1, 2, 3, 4, 5])
  && result.dragReordered
  && result.drawAndTotalVisible
  && result.noReanalysis
  && result.mergeRadiusConfigured === 0 && result.mergeRadiusApplied === 0
  && result.pushed[1] === 'true' && result.pushed[3] === 'true'
  && result.pinnedThird === 'true'
  && !result.framePanelHasForbiddenDrawSlider
  && result.noMergeControl
result.screenshots = ['.tmp-object-settings-e2e.png', '.tmp-frame-settings-e2e.png']
socket.close()
console.log(JSON.stringify(result, null, 2))
if (!result.passed) process.exitCode = 1
