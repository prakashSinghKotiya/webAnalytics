import Loading from '../components/Loading'
import MetricCard from '../components/MetricCard'
import RegionSelect from '../components/RegionSelect'
import UrlInput from '../components/UrlInput'
import { useAnalysis } from '../context/AnalysisContext'
import { ALL_REGIONS, REGION_LABELS, REGIONS } from '../services/api'
import { formatMs, formatTime, ttfbTone } from '../utils/format'

const THRESHOLDS = [
  { label: 'Good', range: 'Under 200 ms', tone: 'good' },
  { label: 'Needs improvement', range: '200 – 500 ms', tone: 'moderate' },
  { label: 'Poor', range: 'Above 500 ms', tone: 'poor' },
]

export default function TTFB() {
  const { target, setTarget, region, setRegion, ttfb } = useAnalysis()

  const requested = ttfb.region === ALL_REGIONS ? REGIONS : [ttfb.region]
  const results = requested
    .map((key) => ttfb.results[key])
    .filter(Boolean)
    .sort((a, b) => (a.ttfb ?? Infinity) - (b.ttfb ?? Infinity))

  const fastest = results.find((result) => typeof result.ttfb === 'number')
  const slowest = [...results].reverse().find((result) => typeof result.ttfb === 'number')

  return (
    <div className="page">
      <section className="page__header">
        <div className="page__heading">
          <p className="page__eyebrow">Server latency</p>
          <h1 className="page__title">Time to first byte</h1>
          <p className="page__subtitle">
            The backend measures each request from a dedicated worker per region. Pick one region
            or ask every region at once.
          </p>
        </div>

        <UrlInput
          value={target}
          onChange={setTarget}
          onSubmit={(url) => ttfb.run(url, region)}
          loading={ttfb.isRunning}
          submitLabel="Measure"
        >
          <RegionSelect value={region} onChange={setRegion} disabled={ttfb.isRunning} />
        </UrlInput>
      </section>

      {ttfb.status === 'error' ? (
        <div className="alert alert--error" role="alert">
          <strong>Measurement failed.</strong>
          <span>{ttfb.error}</span>
        </div>
      ) : null}

      {ttfb.isRunning ? (
        <section className="panel panel--progress" aria-live="polite">
          <div className="panel__head">
            <div>
              <h2 className="panel__title">
                Measuring {ttfb.region === ALL_REGIONS ? 'all regions' : REGION_LABELS[ttfb.region]}
              </h2>
              <p className="panel__subtitle">{ttfb.url}</p>
            </div>
            {ttfb.pending.length ? (
              <Loading size="sm" label={`Waiting on ${ttfb.pending.join(', ')}`} inline />
            ) : null}
          </div>
          <p className="panel__footnote">
            The job is queued in Redis; each region streams its result back over the socket.
          </p>
        </section>
      ) : null}

      <section className="grid grid--metrics-3">
        {requested.map((key) => {
          const result = ttfb.results[key]
          const waiting = ttfb.pending.includes(key)

          return (
            <MetricCard
              key={key}
              label={REGION_LABELS[key]}
              value={typeof result?.ttfb === 'number' ? result.ttfb : '—'}
              unit={typeof result?.ttfb === 'number' ? 'ms' : ''}
              status={result ? ttfbTone(result.ttfb) : 'neutral'}
              loading={waiting || (ttfb.isRunning && !result)}
              hint={
                result?.error
                  ? result.error
                  : result
                    ? `HTTP ${result.statusCode ?? '—'} · ${result.success ? 'request succeeded' : 'request failed'}`
                    : 'No measurement for this region yet.'
              }
            />
          )
        })}
      </section>

      {results.length ? (
        <section className="panel">
          <div className="panel__head">
            <div>
              <h2 className="panel__title">Regional breakdown</h2>
              <p className="panel__subtitle">
                {ttfb.url}
                {fastest && slowest && fastest.region !== slowest.region
                  ? ` — fastest ${REGION_LABELS[fastest.region]} at ${formatMs(fastest.ttfb)}, slowest ${REGION_LABELS[slowest.region]} at ${formatMs(slowest.ttfb)}.`
                  : '.'}
              </p>
            </div>
          </div>

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Region</th>
                  <th scope="col">TTFB</th>
                  <th scope="col">Status code</th>
                  <th scope="col">Outcome</th>
                  <th scope="col">Measured</th>
                </tr>
              </thead>
              <tbody>
                {results.map((result) => (
                  <tr key={result.region}>
                    <td>
                      <span className="pill pill--neutral">
                        <span className="pill__dot" aria-hidden="true" />
                        {REGION_LABELS[result.region] ?? result.region}
                      </span>
                    </td>
                    <td>{formatMs(result.ttfb)}</td>
                    <td>{result.statusCode ?? '—'}</td>
                    <td>
                      <span className={`pill pill--${result.success ? 'online' : 'offline'}`}>
                        <span className="pill__dot" aria-hidden="true" />
                        {result.success ? 'Success' : (result.error ?? 'Failed')}
                      </span>
                    </td>
                    <td>{formatTime(ttfb.finishedAt ?? ttfb.startedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel__head">
          <div>
            <h2 className="panel__title">How to read this</h2>
            <p className="panel__subtitle">
              TTFB is measured from the worker&apos;s network, so distance to the target matters.
            </p>
          </div>
        </div>
        <ul className="thresholds">
          {THRESHOLDS.map((row) => (
            <li key={row.label} className={`threshold threshold--${row.tone}`}>
              <span className="threshold__dot" aria-hidden="true" />
              <span className="threshold__label">{row.label}</span>
              <span className="threshold__range">{row.range}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
