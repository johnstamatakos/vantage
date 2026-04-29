import { useState, useEffect } from 'react'
import { api } from '../utils/api'

function TagList({ tags, onRemove, onAdd, placeholder }) {
  const [input, setInput] = useState('')

  function addTag() {
    const val = input.trim()
    if (!val) return
    onAdd(val)
    setInput('')
  }

  return (
    <>
      <div className="tag-wrap">
        {tags.map((t, i) => (
          <span key={i} className="cfg-tag">
            {t}
            <button onClick={() => onRemove(i)}>×</button>
          </span>
        ))}
      </div>
      <div className="add-row">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addTag()}
          placeholder={placeholder}
        />
        <button className="btn btn-ghost" onClick={addTag}>Add</button>
      </div>
    </>
  )
}

function HealthDot({ status }) {
  if (!status) return null
  return (
    <span
      className={`dot ${status.ok ? 'dot-green' : 'dot-red'}`}
      title={status.ok ? `${status.latency}ms` : status.error}
      style={{ marginLeft: 8, verticalAlign: 'middle' }}
    />
  )
}

function FeedList({ feeds, onRemove, onAdd, health }) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const healthMap = Object.fromEntries((health || []).map(h => [h.url, h]))

  function addFeed() {
    if (!name.trim() || !url.trim()) return
    onAdd({ name: name.trim(), url: url.trim() })
    setName('')
    setUrl('')
  }

  return (
    <>
      {feeds.map((f, i) => (
        <div key={i} className="feed-item">
          <div className="feed-info">
            <span className="feed-name">{f.name}</span>
            <span className="feed-url">{f.url}</span>
            {healthMap[f.url] && (
              <span
                className={`dot ${healthMap[f.url].ok ? 'dot-green' : 'dot-red'}`}
                title={healthMap[f.url].ok ? `${healthMap[f.url].latency}ms` : healthMap[f.url].error}
                style={{ marginLeft: 6, flexShrink: 0 }}
              />
            )}
          </div>
          <button className="feed-remove" onClick={() => onRemove(i)}>×</button>
        </div>
      ))}
      <div className="add-feed">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Name"
        />
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addFeed()}
          placeholder="Feed URL"
        />
        <button className="btn btn-ghost" onClick={addFeed}>Add</button>
      </div>
    </>
  )
}

