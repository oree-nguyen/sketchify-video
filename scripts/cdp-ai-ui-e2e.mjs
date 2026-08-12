import { writeFile } from 'node:fs/promises'

const pages = await fetch('http://127.0.0.1:9222/json/list').then((response) => response.json())
const page = pages.find((item) => item.type === 'page') ?? pages[0]
if (!page) throw new Error('Không tìm thấy Chrome CDP')
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
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: `http://127.0.0.1:4173/?ai-ui=${Date.now()}` })
await new Promise((resolve) => setTimeout(resolve, 900))
await evaluate(`localStorage.removeItem('wb.pollinations.key'); location.reload()` ).catch(() => undefined)
await new Promise((resolve) => setTimeout(resolve, 650))
const first = await evaluate(String.raw`(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const clickByText = (selector, text) => [...document.querySelectorAll(selector)].find((node) => node.textContent.includes(text))?.click()
  clickByText('.empty-preview button', 'Tạo video')
  await wait(100)
  const choices = [...document.querySelectorAll('.ai-choice-grid button')].map((node) => node.textContent.trim())
  clickByText('.ai-choice-grid button', 'Tạo ảnh bằng AI')
  await wait(80)
  const asksForAppKey = Boolean(document.querySelector('.ai-form input[placeholder="pk_…"]'))
  document.querySelector('.ai-dialog-head button')?.click()
  localStorage.setItem('wb.pollinations.key', 'sk_browser_mock')
  return { choices, asksForAppKey }
})()`)
await send('Page.reload', { ignoreCache: true })
await new Promise((resolve) => setTimeout(resolve, 700))
const second = await evaluate(String.raw`(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const clickByText = (selector, text) => [...document.querySelectorAll(selector)].find((node) => node.textContent.includes(text))?.click()
  clickByText('.empty-preview button', 'Tạo video')
  await wait(80)
  clickByText('.ai-choice-grid button', 'Tạo video từ chủ đề')
  await wait(80)
  const storyText = document.querySelector('.ai-dialog')?.textContent ?? ''
  const sceneInput = document.querySelector('.ai-form input[type=number]')
  return {
    storyHasTopic: storyText.includes('Chủ đề'),
    storyShowsCost: storyText.includes('1 lượt viết kịch bản') && storyText.includes('11 lượt gọi'),
    defaultScenes: Number(sceneInput?.value),
    dialogOpen: document.querySelector('.ai-dialog')?.open === true,
  }
})()`)
const result = { ...first, ...second }
const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
await writeFile('.tmp-ai-ui-e2e.png', Buffer.from(screenshot.data, 'base64'))
result.passed = result.choices.length === 3 && result.asksForAppKey && result.storyHasTopic && result.storyShowsCost && result.defaultScenes === 5 && result.dialogOpen
result.screenshot = '.tmp-ai-ui-e2e.png'
socket.close()
console.log(JSON.stringify(result, null, 2))
if (!result.passed) process.exitCode = 1
