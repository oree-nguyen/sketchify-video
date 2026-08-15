import type { CSSProperties } from 'react'
import type { SubtitleSettings } from '../state/projectStore'

export function SubtitlePanel({ settings, update }: { settings: SubtitleSettings; update: (patch: Partial<SubtitleSettings>) => void }) {
  return <>
    <div className="inspector-title"><span>CÔNG CỤ</span><h2>Phụ đề</h2><p>Thiết lập toàn cục, áp dụng cho mọi khung hình và video xuất.</p></div>
    <section className="subtitle-panel">
      <label className="subtitle-enable"><span>Hiển thị phụ đề</span><input type="checkbox" checked={settings.enabled} onChange={(event) => update({ enabled: event.target.checked })} /></label>
      <label className="subtitle-field"><span>Font chữ</span><select value={settings.fontFamily} onChange={(event) => update({ fontFamily: event.target.value })}>
        <option value="Oswald Sketchify">Oswald</option><option value="Arial">Arial</option><option value="Georgia">Georgia</option><option value="monospace">Monospace</option>
      </select></label>
      <label className="range-field"><span>Cỡ chữ <output>{Math.max(7, Math.min(20, settings.fontSizePx))}px</output></span><input className="range-input" type="range" min="7" max="20" step="1" value={Math.max(7, Math.min(20, settings.fontSizePx))} style={{ '--range-progress': `${(Math.max(7, Math.min(20, settings.fontSizePx)) - 7) / 13 * 100}%` } as CSSProperties} onChange={(event) => update({ fontSizePx: Number(event.target.value) })} /></label>
      <label className="subtitle-color"><span>Màu chữ</span><input aria-label="Màu phụ đề" type="color" value={settings.color} onChange={(event) => update({ color: event.target.value })} /></label>
      <div className="subtitle-style-buttons" aria-label="Kiểu chữ">
        <button type="button" aria-pressed={settings.bold} className={settings.bold ? 'active' : ''} onClick={() => update({ bold: !settings.bold })}><b>B</b></button>
        <button type="button" aria-pressed={settings.italic} className={settings.italic ? 'active' : ''} onClick={() => update({ italic: !settings.italic })}><i>I</i></button>
        <button type="button" aria-pressed={settings.underline} className={settings.underline ? 'active' : ''} onClick={() => update({ underline: !settings.underline })}><u>U</u></button>
      </div>
      <p className="subtitle-position-help">Mở công cụ CC rồi kéo khung mẫu trên ảnh để đặt vị trí. Vị trí này giữ nguyên khi camera zoom hoặc pan.</p>
      <button className="quiet" type="button" onClick={() => update({ xPct: .5, yPct: .88 })}>Đặt lại vị trí</button>
    </section>
  </>
}
