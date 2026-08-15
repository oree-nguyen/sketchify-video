import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type MutableRefObject, type ReactNode } from 'react'
import { ArrowSquareIn, CaretDown, CaretRight, DotsSixVertical, FrameCorners, ListBullets, MagnifyingGlass, SquaresFour, StackMinus, StackPlus } from '@phosphor-icons/react'
import { HAND_ASSETS } from '../assets/hands/registry'
import { buildCameraTimeline } from '../camera/cameraTimeline'
import { frameDrawDurationSec, frameDurationSec, type AudioClip, type Frame, type FrameObject, type HandStyleId, type ObjectSettings, type PushHandStyle, type TransitionType } from '../state/projectStore'
import type { FrameSettings, PushEdge } from '../state/settingsDefaults'
import type { Analysis } from '../wasm/wasmClient'

const transitionOptions: Array<{ value: TransitionType; label: string; hint: string }> = [
  { value: 'none', label: 'Cắt thẳng', hint: 'Chuyển ngay sang khung kế tiếp.' },
  { value: 'zoom-morph', label: 'Zoom morph', hint: 'Lùi ra rồi tiến vào khung kế.' },
  { value: 'paper-airplane', label: 'Máy bay giấy', hint: 'Gấp và bay sang khung kế.' },
  { value: 'paper-fold', label: 'Gấp trang', hint: 'Lật trang để lộ khung kế.' },
]

const cameraOptions: Array<{ value: FrameSettings['camera']['mode']; label: string; hint: string }> = [
  { value: 'off', label: 'Tắt camera', hint: 'Giữ toàn khung.' },
  { value: 'A-auto-follow', label: 'A · Bám vật thể', hint: 'Theo đúng vật thể đang được vẽ.' },
  { value: 'B-manual-keyframe', label: 'B · Khung thủ công', hint: 'Dùng crop thủ công theo từng vật thể.' },
  { value: 'C-two-stage', label: 'C · Zoom đơn giản', hint: 'Một lần vào, một lần ra.' },
  { value: 'D-hybrid', label: 'D · Kết hợp', hint: 'Tự chọn A hoặc C theo số vật thể.' },
]

const edgeOptions: Array<{ value: PushEdge; label: string }> = [
  { value: 'auto', label: 'Cạnh gần nhất' }, { value: 'left', label: 'Từ trái' },
  { value: 'right', label: 'Từ phải' }, { value: 'top', label: 'Từ trên' }, { value: 'bottom', label: 'Từ dưới' },
]
const pushHandOptions: Array<{ value: PushHandStyle; label: string }> = [
  { value: 'auto', label: 'Tự động theo hướng' },
  ...(['1', '2', '3', '4', '5', '6'] as PushHandStyle[]).map((value) => ({ value, label: `Tay đẩy số ${value}` })),
]

export function HandPanel({ style, setStyle }: { style: HandStyleId; setStyle: (id: HandStyleId) => void }) {
  return <>
    <div className="inspector-title"><span>CÔNG CỤ</span><h2>Bàn tay</h2><p>Một kiểu tay xuyên suốt toàn bộ video.</p></div>
    <div className="hand-grid">
      {(Object.entries(HAND_ASSETS) as [HandStyleId, typeof HAND_ASSETS[HandStyleId]][]).map(([id, hand]) => <button className={`hand-card ${style === id ? 'selected' : ''}`} key={id} onClick={() => setStyle(id)}>
        <img src={hand.src} alt="" /><span>{hand.label}</span>
      </button>)}
    </div>
  </>
}

interface EditPanelProps {
  frame: Frame
  analysis: Analysis | null
  last: boolean
  scope: 'object' | 'frame'
  setScope: (scope: 'object' | 'frame') => void
  selectedObjectId: string | null
  selectedObjectIds: string[]
  selectObject: (objectId: string | null) => void
  toggleObjectSelection: (objectId: string, modifiers: { range?: boolean; additive?: boolean }) => void
  groupSelectedObjects: () => void
  ungroupObject: (groupId: string) => void
  rescanObject: (objectId: string) => void
  updateFrameSettings: (patch: Partial<FrameSettings>) => void
  updateTransition: (patch: Partial<Frame['transitionToNext']>) => void
  updateObject: (objectId: string, patch: Partial<ObjectSettings>) => void
  reorderObject: (fromObjectId: string, toObjectId: string, position: 'before' | 'after') => void
  setObjectOrderDirect: (objectId: string, order: number) => void
  audioClip?: AudioClip
  removeAudio: () => void
  removeFrame: () => void
}

