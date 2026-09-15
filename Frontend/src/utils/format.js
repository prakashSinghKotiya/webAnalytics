/** Shared number/time formatting used by the pages. */

/** First value that parses to a finite number wins. */
export function num(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue
    const parsed = Number(value)
    if (!Number.isNaN(parsed)) return parsed
  }
  return null
}

export function formatNumber(value, digits = 0) {
  if (value === null || value === undefined) return '—'
  return Number(value).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

/** `850` -> `850 ms`, `1250` -> `1.25 s`. */
export function formatMs(value) {
  const parsed = num(value)
  if (parsed === null) return '—'
  return parsed >= 1000 ? `${(parsed / 1000).toFixed(2)} s` : `${Math.round(parsed)} ms`
}

export function formatTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatClock(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function shortUrl(value) {
  if (!value) return '—'
  return String(value).replace(/^https?:\/\//, '').replace(/\/$/, '')
}

/* -------------------------------------------------------------------- tones */

/** Google's TTFB guidance: good under 200 ms, poor above 500 ms. */
export function ttfbTone(ms) {
  const value = num(ms)
  if (value === null) return 'neutral'
  if (value <= 200) return 'good'
  if (value <= 500) return 'moderate'
  return 'poor'
}

/** Lighthouse category scores: 90+ good, 50–89 needs work. */
export function scoreTone(score) {
  const value = num(score)
  if (value === null) return 'neutral'
  if (value >= 90) return 'good'
  if (value >= 50) return 'moderate'
  return 'poor'
}

/** The uptime checker reports UP / DEGRADED / DOWN. */
export function checkTone(status) {
  switch (String(status ?? '').toUpperCase()) {
    case 'UP':
      return 'good'
    case 'DEGRADED':
      return 'moderate'
    case 'DOWN':
      return 'poor'
    default:
      return 'neutral'
  }
}

/* ---------------------------------------------------------------- intervals */

export const INTERVAL_LABELS = {
  '1m': 'every minute',
  '5m': 'every 5 minutes',
  '10m': 'every 10 minutes',
  '30m': 'every 30 minutes',
  '1h': 'every hour',
}

export const intervalLabel = (interval) => INTERVAL_LABELS[interval] ?? interval ?? '—'

/* ------------------------------------------------------------------ addresses */

/**
 * The uptime checker forwards Node's `lookup` result straight through, and that
 * lookup runs with `all: true` — so `dnsAddress` arrives as a list of
 * `{ address, family }` records, not a string. Normalise both shapes here so a
 * payload shape never reaches JSX as an object.
 */
function toAddressList(value) {
  if (!value) return []

  const entries = Array.isArray(value) ? value : [value]

  return entries
    .map((entry) => {
      if (typeof entry === 'string') return { address: entry }
      if (entry && typeof entry === 'object' && typeof entry.address === 'string') {
        return { address: entry.address, family: entry.family }
      }
      return null
    })
    .filter(Boolean)
}

/** Short label for the resolved addresses, e.g. `1.2.3.4, 5.6.7.8 +2`. */
export function formatAddress(value) {
  const addresses = toAddressList(value).map((entry) => entry.address)
  if (addresses.length === 0) return '—'
  if (addresses.length <= 2) return addresses.join(', ')
  return `${addresses.slice(0, 2).join(', ')} +${addresses.length - 2}`
}

/** All resolved addresses with their IP family, for a tooltip. */
export function addressTooltip(value) {
  const entries = toAddressList(value)
  if (entries.length === 0) return undefined
  return entries
    .map((entry) => (entry.family ? `${entry.address} (IPv${entry.family})` : entry.address))
    .join('\n')
}

/** Why a check came back down/degraded, in words. */
export const REASON_LABELS = {
  HTTP_OK: 'Response OK',
  HIGH_RESPONSE_TIME: 'Slow response',
  HTTP_ERROR: 'HTTP error',
  TIMEOUT: 'Timed out',
  INVALID_URL: 'Invalid URL',
  DNS_ERROR: 'DNS lookup failed',
  CONNECTION_REFUSED: 'Connection refused',
  CONNECTION_RESET: 'Connection reset',
  CONNECTION_TIMEOUT: 'Connection timed out',
  NETWORK_ERROR: 'Network error',
}

export const reasonLabel = (reason) =>
  typeof reason === 'string' ? (REASON_LABELS[reason] ?? reason) : '—'
