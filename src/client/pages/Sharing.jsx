import { useState, useEffect, useRef } from 'react'
import RejectModal from '../components/RejectModal'
import DraftCard from '../components/DraftCard'
import QueueItem from '../components/QueueItem'
import { api, parseCron } from '../utils/api'

export default function Sharing({ showToast, updateBadges }) {
  const [savedDrafts, setSavedDrafts] = useState([])
  const [queue, setQueue]             = useState([])
  const [config, setConfig]           = useState(null)
  const [linkedin, setLinkedin]       = useState(null)
  const [rejectingDraft, setRejectingDraft] = useState(null)
  const dragSrc = useRef(null)

  useEffect(() => {
    Promise.all([
      api('/api/drafts/pending'),
      api('/api/drafts/queue'),
      api('/api/config'),
      api('/api/linkedin/status'),
    ]).then(([saved, q, cfg, li]) => {
      setSavedDrafts(saved)
      setQueue(q)
      setConfig(cfg)
      setLinkedin(li)
    })
  }, [])

  // ── Saved draft actions ───────────────────────────────────────────────────

  async function queueDraft(id) {
    await api(`/api/drafts/${id}/approve`, 'POST')
    const moving = savedDrafts.find(d => d.id === id)
    setSavedDrafts(prev => prev.filter(d => d.id !== id))
    if (moving) setQueue(prev => [...prev, { ...moving, status: 'approved' }])
    showToast('Added to queue', 'success')
    updateBadges()
  }

  async function confirmDelete(note, addAsPov) {
    const { id, post_text } = rejectingDraft
    await api(`/api/drafts/${id}/reject`, 'POST', { note })
    setSavedDrafts(prev => prev.filter(d => d.id !== id))
    setRejectingDraft(null)
    if (addAsPov && note.trim()) {
      try {
        await api('/api/calibrate/pov', 'POST', { rejectionNote: note, postText: post_text })
        showToast('Deleted and added as Point of View', 'success')
      } catch {
        showToast('Deleted (Point of View save failed)', 'error')
      }
    } else {
      showToast('Deleted', 'success')
    }
    updateBadges()
  }

  // ── Post now ──────────────────────────────────────────────────────────────

  async function postNow() {
    if (!confirm('Post the next queued item to LinkedIn right now?')) return
    const r = await api('/api/run/post', 'POST')
    if (r.skipped)     showToast(`Skipped: ${r.reason}`, 'error')
    else if (r.posted) { showToast('Posted!', 'success'); setQueue(prev => prev.slice(1)) }
    else               showToast(`Failed: ${r.error}`, 'error')
  }

  // ── Queue actions ─────────────────────────────────────────────────────────

  function onDragStart(e, i) {
    dragSrc.current = i
    e.currentTarget.classList.add('dragging')
  }

  function onDragOver(e) {
    e.preventDefault()
    e.currentTarget.classList.add('drag-over')
  }

  function onDragLeave(e) {
    e.currentTarget.classList.remove('drag-over')
  }

  function onDragEnd(e) {
    e.currentTarget.classList.remove('dragging')
    dragSrc.current = null
  }

  async function onDrop(e, targetIdx) {
    e.preventDefault()
    e.currentTarget.classList.remove('drag-over')
    const srcIdx = dragSrc.current
    if (srcIdx === null || srcIdx === targetIdx) return
    const next = [...queue]
    const [moved] = next.splice(srcIdx, 1)
    next.splice(targetIdx, 0, moved)
    setQueue(next)
    await api('/api/drafts/queue/reorder', 'POST', { orderedIds: next.map(d => d.id) })
    showToast('Order saved', 'success')
  }

  async function removeFromQueue(id) {
    if (!confirm('Remove this post from the queue?')) return
    await api(`/api/drafts/${id}/reject`, 'POST', { note: 'Removed from queue' })
    setQueue(prev => prev.filter(d => d.id !== id))
    showToast('Removed', 'success')
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Sharing</div>
          <div className="page-sub">Drafts you've saved, and posts queued for publishing</div>
        </div>
      </div>

      {/* ── LinkedIn status ────────────────────────────────────────────── */}
      {linkedin && (
        linkedin.connected ? (
          <div className="li-bar">
            <span className="dot dot-green" />
            LinkedIn connected
            <span style={{ marginLeft: 6, color: 'var(--muted)', fontSize: 11 }}>· token valid for {linkedin.expiresIn}m</span>
          </div>
        ) : (
          <div className="li-bar" style={{ borderColor: 'var(--red)', color: 'var(--red)' }}>
            <span className="dot dot-red" />
            LinkedIn not connected
            <a href="/auth/linkedin" style={{ marginLeft: 10, fontSize: 12, color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>
              Connect now →
            </a>
          </div>
        )
      )}

      {/* ── Saved section ──────────────────────────────────────────────── */}
      <div className="sharing-section-header">Saved</div>

      {savedDrafts.length === 0 ? (
        <div className="empty" style={{ minHeight: 80, padding: '24px 0' }}>
          <div className="icon">✏️</div>
          No saved drafts. Click "Draft" on any article to start writing.
        </div>
      ) : (
        savedDrafts.map(d => (
          <DraftCard
            key={d.id}
            draft={d}
            onQueue={queueDraft}
            onDelete={draft => setRejectingDraft({ id: draft.id, post_text: draft.post_text })}
          />
        ))
      )}

      {/* ── Queue section ──────────────────────────────────────────────── */}
      <div className="sharing-section-header" style={{ marginTop: 32, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        Queue
        {queue.length > 0 && (
          <button className="btn btn-warn" style={{ fontSize: 12, padding: '4px 12px' }} onClick={postNow}>
            Post Now
          </button>
        )}
      </div>

      {queue.length === 0 ? (
        <div className="empty" style={{ minHeight: 80, padding: '24px 0' }}>
          <div className="icon">📭</div>
          Queue is empty. Add drafts to build your publishing backlog.
        </div>
      ) : (
        <>
          {queue.map((d, i) => (
            <QueueItem
              key={d.id}
              draft={d}
              index={i}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDragEnd={onDragEnd}
              onDrop={onDrop}
              onRemove={() => removeFromQueue(d.id)}
            />
          ))}
          {config?.schedule?.postCron && (
            <div style={{ marginTop: 12, fontSize: 12, color: 'var(--muted)', paddingLeft: 4 }}>
              Posts on schedule: <span style={{ color: 'var(--text)' }}>{parseCron(config.schedule.postCron)}</span>
            </div>
          )}
        </>
      )}

      {rejectingDraft !== null && (
        <RejectModal
          onConfirm={confirmDelete}
          onClose={() => setRejectingDraft(null)}
        />
      )}
    </>
  )
}