export default function Settings({ showToast }) {
  const [config, setConfig] = useState(null)
  const [li, setLi] = useState(null)
  const [hnQueries, setHnQueries] = useState([])
  const [subreddits, setSubreddits] = useState([])
  const [feeds, setFeeds] = useState([])
  const [crawlCron, setCrawlCron] = useState('')
  const [postCron, setPostCron] = useState('')
  const [analyticsCron, setAnalyticsCron] = useState('')
  const [timezone, setTimezone] = useState('')
  const [minScore, setMinScore] = useState(7)
  const [sourceHealth, setSourceHealth] = useState(null)
  const [checkingHealth, setCheckingHealth] = useState(false)

  useEffect(() => {
    Promise.all([api('/api/config'), api('/api/dashboard')]).then(([cfg, dash]) => {
      setConfig(cfg)
      setLi(dash.linkedInStatus)
      setHnQueries(cfg.sources?.hackernews?.queries || [])
      setSubreddits(cfg.sources?.reddit?.subreddits || [])
      setFeeds(cfg.sources?.rss?.feeds || [])
      setCrawlCron(cfg.schedule?.crawlCron || '0 8 * * 1,3,5')
      setPostCron(cfg.schedule?.postCron || '0 9 * * 2')
      setAnalyticsCron(cfg.schedule?.analyticsCron || '0 10 * * *')
      setTimezone(cfg.schedule?.timezone || 'America/New_York')
      setMinScore(cfg.pipeline?.minRelevanceScore ?? 7)
    })
  }, [])

  async function checkSources() {
    setCheckingHealth(true)
    try {
      const h = await api('/api/sources/health')
      setSourceHealth(h)
      const broken = [
        h.hackernews && !h.hackernews.ok ? 'HN' : null,
        h.reddit     && !h.reddit.ok     ? 'Reddit' : null,
        ...(h.rss || []).filter(f => !f.ok).map(f => f.name),
      ].filter(Boolean)
      if (broken.length) showToast(`Broken: ${broken.join(', ')}`, 'error')
      else showToast('All sources OK', 'success')
    } catch (err) {
      showToast(`Health check failed: ${err.message}`, 'error')
    } finally {
      setCheckingHealth(false)
    }
  }

  async function saveConfig() {
    const updated = {
      ...config,
      sources: {
        ...config.sources,
        hackernews: { ...config.sources.hackernews, queries: hnQueries },
        reddit:     { ...config.sources.reddit,     subreddits },
        rss:        { ...config.sources.rss,         feeds },
      },
      schedule: { ...config.schedule, crawlCron, postCron, analyticsCron, timezone },
      pipeline: { ...config.pipeline, minRelevanceScore: Number(minScore) },
    }
    await api('/api/config', 'PUT', updated)
    setConfig(updated)
    showToast('Settings saved', 'success')
  }

  if (!config || !li) {
    return <div className="empty"><div className="icon">⏳</div>Loading...</div>
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Settings</div>
          <div className="page-sub">Sources, schedule, and pipeline</div>
        </div>
        <div className="btn-row">
          <button className="btn btn-ghost" onClick={checkSources} disabled={checkingHealth}>
            {checkingHealth ? 'Checking...' : 'Check Sources'}
          </button>
          <button className="btn btn-primary" onClick={saveConfig}>Save Settings</button>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div className="section-title">HN Search Queries</div>
          <HealthDot status={sourceHealth?.hackernews} />
        </div>
        <div className="section-sub">Terms used to search Hacker News on each crawl run.</div>
        <TagList
          tags={hnQueries}
          onRemove={i => setHnQueries(prev => prev.filter((_, j) => j !== i))}
          onAdd={val => setHnQueries(prev => [...prev, val])}
          placeholder="Add a query..."
        />
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div className="section-title">Reddit Subreddits</div>
          <HealthDot status={sourceHealth?.reddit} />
        </div>
        <div className="section-sub">Subreddits crawled for relevant posts.</div>
        <TagList
          tags={subreddits}
          onRemove={i => setSubreddits(prev => prev.filter((_, j) => j !== i))}
          onAdd={val => setSubreddits(prev => [...prev, val])}
          placeholder="Add a subreddit..."
        />
      </div>

      <div className="card">
        <div className="section-title">RSS Feeds</div>
        <div className="section-sub">Feeds checked on each crawl run (articles up to {config.sources?.rss?.maxAgeHours || 168}h old).</div>
        <FeedList
          feeds={feeds}
          onRemove={i => setFeeds(prev => prev.filter((_, j) => j !== i))}
          onAdd={feed => setFeeds(prev => [...prev, feed])}
          health={sourceHealth?.rss}
        />
      </div>

      <div className="card">
        <div className="section-title">Schedule &amp; Pipeline</div>
        <div className="cfg-grid">
          <div>
            <label className="cfg-lbl">Crawl Cron</label>
            <input className="cfg-input" value={crawlCron} onChange={e => setCrawlCron(e.target.value)} />
          </div>
          <div>
            <label className="cfg-lbl">Post Cron</label>
            <input className="cfg-input" value={postCron} onChange={e => setPostCron(e.target.value)} />
          </div>
          <div>
            <label className="cfg-lbl">Analytics Cron</label>
            <input className="cfg-input" value={analyticsCron} onChange={e => setAnalyticsCron(e.target.value)} />
          </div>
          <div>
            <label className="cfg-lbl">Timezone</label>
            <input className="cfg-input" value={timezone} onChange={e => setTimezone(e.target.value)} />
          </div>
          <div>
            <label className="cfg-lbl">Min Relevance Score (1–10)</label>
            <input type="number" min="1" max="10" className="cfg-input" value={minScore} onChange={e => setMinScore(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="section-title">LinkedIn Connection</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', margin: '10px 0 16px' }}>
          {li.connected ? (
            <><span className="dot dot-green" style={{ marginRight: 6 }} /> Connected. Token expires in {li.expiresIn}m.</>
          ) : (
            <><span className="dot dot-red" style={{ marginRight: 6 }} /> {li.reason}</>
          )}
        </div>
        <a href="/auth/linkedin" className="btn btn-primary">Reconnect LinkedIn</a>
      </div>
    </>
  )
}
