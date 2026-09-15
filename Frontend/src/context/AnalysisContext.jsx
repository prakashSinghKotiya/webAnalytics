import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  ALL_REGIONS,
  INTERVALS,
  REGIONS,
  assertOk,
  getErrorMessage,
  isValidUrl,
  lighthouseApi,
  normalizeUrl,
  ttfbApi,
  uptimeApi,
} from '../services/api'
import { EMIT, ON, getSocket, joinRoom, keepRooms, leaveRoom } from '../services/socket'

/**
 * Single source of truth for the three independent things the backend can do:
 * a TTFB measurement, a Lighthouse audit and uptime monitors.
 *
 * Every job is queued over REST and its result is delivered over Socket.IO, so
 * each slice keeps the id it is waiting for and ignores events for anything
 * else. Runs are also given a deadline, because a queue that never completes
 * (worker down, Redis down) would otherwise leave the UI spinning forever.
 */

const TTFB_TIMEOUT = 60_000
const LIGHTHOUSE_TIMEOUT = 180_000

/** Rooms are tracked under these local keys; the id part keeps runs apart. */
const TTFB_ROOM = (roomId) => `ttfb:${roomId}`
const LIGHTHOUSE_ROOM = (roomId) => `lighthouse:${roomId}`
const UPTIME_ROOM = (monitorId) => `uptime:${monitorId}`

const initialTtfb = {
  status: 'idle', // idle | running | done | error
  url: null,
  region: ALL_REGIONS,
  roomId: null,
  jobId: null,
  pending: [], // regions still waiting for a result
  results: {}, // region -> { ttfb, statusCode, success, error? }
  error: null,
  startedAt: null,
  finishedAt: null,
}

const initialLighthouse = {
  status: 'idle',
  url: null,
  roomId: null,
  jobId: null,
  report: null, // { requestedUrl, fetchTime, scores, metrics }
  error: null,
  startedAt: null,
  finishedAt: null,
}

const initialUptime = {
  status: 'loading', // loading | ready | error
  monitors: [], // as stored by Mongo: { _id, url, interval, status, createdAt, updatedAt }
  live: {}, // monitorId -> last result from the queue
  error: null,
  actionError: null,
  busyId: null,
}

const AnalysisContext = createContext(null)

