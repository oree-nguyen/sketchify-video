import type { CSSProperties, ReactNode } from 'react'
import { HAND_ASSETS } from '../assets/hands/registry'
import { buildCameraTimeline } from '../camera/cameraTimeline'
import type { Frame, HandStyleId, TransitionType } from '../state/projectStore'
import type { FrameSettings } from '../state/settingsDefaults'
import type { Analysis } from '../wasm/wasmClient'

const transitionOptions: Array<{ value: TransitionType; label: string; hint: string }> = [
  { value: 'none', label: 'Cắt thẳng', hint: 'Chuyển ngay sang khung kế tiếp.' },
  { value: 'zoom-morph', label: 'Zoom morph', hint: 'Lùi ra rồi tiến vào khung kế.' },
  { value: 'paper-airplane', label: 'Máy bay giấy', hint: 'Gấp và bay sang khung kế.' },
  { value: 'paper-fold', label: 'Gấp trang', hint: 'Lật trang để lộ khung kế.' },
]

const orderOptions: Array<{ value: FrameSettings['orderMode']; label: string }> = [
  { value: 'auto-row', label: 'Tự động theo hàng' },
  { value: 'ltr', label: 'Trái → phải' },
  { value: 'rtl', label: 'Phải → trái' },
  { value: 'ttb', label: 'Trên → dưới' },
  { value: 'btt', label: 'Dưới → trên' },
  { value: 'custom', label: 'Tự chọn' },
]