export function EditPanel({ frame, analysis, last, scope, setScope, selectedObjectId, selectedObjectIds, selectObject, toggleObjectSelection, groupSelectedObjects, ungroupObject, rescanObject, updateFrameSettings, updateTransition, updateObject, reorderObject, setObjectOrderDirect, audioClip, removeAudio, removeFrame }: EditPanelProps) {
  const draggedObjectId = useRef<string | null>(null)
  const dropElement = useRef<HTMLElement | null>(null)
  const drawDuration = frameDrawDurationSec(frame)
  const zoomBlocks = frame.objects.filter((object) => object.settings.zoomFollow).map((object) => object.blockId)
  const cameraTimeline = analysis ? buildCameraTimeline(frame.settings, analysis.blocks, analysis.units, analysis.img.w, analysis.img.h, zoomBlocks, drawDuration) : null
  const selected = frame.objects.find((object) => object.objectId === selectedObjectId) ?? frame.objects[0]
  const [gridMode, setGridMode] = useState(false)
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null)

  return <>
    <div className="inspector-title"><span>ĐỊNH DẠNG</span><h2>Khung & vật thể</h2><p>{frame.name}</p></div>
    <div className="edit-scope-tabs" role="tablist" aria-label="Phạm vi thiết lập">
      <button role="tab" aria-selected={scope === 'object'} className={scope === 'object' ? 'active' : ''} onClick={() => { setScope('object'); selectObject(selected?.objectId ?? null) }}>Vật thể <small>{frame.objects.length}</small></button>
      <button role="tab" aria-selected={scope === 'frame'} className={scope === 'frame' ? 'active' : ''} onClick={() => { setScope('frame'); selectObject(null) }}>Khung hình</button>
    </div>
    <div className="settings-accordion">
      {scope === 'object' && <Accordion title="Vật thể" meta={`${frame.objects.length} · ${formatSec(drawDuration)} vẽ`} open>
        {!frame.objects.length && <p className="empty-objects">Đang chờ kết quả phân tích để tạo danh sách vật thể…</p>}
        {frame.objects.length > 0 && <div className="object-group-toolbar"><span>{selectedObjectIds.length} vật thể đã chọn</span><div className="object-toolbar-icons"><button type="button" title="Gom nhóm (Ctrl+G)" aria-label="Gom nhóm" disabled={selectedObjectIds.length < 2} onClick={groupSelectedObjects}><StackPlus size={16} weight="bold" /></button><button type="button" title="Tách nhóm về lần gom gần nhất" aria-label="Tách nhóm" disabled={!selected?.groupMembers?.length} onClick={() => selected && ungroupObject(selected.objectId)}><StackMinus size={16} weight="bold" /></button><button type="button" title="Đẩy vật thể vào khung" aria-label="Đẩy vật thể vào khung" disabled={!selected} aria-pressed={selected?.settings.pushEntry.enabled} onClick={() => selected && updateObject(selected.objectId, { pushEntry: { ...selected.settings.pushEntry, enabled: !selected.settings.pushEntry.enabled } })}><ArrowSquareIn size={16} weight="bold" /></button><button type="button" title="Zoom theo vật thể" aria-label="Zoom theo vật thể" disabled={!selected} aria-pressed={selected?.settings.zoomFollow} onClick={() => selected && updateObject(selected.objectId, { zoomFollow: !selected.settings.zoomFollow })}><MagnifyingGlass size={16} weight="bold" /></button><button type="button" title={gridMode ? 'Xem dạng danh sách' : 'Xem dạng lưới'} aria-label={gridMode ? 'Xem dạng danh sách' : 'Xem dạng lưới'} aria-pressed={gridMode} onClick={() => setGridMode((value) => !value)}>{gridMode ? <ListBullets size={16} weight="bold" /> : <SquaresFour size={16} weight="bold" />}</button></div></div>}
        <div className={`object-list ${gridMode ? 'object-grid' : ''}`} aria-label="Danh sách vật thể">
          {[...frame.objects].sort((a, b) => a.settings.order - b.settings.order).map((object) => <article
            className={`object-row ${selectedObjectIds.includes(object.objectId) ? 'selected' : ''}`}
            key={object.objectId}
            data-object-id={object.objectId}
            data-block-id={object.blockId}
            draggable
            onDragStart={(event) => beginObjectDrag(event, object.objectId, draggedObjectId)}
            onDragEnd={(event) => finishObjectDrag(event, draggedObjectId, dropElement)}
            onDragOver={(event) => markObjectDrop(event, object.objectId, draggedObjectId, dropElement)}
            onDragLeave={(event) => clearObjectDropOnLeave(event, dropElement)}
            onDrop={(event) => dropObject(event, object.objectId, draggedObjectId, dropElement, reorderObject)}
            onClick={(event) => toggleObjectSelection(object.objectId, { range: event.shiftKey, additive: event.ctrlKey || event.metaKey })}
          >
            <span className="object-grip" aria-hidden="true"><DotsSixVertical size={15} weight="bold" /></span>
            <ObjectThumbnail analysis={analysis} object={object} />
            <span className="object-summary"><b><ObjectOrderInput object={object} count={frame.objects.length} commit={setObjectOrderDirect} /><em>{object.settings.kindOverride ?? object.kind}</em>{object.groupMembers?.length ? <button className="group-disclosure" type="button" aria-expanded={expandedGroupId === object.objectId} title="Xem các vật thể trong nhóm" onClick={(event) => { event.stopPropagation(); setExpandedGroupId((current) => current === object.objectId ? null : object.objectId) }}>{expandedGroupId === object.objectId ? <CaretDown size={13} weight="bold" /> : <CaretRight size={13} weight="bold" />}<span>{object.groupMembers.length}</span></button> : null}</b><small>{object.inkArea} ink · {object.bbox.w}×{object.bbox.h}px</small>{selected?.objectId === object.objectId && <small className="timeline-clean">Timeline đã cập nhật</small>}</span>
            <label className="object-duration" title="Thời gian vẽ" onClick={(event) => event.stopPropagation()}><input aria-label="Thời gian vẽ" type="number" min="0.1" max="120" step="0.1" value={object.settings.drawDurationSec} onChange={(event) => updateObject(object.objectId, { drawDurationSec: Math.max(.1, Number(event.target.value)) })} /><i>s</i></label>
            <span className="object-flags" aria-label="Hiệu ứng vật thể">
              <button type="button" title="Đẩy vào khung" aria-label="Đẩy vào khung" aria-pressed={object.settings.pushEntry.enabled} onClick={(event) => { event.stopPropagation(); updateObject(object.objectId, { pushEntry: { ...object.settings.pushEntry, enabled: !object.settings.pushEntry.enabled } }) }}><ArrowSquareIn size={13} weight="bold" /></button>
              <button type="button" title="Zoom theo vật thể" aria-label="Zoom theo vật thể" aria-pressed={object.settings.zoomFollow} onClick={(event) => { event.stopPropagation(); if (frame.settings.cameraPinned && !object.settings.zoomFollow) window.alert('Ghim camera đang bật (camera nhìn toàn khung, không di chuyển). Vui lòng tắt Ghim camera để dùng Zoom theo vật thể.'); else updateObject(object.objectId, { zoomFollow: !object.settings.zoomFollow }) }}><FrameCorners size={13} weight="bold" /></button>
            </span>
          </article>)}
        </div>

        {expandedGroupId && frame.objects.find((object) => object.objectId === expandedGroupId)?.groupMembers && <div className="group-members"><div className="group-members-heading"><b>Lần gom gần nhất</b><button type="button" onClick={() => ungroupObject(expandedGroupId)}><StackMinus size={14} weight="bold" /> Tách nhóm</button></div>{frame.objects.find((object) => object.objectId === expandedGroupId)!.groupMembers!.map((member, index) => <div className="group-member" key={member.objectId}><span>{index + 1}</span><ObjectThumbnail analysis={analysis} object={member} /><div><b>{member.groupMembers?.length ? `Nhóm ${member.groupMembers.length} vật thể` : `Vật thể ${member.settings.kindOverride ?? member.kind}`}</b><small>{member.bbox.w}×{member.bbox.h}px</small></div>{member.groupMembers?.length ? <StackPlus size={14} weight="bold" /> : null}</div>)}</div>}

        {selected && <div className="object-detail">
          <div className="object-detail-heading"><span>Thiết lập vật thể #{selected.settings.order + 1}</span><small>ID {selected.objectId}</small></div>
          <SelectMenu label="Kiểu thể hiện" value={selected.settings.kindOverride ?? selected.kind} options={[
            { value: 'vector' as const, label: 'Vector · nét vẽ' },
            { value: 'photo' as const, label: 'Ảnh · vùng màu' },
          ]} onChange={(kindOverride) => updateObject(selected.objectId, { kindOverride })} />
          <ToggleRow label="Đẩy vật thể vào khung" checked={selected.settings.pushEntry.enabled} onChange={(enabled) => updateObject(selected.objectId, { pushEntry: { ...selected.settings.pushEntry, enabled } })} />
          {selected.settings.pushEntry.enabled && <SelectMenu label="Hướng đi vào" value={selected.settings.pushEntry.edge} options={edgeOptions} onChange={(edge) => updateObject(selected.objectId, { pushEntry: { ...selected.settings.pushEntry, edge } })} />}
          {selected.settings.pushEntry.enabled && <SelectMenu label="Tay đẩy" value={selected.settings.pushEntry.handStyle} options={pushHandOptions} onChange={(handStyle) => updateObject(selected.objectId, { pushEntry: { ...selected.settings.pushEntry, handStyle } })} />}
          <ToggleRow label="Zoom theo vật thể" checked={selected.settings.zoomFollow} disabled={frame.settings.cameraPinned} onBlocked={() => window.alert('Ghim camera đang bật (camera nhìn toàn khung, không di chuyển). Vui lòng tắt Ghim camera để dùng Zoom theo vật thể.')} onChange={(zoomFollow) => updateObject(selected.objectId, { zoomFollow })} />
          <button className="local-rescan-button" type="button" onClick={() => rescanObject(selected.objectId)}><MagnifyingGlass size={16} weight="bold" /> Quét lại vùng này</button>
          <small className="local-rescan-hint">Chạy saliency trong riêng bbox vật thể, có nới biên {frame.settings.localRescanPaddingPct}%.</small>
        </div>}
      </Accordion>}

      {scope === 'frame' && <Accordion title="Khung hình" meta={`${formatSec(frameDurationSec(frame))} tổng`} open>
        <div className="derived-duration"><span>Thời gian vẽ</span><b>{formatSec(drawDuration)}</b><small>Tự tính từ tổng thời gian của {frame.objects.length} vật thể.</small></div>
        <RangeField label="Giữ khung" value={frame.settings.holdDurationSec} min={0} max={12} step={.1} unit="s" onChange={(holdDurationSec) => updateFrameSettings({ holdDurationSec })} />
        {frame.imageSource === 'ai-generated' && <div className="ai-frame-detail"><b>Ảnh do AI tạo</b><p>{frame.aiGeneration?.prompt}</p><small>{frame.aiGeneration?.generatedAt ? new Date(frame.aiGeneration.generatedAt).toLocaleString('vi-VN') : ''}</small></div>}
        {audioClip && <div className="ai-frame-detail"><b>Giọng đọc · {formatSec(audioClip.durationSec)}</b><p>{audioClip.narrationText}</p><audio controls src={audioClip.sourceUrl} /><button className="quiet" type="button" onClick={removeAudio}>Xoá giọng đọc</button></div>}
        <button className="danger-button" type="button" onClick={removeFrame}>Xoá khung hình</button>
      </Accordion>}

      {scope === 'frame' && <Accordion title="04 · Phân tích ảnh" meta={frame.settings.segmentationMode === 'auto' ? 'Tự động' : frame.settings.segmentationMode === 'saliency' ? 'Saliency' : 'Chuẩn'}>
        <SelectMenu label="Thuật toán tách" value={frame.settings.segmentationMode} options={[
          { value: 'auto' as const, label: 'Tự động theo nền' },
          { value: 'standard' as const, label: 'Ép thuật toán chuẩn' },
          { value: 'saliency' as const, label: 'Ép thuật toán saliency' },
        ]} onChange={(segmentationMode) => updateFrameSettings({ segmentationMode })} />
        {analysis && <div className="analysis-metrics"><b>{analysis.stats.segmentationMode === 'saliency' ? 'Nền phức tạp · thuật toán saliency' : 'Nền đơn giản · thuật toán chuẩn'}</b><small>Độ lệch màu {analysis.stats.backgroundVariance.toFixed(1)} · entropy {analysis.stats.backgroundEntropy.toFixed(2)} bit</small></div>}
        <details className="advanced-settings">
          <summary>Nâng cao</summary>
          <RangeField label="Ngưỡng phương sai nền" value={frame.settings.bgVarianceThreshold} min={2} max={60} step={1} unit="" onChange={(bgVarianceThreshold) => updateFrameSettings({ bgVarianceThreshold })} />
          <RangeField label="Ngưỡng entropy nền" value={frame.settings.bgEntropyThreshold} min={.5} max={6} step={.1} unit="bit" onChange={(bgEntropyThreshold) => updateFrameSettings({ bgEntropyThreshold })} />
          <RangeField label="Percentile saliency" value={frame.settings.saliencyPercentile} min={70} max={90} step={1} unit="%" onChange={(saliencyPercentile) => updateFrameSettings({ saliencyPercentile })} />
          <RangeField label="Nới biên quét cục bộ" value={frame.settings.localRescanPaddingPct} min={0} max={12} step={1} unit="%" onChange={(localRescanPaddingPct) => updateFrameSettings({ localRescanPaddingPct })} />
        </details>
      </Accordion>}

      {scope === 'frame' && <Accordion title="07 · Nhịp nghỉ" meta={`${frame.settings.microPauseMs}/${frame.settings.groupPauseMs}ms`}>
        <RangeField label="Nghỉ giữa vật thể-nhãn" value={frame.settings.microPauseMs} min={100} max={300} step={10} unit="ms" onChange={(microPauseMs) => updateFrameSettings({ microPauseMs })} />
        <RangeField label="Nghỉ khi chuyển ý khác" value={frame.settings.groupPauseMs} min={400} max={800} step={20} unit="ms" onChange={(groupPauseMs) => updateFrameSettings({ groupPauseMs })} />
        <details className="advanced-settings">
          <summary>Nâng cao</summary>
          <RangeField label="Ngưỡng phân biệt gần/xa" value={frame.settings.proximityThresholdPct} min={5} max={40} step={1} unit="%" onChange={(proximityThresholdPct) => updateFrameSettings({ proximityThresholdPct })} />
        </details>
      </Accordion>}

      {scope === 'frame' && <Accordion title="Camera" meta={cameraOptions.find((option) => option.value === frame.settings.camera.mode)?.label}>
        <ToggleRow label="Ghim camera" checked={frame.settings.cameraPinned} onChange={(cameraPinned) => { if (cameraPinned && frame.objects.some((object) => object.settings.zoomFollow)) window.alert('Đang có vật thể bật Zoom theo vật thể. Vui lòng tắt Zoom theo vật thể trước khi bật Ghim camera.'); else updateFrameSettings({ cameraPinned }) }} />
        <SelectMenu label="Chế độ camera" value={frame.settings.camera.mode} options={cameraOptions} onChange={(mode) => updateFrameSettings({ camera: { ...frame.settings.camera, mode } })} />
        {cameraTimeline?.fellBack && <div className="camera-warning">{cameraTimeline.reason}</div>}
      </Accordion>}

      {scope === 'frame' && <Accordion title="Zoom trang" meta={frame.settings.pageZoom.enabled ? 'Bật' : 'Tắt'}>
        <ToggleRow label="Zoom giữa các trang" checked={frame.settings.pageZoom.enabled} onChange={(enabled) => updateFrameSettings({ pageZoom: { ...frame.settings.pageZoom, enabled } })} />
        {frame.settings.pageZoom.enabled && <>
          <SelectMenu label="Cách gộp trang" value={frame.settings.pageZoom.mode} options={[
            { value: 'auto-rows' as const, label: 'Theo hàng tự động' },
            { value: 'manual' as const, label: 'Tự gán thủ công' },
          ]} onChange={(mode) => updateFrameSettings({ pageZoom: { ...frame.settings.pageZoom, mode } })} />
          <RangeField label="Thời lượng chuyển" value={frame.settings.pageZoom.transitionSec} min={.4} max={3} step={.1} unit="s" onChange={(transitionSec) => updateFrameSettings({ pageZoom: { ...frame.settings.pageZoom, transitionSec } })} />
        </>}
      </Accordion>}

      {scope === 'frame' && !last && <Accordion title="Chuyển sang khung kế" meta={transitionOptions.find((option) => option.value === frame.transitionToNext.type)?.label}>
        <div className="transition-list">{transitionOptions.map((option) => <button className={`transition-option ${frame.transitionToNext.type === option.value ? 'chosen' : ''}`} key={option.value} onClick={() => updateTransition({ type: option.value })}>
          <span><b>{option.label}</b><small>{option.hint}</small></span>
        </button>)}</div>
        {frame.transitionToNext.type !== 'none' && <RangeField label="Thời lượng chuyển" value={frame.transitionToNext.durationSec} min={.4} max={3} step={.1} unit="s" onChange={(durationSec) => updateTransition({ durationSec })} />}
      </Accordion>}
    </div>
  </>
}

