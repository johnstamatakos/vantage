import { useState, useEffect, useRef, useMemo } from 'react'
import { api } from '../utils/api'

// ─── Constants ────────────────────────────────────────────────────────────────

const DRAFT_STATUS_LABEL = {
  pending_review: { label: 'awaiting review', color: 'var(--accent)' },
  approved:       { label: 'approved',         color: 'var(--green)' },
  posted:         { label: 'posted',            color: 'var(--green)' },
  rejected:       { label: 'rejected',          color: 'var(--red)' },
}

const ARTICLE_STATUS_COLOR = {
  pending:   'var(--muted)',
  evaluated: 'var(--yellow)',
  drafted:   'var(--accent)',
  skipped:   'var(--muted)',
}

const BREAKDOWN_ROWS = [
  { key: 'relevance',     label: 'Relevance',      weight: '50%' },
  { key: 'timeliness',    label: 'Timeliness',     weight: '20%' },
  { key: 'specificity',   label: 'Specificity',    weight: '15%' },
  { key: 'postPotential', label: 'Post potential', weight: '15%' },
]

const COLUMNS = [
  { key: 'title',       label: 'Title',       sort: (a, b) => a.title.localeCompare(b.title) },
  { key: 'source',      label: 'Source',      sort: (a, b) => (a.source || '').localeCompare(b.source || '') },
  { key: 'fetched_at',  label: 'Added',       sort: (a, b) => a.fetched_at.localeCompare(b.fetched_at) },
  { key: 'eval_score',  label: 'Score',       sort: (a, b) => (a.eval_score ?? -1) - (b.eval_score ?? -1) },
  { key: 'key_insight', label: 'Key Insight', sort: (a, b) => (a.key_insight || '').localeCompare(b.key_insight || '') },
]

const STATUS_OPTIONS = [
  { value: '',               label: 'All statuses' },
  { value: 'pending',        label: 'Pending' },
  { value: 'evaluated',      label: 'Evaluated' },
  { value: 'pending_review', label: 'Awaiting review' },
  { value: 'approved',       label: 'Approved' },
  { value: 'posted',         label: 'Posted' },
  { value: 'rejected',       label: 'Rejected' },
  { value: 'skipped',        label: 'Skipped' },
]

const FILTER_DEFAULTS = { source: '', scoreMin: 0, scoreMax: 10, since: '', status: '' }

// ─── Sub-components ───────────────────────────────────────────────────────────

function ScoreBreakdown({ breakdown }) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '10px 12px', width: 220,
      boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
    }}>
      {BREAKDOWN_ROWS.map(({ key, label, weight }) => (
        breakdown[key] != null && (
          <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 5, fontSize: 12 }}>
            <span style={{ color: 'var(--muted)' }}>{label} <span style={{ fontSize: 10, opacity: 0.6 }}>({weight})</span></span>
            <span style={{ fontWeight: 600, color: breakdown[key] >= 7 ? 'var(--green)' : breakdown[key] >= 4 ? 'var(--yellow)' : 'var(--red)' }}>
              {breakdown[key]}/10
            </span>
          </div>
        )
      ))}
      {breakdown.skipReason && (
        <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--red)', whiteSpace: 'normal', wordBreak: 'break-word' }}>
          {breakdown.skipReason}
        </div>
      )}
      {breakdown.similarityNote && (
        <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--yellow)', whiteSpace: 'normal', wordBreak: 'break-word' }}>
          {breakdown.similarityNote}
        </div>
      )}
    </div>
  )
}

function ScoreCell({ score, breakdown }) {
  const [tooltipPos, setTooltipPos] = useState(null)
  const ref = useRef(null)
  // Hover-capable devices (mouse/trackpad) use hover; touch devices use click
  const canHover = window.matchMedia?.('(hover: hover)').matches ?? true

  useEffect(() => {
    if (!tooltipPos || canHover) return
    function handleOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setTooltipPos(null)
    }
    document.addEventListener('touchstart', handleOutside)
    return () => document.removeEventListener('touchstart', handleOutside)
  }, [tooltipPos, canHover])

  if (score == null) return <span style={{ color: 'var(--muted)' }}>—</span>

  const color = score >= 7 ? 'var(--green)' : score >= 4 ? 'var(--yellow)' : 'var(--red)'

  function openAt(rect) {
    const spaceBelow = window.innerHeight - rect.bottom
    const top = spaceBelow < 190 ? rect.top - 200 : rect.bottom + 6
    setTooltipPos({ top, left: rect.left + rect.width / 2 })
  }

  return (
    <div ref={ref}
      style={{ display: 'inline-block', cursor: breakdown ? 'pointer' : 'default' }}
      onMouseEnter={() => { if (canHover && ref.current) openAt(ref.current.getBoundingClientRect()) }}
      onMouseLeave={() => { if (canHover) setTooltipPos(null) }}
      onClick={e => {
        if (canHover || !breakdown) return
        e.stopPropagation()
        tooltipPos ? setTooltipPos(null) : ref.current && openAt(ref.current.getBoundingClientRect())
      }}
    >
      <span style={{ color, fontWeight: 600 }}>{score}/10</span>
      {tooltipPos && breakdown && (
        <div style={{ position: 'fixed', top: tooltipPos.top, left: tooltipPos.left, transform: 'translateX(-50%)', zIndex: 1000, pointerEvents: 'none' }}>
          <ScoreBreakdown breakdown={breakdown} />
        </div>
      )}
    </div>
  )
}