const cameraOptions: Array<{ value: FrameSettings['camera']['mode']; label: string; hint: string }> = [
  { value: 'off', label: 'Tắt camera', hint: 'Giữ toàn khung.' },
  { value: 'A-auto-follow', label: 'A · Bám vật thể', hint: 'Theo block đang được vẽ.' },
  { value: 'B-manual-keyframe', label: 'B · Khung thủ công', hint: 'Dùng thứ tự Tự chọn.' },
  { value: 'C-two-stage', label: 'C · Zoom đơn giản', hint: 'Một lần vào, một lần ra.' },
  { value: 'D-hybrid', label: 'D · Kết hợp', hint: 'Tự chọn A hoặc C.' },
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

export function EditPanel({ frame, analysis, last, update }: { frame: Frame; analysis: Analysis | null; last: boolean; update: (patch: Partial<Frame>) => void }) {
  const set = (patch: Partial<FrameSettings>) => update({ settings: { ...frame.settings, ...patch } })
  const cameraTimeline = analysis ? buildCameraTimeline(frame.settings, analysis.blocks, analysis.units, analysis.img.w, analysis.img.h, frame.pinnedBlockIds) : null
  return <>
    <div className="inspector-title"><span>ĐỊNH DẠNG</span><h2>Khung hình</h2><p>{frame.name}</p></div>
    <div className="settings-accordion">
      <Accordion title="Thời lượng & phân tích" meta={`${frame.durationSec}s`} open>
        <RangeField label="Thời gian vẽ" value={frame.settings.drawDurationSec} min={2} max={20} unit="s" onChange={(value) => { set({ drawDurationSec: value }); update({ durationSec: value + frame.settings.holdDurationSec }) }} />
        <RangeField label="Giữ khung" value={frame.settings.holdDurationSec} min={0} max={8} unit="s" onChange={(value) => { set({ holdDurationSec: value }); update({ durationSec: value + frame.settings.drawDurationSec }) }} />
        <RangeField label="Gộp vùng" value={frame.settings.mergeRadius} min={0} max={40} unit="px" hint="0 giữ nét rời; 40 gộp các vật thể gần nhau." onChange={(value) => set({ mergeRadius: value })} />
      </Accordion>

      <Accordion title="Thứ tự vẽ" meta={orderOptions.find((option) => option.value === frame.settings.orderMode)?.label}>
        <SelectMenu label="Chọn thứ tự" value={frame.settings.orderMode} options={orderOptions} onChange={(value) => set({ orderMode: value })} />
      </Accordion>

      <Accordion title="Camera" meta={cameraOptions.find((option) => option.value === frame.settings.camera.mode)?.label}>
        <SelectMenu
          label="Chế độ camera"
          value={frame.settings.camera.mode}
          options={cameraOptions.map((option) => ({ ...option, disabled: option.value === 'B-manual-keyframe' && frame.settings.orderMode !== 'custom' }))}
          onChange={(mode) => set({ camera: { ...frame.settings.camera, mode } })}
        />
        {frame.settings.orderMode !== 'custom' && <small className="field-hint">Chế độ B cần Thứ tự vẽ = Tự chọn.</small>}
        {cameraTimeline?.fellBack && <div className="camera-warning">{cameraTimeline.reason}</div>}
      </Accordion>

      <Accordion title="Zoom trang" meta={frame.settings.pageZoom.enabled ? 'Bật' : 'Tắt'}>
        <ToggleRow label="Thu nhỏ/phóng to giữa các trang" checked={frame.settings.pageZoom.enabled} onChange={(enabled) => set({ pageZoom: { ...frame.settings.pageZoom, enabled } })} />
        {frame.settings.pageZoom.enabled && <>
          <SelectMenu label="Cách gộp trang" value={frame.settings.pageZoom.mode} options={[
            { value: 'auto-rows' as const, label: 'Theo hàng tự động', disabled: frame.settings.orderMode !== 'auto-row' },
            { value: 'manual' as const, label: 'Tự gán thủ công' },
          ]} onChange={(mode) => set({ pageZoom: { ...frame.settings.pageZoom, mode } })} />
          <RangeField label="Thời lượng chuyển" value={frame.settings.pageZoom.transitionSec} min={0.4} max={3} step={0.1} unit="s" onChange={(transitionSec) => set({ pageZoom: { ...frame.settings.pageZoom, transitionSec } })} />
        </>}
      </Accordion>

      <Accordion title="Hiệu ứng vật thể" meta={analysis ? `${analysis.blocks.length} khối` : 'Chờ phân tích'}>
        {analysis && <OptionList title="Đẩy vật thể vào khung">
          {analysis.blocks.map((block) => <CheckRow key={block.id} label={`#${block.id + 1} · ${block.kind}`} checked={frame.settings.objectPushEntry.selectedBlockIds.includes(block.id)} onChange={(checked) => {
            const ids = frame.settings.objectPushEntry.selectedBlockIds
            set({ objectPushEntry: { ...frame.settings.objectPushEntry, selectedBlockIds: checked ? [...ids, block.id] : ids.filter((id) => id !== block.id) } })
          }} />)}
        </OptionList>}
        {analysis && <OptionList title="Ghim camera cận cảnh">
          {analysis.blocks.map((block) => <CheckRow key={block.id} label={`Khối #${block.id + 1}`} checked={frame.pinnedBlockIds.includes(block.id)} onChange={(checked) => update({ pinnedBlockIds: checked ? [...frame.pinnedBlockIds, block.id] : frame.pinnedBlockIds.filter((id) => id !== block.id) })} />)}
        </OptionList>}
        <ToggleRow label="Cử chỉ tay kết thúc" checked={frame.settings.handPushEnding.enabled} disabled={frame.settings.holdDurationSec < 1.2} onChange={(enabled) => set({ handPushEnding: { enabled } })} />
        <small className="field-hint">{frame.settings.holdDurationSec < 1.2 ? 'Cần giữ khung ít nhất 1,2 giây.' : 'Hiện trong 0,8 giây đầu của pha giữ khung.'}</small>
      </Accordion>

      {!last && <Accordion title="Chuyển sang khung kế" meta={transitionOptions.find((option) => option.value === frame.transitionToNext.type)?.label}>
        <div className="transition-list">{transitionOptions.map((option) => <button className={`transition-option ${frame.transitionToNext.type === option.value ? 'chosen' : ''}`} key={option.value} onClick={() => update({ transitionToNext: { ...frame.transitionToNext, type: option.value } })}>
          <span><b>{option.label}</b><small>{option.hint}</small></span>
        </button>)}</div>
      </Accordion>}
    </div>
  </>
}

function Accordion({ title, meta, open = false, children }: { title: string; meta?: string; open?: boolean; children: ReactNode }) {
  return <details className="setting-section" open={open}>
    <summary><span>{title}</span>{meta && <small>{meta}</small>}<i aria-hidden="true">⌄</i></summary>
    <div className="setting-section-body">{children}</div>
  </details>
}

function SelectMenu<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<{ value: T; label: string; hint?: string; disabled?: boolean }>; onChange: (value: T) => void }) {
  const selected = options.find((option) => option.value === value)
  return <div className="select-field">
    <span className="control-label">{label}</span>
    <details className="select-shell">
      <summary><span>{selected?.label ?? value}</span><i aria-hidden="true">⌄</i></summary>
      <div className="select-options" role="listbox">
        {options.map((option) => <button key={option.value} type="button" role="option" aria-selected={option.value === value} disabled={option.disabled} onClick={(event) => {
          onChange(option.value)
          event.currentTarget.closest('details')?.removeAttribute('open')
        }}><span>{option.label}</span>{option.hint && <small>{option.hint}</small>}</button>)}
      </div>
    </details>
  </div>
}

function RangeField({ label, value, min, max, step = 1, unit, hint, onChange }: { label: string; value: number; min: number; max: number; step?: number; unit: string; hint?: string; onChange: (value: number) => void }) {
  const progress = ((value - min) / Math.max(0.0001, max - min)) * 100
  return <label className="range-field">
    <span>{label}<output>{value}{unit}</output></span>
    <input className="range-input" type="range" min={min} max={max} step={step} value={value} style={{ '--range-progress': `${progress}%` } as CSSProperties} onChange={(event) => onChange(Number(event.target.value))} />
    {hint && <small className="field-hint">{hint}</small>}
  </label>
}

function ToggleRow({ label, checked, disabled = false, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return <label className={`toggle-row ${disabled ? 'disabled' : ''}`}><span>{label}</span><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /><i aria-hidden="true" /></label>
}

function OptionList({ title, children }: { title: string; children: ReactNode }) {
  return <div className="option-list"><strong>{title}</strong><div>{children}</div></div>
}

function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="check-row"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i aria-hidden="true" /><span>{label}</span></label>
}