function beginObjectDrag(event: DragEvent<HTMLElement>, objectId: string, dragged: MutableRefObject<string | null>) {
  dragged.current = objectId
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('application/x-sketchify-object', objectId)
  event.dataTransfer.setData('text/plain', objectId)
  event.currentTarget.classList.add('dragging')
}

function markObjectDrop(event: DragEvent<HTMLElement>, targetId: string, dragged: MutableRefObject<string | null>, dropElement: MutableRefObject<HTMLElement | null>) {
  const sourceId = event.dataTransfer.getData('application/x-sketchify-object') || dragged.current
  if (!sourceId || sourceId === targetId) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'
  const bounds = event.currentTarget.getBoundingClientRect()
  const position = event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
  if (dropElement.current && dropElement.current !== event.currentTarget) delete dropElement.current.dataset.dropPosition
  event.currentTarget.dataset.dropPosition = position
  dropElement.current = event.currentTarget
}

function clearObjectDropOnLeave(event: DragEvent<HTMLElement>, dropElement: MutableRefObject<HTMLElement | null>) {
  if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
  delete event.currentTarget.dataset.dropPosition
  if (dropElement.current === event.currentTarget) dropElement.current = null
}

function dropObject(event: DragEvent<HTMLElement>, targetId: string, dragged: MutableRefObject<string | null>, dropElement: MutableRefObject<HTMLElement | null>, reorder: (from: string, to: string, position: 'before' | 'after') => void) {
  event.preventDefault()
  event.stopPropagation()
  const sourceId = event.dataTransfer.getData('application/x-sketchify-object') || event.dataTransfer.getData('text/plain') || dragged.current
  const position = event.currentTarget.dataset.dropPosition === 'after' ? 'after' : 'before'
  delete event.currentTarget.dataset.dropPosition
  dropElement.current = null
  dragged.current = null
  if (sourceId && sourceId !== targetId) reorder(sourceId, targetId, position)
}

