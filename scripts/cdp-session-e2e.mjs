import { writeFile } from 'node:fs/promises'

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
const appUrl = 'http://127.0.0.1:4173/'
await send('Page.enable'); await send('Runtime.enable')
await send('Page.navigate', { url: 'about:blank' })
await send('Storage.clearDataForOrigin', { origin: appUrl.slice(0, -1), storageTypes: 'indexeddb,local_storage' })
await send('Page.navigate', { url: `${appUrl}?session-e2e=${Date.now()}` })
await new Promise((resolve) => setTimeout(resolve, 900))

const first = await evaluate(`(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const until = async (condition, timeout = 30000) => { const end = performance.now() + timeout; while (!condition() && performance.now() < end) await wait(80); if (!condition()) throw new Error('Timeout: ' + condition) }
  const sessionName = () => document.querySelector('.session-switcher > summary span')?.textContent?.trim() ?? ''
  const openMenu = async () => { const details = document.querySelector('.session-switcher'); if (!details.open) details.querySelector(':scope > summary').click(); await wait(60) }
  const addImage = async (name, color) => {
    const before = document.querySelectorAll('.frame-card').length
    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90
    const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, 160, 90); context.fillStyle = color; context.fillRect(35, 20, 70, 50)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
    const transfer = new DataTransfer(); transfer.items.add(new File([blob], name, { type: 'image/png' }))
    const input = document.querySelector('input[type=file]'); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }))
    await until(() => document.querySelectorAll('.frame-card').length === before + 1)
  }
  await until(() => sessionName() && !sessionName().includes('Đang tải'))
  const sessionAName = sessionName()
  const initiallyBlank = document.querySelectorAll('.frame-card').length === 0 && Boolean(document.querySelector('.empty-preview'))
  await addImage('a.png', '#111')
  await wait(2300)
  await openMenu(); document.querySelector('.session-new').click()
  await until(() => sessionName() !== sessionAName)
  const sessionBName = sessionName()
  const newSessionBlank = document.querySelectorAll('.frame-card').length === 0 && Boolean(document.querySelector('.empty-preview'))
  await addImage('b1.png', '#123456'); await addImage('b2.png', '#654321')
  await wait(2300)
  await openMenu(); [...document.querySelectorAll('.session-main')].find((button) => button.querySelector('span')?.textContent === sessionAName)?.click()
  await until(() => sessionName() === sessionAName && document.querySelectorAll('.frame-card').length === 1)
  window.prompt = () => 'Phiên A'
  await openMenu(); document.querySelector('.session-menu-row.active .session-icon')?.click()
  await until(() => sessionName() === 'Phiên A')
  await openMenu(); [...document.querySelectorAll('.session-main')].find((button) => button.querySelector('span')?.textContent === sessionBName)?.click()
  await until(() => sessionName() === sessionBName && document.querySelectorAll('.frame-card').length === 2)
  const records = await new Promise((resolve, reject) => { const request = indexedDB.open('sketchify-sessions'); request.onerror = () => reject(request.error); request.onsuccess = () => { const tx = request.result.transaction('sessions', 'readonly'); const all = tx.objectStore('sessions').getAll(); all.onsuccess = () => resolve(all.result) } })
  const pointer = records.find((record) => record.id === '__active_pointer__')
  const real = records.filter((record) => record.projectJson).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return { initiallyBlank, newSessionBlank, sessionAName, sessionBName, beforeReloadName: sessionName(), beforeReloadFrames: document.querySelectorAll('.frame-card').length, pointerId: pointer?.activeSessionId, newestId: real[0]?.id, activeIsNotNewest: pointer?.activeSessionId !== real[0]?.id }
})()`)

await send('Page.reload', { ignoreCache: true })
await new Promise((resolve) => setTimeout(resolve, 1000))
const second = await evaluate(`(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const until = async (condition, timeout = 30000) => { const end = performance.now() + timeout; while (!condition() && performance.now() < end) await wait(80); if (!condition()) throw new Error('Timeout after reload') }
  const sessionName = () => document.querySelector('.session-switcher > summary span')?.textContent?.trim() ?? ''
  const openMenu = async () => { const details = document.querySelector('.session-switcher'); if (!details.open) details.querySelector(':scope > summary').click(); await wait(60) }
  await until(() => sessionName() === ${JSON.stringify(first.sessionBName)} && document.querySelectorAll('.frame-card').length === 2)
  const reloadKeptB = true
  window.prompt = () => 'Phiên B'; window.confirm = () => true
  await openMenu(); document.querySelector('.session-menu-row.active .session-icon')?.click()
  await until(() => sessionName() === 'Phiên B')
  const renamedInHeader = sessionName() === 'Phiên B'
  await openMenu(); document.querySelector('.session-new')?.click()
  await until(() => sessionName() !== 'Phiên B' && document.querySelectorAll('.frame-card').length === 0)
  const disposableName = sessionName()
  await openMenu(); [...document.querySelectorAll('.session-main')].find((button) => button.querySelector('span')?.textContent === 'Phiên B')?.click()
  await until(() => sessionName() === 'Phiên B' && document.querySelectorAll('.frame-card').length === 2)
  await openMenu(); const disposableRow = [...document.querySelectorAll('.session-menu-row')].find((row) => row.querySelector('.session-main span')?.textContent === disposableName); disposableRow?.querySelector('.session-icon.danger')?.click()
  await wait(200); await openMenu(); await until(() => document.querySelectorAll('.session-menu-row').length === 2)
  const nonActiveDeleteKeptCurrent = sessionName() === 'Phiên B' && document.querySelectorAll('.frame-card').length === 2
  await openMenu(); document.querySelector('.session-menu-row.active .session-icon.danger')?.click()
  await until(() => sessionName() === 'Phiên A' && document.querySelectorAll('.frame-card').length === 1)
  const records = await new Promise((resolve, reject) => { const request = indexedDB.open('sketchify-sessions'); request.onerror = () => reject(request.error); request.onsuccess = () => { const tx = request.result.transaction('sessions', 'readonly'); const all = tx.objectStore('sessions').getAll(); all.onsuccess = () => resolve(all.result) } })
  const pointer = records.find((record) => record.id === '__active_pointer__')
  const real = records.filter((record) => record.projectJson)
  return { reloadKeptB, renamedInHeader, nonActiveDeleteKeptCurrent, deleteActiveSwitchedSafely: sessionName() === 'Phiên A' && real.length === 1 && pointer?.activeSessionId === real[0]?.id, remainingFrames: document.querySelectorAll('.frame-card').length, remainingSessions: real.length }
})()`)