export function AnalysisProvider({ children }) {
  const [target, setTarget] = useState('')
  const [region, setRegion] = useState(ALL_REGIONS)
  const [connection, setConnection] = useState('connecting') // connecting | online | offline

  const [ttfb, setTtfb] = useState(initialTtfb)
  const [lighthouse, setLighthouse] = useState(initialLighthouse)
  const [uptime, setUptime] = useState(initialUptime)

  /* --------------------------------------------------------- realtime wiring */

  useEffect(() => {
    const socket = getSocket()

    const onConnect = () => setConnection('online')
    const onDisconnect = () => setConnection('offline')
    const onConnectError = () => setConnection('offline')

    const onTtfbCompleted = ({ roomId, jobId, result = {}, region: eventRegion } = {}) => {
      const key = result.region ?? eventRegion
      if (!key) return

      setTtfb((prev) => {
        if (!prev.roomId || prev.roomId !== roomId) return prev // an older run
        if (prev.results[key]) return prev // duplicate event
        const results = { ...prev.results, [key]: { ...result, region: key, jobId } }
        const pending = prev.pending.filter((item) => item !== key)
        return {
          ...prev,
          results,
          pending,
          status: pending.length ? 'running' : 'done',
          finishedAt: pending.length ? prev.finishedAt : Date.now(),
        }
      })
    }

    const onLighthouseCompleted = ({ result = {} } = {}) => {
      const roomId = result.roomId ? String(result.roomId) : null
      setLighthouse((prev) => {
        if (!roomId || prev.roomId !== roomId) return prev
        return { ...prev, status: 'done', report: result, error: null, finishedAt: Date.now() }
      })
    }

    const onLighthouseFailed = ({ jobId, error } = {}) => {
      setLighthouse((prev) => {
        if (!prev.jobId || String(prev.jobId) !== String(jobId)) return prev
        return {
          ...prev,
          status: 'error',
          error: error || 'Lighthouse could not audit that URL.',
          finishedAt: Date.now(),
        }
      })
    }

    // Uptime results are keyed by monitor, so an event is always safe to apply.
    const onUptimeCompleted = ({ result = {} } = {}) => {
      const monitorId = result.monitorId ? String(result.monitorId) : null
      if (!monitorId) return
      setUptime((prev) => ({ ...prev, live: { ...prev.live, [monitorId]: result } }))
    }

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('connect_error', onConnectError)
    socket.on(ON.TTFB_COMPLETED, onTtfbCompleted)
    socket.on(ON.LIGHTHOUSE_COMPLETED, onLighthouseCompleted)
    socket.on(ON.LIGHTHOUSE_FAILED, onLighthouseFailed)
    socket.on(ON.UPTIME_COMPLETED, onUptimeCompleted)

    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('connect_error', onConnectError)
      socket.off(ON.TTFB_COMPLETED, onTtfbCompleted)
      socket.off(ON.LIGHTHOUSE_COMPLETED, onLighthouseCompleted)
      socket.off(ON.LIGHTHOUSE_FAILED, onLighthouseFailed)
      socket.off(ON.UPTIME_COMPLETED, onUptimeCompleted)
    }
  }, [])

  /* --------------------------------------------------------------- deadlines */

  useEffect(() => {
    if (ttfb.status !== 'running') return undefined
    const timer = setTimeout(() => {
      setTtfb((prev) =>
        prev.status === 'running'
          ? {
              ...prev,
              status: 'error',
              error: 'Timed out waiting for the TTFB result. Is the Redis worker running?',
            }
          : prev,
      )
    }, TTFB_TIMEOUT)
    return () => clearTimeout(timer)
  }, [ttfb.status, ttfb.startedAt])

  useEffect(() => {
    if (lighthouse.status !== 'running') return undefined
    const timer = setTimeout(() => {
      setLighthouse((prev) =>
        prev.status === 'running'
          ? {
              ...prev,
              status: 'error',
              error: 'Timed out waiting for the Lighthouse report. The audit can take a couple of minutes.',
            }
          : prev,
      )
    }, LIGHTHOUSE_TIMEOUT)
    return () => clearTimeout(timer)
  }, [lighthouse.status, lighthouse.startedAt])

  /* ------------------------------------------------------------ room cleanup */

  const ttfbRoomRef = useRef(null)
  useEffect(() => {
    const previous = ttfbRoomRef.current
    ttfbRoomRef.current = ttfb.roomId
    if (previous && previous !== ttfb.roomId) leaveRoom(TTFB_ROOM(previous))
  }, [ttfb.roomId])

  const lighthouseRoomRef = useRef(null)
  useEffect(() => {
    const previous = lighthouseRoomRef.current
    lighthouseRoomRef.current = lighthouse.roomId
    if (previous && previous !== lighthouse.roomId) leaveRoom(LIGHTHOUSE_ROOM(previous))
  }, [lighthouse.roomId])

  // Subscribe to a room per monitor so scheduled checks stream in as they run.
  useEffect(() => {
    const keys = new Set()
    uptime.monitors.forEach((monitor) => {
      const monitorId = String(monitor._id)
      const key = UPTIME_ROOM(monitorId)
      keys.add(key)
      joinRoom(EMIT.UPTIME_JOB, { monitorId }, key)
    })
    keepRooms('uptime:', keys)
  }, [uptime.monitors])

  /* -------------------------------------------------------------------- ttfb */

  const runTtfb = useCallback(
    async (rawUrl = target, wanted = region) => {
      const url = normalizeUrl(rawUrl)
      if (!isValidUrl(url)) {
        setTtfb((prev) => ({
          ...prev,
          status: 'error',
          error: 'Enter a valid URL, for example https://example.com.',
        }))
        return
      }

      const expected = wanted === ALL_REGIONS ? [...REGIONS] : [wanted]
      setTtfb({
        ...initialTtfb,
        status: 'running',
        url,
        region: wanted,
        pending: expected,
        startedAt: Date.now(),
      })

      try {
        const ack = assertOk(await ttfbApi.measure(url, wanted))
        const roomId = ack?.roomId
        if (!roomId) throw new Error('The server did not return a room id for that job.')

        setTtfb((prev) => ({ ...prev, roomId, jobId: ack.jobId ?? null }))
        joinRoom(
          wanted === ALL_REGIONS ? EMIT.TTFB_JOB_ALL : EMIT.TTFB_JOB,
          { roomId },
          TTFB_ROOM(roomId),
        )
      } catch (error) {
        setTtfb((prev) => ({ ...prev, status: 'error', error: getErrorMessage(error) }))
      }
    },
    [region, target],
  )

  const resetTtfb = useCallback(() => setTtfb(initialTtfb), [])

  /* -------------------------------------------------------------- lighthouse */

  const runLighthouse = useCallback(
    async (rawUrl = target) => {
      const url = normalizeUrl(rawUrl)
      if (!isValidUrl(url)) {
        setLighthouse((prev) => ({
          ...prev,
          status: 'error',
          error: 'Enter a valid URL, for example https://example.com.',
        }))
        return
      }

      setLighthouse({ ...initialLighthouse, status: 'running', url, startedAt: Date.now() })

      try {
        const ack = assertOk(await lighthouseApi.report(url))
        const roomId = ack?.data?._id ? String(ack.data._id) : null
        if (!roomId) throw new Error('The server did not return a report id for that audit.')

        setLighthouse((prev) => ({ ...prev, roomId, jobId: ack?.job?.id ?? null }))
        joinRoom(EMIT.LIGHTHOUSE_JOB, { roomId }, LIGHTHOUSE_ROOM(roomId))
      } catch (error) {
        setLighthouse((prev) => ({ ...prev, status: 'error', error: getErrorMessage(error) }))
      }
    },
    [target],
  )

  const resetLighthouse = useCallback(() => setLighthouse(initialLighthouse), [])

  /* ------------------------------------------------------------------ uptime */

  const loadMonitors = useCallback(async () => {
    try {
      const ack = await uptimeApi.list()
      setUptime((prev) => ({
        ...prev,
        status: 'ready',
        monitors: Array.isArray(ack?.monitors) ? ack.monitors : [],
        error: null,
      }))
    } catch (error) {
      setUptime((prev) => ({ ...prev, status: 'error', error: getErrorMessage(error) }))
    }
  }, [])

  useEffect(() => {
    loadMonitors()
  }, [loadMonitors])

  /**
   * Runs a monitor mutation and refreshes the list afterwards, because the
   * create route answers with `monitor.id` while the list returns Mongo `_id`s.
   */
  const runMonitorAction = useCallback(
    async (id, action) => {
      setUptime((prev) => ({ ...prev, busyId: id, actionError: null }))
      try {
        await action()
        await loadMonitors()
        return true
      } catch (error) {
        setUptime((prev) => ({ ...prev, actionError: getErrorMessage(error) }))
        return false
      } finally {
        setUptime((prev) => ({ ...prev, busyId: null }))
      }
    },
    [loadMonitors],
  )

  const createMonitor = useCallback(
    async (rawUrl, interval = INTERVALS[1]) => {
      const url = normalizeUrl(rawUrl)
      if (!isValidUrl(url)) {
        setUptime((prev) => ({
          ...prev,
          actionError: 'Enter a valid URL, for example https://example.com.',
        }))
        return false
      }
      return runMonitorAction('new', () => uptimeApi.create(url, interval))
    },
    [runMonitorAction],
  )

  const updateMonitor = useCallback(
    (id, body) => runMonitorAction(id, () => uptimeApi.update(id, body)),
    [runMonitorAction],
  )

  const pauseMonitor = useCallback(
    (id) => runMonitorAction(id, () => uptimeApi.pause(id)),
    [runMonitorAction],
  )

  const resumeMonitor = useCallback(
    (id) => runMonitorAction(id, () => uptimeApi.resume(id)),
    [runMonitorAction],
  )

  const removeMonitor = useCallback(
    (id) => runMonitorAction(id, () => uptimeApi.remove(id)),
    [runMonitorAction],
  )

  /* ------------------------------------------------------------------- value */

  const value = useMemo(
    () => ({
      connection,
      target,
      setTarget,
      region,
      setRegion,
      ttfb: { ...ttfb, run: runTtfb, reset: resetTtfb, isRunning: ttfb.status === 'running' },
      lighthouse: {
        ...lighthouse,
        run: runLighthouse,
        reset: resetLighthouse,
        isRunning: lighthouse.status === 'running',
      },
      uptime: {
        ...uptime,
        reload: loadMonitors,
        create: createMonitor,
        update: updateMonitor,
        pause: pauseMonitor,
        resume: resumeMonitor,
        remove: removeMonitor,
      },
    }),
    [
      connection,
      target,
      region,
      ttfb,
      lighthouse,
      uptime,
      runTtfb,
      resetTtfb,
      runLighthouse,
      resetLighthouse,
      loadMonitors,
      createMonitor,
      updateMonitor,
      pauseMonitor,
      resumeMonitor,
      removeMonitor,
    ],
  )

  return <AnalysisContext.Provider value={value}>{children}</AnalysisContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAnalysis() {
  const context = useContext(AnalysisContext)
  if (!context) throw new Error('useAnalysis must be used inside an <AnalysisProvider>')
  return context
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTtfb() {
  return useAnalysis().ttfb
}

// eslint-disable-next-line react-refresh/only-export-components
export function useLighthouse() {
  return useAnalysis().lighthouse
}

// eslint-disable-next-line react-refresh/only-export-components
export function useUptime() {
  return useAnalysis().uptime
}

export default AnalysisContext
