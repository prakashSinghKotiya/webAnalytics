import { Link } from 'react-router-dom'
import Loading from '../components/Loading'
import MetricCard from '../components/MetricCard'
import RegionSelect from '../components/RegionSelect'
import ScoreCard from '../components/ScoreCard'
import UrlInput from '../components/UrlInput'
import { useAnalysis } from '../context/AnalysisContext'
import { ALL_REGIONS, REGION_LABELS, REGIONS } from '../services/api'
import {
  checkTone,
  formatClock,
  formatMs,
  intervalLabel,
  scoreTone,
  shortUrl,
  ttfbTone,
} from '../utils/format'

const CATEGORIES = [
  { key: 'performance', label: 'Performance' },
  { key: 'accessibility', label: 'Accessibility' },
  { key: 'bestPractices', label: 'Best practices' },
  { key: 'seo', label: 'SEO' },
]

const STATUS_LABELS = { UP: 'Up', DEGRADED: 'Degraded', DOWN: 'Down' }

export default function Dashboard() {
  const { target, setTarget, region, setRegion, ttfb, lighthouse, uptime } = useAnalysis()

  const requested = ttfb.region === ALL_REGIONS ? REGIONS : [ttfb.region]
  const scores = lighthouse.report?.scores ?? {}
  const monitors = uptime.monitors.slice(0, 4)
  const active = uptime.monitors.filter((monitor) => monitor.status === 'active').length
  const latest = Object.values(uptime.live).sort(
    (a, b) => new Date(b.timestamp ?? 0) - new Date(a.timestamp ?? 0),
  )[0]

  const hasAnyRun =
    ttfb.status !== 'idle' || lighthouse.status !== 'idle' || uptime.monitors.length > 0

  return (
    <div className="page">
      <section className="page__header">
        <div className="page__heading">
          <p className="page__eyebrow">Performance overview</p>
          <h1 className="page__title">Website audit dashboard</h1>
          <p className="page__subtitle">
            One URL, three independent jobs: a regional TTFB measurement, a Lighthouse audit and
            uptime monitors. Each runs separately, so choose what to start.
          </p>
        </div>

        <UrlInput
          value={target}
          onChange={setTarget}
          onSubmit={(url) => ttfb.run(url, region)}
          loading={ttfb.isRunning}
          submitLabel="Measure TTFB"
          autoFocus
        >
          <RegionSelect value={region} onChange={setRegion} disabled={ttfb.isRunning} />
        </UrlInput>
      </section>

      {!hasAnyRun ? (
        <section className="panel panel--intro">
          <h2 className="panel__title">Start here</h2>
          <ol className="steps">
            <li>
              <strong>Enter a URL</strong>
              <span>It is shared across every page, so you only type it once.</span>
            </li>
            <li>
              <strong>Pick a region</strong>
              <span>All regions fans the job out to India, Europe and the USA at once.</span>
            </li>
            <li>
              <strong>Read the results live</strong>
              <span>Jobs are queued in Redis and streamed back over the socket.</span>
            </li>
          </ol>
        </section>
      ) : null}

      {/* ------------------------------------------------------------------ TTFB */}

      <section className="panel">
        <div className="panel__head">
          <div>
            <h2 className="panel__title">Time to first byte</h2>
            <p className="panel__subtitle">
              {ttfb.url
                ? `${ttfb.url} · ${ttfb.region === ALL_REGIONS ? 'all regions' : REGION_LABELS[ttfb.region]}`
                : 'Measure how fast the server answers from each region.'}
            </p>
          </div>
          <div className="panel__actions">
            {ttfb.isRunning ? <Loading size="sm" label="Measuring" inline /> : null}
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => ttfb.run(target, region)}
              disabled={ttfb.isRunning || !target}
            >
              {ttfb.results && Object.keys(ttfb.results).length ? 'Measure again' : 'Measure'}
            </button>
            <Link className="btn btn--ghost btn--sm" to="/ttfb">
              Details
            </Link>
          </div>
        </div>

        {ttfb.status === 'error' ? (
          <div className="alert alert--error" role="alert">
            <span>{ttfb.error}</span>
          </div>
        ) : null}

        <div className="grid grid--metrics-3">
          {requested.map((key) => {
            const result = ttfb.results[key]
            return (
              <MetricCard
                key={key}
                label={REGION_LABELS[key]}
                value={typeof result?.ttfb === 'number' ? result.ttfb : '—'}
                unit={typeof result?.ttfb === 'number' ? 'ms' : ''}
                status={result ? ttfbTone(result.ttfb) : 'neutral'}
                loading={ttfb.pending.includes(key) || (ttfb.isRunning && !result)}
                hint={
                  result?.error
                    ? result.error
                    : result
                      ? `HTTP ${result.statusCode ?? '—'}`
                      : 'Not measured yet.'
                }
              />
            )
          })}
        </div>
      </section>

      {/* ------------------------------------------------------------ Lighthouse */}

      <section className="panel">
        <div className="panel__head">
          <div>
            <h2 className="panel__title">Lighthouse</h2>
            <p className="panel__subtitle">
              {lighthouse.report?.requestedUrl
                ? lighthouse.report.requestedUrl
                : 'A full headless Chrome audit — this one takes 30–90 seconds.'}
            </p>
          </div>
          <div className="panel__actions">
            {lighthouse.isRunning ? <Loading size="sm" label="Auditing" inline /> : null}
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => lighthouse.run(target)}
              disabled={lighthouse.isRunning || !target}
            >
              {lighthouse.report ? 'Re-run audit' : 'Run audit'}
            </button>
            <Link className="btn btn--ghost btn--sm" to="/lighthouse">
              Details
            </Link>
          </div>
        </div>

        {lighthouse.status === 'error' ? (
          <div className="alert alert--error" role="alert">
            <span>{lighthouse.error}</span>
          </div>
        ) : null}

        <div className="grid grid--scores">
          {CATEGORIES.map((category) => (
            <ScoreCard
              key={category.key}
              label={category.label}
              score={scores[category.key] ?? null}
              hint={
                scores[category.key] === undefined
                  ? 'No audit has run yet.'
                  : scoreTone(scores[category.key]) === 'good'
                    ? 'Good'
                    : scoreTone(scores[category.key]) === 'moderate'
                      ? 'Needs improvement'
                      : 'Poor'
              }
              loading={lighthouse.isRunning && !lighthouse.report}
            />
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------------------- Uptime */}

      <section className="panel">
        <div className="panel__head">
          <div>
            <h2 className="panel__title">Uptime monitors</h2>
            <p className="panel__subtitle">
              {uptime.monitors.length
                ? `${active} of ${uptime.monitors.length} running · last result ${latest ? formatClock(latest.timestamp) : 'pending'}`
                : 'No monitors yet — create one on the uptime page.'}
            </p>
          </div>
          <div className="panel__actions">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={uptime.reload}
              disabled={uptime.status === 'loading'}
            >
              Refresh
            </button>
            <Link className="btn btn--ghost btn--sm" to="/uptime">
              Manage
            </Link>
          </div>
        </div>

        {uptime.status === 'error' ? (
          <div className="alert alert--error" role="alert">
            <span>{uptime.error}</span>
          </div>
        ) : null}

        {uptime.status === 'loading' && uptime.monitors.length === 0 ? (
          <Loading label="Loading monitors" />
        ) : monitors.length === 0 ? (
          <p className="empty-state">Nothing is being monitored yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">URL</th>
                  <th scope="col">Schedule</th>
                  <th scope="col">Monitor</th>
                  <th scope="col">Last check</th>
                  <th scope="col">HTTP</th>
                  <th scope="col">Response</th>
                </tr>
              </thead>
              <tbody>
                {monitors.map((monitor) => {
                  const live = uptime.live[String(monitor._id)]
                  return (
                    <tr key={String(monitor._id)}>
                      <td className="table__url" title={monitor.url}>
                        {shortUrl(monitor.url)}
                      </td>
                      <td>{intervalLabel(monitor.interval)}</td>
                      <td>
                        <span
                          className={`pill pill--${monitor.status === 'active' ? 'online' : 'connecting'}`}
                        >
                          <span className="pill__dot" aria-hidden="true" />
                          {monitor.status}
                        </span>
                      </td>
                      <td>
                        <span className={`pill pill--${checkTone(live?.status)}`}>
                          <span className="pill__dot" aria-hidden="true" />
                          {live ? (STATUS_LABELS[live.status] ?? live.status) : 'Waiting'}
                        </span>
                      </td>
                      <td>{live?.httpStatus ?? '—'}</td>
                      <td>{live?.TotalresponseTime === undefined ? '—' : formatMs(live.TotalresponseTime)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
