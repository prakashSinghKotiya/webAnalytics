import { io } from 'socket.io-client'

/**
 * Socket.IO client for the backend in `../Backend/src/socket`.
 *
 * A single connection is shared by the whole app. Rooms are created by the
 * server when we emit a "job" event, and results are broadcast back into that
 * room — there is no polling route for job results.
 */

export const SOCKET_URL = (
  import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000'
).replace(/\/+$/, '')

/** Client -> server. Each one joins this socket to the room it carries. */
export const EMIT = {
  TTFB_JOB: 'ttfb-job', // { roomId }        single region
  TTFB_JOB_ALL: 'ttfb-job-global', // { roomId }        all regions
  LIGHTHOUSE_JOB: 'Lighthouse-job', // { roomId }        roomId is the report _id
  UPTIME_JOB: 'uptime-job', // { monitorId }     server names the room itself
}

/** Server -> client. */
export const ON = {
  TTFB_COMPLETED: 'ttfbCompleted', // { jobId, roomId, result, region }
  LIGHTHOUSE_COMPLETED: 'Lighthouse-completed', // { jobId, result }
  LIGHTHOUSE_FAILED: 'Lighthouse-failed', // { jobId, error }
  UPTIME_COMPLETED: 'uptimeCompleted', // { jobId, roomid, result }
}

let socket = null

/** Rooms we have joined, so they can be re-joined after a reconnect. */
const rooms = new Map()

/** Returns the shared socket, creating the connection on first use. */
export function getSocket() {
  if (socket) return socket

  socket = io(SOCKET_URL, {
    transports: ['websocket', 'polling'],
    withCredentials: true,
  })

  // Room membership lives on the server's socket, so it is lost on reconnect.
  socket.on('connect', () => {
    rooms.forEach(({ event, payload }) => socket.emit(event, payload))
  })

  return socket
}

/**
 * Joins a room and remembers it for reconnects.
 *
 * `key` identifies the room locally: joining the same key twice is a no-op, so
 * it is safe to call from an effect that re-runs.
 */
export function joinRoom(event, payload, key) {
  const roomKey = key ?? `${event}:${payload?.roomId ?? payload?.monitorId}`
  if (rooms.has(roomKey)) return roomKey

  rooms.set(roomKey, { event, payload })
  getSocket().emit(event, payload)
  return roomKey
}

/**
 * Forgets a room. The server exposes no "leave" event, so this only stops us
 * re-joining it on reconnect — stale events are ignored by the consumers,
 * which match on the room/monitor id they are currently showing.
 */
export function leaveRoom(key) {
  rooms.delete(key)
}

/** Forgets every room whose key starts with `prefix`, except the ones in `keep`. */
export function keepRooms(prefix, keep) {
  rooms.forEach((_payload, key) => {
    if (key.startsWith(prefix) && !keep.has(key)) rooms.delete(key)
  })
}

