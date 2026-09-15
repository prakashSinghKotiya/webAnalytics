import { useId } from 'react'

const RADIUS = 46
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

const scoreTone = (score) => {
  if (score >= 90) return 'good'
  if (score >= 50) return 'moderate'
  return 'poor'
}

/**
 * Circular 0–100 gauge, used for the four Lighthouse categories.
 */
export default function ScoreCard({ label, score, hint, loading = false, className = '' }) {
  const gradientId = useId()
  const numeric = Number(score)
  const hasScore = Number.isFinite(numeric)
  const clamped = hasScore ? Math.min(100, Math.max(0, numeric)) : 0
  const tone = hasScore ? scoreTone(clamped) : 'neutral'
  const offset = CIRCUMFERENCE - (clamped / 100) * CIRCUMFERENCE

  const classes = ['score-card', `score-card--${tone}`, className].filter(Boolean).join(' ')

  return (
    <article className={classes}>
      <div className="score-card__gauge">
        {loading ? (
          <div className="skeleton skeleton--circle" />
        ) : (
          <svg viewBox="0 0 110 110" role="img" aria-label={`${label}: ${hasScore ? clamped : 'no data'}`}>
            <defs>
              <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="var(--score-from)" />
                <stop offset="100%" stopColor="var(--score-to)" />
              </linearGradient>
            </defs>
            <circle className="score-card__track" cx="55" cy="55" r={RADIUS} />
            <circle
              className="score-card__value-ring"
              cx="55"
              cy="55"
              r={RADIUS}
              stroke={`url(#${gradientId})`}
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={offset}
            />
          </svg>
        )}
        {!loading ? (
          <span className="score-card__number">{hasScore ? Math.round(clamped) : '—'}</span>
        ) : null}
      </div>

      <div className="score-card__meta">
        <h3 className="score-card__label">{label}</h3>
        <p className="score-card__hint">{hint ?? (hasScore ? `${toneLabel(tone)}` : 'Run an analysis')}</p>
      </div>
    </article>
  )
}

function toneLabel(tone) {
  if (tone === 'good') return 'Good'
  if (tone === 'moderate') return 'Needs improvement'
  return 'Poor'
}
