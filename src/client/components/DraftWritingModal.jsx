import { useState, useEffect } from 'react'
import { api } from '../utils/api'

export default function DraftWritingModal({ articleId, article, onClose, onSaved, showToast }) {
  const [postText, setPostText]       = useState('')
  const [aiLoading, setAiLoading]     = useState(false)
  const [saving, setSaving]           = useState(false)
  const [showGuidance, setShowGuidance] = useState(false)
  const [guidance, setGuidance]       = useState('')

  const charCount = postText.length

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  async function handleAiAssist() {
    if (!showGuidance) {
      setShowGuidance(true)
      return
    }
    setAiLoading(true)
    try {
      const result = await api(`/api/articles/${articleId}/ai-assist`, 'POST', { guidance: guidance || null })
      setPostText(result.post_text)
      showToast('AI draft generated', 'success')
    } catch (err) {
      showToast(`AI assist failed: ${err.message}`, 'error')
    }
    setAiLoading(false)
  }

  async function handleSave() {
    if (!postText.trim() || charCount > 2800) return
    setSaving(true)
    try {
      const result = await api('/api/drafts', 'POST', { article_id: articleId, post_text: postText.trim() })
      showToast('Draft saved', 'success')
      onSaved(result.draftId)
    } catch (err) {
      showToast(`Save failed: ${err.message}`, 'error')
      setSaving(false)
    }
  }

  const score = article.eval_score
  const scoreColor = score >= 7 ? 'var(--green)' : score >= 4 ? 'var(--yellow)' : 'var(--red)'

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 'min(760px, calc(100vw - 32px))', maxHeight: '90vh', overflow: 'auto', padding: 28 }}>

        {/* Header */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>Write a post</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Share this article on LinkedIn</div>
        </div>

        {/* Body */}
        <div className="draft-modal-body">

          {/* Left: article context */}
          <div className="draft-modal-context">
            <a
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', textDecoration: 'none', lineHeight: 1.4, display: 'block', marginBottom: 10 }}
              onMouseOver={e => e.currentTarget.style.color = 'var(--accent)'}
              onMouseOut={e => e.currentTarget.style.color = 'var(--text)'}
            >
              {article.title}
            </a>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              {article.source && <span className="tag tag-src">{article.source}</span>}
              {score != null && (
                <span className="tag tag-score" style={{ color: scoreColor }}>Score {score}/10</span>
              )}
            </div>

            {article.primary_connection && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)', marginBottom: 4 }}>Relevance</div>
                <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5 }}>{article.primary_connection}</div>
              </div>
            )}

            {article.key_insight && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)', marginBottom: 4 }}>Key Insight</div>
                <div className="insight" style={{ margin: 0, fontSize: 12 }}>{article.key_insight}</div>
              </div>
            )}
          </div>

          {/* Right: editor */}
          <div className="draft-modal-editor">
            <textarea
              className="post-edit"
              value={postText}
              onChange={e => setPostText(e.target.value)}
              placeholder="Write your post here..."
              style={{ minHeight: 200, resize: 'vertical' }}
              autoFocus
            />
            <div className={`char-count${charCount > 2800 ? ' over' : ''}`} style={{ marginBottom: 12 }}>
              {charCount} / 2800
            </div>

            {showGuidance && (
              <input
                className="cfg-input"
                value={guidance}
                onChange={e => setGuidance(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !aiLoading && handleAiAssist()}
                placeholder="Optional: guidance for the AI (e.g. 'focus on the leadership angle')"
                disabled={aiLoading}
                style={{ marginBottom: 12 }}
              />
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
              <button
                className="btn btn-ai"
                onClick={handleAiAssist}
                disabled={aiLoading}
                title="Generate a first-pass using your writing style"
              >
                {aiLoading ? 'Generating...' : showGuidance ? '✦ Generate' : '✦ AI Assist'}
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
                <button
                  className="btn btn-primary"
                  onClick={handleSave}
                  disabled={!postText.trim() || charCount > 2800 || saving}
                >
                  {saving ? 'Saving...' : 'Save Draft'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
