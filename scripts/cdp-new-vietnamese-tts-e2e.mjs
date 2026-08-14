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
await send('Page.enable'); await send('Runtime.enable'); await send('Page.navigate', { url: `http://127.0.0.1:4173/?new-tts-e2e=${Date.now()}` })
await new Promise((resolve) => setTimeout(resolve, 1200))
const result = await evaluate(`(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const waitFor = async (test, timeout, message) => { const end = performance.now() + timeout; while (!test() && performance.now() < end) await wait(200); if (!test()) throw new Error(message) }
  if (!document.querySelector('.frame-card')) {
    const canvas = document.createElement('canvas'); canvas.width = 360; canvas.height = 220; const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, 360, 220); context.fillStyle = '#111'; context.font = '44px sans-serif'; context.fillText('TTS', 130, 125)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png')); const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'tts-new.png', { type: 'image/png' })); const input = document.querySelector('input[type=file]'); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }))
  }
  await waitFor(() => document.querySelector('.narration-bar'), 30000, 'Không có thanh lồng tiếng')
  window.__ttsAlerts = []; window.alert = (message) => window.__ttsAlerts.push(String(message))
  const setValue = (element, value) => { const proto = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })) }
  const run = async (voiceId, speed) => {
    const voice = document.querySelector('select[aria-label="Giọng đọc"]'), textarea = document.querySelector('.narration-bar textarea'), speedInput = document.querySelector('input[aria-label="Tốc độ giọng đọc"]')
    setValue(voice, voiceId); setValue(textarea, 'Xin chào bạn.'); setValue(speedInput, String(speed)); await wait(80)
    const oldDuration = document.querySelector('.narration-preview span')?.textContent; const button = document.querySelector('.narration-actions .export'); button.click()
    await waitFor(() => (document.querySelector('.narration-preview span')?.textContent && document.querySelector('.narration-preview span')?.textContent !== oldDuration) || window.__ttsAlerts.length, 900000, 'TTS quá thời gian')
    return { voice: voice.selectedOptions[0]?.textContent, duration: document.querySelector('.narration-preview span')?.textContent, alerts: [...window.__ttsAlerts] }
  }
  const matcha = await run('vi-mc-ngoc-ngan', 1.2)
  window.__ttsAlerts = []
  const vieneu = await run('vi-vieneu-ngoc-lan', 1.2)
  return { matcha, vieneu }
})()`)
result.passed = Boolean(result.matcha.duration && result.vieneu.duration && !result.matcha.alerts.length && !result.vieneu.alerts.length)
socket.close(); console.log(JSON.stringify(result, null, 2)); if (!result.passed) process.exitCode = 1
