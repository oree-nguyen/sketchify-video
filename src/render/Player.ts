import type { AnalysisResult, DrawUnit } from '../wasm/wasmClient'
import type { FrameSettings } from '../state/settingsDefaults'
import type { ObjectSettings } from '../state/projectStore'
import { buildCameraTimeline, cameraAt, cameraFocusBlockAt } from '../camera/cameraTimeline'
import { resolvePushHand } from '../assets/hands/pushRegistry'
import { activeScheduledUnit, buildDrawUnitSchedule, drawingProgressAt } from '../timeline/drawUnitSchedule'
import type { SubtitleSettings } from '../state/projectStore'
import { drawSubtitleOverlay, type SubtitleTrack } from './subtitleRenderer'

export interface PlayerOptions {
  sourceUrl: string; drawDurationSec: number; holdDurationSec: number; fps: number
  analysis: AnalysisResult; hand: { src: string; anchorPct: { x: number; y: number } };settings?:FrameSettings;zoomBlockIds?:number[];objectSettingsByBlockId?:Readonly<Record<number,ObjectSettings>>;subtitle?:{settings:SubtitleSettings;track:SubtitleTrack};onCanvasReady?:()=>void
}
export interface PlayResult { elapsedMs: number; blob?: Blob }
export const usesStandardReveal = (settings: ObjectSettings | undefined) => !settings?.pushEntry.enabled

export class Player {
  private stopped = false
  constructor(private readonly displayCanvas: HTMLCanvasElement, private readonly options: PlayerOptions) {}
  stop() { this.stopped = true }

