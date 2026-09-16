import { io } from 'socket.io-client'

const AUTH_TOKEN_KEY = 'auth_token'


export const SOCKET_URL = (
  import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000'
)

/** Event names shared with the backend. Keep in sync with the server emitter. */
export const SOCKET_EVENTS = {
  CONNECT: 'connect',
  DISCONNECT: 'disconnect',
  CONNECT_ERROR: 'connect_error',
  RECONNECT: 'reconnect',

  ANALYSIS_STARTED: 'analysis:started',
  ANALYSIS_PROGRESS: 'analysis:progress',
  ANALYSIS_COMPLETE: 'analysis:complete',
  ANALYSIS_ERROR: 'analysis:error',
  ANALYSIS_HISTORY: 'analysis:history',

  TTFB_UPDATE: 'ttfb:update',
  LIGHTHOUSE_UPDATE: 'lighthouse:update',
  UPTIME_UPDATE: 'uptime:update',

  JOIN_ROOM: 'analysis:join',
  LEAVE_ROOM: 'analysis:leave',
}

/** Events the context layer listens to on every connection. */
export const ANALYSIS_EVENTS = [
  SOCKET_EVENTS.ANALYSIS_STARTED,
  SOCKET_EVENTS.ANALYSIS_PROGRESS,
  SOCKET_EVENTS.ANALYSIS_COMPLETE,
  SOCKET_EVENTS.ANALYSIS_ERROR,
  SOCKET_EVENTS.ANALYSIS_HISTORY,
  SOCKET_EVENTS.TTFB_UPDATE,
  SOCKET_EVENTS.LIGHTHOUSE_UPDATE,
  SOCKET_EVENTS.UPTIME_UPDATE,
]

function readAuthToken() {
  try {
    return window.localStorage.getItem(AUTH_TOKEN_KEY)
  } catch {
    return null
  }
}

let socket = null

/**
 * Returns the shared socket, creating it on first use.
 * Pass `{ autoConnect: false }` to prepare it without opening a connection.
 */
export function getSocket({ autoConnect = false } = {}) {
  if (socket) return socket

  const token = readAuthToken()

  socket = io(SOCKET_URL, {
    autoConnect,
    transports: ['websocket', 'polling'],
    withCredentials: true,
    auth: token ? { token } : undefined,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 10_000,
    randomizationFactor: 0.5,
    timeout: 10_000,
  })

  return socket
}

/** Opens the connection (safe to call repeatedly). */
export function connectSocket({ token } = {}) {
  const instance = getSocket()
  if (token) instance.auth = { token }
  if (!instance.connected) instance.connect()
  return instance
}

/** Closes the connection and prevents automatic reconnection. */
export function disconnectSocket() {
  if (!socket) return
  socket.removeAllListeners()
  socket.disconnect()
  socket = null
}

export function isSocketConnected() {
  return Boolean(socket?.connected)
}

/**
 * Subscribes to a map of `{ event: handler }` and returns a single cleanup
 * function, which makes it a drop-in return value for a `useEffect`.
 *
 *   useEffect(() => subscribeToEvents({ 'analysis:progress': onProgress }), [])
 */
export function subscribeToEvents(handlers, target = getSocket()) {
  const entries = Object.entries(handlers).filter(([, handler]) => typeof handler === 'function')
  entries.forEach(([event, handler]) => target.on(event, handler))

  return () => {
    entries.forEach(([event, handler]) => target.off(event, handler))
  }
}

/** Fire-and-forget emit that no-ops when the socket is offline. */
export function emitSocketEvent(event, payload) {
  const instance = getSocket()
  if (!instance.connected) return false
  instance.emit(event, payload)
  return true
}

/** Emit and wait for the server acknowledgement (with a timeout). */
export function emitWithAck(event, payload, { timeout = 10_000 } = {}) {
  const instance = getSocket()

  if (!instance.connected) {
    return Promise.reject(new Error(`Socket is not connected, cannot emit "${event}"`))
  }

  return new Promise((resolve, reject) => {
    instance.timeout(timeout).emit(event, payload, (err, response) => {
      if (err) reject(new Error(`"${event}" timed out after ${timeout}ms`))
      else resolve(response)
    })
  })
}

/** Joins a per-analysis room so progress events are scoped to one run. */
export function watchAnalysis(analysisId) {
  return emitWithAck(SOCKET_EVENTS.JOIN_ROOM, { analysisId }, { timeout: 5_000 }).catch(
    () => null,
  )
}

/** Leaves the room created by `watchAnalysis`. */
export function unwatchAnalysis(analysisId) {
  if (!analysisId) return
  emitSocketEvent(SOCKET_EVENTS.LEAVE_ROOM, { analysisId })
}

/** Event names emitted FROM the client TO the server. */
export const EMIT = {
  TTFB_JOB: 'ttfb-job',
  TTFB_JOB_ALL: 'ttfb-job-global',
  LIGHTHOUSE_JOB: 'Lighthouse-job',
  UPTIME_JOB: 'uptime-job',
}

/** Event names emitted FROM the server TO the client. */
export const ON = {
  TTFB_COMPLETED: 'ttfbCompleted',
  LIGHTHOUSE_COMPLETED: 'Lighthouse-completed',
  LIGHTHOUSE_FAILED: 'Lighthouse-failed',
  UPTIME_COMPLETED: 'uptimeCompleted',
}

/** Rooms the client has joined, keyed by a local string key. */
const activeRooms = new Map()

/**
 * Joins a socket room if not already joined.
 * `event` is the emit name, `payload` is the data, `key` is a local dedup key.
 */
export function joinRoom(event, payload, key) {
  if (activeRooms.has(key)) return
  const instance = getSocket({ autoConnect: true })
  const doEmit = () => instance.emit(event, payload)
  if (instance.connected) {
    doEmit()
  } else {
    instance.once('connect', doEmit)
  }
  activeRooms.set(key, payload)
}

/** Leaves a room and removes it from the local tracking map. */
export function leaveRoom(key) {
  if (!activeRooms.has(key)) return
  activeRooms.delete(key)
}

/**
 * Removes all tracked rooms whose key starts with `prefix` EXCEPT those
 * present in `keepSet`. Used to clean up stale uptime rooms when the monitor
 * list changes.
 */
export function keepRooms(prefix, keepSet) {
  for (const key of activeRooms.keys()) {
    if (key.startsWith(prefix) && !keepSet.has(key)) {
      activeRooms.delete(key)
    }
  }
}

export default { getSocket, connectSocket, disconnectSocket, subscribeToEvents }
