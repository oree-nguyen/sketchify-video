const filePath = process.argv[2]
const pages = await fetch('http://127.0.0.1:9222/json/list').then(r => r.json())
const page = pages[0]
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
let nextId = 0
const pending = new Map()
ws.onmessage = event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { const { resolve, reject } = pending.get(message.id); pending.delete(message.id); message.error ? reject(message.error) : resolve(message.result) } }
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })) })
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const evaluate = async expression => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value

await send('Page.enable')
await send('Runtime.enable')
await send('DOM.enable')
await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__capturedLogs=[];const originalLog=console.log.bind(console);console.log=(...args)=>{window.__capturedLogs.push(args);originalLog(...args)}` })
await send('Page.navigate', { url: 'http://127.0.0.1:4173/' })
for (let i = 0; i < 100; i++) { if (await evaluate(`location.port==='4173'&&document.readyState==='complete'&&!!document.querySelector('input[type=file]')`)) break; await delay(100) }
const documentNode = await send('DOM.getDocument', { depth: -1 })
const input = await send('DOM.querySelector', { nodeId: documentNode.root.nodeId, selector: 'input[type=file]' })
await send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [filePath] })
for (let i = 0; i < 300; i++) { if (await evaluate(`window.__capturedLogs.some(args=>args[0]==='[Sketchify] AnalysisResult')`)) break; await delay(100) }
const analysis = await evaluate(`window.__capturedLogs.find(args=>args[0]==='[Sketchify] AnalysisResult')?.[1]`)
await evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent?.trim()==='Tạo .webm')?.click()`)
await delay(3000)
const middleShot = await send('Page.captureScreenshot', { format: 'png' })
await writeFile('.tmp-player-middle.png', Buffer.from(middleShot.data, 'base64'))
const middle = await evaluate(`({time:[...document.querySelectorAll('.duration')][0]?.textContent,canvasVisible:getComputedStyle(document.querySelector('.render-canvas')).display,logs:window.__capturedLogs.filter(args=>String(args[0]).startsWith('[Sketchify]'))})`)
await delay(7500)
const completedShot = await send('Page.captureScreenshot', { format: 'png' })
await writeFile('.tmp-player-completed.png', Buffer.from(completedShot.data, 'base64'))
const completed = await evaluate(`({time:[...document.querySelectorAll('.duration')][0]?.textContent,videoReady:!!document.querySelector('a[download]'),logs:window.__capturedLogs.filter(args=>String(args[0]).startsWith('[Sketchify]'))})`)
if(completed.videoReady){completed.videoDuration=await evaluate(`(async()=>{const a=document.querySelector('a[download]'),v=document.createElement('video');v.src=a.href;await new Promise(r=>v.onloadedmetadata=r);return v.duration})()`)}
console.log(JSON.stringify({ analysis, middle, completed }, null, 2))
ws.close()
import { writeFile } from 'node:fs/promises'
