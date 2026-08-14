import { useEffect, useRef } from 'react'
import type { SessionSummary } from '../state/sessionStore'

interface Props {
  activeSessionId: string | null
  activeSessionName: string
  sessions: SessionSummary[]
  refresh: () => void
  select: (id: string) => void
  create: () => void
  rename: (session: SessionSummary) => void
  remove: (id: string) => void
}

export function SessionSwitcher({ activeSessionId, activeSessionName, sessions, refresh, select, create, rename, remove }: Props) {
  const ref = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const close = (event: PointerEvent) => { if (ref.current?.open && !ref.current.contains(event.target as Node)) ref.current.removeAttribute('open') }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [])
  const finish = (action: () => void) => { ref.current?.removeAttribute('open'); action() }
  return <details className="session-switcher" ref={ref} onToggle={(event) => { if (event.currentTarget.open) refresh() }}>
    <summary aria-label="Chọn phiên làm việc"><span>{activeSessionName || 'Đang tải phiên…'}</span><i aria-hidden="true">⌄</i></summary>
    <div className="session-menu" role="menu">
      <div className="session-menu-heading"><span>Phiên làm việc</span><small>{sessions.length} phiên</small></div>
      <div className="session-menu-list">
        {sessions.map((session) => <div className={`session-menu-row ${session.id === activeSessionId ? 'active' : ''}`} key={session.id} role="menuitem">
          <button className="session-main" type="button" onClick={() => finish(() => select(session.id))}>
            <span>{session.name}</span>
            <small>{session.frameCount} Frame · {new Date(session.updatedAt).toLocaleString('vi-VN')}</small>
          </button>
          <button className="session-icon" type="button" aria-label={`Đổi tên ${session.name}`} title="Đổi tên" onClick={() => finish(() => rename(session))}>✎</button>
          <button className="session-icon danger" type="button" aria-label={`Xoá ${session.name}`} title="Xoá phiên" onClick={() => finish(() => remove(session.id))}>×</button>
        </div>)}
      </div>
      <button className="session-new" type="button" onClick={() => finish(create)}>＋ Phiên mới</button>
    </div>
  </details>
}
