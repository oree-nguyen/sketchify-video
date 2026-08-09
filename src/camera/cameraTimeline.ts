import type { Block, DrawUnit, Rect } from '../wasm/wasmClient'
import type { FrameSettings } from '../state/settingsDefaults'
import { buildPageZoomKeys } from './pageZoom'

export interface CamKey {t:number;crop:Rect;easing:'linear'|'easeInOutCubic'}
export interface CameraTimeline {keys:CamKey[];fellBack:boolean;reason?:string}
const full=(w:number,h:number):Rect=>({x:0,y:0,w,h})

export function fitRect(box:Rect,aspect:number,paddingPct:number,frameW:number,frameH:number,maxZoom:number):Rect{
  let w=Math.max(1,box.w*(1+paddingPct*2)),h=Math.max(1,box.h*(1+paddingPct*2));const cx=box.x+box.w/2,cy=box.y+box.h/2
  if(w/h<aspect)w=h*aspect;else h=w/aspect
  const minW=frameW/Math.max(1,maxZoom);if(w<minW){w=minW;h=w/aspect}
  if(w>frameW||h>frameH)return full(frameW,frameH)
  return{x:Math.max(0,Math.min(frameW-w,cx-w/2)),y:Math.max(0,Math.min(frameH-h,cy-h/2)),w,h}
}
const blockStart=(id:number,units:DrawUnit[])=>units.find(u=>u.blockId===id)?.t0??0
const iou=(a:Rect,b:Rect)=>{const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y),r=Math.min(a.x+a.w,b.x+b.w),d=Math.min(a.y+a.h,b.y+b.h),area=Math.max(0,r-x)*Math.max(0,d-y);return area/(a.w*a.h+b.w*b.h-area||1)}
const union=(a:Rect,b:Rect):Rect=>{const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y),r=Math.max(a.x+a.w,b.x+b.w),d=Math.max(a.y+a.h,b.y+b.h);return{x,y,w:r-x,h:d-y}}
function clean(keys:CamKey[],aspect:number,w:number,h:number,maxZoom:number){const out:CamKey[]=[];for(const key of keys.sort((a,b)=>a.t-b.t)){if(out.length&&iou(out.at(-1)!.crop,key.crop)>.8)continue;const prev=out.at(-1);if(prev&&iou(prev.crop,key.crop)<.25){out.push({t:(prev.t+key.t)/2,crop:fitRect(union(prev.crop,key.crop),aspect,0,w,h,maxZoom),easing:'easeInOutCubic'})}out.push(key)}return out}
export function buildCameraTimeline(settings:FrameSettings,blocks:Block[],units:DrawUnit[],w:number,h:number,pinnedBlockIds:number[]=[]):CameraTimeline{
  const aspect=w/h,crop=(b:Block)=>fitRect(b.bbox,aspect,settings.camera.zoomPadding,w,h,settings.camera.zoomLevel),all=full(w,h)
  let mode=settings.camera.mode,fellBack=false,reason:string|undefined
  if(mode==='D-hybrid'){if(blocks.length>settings.camera.maxBlocksForAutoFollow){mode='C-two-stage';fellBack=true;reason=`Ảnh có ${blocks.length} khối (>${settings.camera.maxBlocksForAutoFollow}) nên camera chuyển sang chế độ zoom đơn giản để video không bị giật.`}else mode='A-auto-follow'}
  let keys:CamKey[]
  if(mode==='off')keys=[{t:0,crop:all,easing:'linear'},{t:1,crop:all,easing:'linear'}]
  else if(mode==='C-two-stage'||!blocks.length)keys=[{t:0,crop:blocks[0]?crop(blocks[0]):all,easing:'linear'},{t:1-settings.camera.zoomOutPortion,crop:all,easing:'easeInOutCubic'},{t:1,crop:all,easing:'linear'}]
  else if(mode==='B-manual-keyframe'){keys=blocks.map(b=>({t:blockStart(b.id,units),crop:settings.camera.manualKeyframes.find(k=>k.blockId===b.id)?.crop??crop(b),easing:'easeInOutCubic'}));keys.push({t:1,crop:all,easing:'easeInOutCubic'})}
  else {keys=blocks.map(b=>({t:blockStart(b.id,units),crop:crop(b),easing:'easeInOutCubic'}));keys.push({t:1-settings.camera.zoomOutPortion,crop:all,easing:'easeInOutCubic'},{t:1,crop:all,easing:'linear'})}
  keys.push(...buildPageZoomKeys(blocks,units,settings,w,h));for(const id of pinnedBlockIds){const b=blocks.find(x=>x.id===id);if(b)keys.push({t:Math.max(0,blockStart(id,units)),crop:crop(b),easing:'easeInOutCubic'})}
  return{keys:clean(keys,aspect,w,h,settings.camera.zoomLevel),fellBack,reason}
}
export function cameraAt(keys:CamKey[],t:number):Rect{let a=keys[0],b=keys.at(-1)!;for(let i=1;i<keys.length;i++)if(t<=keys[i].t){a=keys[i-1];b=keys[i];break}let q=(t-a.t)/Math.max(.000001,b.t-a.t);q=Math.max(0,Math.min(1,q));if(b.easing==='easeInOutCubic')q=q<.5?4*q*q*q:1-Math.pow(-2*q+2,3)/2;return{x:a.crop.x+(b.crop.x-a.crop.x)*q,y:a.crop.y+(b.crop.y-a.crop.y)*q,w:a.crop.w+(b.crop.w-a.crop.w)*q,h:a.crop.h+(b.crop.h-a.crop.h)*q}}

// Ranh giới chỉ union đúng hai trang kề nhau; không đọc trang i+2.
export function injectPageTransitions(keys:CamKey[],pages:Rect[],starts:number[],aspect:number,w:number,h:number,maxZoom:number){const out=[...keys];for(let i=0;i<pages.length-1;i++){const t=starts[i+1];out.push({t,crop:fitRect(union(pages[i],pages[i+1]),aspect,0,w,h,maxZoom),easing:'easeInOutCubic'})}return out.sort((a,b)=>a.t-b.t)}
