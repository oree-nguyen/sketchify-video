export type OrderMode = 'auto-row'|'ltr'|'rtl'|'ttb'|'btt'|'custom'
export type CameraMode = 'off'|'A-auto-follow'|'B-manual-keyframe'|'C-two-stage'|'D-hybrid'
export type PushEdge = 'auto'|'left'|'right'|'top'|'bottom'
export type PageZoomMode = 'auto-rows'|'manual'
export type SegmentationMode = 'auto'|'standard'|'saliency'
export type RasterWipeDirection = 'ttb'|'ltr'|'rtl'|'btt'

export interface FrameSettings {
  workingWidth:number; edgeThreshold:number; bgTolerance:number; mergeRadius:number; minBlockInk:number
  segmentationMode:SegmentationMode; bgVarianceThreshold:number; bgEntropyThreshold:number; saliencyPercentile:number; localRescanPaddingPct:number
  orderMode:OrderMode; rowThresholdFactor:number; customOrder:number[]
  probeColors:number; minProbeRegion:number; photoDensityThreshold:number
  vectorLevels:number; vectorMinRegionArea:number; photoClusters:number; photoMinRegionArea:number
  holdDurationSec:number; fps:30|60; maxUnits:number
  microPauseMs:number; groupPauseMs:number; proximityThresholdPct:number
  camera:{mode:CameraMode;zoomPadding:number;zoomLevel:number;zoomOutPortion:number;maxBlocksForAutoFollow:number;manualKeyframes:Array<{blockId:number;crop:{x:number;y:number;w:number;h:number}}>}
  pageZoom:{enabled:boolean;mode:PageZoomMode;pageGroups:number[][];transitionSec:number;padding:number}
  handPushEnding:{enabled:boolean}
  cameraPinned:boolean
  // null giu nguyen pipeline tach vat the. Khi bat, Frame duoc reveal nhu mot raster duy nhat.
  rasterWipe:{enabled:boolean;direction:RasterWipeDirection}|null
  rasterWipeDurationSec:number
}

export const DEFAULT_SETTINGS:FrameSettings={
  workingWidth:960,edgeThreshold:42,bgTolerance:34,mergeRadius:0,minBlockInk:60,
  segmentationMode:'auto',bgVarianceThreshold:15,bgEntropyThreshold:2.5,saliencyPercentile:75,localRescanPaddingPct:4,
  orderMode:'auto-row',rowThresholdFactor:.65,customOrder:[],
  probeColors:8,minProbeRegion:16,photoDensityThreshold:.012,
  vectorLevels:6,vectorMinRegionArea:6,photoClusters:10,photoMinRegionArea:10,
  holdDurationSec:2,fps:30,maxUnits:2000,
  microPauseMs:200,groupPauseMs:600,proximityThresholdPct:20,
  camera:{mode:'D-hybrid',zoomPadding:.12,zoomLevel:2.6,zoomOutPortion:.18,maxBlocksForAutoFollow:25,manualKeyframes:[]},
  pageZoom:{enabled:false,mode:'auto-rows',pageGroups:[],transitionSec:1,padding:.08},
  handPushEnding:{enabled:false},
  cameraPinned:false,
  rasterWipe:null,
  rasterWipeDurationSec:8,
}
