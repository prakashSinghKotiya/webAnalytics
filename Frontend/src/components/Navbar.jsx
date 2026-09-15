import { useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { useAnalysis } from '../context/AnalysisContext'

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/ttfb', label: 'TTFB' },
  { to: '/lighthouse', label: 'Lighthouse' },
  { to: '/uptime', label: 'Uptime' },
]

const CONNECTION_LABELS = {
  online: 'Live',
  connecting: 'Connecting',
  offline: 'Offline',
}

export default function Navbar() {
  const { connection, target, ttfb, lighthouse } = useAnalysis()
  const [menuOpen, setMenuOpen] = useState(false)
  const busy = ttfb.isRunning || lighthouse.isRunning

  return (
    <header className="navbar">
      <div className="navbar__inner">
        <Link to="/" className="brand" aria-label="Web Audit home">
          <span className="brand__mark" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path
                d="M4 16.5 9 11l4 3.5L20 6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M3 20.5h18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <span className="brand__text">
            Web<span className="brand__accent">Audit</span>
          </span>
        </Link>

        <nav className={`navbar__nav${menuOpen ? ' navbar__nav--open' : ''}`} aria-label="Main">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `navbar__link${isActive ? ' navbar__link--active' : ''}`
              }
              onClick={() => setMenuOpen(false)}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="navbar__meta">
          {busy ? (
            <span className="pill pill--running">
              <span className="pill__dot" aria-hidden="true" />
              Running
            </span>
          ) : null}

          <span className={`pill pill--${connection}`} title={`Realtime: ${connection}`}>
            <span className="pill__dot" aria-hidden="true" />
            {CONNECTION_LABELS[connection] ?? connection}
          </span>

          <button
            type="button"
            className="navbar__toggle"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-label="Toggle navigation"
          >
            <span aria-hidden="true">{menuOpen ? '×' : '☰'}</span>
          </button>
        </div>
      </div>

      {target ? <div className="navbar__target">Tracking {target}</div> : null}
    </header>
  )
}
