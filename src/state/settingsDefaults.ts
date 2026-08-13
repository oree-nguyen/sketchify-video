export type OrderMode = 'auto-row'|'ltr'|'rtl'|'ttb'|'btt'|'custom'
export type CameraMode = 'off'|'A-auto-follow'|'B-manual-keyframe'|'C-two-stage'|'D-hybrid'
export type PushEdge = 'auto'|'left'|'right'|'top'|'bottom'
export type PageZoomMode = 'auto-rows'|'manual'

export interface FrameSettings {
  workingWidth:number; edgeThreshold:number; bgTolerance:number; mergeRadius:number; minBlockInk:number
  orderMode:OrderMode; rowThresholdFactor:number; customOrder:number[]
  probeColors:number; minProbeRegion:number; photoDensityThreshold:number
  vectorLevels:number; vectorMinRegionArea:number; photoClusters:number; photoMinRegionArea:number
  holdDurationSec:number; fps:30|60; maxUnits:number
  camera:{mode:CameraMode;zoomPadding:number;zoomLevel:number;zoomOutPortion:number;maxBlocksForAutoFollow:number;manualKeyframes:Array<{blockId:number;crop:{x:number;y:number;w:number;h:number}}>}
  pageZoom:{enabled:boolean;mode:PageZoomMode;pageGroups:number[][];transitionSec:number;padding:number}
  handPushEnding:{enabled:boolean}
  cameraPinned:boolean
}

export const DEFAULT_SETTINGS:FrameSettings={
  workingWidth:960,edgeThreshold:42,bgTolerance:34,mergeRadius:0,minBlockInk:60,
  orderMode:'auto-row',rowThresholdFactor:.65,customOrder:[],
  probeColors:8,minProbeRegion:16,photoDensityThreshold:.012,
  vectorLevels:6,vectorMinRegionArea:6,photoClusters:10,photoMinRegionArea:10,
  holdDurationSec:2,fps:30,maxUnits:2000,
  camera:{mode:'D-hybrid',zoomPadding:.12,zoomLevel:2.6,zoomOutPortion:.18,maxBlocksForAutoFollow:25,manualKeyframes:[]},
  pageZoom:{enabled:false,mode:'auto-rows',pageGroups:[],transitionSec:1,padding:.08},
  handPushEnding:{enabled:false},
  cameraPinned:false,
}
