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

await send('Page.enable'); await send('Runtime.enable')
await send('Page.navigate', { url: `http://127.0.0.1:4173/?raster-wipe-e2e=${Date.now()}` })
for (let attempt = 0; attempt < 50; attempt++) {
  if (await evaluate(`Boolean(document.querySelector('input[type=file]'))`)) break
  await new Promise((resolve) => setTimeout(resolve, 150))
}
const result = await evaluate(`(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const source = document.createElement('canvas'); source.width = 320; source.height = 180
  const sourceContext = source.getContext('2d'); sourceContext.fillStyle = '#ffffff'; sourceContext.fillRect(0, 0, 320, 180)
  sourceContext.fillStyle = '#e11d48'; sourceContext.fillRect(0, 0, 320, 90)
  sourceContext.fillStyle = '#2563eb'; sourceContext.fillRect(0, 90, 320, 90)
  const blob = await new Promise((resolve) => source.toBlob(resolve, 'image/png'))
  const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'raster-wipe.png', { type: 'image/png' }))
  const input = document.querySelector('input[type=file]'); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }))
  const deadline = performance.now() + 30000
  while (!document.querySelector('.stage-diagnostics')?.textContent.includes('vật thể đã tách') && performance.now() < deadline) await wait(80)
  const menu = document.querySelector('.raster-wipe-menu summary'); menu.click(); await wait(50)
  ;[...document.querySelectorAll('.raster-wipe-options button')].find((button) => button.textContent.includes('Trên xuống dưới'))?.click()
  await wait(200)
  const durationInput = [...document.querySelectorAll('.range-field')].find((field) => field.textContent.includes('Thời gian quét'))?.querySelector('input')
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(durationInput, '1'); durationInput.dispatchEvent(new Event('input', { bubbles: true })); durationInput.dispatchEvent(new Event('change', { bubbles: true }))
  const objectTabGone = ![...document.querySelectorAll('[role=tab]')].some((button) => button.textContent.includes('Vật thể'))
  const inkHidden = !document.querySelector('.mask-toggle')
  const preview = [...document.querySelectorAll('button')].find((button) => button.textContent.includes('Xem thử')); preview.click()
  const canvas = document.querySelector('.render-canvas');
  while (canvas.width !== 320 && performance.now() < deadline) await wait(30)
  await wait(430)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  const top = [...context.getImageData(canvas.width / 2, canvas.height * .2, 1, 1).data]
  const bottomEarly = [...context.getImageData(canvas.width / 2, canvas.height * .8, 1, 1).data]
  await wait(950)
  const bottomFinal = [...context.getImageData(canvas.width / 2, canvas.height * .8, 1, 1).data]
  return { objectTabGone, inkHidden, canvas: { w: canvas.width, h: canvas.height }, top, bottomEarly, bottomFinal, passed: objectTabGone && inkHidden && top[0] > 180 && bottomEarly[2] < 200 && bottomFinal[2] > 220 && bottomFinal[0] < 80 }
})()`)
socket.close()
console.log(JSON.stringify(result, null, 2))
if (!result?.passed) process.exitCode = 1