await evaluate(`(async () => {
  const database = await new Promise((resolve, reject) => { const request = indexedDB.open('sketchify-sessions'); request.onerror = () => reject(request.error); request.onsuccess = () => resolve(request.result) })
  const records = await new Promise((resolve, reject) => { const tx = database.transaction('sessions', 'readonly'); const request = tx.objectStore('sessions').getAll(); request.onerror = () => reject(request.error); request.onsuccess = () => resolve(request.result) })
  const source = records.find((record) => record.projectJson)
  await new Promise((resolve, reject) => {
    const tx = database.transaction('sessions', 'readwrite'), store = tx.objectStore('sessions')
    store.clear(); store.put({ ...source, id: '__current__', name: 'Phiên đang làm' })
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error)
  })
  database.close()
})()`)
await send('Page.reload', { ignoreCache: true })
await new Promise((resolve) => setTimeout(resolve, 1000))
const migration = await evaluate(`(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const end = performance.now() + 30000
  while (document.querySelector('.session-switcher > summary span')?.textContent?.trim() !== 'Phiên được khôi phục' && performance.now() < end) await wait(80)
  const records = await new Promise((resolve, reject) => { const request = indexedDB.open('sketchify-sessions'); request.onerror = () => reject(request.error); request.onsuccess = () => { const tx = request.result.transaction('sessions', 'readonly'); const all = tx.objectStore('sessions').getAll(); all.onsuccess = () => resolve(all.result) } })
  const pointer = records.find((record) => record.id === '__active_pointer__')
  const real = records.filter((record) => record.projectJson && record.id !== '__current__')
  return { legacyMigrated: !records.some((record) => record.id === '__current__') && real.length === 1 && pointer?.activeSessionId === real[0]?.id && document.querySelectorAll('.frame-card').length === 1 }
})()`)

const result = { ...first, ...second, ...migration }
result.passed = result.initiallyBlank && result.newSessionBlank && result.beforeReloadFrames === 2 && result.activeIsNotNewest && result.reloadKeptB && result.renamedInHeader && result.nonActiveDeleteKeptCurrent && result.deleteActiveSwitchedSafely && result.remainingFrames === 1 && result.legacyMigrated
await evaluate(`document.querySelector('.session-switcher > summary')?.click()`)
await new Promise((resolve) => setTimeout(resolve, 120))
const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
await writeFile('.tmp-session-e2e.png', Buffer.from(screenshot.data, 'base64'))
result.screenshot = '.tmp-session-e2e.png'
const lastDelete = await evaluate(`(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)); window.confirm = () => true
  document.querySelector('.session-menu-row.active .session-icon.danger')?.click()
  const end = performance.now() + 30000
  while ((document.querySelectorAll('.frame-card').length !== 0 || !document.querySelector('.empty-preview')) && performance.now() < end) await wait(80)
  const records = await new Promise((resolve, reject) => { const request = indexedDB.open('sketchify-sessions'); request.onerror = () => reject(request.error); request.onsuccess = () => { const tx = request.result.transaction('sessions', 'readonly'); const all = tx.objectStore('sessions').getAll(); all.onsuccess = () => resolve(all.result) } })
  const pointer = records.find((record) => record.id === '__active_pointer__'), real = records.filter((record) => record.projectJson)
  return { lastSessionDeleteCreatedBlank: real.length === 1 && pointer?.activeSessionId === real[0]?.id && real[0].projectJson.frames.length === 0 && document.querySelectorAll('.frame-card').length === 0 }
})()`)
Object.assign(result, lastDelete)
result.passed = result.passed && result.lastSessionDeleteCreatedBlank
socket.close()
console.log(JSON.stringify(result, null, 2))
if (!result.passed) process.exitCode = 1
