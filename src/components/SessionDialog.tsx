import { useEffect, useRef } from 'react'
import type { SessionSummary } from '../state/sessionStore'

interface Props { open: boolean; sessions: SessionSummary[]; close: () => void; save: () => void; load: (id: string) => void; rename: (session: SessionSummary) => void; remove: (id: string) => void }
export function SessionDialog({ open, sessions, close, save, load, rename, remove }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { const dialog = ref.current; if (!dialog) return; if (open && !dialog.open) dialog.showModal(); if (!open && dialog.open) dialog.close() }, [open])
  return <dialog ref={ref} className="session-dialog" onCancel={close}>
    <header><div><small>PHIÊN LÀM VIỆC</small><h2>Phiên đã lưu</h2></div><button className="quiet" onClick={close}>×</button></header>
    <button className="export session-save" onClick={save}>Lưu phiên hiện tại...</button>
    <div className="session-list">{sessions.length ? sessions.map((session) => <article key={session.id}>
      <div><b>{session.name}</b><small>{new Date(session.updatedAt).toLocaleString('vi-VN')}</small></div>
      <nav><button onClick={() => load(session.id)}>Mở</button><button onClick={() => rename(session)}>Đổi tên</button><button className="danger" onClick={() => remove(session.id)}>Xoá</button></nav>
    </article>) : <p>Chưa có snapshot nào. Bản đang làm vẫn được tự động lưu.</p>}</div>
  </dialog>
}
