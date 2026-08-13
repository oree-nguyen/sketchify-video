import { useEffect, useState } from 'react'
import type { Frame } from '../state/projectStore'
import { DEFAULT_PIPER_VOICE_ID, PIPER_VOICES } from '../audio/piperVoices'
import type { PiperProgress } from '../audio/piperClient'

interface Props {
  frame: Frame
  busy: boolean
  progress: PiperProgress | null
  create: (text: string, voiceId: string) => void
}

export function NarrationBar({ frame, busy, progress, create }: Props) {
  const [text, setText] = useState(frame.narration?.text ?? '')
  const [voiceId, setVoiceId] = useState(frame.narration?.voiceId ?? DEFAULT_PIPER_VOICE_ID)
  useEffect(() => { setText(frame.narration?.text ?? ''); setVoiceId(frame.narration?.voiceId ?? DEFAULT_PIPER_VOICE_ID) }, [frame.id, frame.narration?.generatedAt])
  const status = progress?.phase === 'download' ? `Đang tải giọng đọc... ${progress.percent ?? 0}%` : progress?.phase === 'inference' ? 'Đang tạo giọng nói...' : null
  return <div className="narration-bar">
    <textarea aria-label="Lời thoại khung hình" placeholder="Nhập lời thoại cho khung hình này..." value={text} onChange={(event) => setText(event.target.value)} />
    <div className="narration-actions">
      <select aria-label="Giọng đọc" value={voiceId} onChange={(event) => setVoiceId(event.target.value)}>{PIPER_VOICES.map((voice) => <option key={voice.id} value={voice.id}>{voice.displayName}</option>)}</select>
      <button className="export" disabled={busy || !text.trim()} onClick={() => create(text, voiceId)}>{busy ? status : frame.narration?.audioBuffer ? 'Tạo lại audio' : 'Tạo audio ▶'}</button>
    </div>
    {frame.narration?.audioBuffer && <AudioPreview buffer={frame.narration.audioBuffer} />}
  </div>
}

function AudioPreview({ buffer }: { buffer: AudioBuffer }) {
  const [playing, setPlaying] = useState(false)
  const play = () => {
    const context = new AudioContext(), source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination)
    source.onended = () => { setPlaying(false); void context.close() }; setPlaying(true); source.start()
  }
  return <div className="narration-preview"><div className="waveform" aria-hidden="true">{Array.from({ length: 30 }, (_, index) => <i key={index} style={{ height: `${20 + Math.abs(Math.sin(index * 1.7)) * 70}%` }} />)}</div><button className="quiet" disabled={playing} onClick={play}>{playing ? 'Đang phát...' : 'Nghe thử'}</button><span>{buffer.duration.toFixed(1)}s</span></div>
}