// Inline (non-floating) breakdown for mobile cards — no positioning needed
function ScoreInline({ score, breakdown }) {
  const [open, setOpen] = useState(false)
  if (score == null) return <span style={{ color: 'var(--muted)', fontSize: 12 }}>No score</span>
  const color = score >= 7 ? 'var(--green)' : score >= 4 ? 'var(--yellow)' : 'var(--red)'
  return (
    <div>
      <button onClick={() => setOpen(o => !o)} style={{
        background: 'none', border: 'none', cursor: breakdown ? 'pointer' : 'default',
        padding: 0, color, fontWeight: 600, fontSize: 13,
        display: 'flex', alignItems: 'center', gap: 4,
      }}>
        {score}/10
        {breakdown && (
          <span style={{ fontSize: 10, color: 'var(--muted)', transition: 'transform .15s', display: 'inline-block', transform: open ? 'rotate(90deg)' : 'none' }}>▸</span>
        )}
      </button>
      {open && breakdown && (
        <div style={{ marginTop: 8 }}>
          <ScoreBreakdown breakdown={breakdown} />
        </div>
      )}
    </div>
  )
}

function daysUntil(isoDate) {
  return Math.ceil((new Date(isoDate) - Date.now()) / (1000 * 60 * 60 * 24))
}

function ExpirationPill({ article }) {
  if (article.starred) return null
  if (article.queued_for_deletion) {
    return (
      <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 99, background: 'rgba(248,113,113,0.15)', color: 'var(--red)', border: '1px solid rgba(248,113,113,0.3)' }}>
        queued for deletion
      </span>
    )
  }
  if (article.expires_at) {
    const days = daysUntil(article.expires_at)
    if (days <= 0) return null
    return (
      <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 99, background: 'rgba(248,113,113,0.15)', color: 'var(--red)', border: '1px solid rgba(248,113,113,0.3)' }}>
        expires in {days}d
      </span>
    )
  }
  return null
}

function ScoreRangeSlider({ min, max, onChange }) {
  const minPct = (min / 10) * 100
  const maxPct = (max / 10) * 100
  return (
    <div style={{ position: 'relative', width: 96, height: 16, flexShrink: 0 }}>
      <div style={{
        position: 'absolute', top: '50%', left: 0, right: 0,
        height: 3, background: 'var(--border)', borderRadius: 99,
        transform: 'translateY(-50%)', pointerEvents: 'none',
      }}>
        <div style={{
          position: 'absolute', left: `${minPct}%`, right: `${100 - maxPct}%`,
          height: '100%', background: 'var(--accent)', borderRadius: 99,
        }} />
      </div>
      <input type="range" className="range-thumb" min={0} max={10} step={1} value={min}
        onChange={e => onChange(Math.min(Number(e.target.value), max), max)}
        style={{ zIndex: min >= max ? 5 : 3 }}
      />
      <input type="range" className="range-thumb" min={0} max={10} step={1} value={max}
        onChange={e => onChange(min, Math.max(Number(e.target.value), min))}
        style={{ zIndex: 4 }}
      />
    </div>
  )
}

function StarButton({ starred, onClick }) {
  return (
    <button onClick={onClick}
      title={starred ? 'Unstar (will expire normally)' : 'Star to keep forever'}
      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, padding: '2px 4px', lineHeight: 1, color: starred ? '#f59e0b' : 'var(--muted)', opacity: starred ? 1 : 0.4, transition: 'opacity 0.15s, color 0.15s', flexShrink: 0 }}
      onMouseOver={e => e.currentTarget.style.opacity = 1}
      onMouseOut={e => e.currentTarget.style.opacity = starred ? 1 : 0.4}
    >
      {starred ? '★' : '☆'}
    </button>
  )
}

