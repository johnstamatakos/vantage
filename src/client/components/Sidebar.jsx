import { api } from '../utils/api'

const Icon = ({ d, children, size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
    style={{ flexShrink: 0 }}>
    {d ? <path d={d} /> : children}
  </svg>
)

const NAV_ICONS = {
  dashboard: <Icon><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></Icon>,
  sharing:   <Icon><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></Icon>,
  analytics: <Icon><path d="M18 20V10M12 20V4M6 20v-6"/><path d="M2 20h20"/></Icon>,
  calibrate: <Icon><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></Icon>,
  config:    <Icon><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></Icon>,
}

const NAV_ITEMS = [
  { page: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { page: 'sharing',   label: 'Sharing',   icon: 'sharing',   badgeKey: 'pending' },
  { page: 'analytics', label: 'Analytics', icon: 'analytics' },
  { page: 'calibrate', label: 'Calibrate', icon: 'calibrate' },
  { page: 'config',    label: 'Settings',  icon: 'config' },
]

export default function Sidebar({ currentPage, onNavigate, pendingCount, isOpen }) {
  async function logout() {
    await api('/api/logout', 'POST')
    window.location.href = '/login'
  }

  const counts = { pending: pendingCount }

  return (
    <nav className={`sidebar${isOpen ? ' open' : ''}`}>
      <div className="logo"><img src="/logo.png" alt="Logo" /></div>
      <div className="logo-tagline">Skip the noise. Keep the signal.</div>
      <div className="nav-section">Navigation</div>
      {NAV_ITEMS.map(({ page, label, icon, badgeKey, warn }) => (
        <div
          key={page}
          className={`nav${currentPage === page ? ' active' : ''}`}
          onClick={() => onNavigate(page)}
        >
          {NAV_ICONS[icon]}
          {label}
          {badgeKey !== undefined && (
            <span className={`badge${warn ? ' warn' : ''}`}>{counts[badgeKey]}</span>
          )}
        </div>
      ))}
      <div className="sidebar-footer">
        <button className="btn btn-ghost" style={{ width: '100%' }} onClick={logout}>
          Sign Out
        </button>
      </div>
    </nav>
  )
}