  async play(record: boolean, onProgress?: (elapsedSec:number)=>void): Promise<PlayResult> {
    const handImage=await loadImage(this.options.hand.src)
    const pushHandImages=new Map<string,HTMLImageElement>()
    for(const settings of Object.values(this.options.objectSettingsByBlockId??{})){if(!settings.pushEntry.enabled)continue;const edge=settings.pushEntry.edge==='auto'?'left':settings.pushEntry.edge,asset=resolvePushHand(settings.pushEntry.handStyle,edge);if(asset.src&&!pushHandImages.has(asset.id))pushHandImages.set(asset.id,await loadImage(asset.src))}
    const {img,units}=this.options.analysis,w=img.w,h=img.h
    const camera=this.options.settings?buildCameraTimeline(this.options.settings,this.options.analysis.blocks,units,w,h,this.options.zoomBlockIds,this.options.drawDurationSec):null
    const blockTiles=new Map<number,HTMLCanvasElement>()
    // Keep the captureStream track alive when ProjectPlayer already prepared
    // the output size before MediaRecorder.start(). Reassigning width/height,
    // even to the same value, resets the canvas backing store and can produce
    // an empty WebM in Chromium.
    if(this.displayCanvas.width!==w)this.displayCanvas.width=w
    if(this.displayCanvas.height!==h)this.displayCanvas.height=h
    const display=this.displayCanvas.getContext('2d',{willReadFrequently:true})!;const content=document.createElement('canvas');content.width=w;content.height=h;const ctx=content.getContext('2d',{willReadFrequently:true})!
    ctx.fillStyle=`rgb(${img.bg.join(',')})`;ctx.fillRect(0,0,w,h)
    // Resize canvas xoá buffer. Vẽ lại source trong cùng task trước khi cho React
    // hiện canvas để không có frame đen/trong suốt lúc chuyển sang chế độ Play.
    display.fillStyle=`rgb(${img.bg.join(',')})`;display.fillRect(0,0,w,h)
    this.options.onCanvasReady?.()
    // Tile được tạo lazy đúng một lần rồi cache trực tiếp trên DrawUnit.
    // Dùng WorkImage.rgba từ WASM nên không cần getImageData toàn ảnh lặp lại cho từng unit.
    const unitAlpha=new Float32Array(units.length)
    const debugUnitIndex=Math.max(0,units.findIndex(unit=>unit.type==='area'))
    const recorder=record?makeRecorder(this.displayCanvas,this.options.fps):undefined,chunks:BlobPart[]=[]
    if(recorder){recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};recorder.start(100)}
    const started=performance.now(),schedule=buildDrawUnitSchedule(units,this.options.drawDurationSec),drawMs=schedule.totalDurationMs,totalMs=drawMs+this.options.holdDurationSec*1000
    let previousProgress=0,unitCursor=0,lastHand:{x:number;y:number}|null=null,angle=0,debugBeforeLogged=false,debugPartialLogs=0,debugPixelLogged=false,finalVerificationLogged=false,cameraSampleBucket=-1
    return await new Promise<PlayResult>((resolve)=>{
      const frame=(now:number)=>{
        const elapsed=now-started
        const progress=drawingProgressAt(schedule,elapsed)
        onProgress?.(elapsed/1000)
        const debugUnit=units[debugUnitIndex]
        if(debugUnit&&!debugBeforeLogged&&progress<debugUnit.t0){console.log('[Sketchify] tile alpha trace',{phase:'before-t0',unitIndex:debugUnitIndex,progress,t0:debugUnit.t0,ctxGlobalAlpha:ctx.globalAlpha,drawImage:false});debugBeforeLogged=true}
        // State machine tuần tự: unit nằm trước cursor đã được đóng dấu vĩnh viễn
        // trên contentCanvas và không bao giờ được tính/vẽ lại ở frame sau.
        while(unitCursor<units.length){
          const i=unitCursor,u=units[i];if(u.t0>progress)break
          const objectSettings=this.options.objectSettingsByBlockId?.[u.blockId]
          if(!usesStandardReveal(objectSettings)){
            const own=units.filter(unit=>unit.blockId===u.blockId),end=Math.max(...own.map(unit=>unit.t1))
            if(progress<end)break
            const block=this.options.analysis.blocks.find(candidate=>candidate.id===u.blockId)
            if(block){const tile=blockTiles.get(u.blockId)??getBlockTile(block,img.rgba,img.bg,w);blockTiles.set(u.blockId,tile);ctx.save();ctx.globalAlpha=1;ctx.drawImage(tile,block.bbox.x,block.bbox.y);ctx.restore()}
            while(unitCursor<units.length&&units[unitCursor].blockId===u.blockId){unitAlpha[unitCursor]=1;unitCursor++}
            continue
          }
          const current=unitProgress(u,progress),prior=unitProgress(u,previousProgress)
          // Bất kể frame có nhảy qua t1 hay không, unit hoàn tất luôn được chốt bằng
          // pixel gốc alpha=1 ngay tại frame này, rồi mới cho cursor đi tiếp.
          if(current>=1){blitFullUnit(ctx,getUnitTile(u,img.rgba,img.bg,w),u,i===debugUnitIndex?{unitIndex:i,type:u.type,t1:u.t1,progress}:undefined);unitAlpha[i]=1;unitCursor++;continue}
          if(current>prior){const renderAsPath=objectSettings?.kindOverride==='photo'?false:(objectSettings?.kindOverride==='vector'?u.path.length>=4:u.type==='path');if(renderAsPath)drawPathDelta(ctx,u,prior,current,getUnitTile(u,img.rgba,img.bg,w),objectSettings);else{const old=unitAlpha[i];const alpha=old<1?(current-old)/(1-old):0;if(alpha>0){ctx.save();ctx.globalAlpha=alpha;ctx.filter='none';if(i===debugUnitIndex&&debugPartialLogs<4){console.log('[Sketchify] tile alpha trace',{phase:'partial-before-drawImage',unitIndex:i,progress,t0:u.t0,t1:u.t1,accumulatedBefore:old,requestedAlpha:alpha,ctxGlobalAlpha:ctx.globalAlpha});debugPartialLogs++}ctx.drawImage(getUnitTile(u,img.rgba,img.bg,w),u.bbox.x,u.bbox.y);ctx.restore();unitAlpha[i]=current}}}
          break
        }
        const scheduledActive=elapsed<drawMs?activeScheduledUnit(schedule,elapsed):undefined
        const active=scheduledActive&&usesStandardReveal(this.options.objectSettingsByBlockId?.[scheduledActive.unit.blockId])?scheduledActive.unit:undefined
        const crop=cameraAt(camera?.keys??[{t:0,crop:{x:0,y:0,w,h},easing:'linear'}],progress)
        const sampleBucket=Math.min(9,Math.floor(progress*10))
        if(active&&sampleBucket!==cameraSampleBucket){
          cameraSampleBucket=sampleBucket
          console.log('[Sketchify] camera alignment',{progress,drawBlockId:active.blockId,cameraBlockId:camera?cameraFocusBlockAt(camera.keys,progress):undefined,inTransition:false})
        }
        display.clearRect(0,0,w,h);display.drawImage(content,crop.x,crop.y,crop.w,crop.h,0,0,w,h)
        drawPushEntry(display,this.options.analysis,units,img.rgba,img.bg,w,h,progress,crop,this.options.objectSettingsByBlockId,blockTiles,pushHandImages)
        if(!finalVerificationLogged&&progress>=1&&unitCursor===units.length){
          console.log('[Sketchify] final render verification',verifyFinalContent(ctx,units,img.rgba,img.bg,w,h))
          finalVerificationLogged=true
        }
        if(debugUnit&&!debugPixelLogged&&unitCursor>debugUnitIndex&&progress>=Math.min(1,debugUnit.t1+.02)&&debugUnit.pixels.length){const pixelIndex=debugUnit.pixels[Math.floor(debugUnit.pixels.length/2)],x=pixelIndex%w,y=Math.floor(pixelIndex/w),sourceOffset=pixelIndex*4;const contentRGBA=Array.from(ctx.getImageData(x,y,1,1).data),displayRGBA=Array.from(display.getImageData(x,y,1,1).data),sourceRGBA=Array.from(img.rgba.slice(sourceOffset,sourceOffset+4));console.log('[Sketchify] completed unit pixel persistence',{unitIndex:debugUnitIndex,progress,point:{x,y},sourceRGBA,contentRGBA,displayRGBA,contentAlpha:contentRGBA[3],displayAlpha:displayRGBA[3]});debugPixelLogged=true}
        if(active){const raw=unitPosition(active,progress),pos={x:(raw.x-crop.x)*w/crop.w,y:(raw.y-crop.y)*h/crop.h};if(lastHand){const target=Math.atan2(pos.y-lastHand.y,pos.x-lastHand.x);angle+=(target-angle)*.25}drawHand(display,handImage,this.options.hand.anchorPct,pos.x,pos.y,angle,w);lastHand=pos}
        else if(this.options.settings?.handPushEnding.enabled&&lastHand&&this.options.holdDurationSec>=1.2&&elapsed>=drawMs&&elapsed<drawMs+Math.min(.8,this.options.holdDurationSec)){drawHand(display,handImage,this.options.hand.anchorPct,lastHand.x,lastHand.y,angle,w)}
        // Final display-space layer: it is deliberately drawn after camera crop,
        // object push and hand compositing so zoom/pan can never move subtitles.
        if(this.options.subtitle)drawSubtitleOverlay(display,this.options.subtitle.settings,this.options.subtitle.track,elapsed/1000)
        previousProgress=progress
        if(!this.stopped&&elapsed<totalMs){requestAnimationFrame(frame);return}
        if(!recorder){resolve({elapsedMs:elapsed});return}
        recorder.onstop=()=>resolve({elapsedMs:elapsed,blob:new Blob(chunks,{type:recorder.mimeType||'video/webm'})});recorder.stop()
      };requestAnimationFrame(frame)
    })
  }
}

