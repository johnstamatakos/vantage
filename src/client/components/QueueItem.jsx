import { useState } from 'react'
import { fmtDate } from '../utils/api'

export default function QueueItem({ draft, index, onDragStart, onDragOver, onDragLeave, onDragEnd, onDrop, onRemove }) {
  const [previewOpen, setPreviewOpen] = useState(false)

  return (
    <div
      className="q-item"
      draggable
      onDragStart={e => onDragStart(e, index)}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDragEnd={onDragEnd}
      onDrop={e => onDrop(e, index)}
    >
      <div className="q-pos">{index + 1}</div>
      <div className="q-body">
        <div className="q-title">{draft.article_title || 'Untitled'}</div>
        <div className="q-meta">
          {draft.primary_connection ? `${draft.primary_connection} · ` : ''}Approved {fmtDate(draft.approved_at)}
        </div>
        {!previewOpen && (
          <div className="q-preview">{draft.post_text.slice(0, 120)}...</div>
        )}
        {previewOpen && (
          <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6, marginTop: 8, whiteSpace: 'pre-wrap' }}>
            {draft.post_text}
          </div>
        )}
      </div>
      <div className="btn-row">
        <button
          className="btn btn-ghost"
          style={{ fontSize: 12, padding: '6px 10px' }}
          onClick={() => setPreviewOpen(o => !o)}
        >
          {previewOpen ? 'Collapse' : 'Preview'}
        </button>
        <button
          className="btn btn-danger"
          style={{ fontSize: 12, padding: '6px 10px' }}
          onClick={onRemove}
        >
          Remove
        </button>
      </div>
    </div>
  )
}
