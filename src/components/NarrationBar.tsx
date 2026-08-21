import { useEffect, useState } from 'react'
import type { Frame } from '../state/projectStore'
import type { TtsLanguage, TtsProgress } from '../tts/types'
import { DEFAULT_VOICE_BY_LANGUAGE, TTS_VOICES, voiceById } from '../tts/voices'

interface Props {
  frame: Frame
  busy: boolean
  progress: TtsProgress | null
  create: (text: string, voiceId: string, speed: number) => void
  onClose?: () => void
}

export function NarrationBar({ frame, busy, progress, create, onClose }: Props) {
  const [text, setText] = useState(frame.narration?.text ?? '')
  const savedVoiceId = frame.narration?.voiceId ?? DEFAULT_VOICE_BY_LANGUAGE.vi
  const savedVoice = (() => { try { return voiceById(savedVoiceId) } catch { return voiceById(DEFAULT_VOICE_BY_LANGUAGE.vi) } })()
  const [language, setLanguage] = useState<TtsLanguage>(savedVoice.language)
  const [voiceId, setVoiceId] = useState(savedVoice.id)
  const [speed, setSpeed] = useState(frame.narration?.speed ?? 1)
  useEffect(() => {
    setText(frame.narration?.text ?? '')
    let voice
    try { voice = voiceById(frame.narration?.voiceId ?? DEFAULT_VOICE_BY_LANGUAGE.vi) }
    catch { voice = voiceById(DEFAULT_VOICE_BY_LANGUAGE.vi) }
    setLanguage(voice.language)
    setVoiceId(voice.id)
    setSpeed(frame.narration?.speed ?? 1)
  }, [frame.id, frame.narration?.generatedAt])
  const voices = TTS_VOICES.filter((voice) => voice.language === language)
  const selectedVoice = voices.find((voice) => voice.id === voiceId)
  const status = progress?.phase === 'download' ? `Đang tải giọng đọc... ${progress.percent ?? 0}%` : progress?.phase === 'inference' ? 'Đang tạo giọng nói...' : null
  return <div className="narration-bar"><button className="narration-close quiet" type="button" aria-label="Đóng bảng audio" onClick={onClose}>×</button>
    <textarea aria-label="Lời thoại khung hình" placeholder="Nhập lời thoại cho khung hình này..." value={text} onChange={(event) => setText(event.target.value)} />
    <div className="narration-actions">
      <select aria-label="Ngôn ngữ giọng đọc" value={language} onChange={(event) => {
        const nextLanguage = event.target.value as TtsLanguage
        setLanguage(nextLanguage)
        setVoiceId(DEFAULT_VOICE_BY_LANGUAGE[nextLanguage])
      }}><option value="vi">Tiếng Việt</option><option value="en">English</option><option value="ko">한국어</option></select>
      <select aria-label="Giọng đọc" value={voiceId} onChange={(event) => setVoiceId(event.target.value)}>{voices.map((voice) => <option key={voice.id} value={voice.id}>{voice.displayName}</option>)}</select>
      <label className="speech-speed">Tốc độ <input aria-label="Tốc độ giọng đọc" type="number" min="0.25" max="4" step="0.1" inputMode="decimal" value={speed} onChange={(event) => setSpeed(Math.max(.25, Math.min(4, Number(event.target.value) || 1)))} /><span>×</span></label>
      <button className="export" disabled={busy || !text.trim()} onClick={() => create(text, voiceId, speed)}>{busy ? status : frame.narration?.audioBuffer ? 'Tạo lại audio' : 'Tạo audio ▶'}</button>
      {selectedVoice?.usageNotice && <small className="voice-usage-notice">{selectedVoice.usageNotice}</small>}
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