const loadImage=(src:string)=>new Promise<HTMLImageElement>((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src=src})
const unitProgress=(u:DrawUnit,p:number)=>Math.max(0,Math.min(1,(p-u.t0)/Math.max(.000001,u.t1-u.t0)))
function drawPathDelta(ctx:CanvasRenderingContext2D,u:DrawUnit,a:number,b:number,tile:HTMLCanvasElement,settings?:ObjectSettings){
  const n=u.path.length/2;if(n<2)return
  const from=Math.floor(a*(n-1)),to=Math.max(from+1,Math.ceil(b*(n-1)))
  const scratch=u._pathScratch??document.createElement('canvas');scratch.width=u.bbox.w;scratch.height=u.bbox.h;u._pathScratch=scratch
  const mask=scratch.getContext('2d',{willReadFrequently:true})!;mask.clearRect(0,0,scratch.width,scratch.height)
  mask.globalCompositeOperation='source-over';mask.strokeStyle='#fff';mask.lineWidth=settings?.strokeWidth??3;mask.lineCap='round';mask.lineJoin='round';mask.beginPath();mask.moveTo(u.path[from*2]-u.bbox.x,u.path[from*2+1]-u.bbox.y)
  for(let i=from+1;i<=Math.min(to,n-1);i++)mask.lineTo(u.path[i*2]-u.bbox.x,u.path[i*2+1]-u.bbox.y)
  mask.stroke();mask.globalCompositeOperation='source-in';if(settings?.strokeColorMode==='custom'){mask.fillStyle=settings.inkColor;mask.fillRect(0,0,scratch.width,scratch.height)}else mask.drawImage(tile,0,0);mask.globalCompositeOperation='source-over'
  ctx.drawImage(scratch,u.bbox.x,u.bbox.y)
}
function blitFullUnit(ctx:CanvasRenderingContext2D,tile:HTMLCanvasElement,u:DrawUnit,debug?:{unitIndex:number;type:string;t1:number;progress:number}){ctx.save();ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';ctx.filter='none';if(debug)console.log('[Sketchify] tile alpha trace',{phase:'complete-before-drawImage',...debug,ctxGlobalAlpha:ctx.globalAlpha});ctx.drawImage(tile,u.bbox.x,u.bbox.y);ctx.restore()}
function unitPosition(u:DrawUnit,p:number){const q=unitProgress(u,p),n=u.path.length/2;if(n){const i=Math.min(n-1,Math.floor(q*(n-1)));return{x:u.path[i*2],y:u.path[i*2+1]}}return{x:u.bbox.x+u.bbox.w*q,y:u.bbox.y+u.bbox.h/2}}
function getUnitTile(u:DrawUnit,rgba:Uint8Array,bg:[number,number,number],w:number){if(u._tile)return u._tile;const tile=document.createElement('canvas');tile.width=u.bbox.w;tile.height=u.bbox.h;const tc=tile.getContext('2d',{willReadFrequently:true})!,out=tc.createImageData(tile.width,tile.height);for(const p of u.pixels){const x=p%w-u.bbox.x,y=Math.floor(p/w)-u.bbox.y;if(x>=0&&y>=0&&x<tile.width&&y<tile.height){const a=p*4,b=(y*tile.width+x)*4,alpha=rgba[a+3]/255;out.data[b]=Math.round(rgba[a]*alpha+bg[0]*(1-alpha));out.data[b+1]=Math.round(rgba[a+1]*alpha+bg[1]*(1-alpha));out.data[b+2]=Math.round(rgba[a+2]*alpha+bg[2]*(1-alpha));out.data[b+3]=255}}tc.putImageData(out,0,0);u._tile=tile;return tile}
function verifyFinalContent(ctx:CanvasRenderingContext2D,units:DrawUnit[],rgba:Uint8Array,bg:[number,number,number],w:number,h:number){
  const actual=ctx.getImageData(0,0,w,h).data,covered=new Uint8Array(w*h)
  for(const unit of units)for(const pixel of unit.pixels)if(pixel>=0&&pixel<covered.length)covered[pixel]=1
  let coveredPixels=0,mismatchedPixels=0,maxChannelDiff=0
  for(let pixel=0;pixel<covered.length;pixel++){
    if(!covered[pixel])continue
    coveredPixels++
    const offset=pixel*4,alpha=rgba[offset+3]/255
    for(let channel=0;channel<3;channel++){
      const expected=Math.round(rgba[offset+channel]*alpha+bg[channel]*(1-alpha))
      const diff=Math.abs(actual[offset+channel]-expected)
      if(diff>maxChannelDiff)maxChannelDiff=diff
      if(diff>2){mismatchedPixels++;break}
    }
  }
  return{coveredPixels,mismatchedPixels,mismatchRatio:coveredPixels?mismatchedPixels/coveredPixels:0,maxChannelDiff,completedUnits:units.length,totalUnits:units.length}
}
function drawHand(ctx:CanvasRenderingContext2D,img:HTMLImageElement,anchor:{x:number;y:number},x:number,y:number,angle:number,w:number){const scale=(w*.14)/img.naturalWidth;ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.scale(scale,scale);ctx.drawImage(img,-anchor.x/100*img.naturalWidth,-anchor.y/100*img.naturalHeight);ctx.restore()}
function makeRecorder(canvas:HTMLCanvasElement,fps:number){if(!('MediaRecorder'in window))return undefined;const mime=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm',''].find(t=>!t||MediaRecorder.isTypeSupported(t))??'';return new MediaRecorder(canvas.captureStream(fps),mime?{mimeType:mime}:undefined)}
export function drawPushEntry(display:CanvasRenderingContext2D,analysis:AnalysisResult,units:DrawUnit[],rgba:Uint8Array,bg:[number,number,number],w:number,h:number,progress:number,crop:{x:number;y:number;w:number;h:number},settingsByBlock:Readonly<Record<number,ObjectSettings>>|undefined,cache:Map<number,HTMLCanvasElement>,handImages:ReadonlyMap<string,HTMLImageElement>=new Map()){
  if(!settingsByBlock)return
  for(const [key,settings] of Object.entries(settingsByBlock)){if(!settings.pushEntry.enabled)continue;const id=Number(key),block=analysis.blocks.find(b=>b.id===id);if(!block)continue;const own=units.filter(u=>u.blockId===id),start=own[0]?.t0,end=own.at(-1)?.t1;if(start===undefined||end===undefined||progress<start||progress>=end)continue;const q=(progress-start)/Math.max(.0001,end-start),ease=1-Math.pow(1-q,3),edge=settings.pushEntry.edge,tile=cache.get(id)??getBlockTile(block,rgba,bg,w);cache.set(id,tile);let dx=0,dy=0;const chosen=edge==='auto'?nearestEdge(block.bbox,w,h):edge;if(chosen==='left')dx=-block.bbox.w*(1-ease)-block.bbox.x;if(chosen==='right')dx=(w-block.bbox.x)*(1-ease);if(chosen==='top')dy=-block.bbox.h*(1-ease)-block.bbox.y;if(chosen==='bottom')dy=(h-block.bbox.y)*(1-ease);const x=(block.bbox.x+dx-crop.x)*w/crop.w,y=(block.bbox.y+dy-crop.y)*h/crop.h,bw=block.bbox.w*w/crop.w,bh=block.bbox.h*h/crop.h;display.save();display.globalAlpha=ease;display.drawImage(tile,x,y,bw,bh);const asset=resolvePushHand(settings.pushEntry.handStyle,chosen),image=handImages.get(asset.id);if(image)drawHand(display,image,asset.anchorPct,x+bw/2,y+bh/2,0,w);else drawPushHandPlaceholder(display,asset.id,x+bw/2,y+bh/2,w);display.restore()}
}
function drawPushHandPlaceholder(ctx:CanvasRenderingContext2D,style:ObjectSettings['pushEntry']['handStyle'],x:number,y:number,w:number){const label=style==='auto'?'A':style,r=Math.max(12,w*.018);ctx.save();ctx.globalAlpha=1;ctx.fillStyle='#84cc16';ctx.shadowColor='#84cc16';ctx.shadowBlur=10;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;ctx.fillStyle='#132006';ctx.font=`700 ${Math.round(r)}px Oswald Sketchify, sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(label,x,y);ctx.restore()}
function nearestEdge(b:{x:number;y:number;w:number;h:number},w:number,h:number){const d={left:b.x,right:w-(b.x+b.w),top:b.y,bottom:h-(b.y+b.h)};return (Object.entries(d).sort((a,b)=>a[1]-b[1])[0][0] as 'left'|'right'|'top'|'bottom')}
function getBlockTile(block:AnalysisResult['blocks'][number],rgba:Uint8Array,bg:[number,number,number],width:number){const tile=document.createElement('canvas');tile.width=block.bbox.w;tile.height=block.bbox.h;const ctx=tile.getContext('2d',{willReadFrequently:true})!,data=ctx.createImageData(tile.width,tile.height);for(const p of block.pixels){const x=p%width-block.bbox.x,y=Math.floor(p/width)-block.bbox.y;if(x<0||y<0||x>=tile.width||y>=tile.height)continue;const source=p*4,target=(y*tile.width+x)*4,a=rgba[source+3]/255;data.data[target]=Math.round(rgba[source]*a+bg[0]*(1-a));data.data[target+1]=Math.round(rgba[source+1]*a+bg[1]*(1-a));data.data[target+2]=Math.round(rgba[source+2]*a+bg[2]*(1-a));data.data[target+3]=255}ctx.putImageData(data,0,0);return tile}
