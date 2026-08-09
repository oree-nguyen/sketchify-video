import type { Block, DrawUnit, Rect } from '../wasm/wasmClient'
import type { FrameSettings } from '../state/settingsDefaults'
import { fitRect, type CamKey } from './cameraTimeline'

type Page={blockIds:number[];rect:Rect;t0:number;t1:number}
const union=(a:Rect,b:Rect):Rect=>{const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y),r=Math.max(a.x+a.w,b.x+b.w),d=Math.max(a.y+a.h,b.y+b.h);return{x,y,w:r-x,h:d-y}}
const blockTime=(id:number,units:DrawUnit[])=>{const own=units.filter(u=>u.blockId===id);return{t0:own[0]?.t0??0,t1:own.at(-1)?.t1??0}}
export function buildPages(blocks:Block[],units:DrawUnit[],settings:FrameSettings):Page[]{
  const groups=settings.pageZoom.mode==='manual'&&settings.pageZoom.pageGroups.length?settings.pageZoom.pageGroups:rowGroups(blocks)
  return groups.map(ids=>{const selected=ids.map(id=>blocks.find(b=>b.id===id)).filter(Boolean) as Block[];const rect=selected.slice(1).reduce((r,b)=>union(r,b.bbox),selected[0]?.bbox??{x:0,y:0,w:1,h:1});const times=ids.map(id=>blockTime(id,units));return{blockIds:ids,rect,t0:Math.min(...times.map(t=>t.t0)),t1:Math.max(...times.map(t=>t.t1))}}).filter(p=>p.blockIds.length)
}
function rowGroups(blocks:Block[]){const sorted=[...blocks].sort((a,b)=>a.centroid.y-b.centroid.y||a.centroid.x-b.centroid.x),groups:number[][]=[];for(const block of sorted){const row=groups.at(-1),anchor=row?.length?blocks.find(b=>b.id===row[0]):undefined;if(!row||!anchor||Math.abs(block.centroid.y-anchor.centroid.y)>Math.max(12,(block.bbox.h+anchor.bbox.h)*.45))groups.push([block.id]);else row.push(block.id)}return groups}
export function buildPageZoomKeys(blocks:Block[],units:DrawUnit[],settings:FrameSettings,w:number,h:number):CamKey[]{if(!settings.pageZoom.enabled)return[];const pages=buildPages(blocks,units,settings);if(pages.length<2)return[];const aspect=w/h,out:CamKey[]=[];for(let i=0;i<pages.length-1;i++){const a=pages[i],b=pages[i+1],half=settings.pageZoom.transitionSec/(2*Math.max(.001,settings.drawDurationSec+settings.holdDurationSec)),mid=a.t1;out.push({t:Math.max(a.t0,mid-half),crop:fitRect(a.rect,aspect,settings.pageZoom.padding,w,h,settings.camera.zoomLevel),easing:'easeInOutCubic'},{t:mid,crop:fitRect(union(a.rect,b.rect),aspect,settings.pageZoom.padding,w,h,settings.camera.zoomLevel),easing:'easeInOutCubic'},{t:Math.min(b.t1,mid+half),crop:fitRect(b.rect,aspect,settings.pageZoom.padding,w,h,settings.camera.zoomLevel),easing:'easeInOutCubic'})}return out}
