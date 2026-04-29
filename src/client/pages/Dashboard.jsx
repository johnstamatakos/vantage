import { useState, useEffect } from 'react'
import { api, parseCron } from '../utils/api'
import ArticleFeed from '../components/ArticleFeed'
import DraftWritingModal from '../components/DraftWritingModal'
import AnalyzeModal from '../components/AnalyzeModal'

export default function Dashboard({ showToast, updateBadges, onNavigate }) {
  const [data, setData] = useState(null)
  const [crawling, setCrawling] = useState(false)
  const [analyzeModalOpen, setAnalyzeModalOpen] = useState(false)
  const [draftingArticle, setDraftingArticle] = useState(null)
  const [feedRefreshKey, setFeedRefreshKey] = useState(0)

  useEffect(() => {
    api('/api/dashboard').then(d => {
      setData(d)
      updateBadges()
    })
  }, [])

  async function runCrawl() {
    setCrawling(true)
    showToast('Crawling sources...', 'success', true)
    try {
      const res = await fetch('/api/run/crawl', { method: 'POST' })
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      outer: while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))
            if (data.done) {
              const n = data.crawlResult?.inserted || 0
              const e = data.evalResult?.evaluated  || 0
              showToast(`Done! ${n} new article${n !== 1 ? 's' : ''} · ${e} scored`)
              updateBadges()
              setFeedRefreshKey(k => k + 1)
              break outer
            }
            if (data.error) { showToast(data.error, 'error'); break outer }
            if (data.msg)   showToast(data.msg, 'success', true)
          } catch {}
        }
      }
    } catch (err) {
      showToast(`Crawl failed: ${err.message}`, 'error')
    }
    setCrawling(false)
  }


  function onAnalyzeSuccess({ title, score }) {
    showToast(`Analyzed "${title}" (score: ${score}/10) — view in feed`)
    setFeedRefreshKey(k => k + 1)
  }

  if (!data) {
    return (
      <div className="empty">
        <div className="icon">⏳</div>
        Loading...
      </div>
    )
  }

  const { stats, config, sourceHealth } = data

  const brokenSources = sourceHealth ? [
    sourceHealth.hackernews && !sourceHealth.hackernews.ok ? `HN (${sourceHealth.hackernews.error})` : null,
    sourceHealth.reddit     && !sourceHealth.reddit.ok     ? `Reddit (${sourceHealth.reddit.error})` : null,
    ...(sourceHealth.rss || []).filter(f => !f.ok).map(f => `${f.name} (${f.error})`),
  ].filter(Boolean) : []

  return (
    <>
      {/* Action row */}
      <div className="btn-row dash-action-row" style={{ marginBottom: 16, justifyContent: 'flex-end' }}>
        <button className="btn btn-ghost" onClick={runCrawl} disabled={crawling}
          title="Fetch new articles from all enabled sources and score them against your skills">
          {crawling ? 'Crawling...' : 'Run Crawl'}
        </button>
        <button className="btn btn-primary" onClick={() => setAnalyzeModalOpen(true)}
          title="Paste any article URL to fetch, score, and add it directly to your feed">
          Analyze
        </button>
      </div>

      {/* Consolidated info card */}
      <div className="card dash-info-grid" style={{ marginBottom: brokenSources.length > 0 ? 8 : 16 }}>
        {/* Schedule */}
        <div className="dash-info-col">
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)', marginBottom: 8 }}>Schedule</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.9 }}>
            <div>Crawl <span style={{ color: 'var(--text)' }}>{parseCron(config.schedule?.crawlCron)}</span></div>
            <div>Posts <span style={{ color: 'var(--text)' }}>{parseCron(config.schedule?.postCron)}</span></div>
          </div>
        </div>

        {/* Activity */}
        <div className="dash-info-col">
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)', marginBottom: 8 }}>Activity</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.9 }}>
            <div>Last post <span style={{ color: 'var(--text)' }}>{stats.lastPost ? new Date(stats.lastPost).toLocaleDateString() : 'None yet'}</span></div>
            <div>Backlog <span style={{ color: 'var(--text)' }}>{stats.draftsApproved} post{stats.draftsApproved === 1 ? '' : 's'} queued</span></div>
          </div>
        </div>

        {/* Stats */}
        <div className="dash-info-col">
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)', marginBottom: 8 }}>Stats</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.9 }}>
            <div><span style={{ color: 'var(--text)', fontWeight: 600 }}>{stats.draftsPendingReview}</span> awaiting review</div>
            <div><span style={{ color: 'var(--text)', fontWeight: 600 }}>{stats.postsTotal}</span> published · <span style={{ color: 'var(--text)', fontWeight: 600 }}>{stats.articlesTotal}</span> scraped</div>
          </div>
        </div>
      </div>

      {/* Source health warning */}
      {brokenSources.length > 0 && (
        <div className="li-bar" style={{ borderColor: '#f87171', color: '#f87171', marginBottom: 16 }}>
          <span className="dot dot-red" /> Source issues: {brokenSources.join(' · ')}
          {sourceHealth?.checkedAt && (
            <span style={{ marginLeft: 8, opacity: 0.6, fontSize: 11 }}>
              checked {new Date(sourceHealth.checkedAt).toLocaleTimeString()}
            </span>
          )}
        </div>
      )}

      {/* Article feed */}
      <ArticleFeed updateBadges={updateBadges} refreshKey={feedRefreshKey} onDraft={setDraftingArticle} />

      {/* Analyze modal */}
      {analyzeModalOpen && (
        <AnalyzeModal
          onClose={() => setAnalyzeModalOpen(false)}
          onSuccess={onAnalyzeSuccess}
        />
      )}

      {/* Draft writing modal */}
      {draftingArticle && (
        <DraftWritingModal
          articleId={draftingArticle.id}
          article={draftingArticle}
          onClose={() => setDraftingArticle(null)}
          onSaved={() => {
            setDraftingArticle(null)
            updateBadges()
            onNavigate('sharing')
          }}
          showToast={showToast}
        />
      )}
    </>
  )
}
