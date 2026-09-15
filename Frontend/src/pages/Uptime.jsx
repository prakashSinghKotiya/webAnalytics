import { useState } from 'react'
import Loading from '../components/Loading'
import MetricCard from '../components/MetricCard'
import UrlInput from '../components/UrlInput'
import { useAnalysis } from '../context/AnalysisContext'
import { INTERVALS } from '../services/api'
import {
  addressTooltip,
  checkTone,
  formatAddress,
  formatClock,
  formatMs,
  formatTime,
  intervalLabel,
  reasonLabel,
  shortUrl,
} from '../utils/format'

const STATUS_LABELS = { UP: 'Up', DEGRADED: 'Degraded', DOWN: 'Down' }

export default function Uptime() {
  const { target, setTarget, connection, uptime } = useAnalysis()
  const [interval, setInterval] = useState('5m')

  const monitors = uptime.monitors
  const active = monitors.filter((monitor) => monitor.status === 'active')
  const latestCheck = Object.values(uptime.live).sort(
    (a, b) => new Date(b.timestamp ?? 0) - new Date(a.timestamp ?? 0),
  )[0]

  const submitMonitor = async (url) => {
    const created = await uptime.create(url, interval)
    if (created) setTarget('')
  }

  return (
    <div className="page">
      <section className="page__header">
        <div className="page__heading">
          <p className="page__eyebrow">Availability</p>
          <h1 className="page__title">Uptime monitors</h1>
          <p className="page__subtitle">
            Each monitor runs on the backend scheduler. Results stream in over the socket as every
            check completes — there is no manual &ldquo;check now&rdquo; route.
          </p>
        </div>

        <UrlInput
          value={target}
          onChange={setTarget}
          onSubmit={submitMonitor}
          loading={uptime.busyId === 'create'}
          submitLabel="Start monitoring"
        >
          <div className="field field--inline">
            <label className="field__label" htmlFor="monitor-interval">
              Check interval
            </label>
            <select
              id="monitor-interval"
              className="select"
              value={interval}
              onChange={(event) => setInterval(event.target.value)}
              disabled={uptime.busyId === 'create'}
            >
              {INTERVALS.map((option) => (
                <option key={option} value={option}>
                  {intervalLabel(option)}
                </option>
              ))}
            </select>
          </div>
        </UrlInput>
      </section>

      {uptime.actionError ? (
        <div className="alert alert--error" role="alert">
          <strong>That action failed.</strong>
          <span>{uptime.actionError}</span>
        </div>
      ) : null}

      {uptime.status === 'error' ? (
        <div className="alert alert--error" role="alert">
          <strong>Could not load monitors.</strong>
          <span>{uptime.error}</span>
        </div>
      ) : null}

      <section className="grid grid--metrics">
        <MetricCard
          label="Monitors"
          value={uptime.status === 'loading' ? '—' : monitors.length}
          hint="URLs stored by the API."
          loading={uptime.status === 'loading'}
        />
        <MetricCard
          label="Active"
          value={uptime.status === 'loading' ? '—' : active.length}
          status={active.length ? 'good' : 'neutral'}
          hint="Schedulers currently running."
          loading={uptime.status === 'loading'}
        />
        <MetricCard
          label="Last check"
          value={latestCheck ? (STATUS_LABELS[latestCheck.status] ?? latestCheck.status) : '—'}
          status={checkTone(latestCheck?.status)}
          hint={
            latestCheck
              ? `${shortUrl(latestCheck.url)} · ${formatClock(latestCheck.timestamp)}`
              : 'Waiting for the first scheduled check.'
          }
        />
        <MetricCard
          label="Realtime"
          value={connection === 'online' ? 'Connected' : connection === 'offline' ? 'Offline' : 'Connecting'}
          status={connection === 'online' ? 'good' : 'neutral'}
          hint="Results only arrive while the socket is connected."
        />
      </section>

      <section className="panel">
        <div className="panel__head">
          <div>
            <h2 className="panel__title">Monitors</h2>
            <p className="panel__subtitle">
              {monitors.length
                ? `${active.length} of ${monitors.length} running.`
                : 'Nothing monitored yet — add a URL above.'}
            </p>
          </div>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={uptime.reload}
            disabled={uptime.status === 'loading'}
          >
            {uptime.status === 'loading' ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {uptime.status === 'loading' && monitors.length === 0 ? (
          <Loading label="Loading monitors" />
        ) : monitors.length === 0 ? (
          <p className="empty-state">
            Enter a URL above and choose how often it should be checked.
          </p>
        ) : (
          <ul className="monitor-list">
            {monitors.map((monitor) => {
              const monitorId = String(monitor._id)
              const live = uptime.live[monitorId]
              const busy = uptime.busyId === monitorId
              const isActive = monitor.status === 'active'

              return (
                <li
                  key={monitorId}
                  className={`monitor${isActive ? '' : ' monitor--paused'}`}
                >
                  <div className="monitor__main">
                    <div className="monitor__head">
                      <span className="monitor__url" title={monitor.url}>
                        {shortUrl(monitor.url)}
                      </span>
                      <span className={`pill pill--${isActive ? 'online' : 'connecting'}`}>
                        <span className="pill__dot" aria-hidden="true" />
                        {monitor.status}
                      </span>
                    </div>

                    <p className="monitor__meta">
                      <span className={`pill pill--${checkTone(live?.status)}`}>
                        <span className="pill__dot" aria-hidden="true" />
                        {live ? (STATUS_LABELS[live.status] ?? live.status) : 'Waiting for a check'}
                      </span>
                      <span>Checked {intervalLabel(monitor.interval)}</span>
                      <span>Last result {formatTime(live?.timestamp)}</span>
                      <span>Added {formatTime(monitor.createdAt)}</span>
                    </p>
                  </div>

                  <div className="monitor__actions">
                    <label className="sr-only" htmlFor={`interval-${monitorId}`}>
                      Check interval
                    </label>
                    <select
                      id={`interval-${monitorId}`}
                      className="select select--sm"
                      value={monitor.interval}
                      disabled={busy}
                      onChange={(event) =>
                        uptime.update(monitorId, {
                          url: monitor.url,
                          interval: event.target.value,
                          status: monitor.status,
                        })
                      }
                    >
                      {INTERVALS.map((option) => (
                        <option key={option} value={option}>
                          {intervalLabel(option)}
                        </option>
                      ))}
                    </select>

                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={busy}
                      onClick={() =>
                        isActive ? uptime.pause(monitorId) : uptime.resume(monitorId)
                      }
                    >
                      {busy ? 'Saving…' : isActive ? 'Pause' : 'Resume'}
                    </button>

                    <button
                      type="button"
                      className="btn btn--danger btn--sm"
                      disabled={busy}
                      onClick={() => uptime.remove(monitorId)}
                    >
                      Delete
                    </button>
                  </div>

                  {live ? (
                    <dl className="stat-list monitor__facts">
                      <div>
                        <dt>Status</dt>
                        <dd>{STATUS_LABELS[live.status] ?? live.status}</dd>
                      </div>
                      <div>
                        <dt>HTTP</dt>
                        <dd>{live.httpStatus ?? '—'}</dd>
                      </div>
                      <div>
                        <dt>Total response</dt>
                        <dd>{live.TotalresponseTime === undefined ? '—' : formatMs(live.TotalresponseTime)}</dd>
                      </div>
                      <div>
                        <dt>TTFB</dt>
                        <dd>{live.ttfb === null || live.ttfb === undefined ? '—' : formatMs(live.ttfb)}</dd>
                      </div>
                      <div>
                        <dt>DNS</dt>
                        <dd>{live.DNSTime === undefined ? '—' : formatMs(live.DNSTime)}</dd>
                      </div>
                      <div>
                        <dt>Resolved to</dt>
                        <dd
                          title={addressTooltip(live.dnsAddress ?? live.checkingFor)}
                          className="monitor__address"
                        >
                          {formatAddress(live.dnsAddress ?? live.checkingFor)}
                        </dd>
                      </div>
                      <div>
                        <dt>Reason</dt>
                        <dd>{reasonLabel(live.reason)}</dd>
                      </div>
                      <div>
                        <dt>Checked at</dt>
                        <dd>{formatClock(live.timestamp)}</dd>
                      </div>
                    </dl>
                  ) : (
                    <p className="monitor__waiting">
                      Results appear after the first scheduled run ({intervalLabel(monitor.interval)}
                      ). Keep this page open — the socket delivers it live.
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="panel panel--intro">
        <div className="panel__head">
          <div>
            <h2 className="panel__title">How checking works</h2>
            <p className="panel__subtitle">
              The scheduler lives in BullMQ, so a monitor keeps running after you close this tab.
            </p>
          </div>
        </div>
        <ol className="steps">
          <li>
            <strong>Queue a monitor</strong>
            <span>POST /uptime/create stores the URL and registers a repeatable job.</span>
          </li>
          <li>
            <strong>The worker probes it</strong>
            <span>Each run records DNS time, TTFB, total response time and the HTTP status.</span>
          </li>
          <li>
            <strong>Results stream back</strong>
            <span>Everything is emitted into the monitor&apos;s own socket room.</span>
          </li>
        </ol>
      </section>
    </div>
  )
}
