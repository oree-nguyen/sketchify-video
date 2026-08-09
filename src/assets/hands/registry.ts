import pencil from './pencil.png'
import grayBird from './gray-bird-pen.png'
import whiteBird from './white-bird-pen.png'
import marker from './big-pen.png'
import bluePen from './pen.png'
import type { HandStyleId } from '../../state/projectStore'

export const HAND_ASSETS: Record<HandStyleId, { label: string; src: string; anchorPct: { x: number; y: number } }> = {
  pencil: { label: 'Bút chì', src: pencil, anchorPct: { x: .6, y: .4 } },
  'feather-gray': { label: 'Lông vũ xám', src: grayBird, anchorPct: { x: 2.7, y: 1.4 } },
  'feather-white': { label: 'Lông vũ trắng', src: whiteBird, anchorPct: { x: 50.1, y: 1.7 } },
  marker: { label: 'Bút marker', src: marker, anchorPct: { x: 9, y: 1.3 } },
  'pen-blue': { label: 'Bút bi xanh', src: bluePen, anchorPct: { x: 22.6, y: .8 } },
}