function DraftButton({ articleId, drafting, onDraft }) {
  return (
    <button onClick={() => onDraft(articleId)} disabled={drafting === articleId}
      style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 99, cursor: 'pointer', border: '1px solid var(--accent)', background: 'transparent', color: 'var(--accent)', opacity: drafting === articleId ? 0.5 : 1, flexShrink: 0 }}>
      {drafting === articleId ? 'Drafting…' : 'Draft'}
    </button>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ArticleFeed({ updateBadges, refreshKey = 0 }) {
  const [articles, setArticles] = useState(null)
  const [sortKey, setSortKey]   = useState('fetched_at')
  const [sortDir, setSortDir]   = useState('desc')
  const [filters, setFilters]   = useState(FILTER_DEFAULTS)
  const [drafting, setDrafting] = useState(null)

  const sources = useMemo(
    () => articles ? [...new Set(articles.map(a => a.source).filter(Boolean))].sort() : [],
    [articles]
  )

  useEffect(() => { api('/api/articles').then(setArticles) }, [refreshKey])

  async function toggleStar(id) {
    const { starred } = await api(`/api/articles/${id}/star`, 'POST')
    setArticles(prev => prev.map(a => a.id === id ? { ...a, starred } : a))
  }

  async function draftArticle(id) {
    setDrafting(id)
    try {
      const result = await api(`/api/articles/${id}/draft`, 'POST')
      const draftExpiry = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
      setArticles(prev => prev.map(a => a.id === id
        ? { ...a, status: 'drafted', draft_status: 'pending_review', eval_score: result.score, expires_at: draftExpiry, queued_for_deletion: false }
        : a
      ))
      updateBadges()
    } catch (err) {
      alert(err.message)
    }
    setDrafting(null)
  }

  function handleSort(key) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir(key === 'fetched_at' || key === 'eval_score' ? 'desc' : 'asc')
    }
  }

  function setFilter(key, value) {
    setFilters(f => ({ ...f, [key]: value }))
  }

  if (!articles) return (
    <div className="empty"><div className="icon">⏳</div>Loading...</div>
  )

  if (articles.length === 0) return (
    <div className="empty"><div className="icon">📰</div>No articles yet — run a crawl to get started.</div>
  )

  const scoreFiltered = filters.scoreMin > 0 || filters.scoreMax < 10
  const isFiltered = filters.source !== '' || scoreFiltered || filters.since !== '' || filters.status !== ''

  const filtered = articles.filter(a => {
    if (filters.source && a.source !== filters.source) return false
    if (scoreFiltered) {
      if (a.eval_score == null || a.eval_score < filters.scoreMin || a.eval_score > filters.scoreMax) return false
    }
    if (filters.since && a.fetched_at < filters.since) return false
    if (filters.status) {
      if (a.status !== filters.status && a.draft_status !== filters.status) return false
    }
    return true
  })

  const col = COLUMNS.find(c => c.key === sortKey)
  const sorted = [...filtered].sort((a, b) => {
    const cmp = col.sort(a, b)
    return sortDir === 'asc' ? cmp : -cmp
  })

  const count = isFiltered ? `${sorted.length} of ${articles.length}` : `${articles.length}`

  return (
    <>
      {/* ── Filter bar ── */}
      <div className="filter-bar">
        {/* Icon — desktop only */}
        <div className="filter-seg filter-seg-icon">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--muted)' }}>
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
          </svg>
        </div>

        {/* Source */}
        <div className="filter-seg filter-seg-src">
          <select value={filters.source} onChange={e => setFilter('source', e.target.value)}>
            <option value="">All sources</option>
            {sources.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {/* Status */}
        <div className="filter-seg filter-seg-status">
          <select value={filters.status} onChange={e => setFilter('status', e.target.value)}>
            {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        {/* Score range */}
        <div className="filter-seg filter-seg-score">
          <span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
            Score
            <span style={{ color: scoreFiltered ? 'var(--text)' : 'var(--muted)', marginLeft: 4 }}>
              {filters.scoreMin}–{filters.scoreMax}
            </span>
          </span>
          <ScoreRangeSlider
            min={filters.scoreMin}
            max={filters.scoreMax}
            onChange={(newMin, newMax) => setFilters(f => ({ ...f, scoreMin: newMin, scoreMax: newMax }))}
          />
        </div>

        {/* Since */}
        <div className="filter-seg filter-seg-since">
          <span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>Since</span>
          <input type="date" value={filters.since} onChange={e => setFilter('since', e.target.value)}
            style={{ background: 'none', border: 'none', color: filters.since ? 'var(--text)' : 'var(--muted)', fontSize: 12, outline: 'none', colorScheme: 'dark', padding: 0 }}
          />
        </div>

        {/* Count + clear */}
        <div className="filter-seg filter-seg-meta">
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>{count} articles</span>
          {isFiltered && (
            <button onClick={() => setFilters(FILTER_DEFAULTS)}
              style={{ background: 'none', border: 'none', padding: '2px 0 2px 8px', color: 'var(--muted)', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              Clear
            </button>
          )}
        </div>
      </div>

      {/* ── Desktop table ── */}
      <div className="card feed-table" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 620 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ width: 28, padding: '10px 0 10px 12px' }} />
                {COLUMNS.map((col, i) => {
                  const active = sortKey === col.key
                  return (
                    <th key={col.key} onClick={() => handleSort(col.key)} style={{
                      textAlign: 'left', padding: '10px 14px', fontWeight: 500, fontSize: 12,
                      color: active ? 'var(--text)' : 'var(--muted)', whiteSpace: 'nowrap',
                      paddingLeft: i === 0 ? 6 : 14, cursor: 'pointer', userSelect: 'none',
                    }}>
                      {col.label}
                      <span style={{ marginLeft: 4, opacity: active ? 1 : 0, fontSize: 10 }}>
                        {sortDir === 'asc' ? '▲' : '▼'}
                      </span>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {sorted.map(a => {
                const draftMeta   = a.draft_status ? DRAFT_STATUS_LABEL[a.draft_status] : null
                const statusLabel = draftMeta ? draftMeta.label : a.status
                const statusColor = draftMeta ? draftMeta.color : ARTICLE_STATUS_COLOR[a.status] || 'var(--muted)'
                return (
                  <tr key={a.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 0 10px 12px', verticalAlign: 'middle' }}>
                      <StarButton starred={a.starred} onClick={() => toggleStar(a.id)} />
                    </td>
                    <td style={{ padding: '10px 6px', maxWidth: 280, wordBreak: 'break-word', overflowWrap: 'break-word' }}>
                      <a href={a.url} target="_blank" rel="noopener noreferrer"
                        style={{ color: 'var(--text)', textDecoration: 'none', lineHeight: 1.4, display: 'block' }}
                        onMouseOver={e => e.currentTarget.style.color = 'var(--accent)'}
                        onMouseOut={e => e.currentTarget.style.color = 'var(--text)'}
                      >
                        {a.title}
                      </a>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                        <span style={{ fontSize: 11, color: statusColor }}>{statusLabel}</span>
                        <ExpirationPill article={a} />
                        {a.status !== 'drafted' && (
                          <button onClick={() => draftArticle(a.id)} disabled={drafting === a.id}
                            style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 99, cursor: 'pointer', border: '1px solid var(--accent)', background: 'transparent', color: 'var(--accent)', opacity: drafting === a.id ? 0.5 : 1 }}>
                            {drafting === a.id ? 'Drafting…' : 'Draft'}
                          </button>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: '10px 14px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{a.source}</td>
                    <td style={{ padding: '10px 14px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                      {new Date(a.fetched_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      <span style={{ fontSize: 11, display: 'block' }}>
                        {new Date(a.fetched_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                      <ScoreCell score={a.eval_score} breakdown={a.eval_breakdown} />
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ color: 'var(--muted)', maxWidth: 320, wordBreak: 'break-word', overflowWrap: 'break-word' }}>
                        {a.key_insight || <span style={{ opacity: 0.4 }}>—</span>}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Mobile cards ── */}
      <div className="feed-cards">
        {sorted.map(a => {
          const draftMeta   = a.draft_status ? DRAFT_STATUS_LABEL[a.draft_status] : null
          const statusLabel = draftMeta ? draftMeta.label : a.status
          const statusColor = draftMeta ? draftMeta.color : ARTICLE_STATUS_COLOR[a.status] || 'var(--muted)'
          return (
            <div key={a.id} className="article-card">
              {/* Title row */}
              <div className="article-card-head">
                <StarButton starred={a.starred} onClick={() => toggleStar(a.id)} />
                <a href={a.url} target="_blank" rel="noopener noreferrer" className="article-card-title">
                  {a.title}
                </a>
              </div>

              {/* Key insight */}
              {a.key_insight && (
                <div className="article-card-insight">{a.key_insight}</div>
              )}

              {/* Meta row */}
              <div className="article-card-meta">
                {a.source && <span>{a.source}</span>}
                {a.source && <span>·</span>}
                <span>{new Date(a.fetched_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                <span>·</span>
                <span style={{ color: statusColor }}>{statusLabel}</span>
              </div>

              {/* Score (inline, expandable) */}
              <div style={{ marginBottom: 10 }}>
                <ScoreInline score={a.eval_score} breakdown={a.eval_breakdown} />
              </div>

              {/* Footer */}
              <div className="article-card-footer">
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <ExpirationPill article={a} />
                </div>
                {a.status !== 'drafted' && (
                  <DraftButton articleId={a.id} drafting={drafting} onDraft={draftArticle} />
                )}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
