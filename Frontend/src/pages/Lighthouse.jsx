import Loading from '../components/Loading'
import MetricCard from '../components/MetricCard'
import ScoreCard from '../components/ScoreCard'
import UrlInput from '../components/UrlInput'
import { useAnalysis } from '../context/AnalysisContext'
import { formatMs, formatTime, num } from '../utils/format'

const CATEGORIES = [
  { key: 'performance', label: 'Performance', hint: 'Load speed and responsiveness.' },
  { key: 'accessibility', label: 'Accessibility', hint: 'Usable by assistive tech.' },
  { key: 'bestPractices', label: 'Best practices', hint: 'Security and modern APIs.' },
  { key: 'seo', label: 'SEO', hint: 'Crawlability and metadata.' },
]

/** Thresholds published by Lighthouse for the lab metrics it returns. */
const METRICS = [
  { key: 'fcp', label: 'First contentful paint', good: 1800, moderate: 3000, unit: 'ms' },
  { key: 'lcp', label: 'Largest contentful paint', good: 2500, moderate: 4000, unit: 'ms' },
  { key: 'speedIndex', label: 'Speed index', good: 3400, moderate: 5800, unit: 'ms' },
  { key: 'tbt', label: 'Total blocking time', good: 200, moderate: 600, unit: 'ms' },
  { key: 'cls', label: 'Cumulative layout shift', good: 0.1, moderate: 0.25, unit: '' },
  { key: 'interactive', label: 'Time to interactive', good: 3800, moderate: 7300, unit: 'ms' },
]

function metricTone(value, config) {
  if (value === null) return 'neutral'
  if (value <= config.good) return 'good'
  if (value <= config.moderate) return 'moderate'
  return 'poor'
}

export default function Lighthouse() {
  const { target, setTarget, lighthouse } = useAnalysis()

  const { report } = lighthouse
  const scores = report?.scores ?? {}
  const metrics = report?.metrics ?? {}
  const hasScores = CATEGORIES.some((category) => num(scores[category.key]) !== null)

  return (
    <div className="page">
      <section className="page__header">
        <div className="page__heading">
          <p className="page__eyebrow">Audit scores</p>
          <h1 className="page__title">Lighthouse report</h1>
          <p className="page__subtitle">
            A headless Chrome run on the server, queued in Redis. Expect 30–90 seconds per audit.
          </p>
        </div>

        <UrlInput
          value={target}
          onChange={setTarget}
          onSubmit={(url) => lighthouse.run(url)}
          loading={lighthouse.isRunning}
          submitLabel="Run audit"
        />
      </section>

      {lighthouse.status === 'error' ? (
        <div className="alert alert--error" role="alert">
          <strong>Audit failed.</strong>
          <span>{lighthouse.error}</span>
        </div>
      ) : null}

      {lighthouse.isRunning ? (
        <section className="panel panel--progress" aria-live="polite">
          <div className="panel__head">
            <div>
              <h2 className="panel__title">Auditing</h2>
              <p className="panel__subtitle">{lighthouse.url}</p>
            </div>
            <Loading size="sm" label="Running Lighthouse" inline />
          </div>
          <div className="progress">
            <div className="progress__bar progress__bar--indeterminate" />
          </div>
          <p className="panel__footnote">
            Chrome is loading the page with a throttled connection. The report arrives over the
            socket when the worker finishes.
          </p>
        </section>
      ) : null}

      <section className="grid grid--scores">
        {CATEGORIES.map((category) => (
          <ScoreCard
            key={category.key}
            label={category.label}
            score={num(scores[category.key])}
            hint={category.hint}
            loading={lighthouse.isRunning && !hasScores}
          />
        ))}
      </section>

      <section className="panel">
        <div className="panel__head">
          <div>
            <h2 className="panel__title">Lab metrics</h2>
            <p className="panel__subtitle">
              {report?.requestedUrl
                ? `${report.requestedUrl} · audited ${formatTime(report.fetchTime)}`
                : 'Measured on the server with Lighthouse’s mobile preset.'}
            </p>
          </div>
        </div>

        <div className="grid grid--metrics">
          {METRICS.map((config) => {
            const value = num(metrics[config.key])
            const display =
              value === null ? '—' : config.unit === '' ? value.toFixed(3) : formatMs(value)

            return (
              <MetricCard
                key={config.key}
                label={config.label}
                value={display}
                status={metricTone(value, config)}
                hint={
                  value === null
                    ? 'No value returned yet.'
                    : `Good under ${config.unit === '' ? config.good : formatMs(config.good)}`
                }
                loading={lighthouse.isRunning && value === null}
              />
            )
          })}
        </div>
      </section>

      {!report && !lighthouse.isRunning && lighthouse.status !== 'error' ? (
        <section className="panel panel--intro">
          <h2 className="panel__title">What the audit returns</h2>
          <ol className="steps">
            <li>
              <strong>Four category scores</strong>
              <span>Performance, accessibility, best practices and SEO, each 0–100.</span>
            </li>
            <li>
              <strong>Six lab metrics</strong>
              <span>FCP, LCP, speed index, blocking time, layout shift and time to interactive.</span>
            </li>
            <li>
              <strong>One job per URL</strong>
              <span>Queued in Redis and reported back into a room keyed by the report id.</span>
            </li>
          </ol>
        </section>
      ) : null}
    </div>
  )
}
