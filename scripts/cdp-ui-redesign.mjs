import { writeFile } from 'node:fs/promises'

const page = (await fetch('http://127.0.0.1:9222/json/list').then((response) => response.json()))
  .find((item) => item.type === 'page' && item.url.startsWith('http://127.0.0.1:4173/'))
if (!page) throw new Error('Không tìm thấy tab Sketchify ở cổng CDP 9222')
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
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await new Promise((resolve) => setTimeout(resolve, 500))
await evaluate(`(async()=>{
  if(document.querySelector('.frame-card')) return;
  const canvas=document.createElement('canvas');canvas.width=720;canvas.height=405;const context=canvas.getContext('2d');context.fillStyle='#f8fafc';context.fillRect(0,0,720,405);context.fillStyle='#111827';context.fillRect(70,90,210,160);context.fillStyle='#65a30d';context.fillRect(470,170,150,120);
  const blob=await new Promise((resolve)=>canvas.toBlob(resolve,'image/png'));const file=new File([blob],'ui-audit.png',{type:'image/png'});const transfer=new DataTransfer();transfer.items.add(file);const input=document.querySelector('input[type=file]');Object.defineProperty(input,'files',{configurable:true,value:transfer.files});input.dispatchEvent(new Event('change',{bubbles:true}));
})()`)
await new Promise((resolve) => setTimeout(resolve, 3500))
await evaluate(`document.querySelector('.tool-rail button:nth-child(2)')?.click()`)
await new Promise((resolve) => setTimeout(resolve, 150))
await evaluate(`{
  const camera = [...document.querySelectorAll('.setting-section')].find((item) => item.querySelector('summary span')?.textContent === 'Camera');
  camera?.setAttribute('open', '');
  camera?.querySelector('.select-shell')?.setAttribute('open', '');
}`)
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 120, y: 370 })
await new Promise((resolve) => setTimeout(resolve, 80))
const leftSpot = await evaluate(`({x:getComputedStyle(document.querySelector('.frame-panel')).getPropertyValue('--spot-x').trim(),y:getComputedStyle(document.querySelector('.frame-panel')).getPropertyValue('--spot-y').trim()})`)
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1280, y: 420 })
await new Promise((resolve) => setTimeout(resolve, 80))
const rightSpot = await evaluate(`({x:getComputedStyle(document.querySelector('.inspector')).getPropertyValue('--spot-x').trim(),y:getComputedStyle(document.querySelector('.inspector')).getPropertyValue('--spot-y').trim()})`)
const metrics = await evaluate(`(() => {
  const rect = (selector) => { const node=document.querySelector(selector),r=node.getBoundingClientRect();return{height:r.height,top:r.top,bottom:r.bottom,clientHeight:node.clientHeight,scrollHeight:node.scrollHeight,overflowY:getComputedStyle(node).overflowY} };
  const range=document.querySelector('.range-input');
  return {
    workspace:rect('.workspace'),left:rect('.frame-panel'),center:rect('.stage'),right:rect('.inspector'),rightScroller:rect('.inspector-body'),leftScroller:rect('.frame-stack'),
    accordionCount:document.querySelectorAll('.setting-section').length,
    cameraOptionCount:[...document.querySelectorAll('.setting-section')].find((item)=>item.querySelector('summary span')?.textContent==='Camera')?.querySelectorAll('.select-options button').length ?? 0,
    rangeProgress:document.querySelector('.inspector .range-input')?.style.getPropertyValue('--range-progress'),accent:getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),track:getComputedStyle(document.documentElement).getPropertyValue('--accent-track').trim()
  };
})()`)
const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
await writeFile('.tmp-ui-redesign.png', Buffer.from(screenshot.data, 'base64'))
socket.close()
console.log(JSON.stringify({ ...metrics, leftSpot, rightSpot, passed: metrics.left.height === metrics.center.height && metrics.center.height === metrics.right.height && metrics.leftScroller.overflowY === 'auto' && metrics.rightScroller.overflowY === 'auto' && metrics.cameraOptionCount === 5 && leftSpot.x !== '50%' && rightSpot.x !== '50%' }, null, 2))
