import axios from 'axios'

/**
 * REST client for the backend in `../Backend`.
 *
 * Routes (no `/api` prefix):
 *   POST /ttfb/find            { url, region }        -> 202 { success, message, jobId, region, roomId }
 *   POST /ttfb/findAll         { url, region: 'All' } -> 202 { success, message, jobId[], region, roomId }
 *   POST /lighthouse/report    { url }                -> 200 { message, data, job }
 *   GET  /uptime/monitors                             -> 200 { monitors: [] }
 *   POST /uptime/create        { url, interval }      -> 201 { message, monitor }
 *   PUT  /uptime/update/:id    { url, interval, status }
 *   POST /uptime/delete/:id
 *   PATCH /uptime/pause/:id
 *   PATCH /uptime/resume/:id
 *
 * The slow work happens in Redis workers, so these calls only queue a job —
 * results themselves arrive over Socket.IO (see `./socket.js`).
 */

export const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:5000').replace(/\/+$/, '')

/** Regions the TTFB queues are split into, plus the "ask all three" value. */
export const REGIONS = ['india', 'europe', 'usa']
export const ALL_REGIONS = 'All'

/** Regions have to be threaded through the controllers' lookups. */
export const REGION_LABELS = {
  india: 'India',
  europe: 'Europe',
  usa: 'USA',
}

/** Intervals accepted by the uptime controller. */
export const INTERVALS = ['1m', '5m', '10m', '30m', '1h']

export const http = axios.create({
  baseURL: API_URL.replace(/\/+$/, '') + '/',
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
})

http.interceptors.request.use((config) => {
  config.url = config.url?.replace(/^\/+/, '')
  return config
})

// Hand back `response.data` so call sites work with the payload directly.
http.interceptors.response.use((response) => response.data)

/* ------------------------------------------------------------------- errors */

/** Human-readable message for anything axios (or our own code) can throw. */
export function getErrorMessage(error) {
  if (!error) return 'Something went wrong.'
  if (axios.isCancel(error)) return 'That request was cancelled.'
  if (error.code === 'ECONNABORTED') return 'The server took too long to respond.'

  const response = error.response
  if (!response) {
    // Axios network failures carry a `request`; anything else was thrown locally.
    if (error.request) return `Cannot reach the API at ${API_URL}. Is the backend running?`
    return error instanceof Error && error.message ? error.message : 'Something went wrong.'
  }

  const data = response.data
  const message = data && typeof data === 'object' ? data.error || data.message : null
  if (typeof message === 'string' && message) return message
  return `Request failed with status ${response.status}.`
}

/**
 * The Lighthouse controller answers `200 { error }` when its own try/catch fires,
 * so a successful status does not always mean a successful job.
 */
export function assertOk(payload) {
  if (
    payload &&
    typeof payload === 'object' &&
    !Array.isArray(payload) &&
    payload.error &&
    !payload.success
  ) {
    throw new Error(
      typeof payload.error === 'string' ? payload.error : 'The server rejected that request.',
    )
  }
  return payload
}

/* ---------------------------------------------------------------- url utils */

/** The controllers run `new URL(url)`, so a bare host has to get a scheme. */
export function normalizeUrl(value) {
  const trimmed = String(value ?? '').trim()
  if (!trimmed) return ''
  return /^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

export function isValidUrl(value) {
  try {
    const { protocol, hostname } = new URL(normalizeUrl(value))
    if (protocol !== 'http:' && protocol !== 'https:') return false
    return hostname.includes('.') || hostname === 'localhost'
  } catch {
    return false
  }
}

/* --------------------------------------------------------------------- ttfb */

export const ttfbApi = {
  /**
   * Queues a measurement. `region` is one of `REGIONS`, or `'All'` to fan the
   * job out to every region queue (the `findAll` route).
   */
  measure: (url, region) =>
    region === ALL_REGIONS
      ? http.post('/ttfb/findAll', { url, region: ALL_REGIONS })
      : http.post('/ttfb/find', { url, region }),
}

/* --------------------------------------------------------------- lighthouse */

export const lighthouseApi = {
  /** Queues an audit and returns `{ data: { _id, url }, job }` — `_id` is the room. */
  report: (url) => http.post('/lighthouse/report', { url }),
}

/* ------------------------------------------------------------------- uptime */

export const uptimeApi = {
  list: () => http.get('/uptime/monitors'),

  create: (url, interval) => http.post('/uptime/create', { url, interval }),

  /** Update requires all three fields — the controller validates each one. */
  update: (id, { url, interval, status }) =>
    http.put(`/uptime/update/${encodeURIComponent(id)}`, { url, interval, status }),

  remove: (id) => http.post(`/uptime/delete/${encodeURIComponent(id)}`),

  pause: (id) => http.patch(`/uptime/pause/${encodeURIComponent(id)}`),

  resume: (id) => http.patch(`/uptime/resume/${encodeURIComponent(id)}`),
}
