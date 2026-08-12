import { useEffect, useRef, useState } from 'react'
import type { StoryProgress, StorySceneFailure } from '../ai/types'

interface Props {
  open: boolean
  connected: boolean
  busy: boolean
  progress: StoryProgress | null
  failures: StorySceneFailure[]
  close: () => void
  upload: () => void
  connect: (appKey: string) => void
  disconnect: () => void
  generateImage: (prompt: string) => Promise<void>
  generateStory: (topic: string, sceneCount?: number) => Promise<void>
  retryFailure: (failure: StorySceneFailure) => Promise<void>
  initialMode: 'choose' | 'connection'
  redirectUri: string
  savedAppKey: string | null
}

export function AIGenerationDialog(props: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [mode, setMode] = useState<'choose' | 'image' | 'story' | 'connection'>('choose')
  const [appKey, setAppKey] = useState('')
  const [prompt, setPrompt] = useState('')
  const [topic, setTopic] = useState('')
  const [sceneCount, setSceneCount] = useState(5)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (props.open && !dialog.open) dialog.showModal()
    if (!props.open && dialog.open) dialog.close()
  }, [props.open])

  useEffect(() => {
    if (props.open) setMode(props.initialMode)
  }, [props.open, props.initialMode])

  useEffect(() => {
    if (props.open && props.initialMode === 'connection') setAppKey(props.savedAppKey ?? '')
  }, [props.open, props.initialMode, props.savedAppKey])

  return <dialog ref={dialogRef} className="ai-dialog" onCancel={(event) => { if (props.busy) event.preventDefault(); else props.close() }}>
    <div className="ai-dialog-head">
      <div><span>NGUỒN NỘI DUNG</span><h2>{mode === 'story' ? 'Tạo video từ chủ đề' : mode === 'image' ? 'Tạo ảnh bằng AI' : mode === 'connection' ? 'Kết nối Pollinations' : 'Thêm khung hình'}</h2></div>
      <button type="button" disabled={props.busy} onClick={props.close} aria-label="Đóng">×</button>
    </div>

    {mode === 'choose' && <div className="ai-choice-grid">
      <button onClick={() => { props.upload(); props.close() }}><b>↑ Tải ảnh lên</b><small>Ảnh PNG/JPG trên máy, không dùng mạng.</small></button>
      <button onClick={() => setMode(props.connected ? 'image' : 'connection')}><b>✦ Tạo ảnh bằng AI</b><small>Dùng Pollen của tài khoản đã kết nối.</small></button>
      <button onClick={() => setMode(props.connected ? 'story' : 'connection')}><b>▤ Tạo video từ chủ đề…</b><small>Tạo tuần tự kịch bản, ảnh và giọng đọc.</small></button>
    </div>}

    {mode === 'connection' && <div className="ai-form">
      <p>App Key là mã công khai <code>pk_…</code> nhận từ Pollinations. Trước khi kết nối, hãy thêm chính xác callback này vào mục <b>Redirect URIs</b> của App Key:</p>
      <div className="redirect-uri"><code>{props.redirectUri}</code><button type="button" className="quiet" onClick={() => void navigator.clipboard?.writeText(props.redirectUri)}>Sao chép URI</button></div>
      <p>URI phải khớp tuyệt đối. Khi chạy local, hãy đăng ký URI localhost này; khi dùng GitHub Pages, hãy đăng ký URI GitHub Pages hiển thị ở đó.</p>
      <label>App Key Pollinations<input value={appKey} onChange={(event) => setAppKey(event.target.value)} placeholder="pk_…" autoComplete="off" /></label>
      <button className="export" disabled={!appKey.trim().startsWith('pk_')} onClick={() => props.connect(appKey.trim())}>Kết nối pollinations.ai</button>
      {props.connected && <button className="quiet" onClick={props.disconnect}>Ngắt kết nối hiện tại</button>}
    </div>}

    {mode === 'image' && <form className="ai-form" onSubmit={(event) => { event.preventDefault(); void props.generateImage(prompt) }}>
      <label>Mô tả ảnh<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Ví dụ: Bốn con vật tách biệt trên nền trắng, phong cách minh hoạ…" rows={5} /></label>
      <p className="ai-cost">Mỗi lần tạo hoặc tạo lại sẽ tiêu Pollen thật của bạn.</p>
      <button className="export" disabled={props.busy || !prompt.trim()}>{props.busy ? 'Đang tạo ảnh…' : 'Tạo ảnh'}</button>
    </form>}

    {mode === 'story' && <form className="ai-form" onSubmit={(event) => { event.preventDefault(); void props.generateStory(topic, sceneCount) }}>
      <label>Chủ đề<textarea value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="Ví dụ: Hành trình của một giọt nước" rows={4} /></label>
      <label>Số cảnh gợi ý<input type="number" min="1" max="12" value={sceneCount} onChange={(event) => setSceneCount(Math.max(1, Math.min(12, Number(event.target.value))))} /></label>
      <p className="ai-cost">Ước tính: 1 lượt viết kịch bản + {sceneCount} ảnh + {sceneCount} đoạn giọng đọc. Tổng cộng khoảng {1 + sceneCount * 2} lượt gọi có tính Pollen.</p>
      <button className="export" disabled={props.busy || !topic.trim()}>{props.busy ? 'Đang sinh nội dung…' : 'Bắt đầu tạo tuần tự'}</button>
    </form>}

    {props.progress && <div className="ai-progress" role="status"><i /><span>{props.progress.message}</span></div>}
    {props.failures.length > 0 && <div className="ai-failures"><strong>Cảnh cần thử lại</strong>{props.failures.map((failure) => <div key={`${failure.scene.order}-${failure.stage}`}><span>Cảnh {failure.scene.order} · {failure.stage}: {failure.message}</span><button className="quiet" disabled={props.busy} onClick={() => void props.retryFailure(failure)}>Thử lại cảnh này</button></div>)}</div>}
    {mode !== 'choose' && !props.busy && <button className="ai-back" onClick={() => setMode('choose')}>← Quay lại</button>}
  </dialog>
}
