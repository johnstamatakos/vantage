import { useState } from 'react'
import { api } from '../utils/api'

export default function AnalyzeModal({ onClose, onSuccess }) {
  const [url, setUrl] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit() {
    if (!url.trim()) return
    setSubmitting(true)
    try {
      const r = await api('/api/run/analyze', 'POST', { url: url.trim() })
      onSuccess(r)
      onClose()
    } catch (err) {
      alert(`Failed: ${err.message}`)
      setSubmitting(false)
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="card" style={{ width: 'min(480px, calc(100vw - 32px))', padding: 24 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Analyze Article</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
          Paste any article URL to score and add it to your feed, bypassing the crawl.
        </div>
        <input
          className="cfg-input"
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !submitting && submit()}
          placeholder="https://..."
          autoFocus
          disabled={submitting}
          style={{ width: '100%', boxSizing: 'border-box', marginBottom: 14 }}
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={submitting}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={submitting || !url.trim()}>
            {submitting ? 'Analyzing...' : 'Analyze'}
          </button>
        </div>
      </div>
    </div>
  )
}
