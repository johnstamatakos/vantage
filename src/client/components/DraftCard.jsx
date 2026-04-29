import { useState, useEffect } from 'react'
import { api } from '../utils/api'

export default function DraftCard({ draft, onQueue, onDelete }) {
  const [editing, setEditing]         = useState(false)
  const [text, setText]               = useState(draft.post_text)
  const [showGuidance, setShowGuidance] = useState(false)
  const [guidance, setGuidance]       = useState('')
  const [aiLoading, setAiLoading]     = useState(false)
  const chars = text.length

  useEffect(() => { setText(draft.post_text) }, [draft.post_text])

  async function saveEdit() {
    await api(`/api/drafts/${draft.id}`, 'PUT', { post_text: text.trim() })
    setEditing(false)
    setShowGuidance(false)
    setGuidance('')
  }

  function cancelEdit() {
    setText(draft.post_text)
    setEditing(false)
    setShowGuidance(false)
    setGuidance('')
  }

  async function handleAiAssist() {
    if (!showGuidance) {
      setShowGuidance(true)
      return
    }
    setAiLoading(true)
    try {
      const result = await api(`/api/articles/${draft.article_id}/ai-assist`, 'POST', { guidance: guidance || null })
      setText(result.post_text)
    } catch (err) {
      // surface error inline — parent doesn't have toast context here
      alert(`AI assist failed: ${err.message}`)
    }
    setAiLoading(false)
  }

  return (
    <div className="draft">
      <div className="draft-meta">
        <span className="tag tag-src">{draft.article_source || 'Unknown'}</span>
        {draft.eval_score && <span className="tag tag-score">Score {draft.eval_score}/10</span>}
        {draft.primary_connection && <span className="tag tag-conn">{draft.primary_connection}</span>}
      </div>

      {draft.article_title && (
        <div className="article-ref">
          From:{' '}
          {draft.article_url
            ? <a href={draft.article_url} target="_blank" rel="noreferrer">{draft.article_title}</a>
            : draft.article_title}
        </div>
      )}

      {draft.key_insight && (
        <div className="insight">Key insight: {draft.key_insight}</div>
      )}

      {!editing && <div className="post-view">{text}</div>}

      {editing && (
        <>
          <textarea
            className="post-edit"
            value={text}
            onChange={e => setText(e.target.value)}
          />
          <div className={`char-count${chars > 2800 ? ' over' : ''}`}>{chars} / 2800</div>

          {showGuidance && (
            <input
              className="cfg-input"
              value={guidance}
              onChange={e => setGuidance(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !aiLoading && handleAiAssist()}
              placeholder="Optional: guidance for the AI (e.g. 'focus on the business impact')"
              disabled={aiLoading}
              style={{ marginBottom: 8 }}
            />
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <button
              className="btn btn-ai"
              onClick={handleAiAssist}
              disabled={aiLoading || !draft.article_id}
              title="Generate a new draft using your writing style"
            >
              {aiLoading ? 'Generating...' : showGuidance ? '✦ Generate' : '✦ AI Assist'}
            </button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" onClick={saveEdit} disabled={aiLoading}>Save</button>
              <button className="btn btn-ghost" onClick={cancelEdit} disabled={aiLoading}>Cancel</button>
            </div>
          </div>
        </>
      )}

      {!editing && (
        <div className="btn-row">
          <button className="btn btn-success" onClick={() => onQueue(draft.id)}>Add to Queue</button>
          <button className="btn btn-danger" onClick={() => onDelete(draft)}>Delete</button>
          <button className="btn btn-ghost" onClick={() => setEditing(true)}>Edit</button>
        </div>
      )}
    </div>
  )
}