function finishObjectDrag(event: DragEvent<HTMLElement>, dragged: MutableRefObject<string | null>, dropElement: MutableRefObject<HTMLElement | null>) {
  event.currentTarget.classList.remove('dragging')
  if (dropElement.current) delete dropElement.current.dataset.dropPosition
  dropElement.current = null
  dragged.current = null
}

function ObjectThumbnail({ analysis, object }: { analysis: Analysis | null; object: FrameObject }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !analysis) return
    const { bbox } = object
    canvas.width = Math.max(1, bbox.w); canvas.height = Math.max(1, bbox.h)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return
    const data = context.createImageData(canvas.width, canvas.height)
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      const source = ((bbox.y + y) * analysis.img.w + bbox.x + x) * 4
      const target = (y * canvas.width + x) * 4
      data.data[target] = analysis.img.rgba[source]
      data.data[target + 1] = analysis.img.rgba[source + 1]
      data.data[target + 2] = analysis.img.rgba[source + 2]
      data.data[target + 3] = analysis.img.rgba[source + 3]
    }
    context.putImageData(data, 0, 0)
  }, [analysis, object])
  return <canvas ref={ref} className="object-thumb" aria-hidden="true" />
}

function ObjectOrderInput({ object, count, commit }: { object: FrameObject; count: number; commit: (objectId: string, order: number) => void }) {
  const [draft, setDraft] = useState(String(object.settings.order + 1))
  useEffect(() => setDraft(String(object.settings.order + 1)), [object.settings.order])
  const apply = () => {
    const parsed = Number.parseInt(draft, 10)
    const next = Number.isFinite(parsed) ? Math.max(1, Math.min(count, parsed)) : object.settings.order + 1
    setDraft(String(next))
    if (next !== object.settings.order + 1) commit(object.objectId, next - 1)
  }
  return <label className="object-order" title="Nhập thứ tự mới rồi nhấn Enter" onClick={(event) => event.stopPropagation()}><span>Thứ tự</span><input aria-label={`Thứ tự vật thể ${object.settings.order + 1}`} type="number" min="1" max={count} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={apply} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); apply(); event.currentTarget.blur() } }} /></label>
}

