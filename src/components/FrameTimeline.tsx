import { useRef, useState, type DragEvent, type PointerEventHandler } from 'react'
import type { Frame } from '../state/projectStore'

interface TimelineProps {
  frames: Frame[]
  activeId?: number
  select: (id: number) => void
  upload: () => void
  drop: (event: DragEvent) => void
  create: () => void
  regenerate: (frame: Frame) => void
}

export function FramePanel({ frames, activeId, select, drop, create, regenerate, horizontal, onPointerMove }: TimelineProps & { horizontal: () => void; onPointerMove: PointerEventHandler<HTMLElement> }) {
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const nodes = useRef(new Map<number, HTMLElement>())
  const before = useRef(new Map<number, DOMRect>())

  const capturePositions = () => { before.current = new Map([...nodes.current].map(([id, node]) => [id, node.getBoundingClientRect()])) }
  const animateReorder = () => requestAnimationFrame(() => {
    for (const [id, node] of nodes.current) {
      const oldRect = before.current.get(id)
      const currentRect = node.getBoundingClientRect()
      if (!oldRect) continue
      const dx = oldRect.left - currentRect.left
      const dy = oldRect.top - currentRect.top
      if (!dx && !dy) continue
      node.style.transition = 'transform 0s'
      node.style.transform = `translate(${dx}px, ${dy}px)`
      requestAnimationFrame(() => {
        node.style.transition = 'transform 180ms cubic-bezier(.2,.8,.2,1)'
        node.style.transform = 'translate(0, 0)'
      })
    }
  })

  return <aside className="frame-panel spotlight-surface" onPointerMove={onPointerMove}>
    <div className="panel-heading"><span>KHUNG HÌNH</span><small>{frames.length} / ∞</small></div>
    <div className="frame-stack">
      {frames.map((frame, index) => <article
        ref={(node) => { if (node) nodes.current.set(frame.id, node); else nodes.current.delete(frame.id) }}
        key={frame.id}
        draggable
        onDragStart={() => { capturePositions(); setDragIndex(index) }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={() => {
          if (dragIndex !== null && dragIndex !== index) {
            window.dispatchEvent(new CustomEvent('sketchify-reorder', { detail: { from: dragIndex, to: index } }))
            animateReorder()
          }
          setDragIndex(null)
        }}
        className={`frame-card ${frame.id === activeId ? 'selected' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => select(frame.id)}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(frame.id) } }}
      >
        <span className="frame-index">{String(index + 1).padStart(2, '0')}</span>
        <img src={frame.sourceUrl} alt={frame.name} />
        <span>{frame.name}{frame.dirty ? ' · đang cập nhật' : ''}</span>
        {frame.imageSource === 'ai-generated' && <span className="ai-frame-meta" title={frame.aiGeneration?.prompt}>{frame.aiGeneration?.prompt}<button type="button" onClick={(event) => { event.stopPropagation(); regenerate(frame) }}>Tạo lại</button></span>}
      </article>)}
      <UploadCard number={frames.length + 1} upload={create} drop={drop} />
    </div>
    <button className="timeline-switch" onClick={horizontal}>↔ Chuyển timeline sang ngang</button>
  </aside>
}

export function HorizontalTimeline({ frames, activeId, select, drop, create, vertical }: TimelineProps & { vertical: () => void }) {
  return <div className="horizontal-timeline">
    <div className="panel-heading"><span>TIMELINE</span><button onClick={vertical}>Đổi sang dọc</button></div>
    <div className="horizontal-frames">
      {frames.map((frame, index) => <button className={`strip-frame ${frame.id === activeId ? 'selected' : ''}`} key={frame.id} onClick={() => select(frame.id)}>
        <img src={frame.sourceUrl} alt="" /><span>#{index + 1}</span>
      </button>)}
      <UploadCard number={frames.length + 1} upload={create} drop={drop} />
    </div>
  </div>
}

function UploadCard({ number, upload, drop }: { number: number; upload: () => void; drop: (event: DragEvent) => void }) {
  return <button className="upload-card" onClick={upload} onDragOver={(event) => event.preventDefault()} onDrop={drop}>
    <strong>+</strong><span>Khung hình #{number}</span><small>Kéo thả hoặc tải lên</small>
  </button>
}
