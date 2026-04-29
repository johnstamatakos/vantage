export async function api(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } }
  if (body) opts.body = JSON.stringify(body)
  const r = await fetch(path, opts)
  if (r.status === 401) { window.location.href = '/login'; return }
  if (!r.ok) {
    const e = await r.json().catch(() => ({ error: r.statusText }))
    throw new Error(e.error || 'API error')
  }
  return r.json()
}

export async function apiStream(path, body, onChunk, onDone, onError) {
  try {
    const r = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (r.status === 401) { window.location.href = '/login'; return }
    if (!r.ok) { onError?.(`Request failed: ${r.statusText}`); return }

    const reader  = r.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        try {
          const parsed = JSON.parse(line.slice(6))
          if (parsed.error) { onError?.(parsed.error); return }
          if (parsed.done)  { onDone(); return }
          if (parsed.text)  onChunk(parsed.text)
        } catch {}
      }
    }
    onDone()
  } catch (err) {
    onError?.(err.message)
  }
}

export function fmtDate(iso) {
  if (!iso) return 'Unknown'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function fmtNum(n) {
  if (n == null) return '—'
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function parseCron(cron) {
  if (!cron) return '—'
  const [min, hour, , , weekday] = cron.split(' ')
  const h = parseInt(hour), m = parseInt(min)
  const time = `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
  const days = weekday === '*'
    ? 'every day'
    : weekday.split(',').map(d => DAYS[parseInt(d)]).join(', ')
  return `${days} at ${time}`
}
