import { readFile } from 'node:fs/promises'

const fixtureName = 'testthuattoanmoi (1).png'
const fixture = (await readFile(new URL(`../${fixtureName}`, import.meta.url))).toString('base64')
const annotations = JSON.parse(await readFile(new URL('../testdata/segmentation/annotations/editorial-instances.json', import.meta.url), 'utf8'))
const expected = annotations.fixtures[fixtureName]
if (!expected) throw new Error(`Missing annotation for ${fixtureName}`)
const cdpPort = process.env.CDP_PORT ?? '9333'
const pages = await fetch(`http://localhost:${cdpPort}/json/list`).then((response) => response.json())
const page = pages.find((item) => item.type === 'page')
if (!page) throw new Error('No Edge CDP page found')
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
let sequence = 0
const pending = new Map()
socket.onmessage = (event) => { const message = JSON.parse(event.data), call = pending.get(message.id); if (!call) return; pending.delete(message.id); message.error ? call.reject(message.error) : call.resolve(message.result) }
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })) })
const evaluate = async (expression) => { const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text); return response.result.value }

await send('Page.enable'); await send('Runtime.enable'); await send('Page.navigate', { url: `http://127.0.0.1:4174/?segmentation-e2e=${Date.now()}` }); await new Promise((resolve) => setTimeout(resolve, 1000))
const result = await evaluate(`(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const waitFor = async (predicate, timeout = 300000) => { const deadline = performance.now() + timeout; while (performance.now() < deadline) { const value = predicate(); if (value) return value; await wait(100); } throw new Error('Timeout waiting for segmentation analysis') }
  const bytes = Uint8Array.from(atob('${fixture}'), (char) => char.charCodeAt(0)); const file = new File([bytes], '${fixtureName}', { type: 'image/png' }); const transfer = new DataTransfer(); transfer.items.add(file)
  const input = await waitFor(() => document.querySelector('input[type=file]')); Object.defineProperty(input, 'files', { configurable: true, value: transfer.files }); input.dispatchEvent(new Event('change', { bubbles: true }))
  await waitFor(() => window.__sketchifyLastAnalysis && !document.body.textContent.includes('Đang phân tích bằng WASM'))
  await waitFor(() => document.querySelectorAll('.block-overlay .block').length > 0)
  const analysis = window.__sketchifyLastAnalysis; const diagnostics = analysis.diagnostics; const overlayCount = document.querySelectorAll('.block-overlay .block').length
  return { version: analysis.version, objectCount: analysis.objects?.length ?? 0, blockCount: analysis.blocks?.length ?? 0, overlayCount, diagnostics, typedUnits: (analysis.unitsV2 ?? []).every((unit) => unit.pixelsRle instanceof Uint32Array && unit.path instanceof Float32Array), reconstructionMismatch: diagnostics?.reconstructionMismatch ?? null }
})()`)
result.expectedCount = expected.expectedCount
result.performancePass = Number(result.diagnostics?.timingsMs?.wasmAnalyze ?? Infinity) <= 8000
result.semanticPass = result.objectCount === expected.expectedCount && result.overlayCount === expected.expectedCount && !(result.diagnostics?.fallbackLanes?.length)
result.passed = result.version === 2 && result.typedUnits && result.reconstructionMismatch === 0 && result.semanticPass && result.performancePass
socket.close()
console.log(JSON.stringify(result, null, 2))
if (!result.passed) process.exitCode = 1