function formatSec(value: number) { return `${Math.round(value * 10) / 10}s` }

function Accordion({ title, meta, open = false, children }: { title: string; meta?: string; open?: boolean; children: ReactNode }) {
  return <details className="setting-section" open={open}>
    <summary><span>{title}</span>{meta && <small>{meta}</small>}<i aria-hidden="true">⌄</i></summary>
    <div className="setting-section-body">{children}</div>
  </details>
}

function SelectMenu<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<{ value: T; label: string; hint?: string; disabled?: boolean }>; onChange: (value: T) => void }) {
  const selected = options.find((option) => option.value === value)
  return <div className="select-field"><span className="control-label">{label}</span><details className="select-shell">
    <summary><span>{selected?.label ?? value}</span><i aria-hidden="true">⌄</i></summary>
    <div className="select-options" role="listbox">{options.map((option) => <button key={option.value} type="button" role="option" aria-selected={option.value === value} disabled={option.disabled} onClick={(event) => { onChange(option.value); event.currentTarget.closest('details')?.removeAttribute('open') }}><span>{option.label}</span>{option.hint && <small>{option.hint}</small>}</button>)}</div>
  </details></div>
}

function RangeField({ label, value, min, max, step = 1, unit, onChange }: { label: string; value: number; min: number; max: number; step?: number; unit: string; onChange: (value: number) => void }) {
  const progress = ((value - min) / Math.max(.0001, max - min)) * 100
  return <label className="range-field"><span>{label}<output>{Math.round(value * 10) / 10}{unit}</output></span><input className="range-input" type="range" min={min} max={max} step={step} value={value} style={{ '--range-progress': `${progress}%` } as CSSProperties} onChange={(event) => onChange(Number(event.target.value))} /></label>
}

function ToggleRow({ label, checked, disabled = false, onBlocked, onChange }: { label: string; checked: boolean; disabled?: boolean; onBlocked?: () => void; onChange: (checked: boolean) => void }) {
  return <label className={`toggle-row ${disabled ? 'disabled' : ''}`} onClick={(event) => { if (disabled) { event.preventDefault(); onBlocked?.() } }}><span>{label}</span><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /><i aria-hidden="true" /></label>
}
