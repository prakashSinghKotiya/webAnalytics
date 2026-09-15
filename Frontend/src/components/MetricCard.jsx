const TONES = {
  good: 'good',
  pass: 'good',
  fast: 'good',
  ok: 'good',
  moderate: 'moderate',
  warn: 'moderate',
  warning: 'moderate',
  average: 'moderate',
  'needs-improvement': 'moderate',
  poor: 'poor',
  bad: 'poor',
  slow: 'poor',
  fail: 'poor',
  down: 'poor',
  neutral: 'neutral',
  idle: 'neutral',
}

const TONE_LABELS = {
  good: 'Good',
  moderate: 'Needs work',
  poor: 'Poor',
}

/**
 * A single KPI tile: value + unit, an optional status pill, a trend delta and
 * an explanatory hint. Falls back to a skeleton while data is loading.
 */
export default function MetricCard({
  label,
  value,
  unit,
  hint,
  status = 'neutral',
  tone,
  icon,
  delta,
  deltaLabel,
  loading = false,
  footer,
  className = '',
}) {
  const resolvedTone = TONES[tone ?? status] ?? 'neutral'
  const hasValue = value !== null && value !== undefined && value !== ''
  const hasDelta = typeof delta === 'number' && Number.isFinite(delta)

  const classes = ['metric-card', `metric-card--${resolvedTone}`, className]
    .filter(Boolean)
    .join(' ')

  return (
    <article className={classes}>
      <header className="metric-card__head">
        <span className="metric-card__label">
          {icon ? (
            <span className="metric-card__icon" aria-hidden="true">
              {icon}
            </span>
          ) : null}
          {label}
        </span>
        {TONE_LABELS[resolvedTone] ? (
          <span className={`pill pill--${resolvedTone}`}>{TONE_LABELS[resolvedTone]}</span>
        ) : null}
      </header>

      {loading ? (
        <>
          <div className="skeleton skeleton--value" />
          <div className="skeleton skeleton--line" />
        </>
      ) : (
        <>
          <p className="metric-card__value">
            <span className="metric-card__number">{hasValue ? value : '—'}</span>
            {unit && hasValue ? <span className="metric-card__unit">{unit}</span> : null}
          </p>

          {hasDelta ? (
            <p className={`metric-card__delta metric-card__delta--${delta > 0 ? 'up' : 'down'}`}>
              <span aria-hidden="true">{delta > 0 ? '▲' : '▼'}</span>
              {Math.abs(delta).toFixed(delta % 1 === 0 ? 0 : 1)}
              {unit ? ` ${unit}` : ''}
              {deltaLabel ? <span className="metric-card__delta-label">{deltaLabel}</span> : null}
            </p>
          ) : null}

          {hint ? <p className="metric-card__hint">{hint}</p> : null}
          {footer ? <div className="metric-card__footer">{footer}</div> : null}
        </>
      )}
    </article>
  )
}
