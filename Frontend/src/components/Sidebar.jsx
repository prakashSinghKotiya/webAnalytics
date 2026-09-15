import { NavLink } from 'react-router-dom'
import { useAnalysis } from '../context/AnalysisContext'
import { API_URL, ALL_REGIONS, REGION_LABELS } from '../services/api'
import { SOCKET_URL } from '../services/socket'

const NAV_ITEMS = [
  {
    to: '/',
    label: 'Dashboard',
    end: true,
    description: 'Overview of the latest run',
    icon: (
      <path
        d="M4 4h6v6H4zM14 4h6v4h-6zM14 12h6v8h-6zM4 14h6v6H4z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    ),
  },
  {
    to: '/ttfb',
    label: 'TTFB',
    description: 'Time to first byte',
    icon: (
      <path
        d="M13 2 4.5 13H11l-1 9 8.5-11H12l1-9Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    ),
  },
  {
    to: '/lighthouse',
    label: 'Lighthouse',
    description: 'Audit scores',
    icon: (
      <>
        <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path
          d="M12 12l4.5-3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </>
    ),
  },
  {
    to: '/uptime',
    label: 'Uptime',
    description: 'Availability monitors',
    icon: (
      <path
        d="M2.5 12h4l2.5 6 4-13 2.5 7h6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
]

/** Best TTFB across the regions of the last run, for the sidebar summary. */
function bestTtfb(results) {
  const values = Object.values(results ?? {})
    .map((result) => result?.ttfb)
    .filter((value) => typeof value === 'number')

  return values.length ? Math.min(...values) : null
}

export default function Sidebar({ open = true, onNavigate }) {
  const { connection, target, region, ttfb, lighthouse, uptime } = useAnalysis()

  const activeMonitors = uptime.monitors.filter((monitor) => monitor.status === 'active').length
  const fastest = bestTtfb(ttfb.results)
  const performance = lighthouse.report?.scores?.performance ?? null

  return (
    <aside className={`sidebar${open ? '' : ' sidebar--collapsed'}`}>
      <nav className="sidebar__nav" aria-label="Sections">
        <p className="sidebar__heading">Analysis</p>

        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              `sidebar__link${isActive ? ' sidebar__link--active' : ''}`
            }
          >
            <svg className="sidebar__icon" viewBox="0 0 24 24" aria-hidden="true">
              {item.icon}
            </svg>
            <span className="sidebar__text">
              <span className="sidebar__label">{item.label}</span>
              <span className="sidebar__description">{item.description}</span>
            </span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar__footer">
        <dl className="sidebar__stats">
          <div>
            <dt>TTFB region</dt>
            <dd>{region === ALL_REGIONS ? 'All' : REGION_LABELS[region]}</dd>
          </div>
          <div>
            <dt>Fastest TTFB</dt>
            <dd>{fastest === null ? '—' : `${fastest} ms`}</dd>
          </div>
          <div>
            <dt>Performance</dt>
            <dd>{performance === null ? '—' : performance}</dd>
          </div>
          <div>
            <dt>Monitors active</dt>
            <dd>
              {activeMonitors}
              {uptime.monitors.length ? ` / ${uptime.monitors.length}` : ''}
            </dd>
          </div>
        </dl>

        <p className={`sidebar__status sidebar__status--${connection}`}>
          <span className="pill__dot" aria-hidden="true" />
          {connection === 'online' ? 'Realtime connected' : `Realtime ${connection}`}
        </p>
        <p className="sidebar__endpoint" title={`${API_URL} · ${SOCKET_URL}`}>
          {API_URL.replace(/^https?:\/\//, '')}
        </p>
        {target ? (
          <p className="sidebar__endpoint" title={target}>
            {target.replace(/^https?:\/\//, '')}
          </p>
        ) : null}
      </div>
    </aside>
  )
}
