# WebAudit — frontend

React (Vite) dashboard for the backend in `../Backend`. It measures **TTFB** per region,
runs **Lighthouse** audits and manages **uptime monitors**. Every job is queued over REST
(Redis/BullMQ) and its result is delivered over Socket.IO.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173 — the backend allows this origin by default
```

The backend must be running (`cd ../Backend && npm run dev`, Redis + MongoDB up), otherwise
the REST calls report "Cannot reach the API…" and the socket stays offline.

Config lives in `.env.local` (see `.env.example`):

| Variable          | Default                 | Notes                                       |
| ----------------- | ----------------------- | ------------------------------------------- |
| `VITE_API_URL`    | `http://localhost:5000` | REST base URL — the backend has no `/api` prefix |
| `VITE_SOCKET_URL` | `http://localhost:5000` | Socket.IO origin (same server)               |

## Structure

```
src/
├── components/   Navbar, Sidebar, UrlInput, RegionSelect, MetricCard, ScoreCard, Loading
├── pages/        Dashboard, TTFB, Lighthouse, Uptime, NotFound
├── services/     api.js (axios) + socket.js (Socket.IO)
├── context/      AnalysisContext.jsx — shared target + ttfb / lighthouse / uptime slices
└── utils/        format.js — number, time and tone helpers
```

`services/api.js` is a plain axios instance (`baseURL`, 30s timeout, `response.data`
unwrapped). `services/socket.js` holds one shared connection, the event name maps and a
room registry that re-joins rooms after a reconnect.

## API contract

Base URL `http://localhost:5000`, JSON bodies, **absolute URLs required** (`https://…`) —
the controllers call `new URL(url)`. The UI adds the scheme for you when you type a bare
host. Errors come back as `{ error: "…" }`.

| Method | Path                    | Body                          | Response                              |
| ------ | ----------------------- | ----------------------------- | ------------------------------------- |
| POST   | `/ttfb/find`            | `{ url, region }`             | `202 { success, message, jobId, region, roomId }` |
| POST   | `/ttfb/findAll`         | `{ url, region: "All" }`      | `202 { success, message, jobId: [{id, region}], region, roomId }` |
| POST   | `/lighthouse/report`    | `{ url }`                     | `200 { message, data, job }` — `data._id` is the room |
| GET    | `/uptime/monitors`      | —                             | `200 { monitors: [{ _id, url, interval, status, createdAt, updatedAt }] }` |
| POST   | `/uptime/create`        | `{ url, interval }`           | `201 { message, monitor: { id, url, interval, status } }` |
| PUT    | `/uptime/update/:id`    | `{ url, interval, status }`   | `200 { message, monitor }`            |
| POST   | `/uptime/delete/:id`    | —                             | `200 { message }`                     |
| PATCH  | `/uptime/pause/:id`     | —                             | `200 { message, monitor }`            |
| PATCH  | `/uptime/resume/:id`    | —                             | `200 { message, monitor }`            |

`region` is `india`, `europe` or `usa`; `interval` is `1m`, `5m`, `10m`, `30m` or `1h`;
monitor `status` is `active` or `paused`.

### Socket events

Client → server (each one joins the room it carries):

| Event               | Payload          | Used for                        |
| ------------------- | ---------------- | ------------------------------- |
| `ttfb-job`          | `{ roomId }`     | one region                      |
| `ttfb-job-global`   | `{ roomId }`     | all regions (`findAll`)         |
| `Lighthouse-job`    | `{ roomId }`     | one audit (`roomId` = report id)|
| `uptime-job`        | `{ monitorId }`  | one monitor                     |

Server → client:

| Event                  | Payload                                                              |
| ---------------------- | -------------------------------------------------------------------- |
| `ttfbCompleted`        | `{ jobId, roomId, region, result: { ttfb, statusCode, success, error? } }` |
| `Lighthouse-completed` | `{ jobId, result: { requestedUrl, fetchTime, scores, metrics, roomId } }` |
| `Lighthouse-failed`    | `{ jobId, error }`                                                   |
| `uptimeCompleted`      | `{ jobId, roomid, result: { monitorId, url, status, reason, httpStatus, TotalresponseTime, ttfb, DNSTime, dnsAddress, checkingFor, timestamp } }` |

## How the frontend handles it

- **`All` regions** posts to `/ttfb/findAll`, which fans out to all three queues under a
  single `roomId`. The page collects the three `ttfbCompleted` events and marks each region
  as it arrives.
- **Results are always scoped.** Each slice stores the room/job id it is waiting for and
  ignores events for anything else, so overlapping runs cannot mix.
- **Deadlines.** A queued job that never completes (worker or Redis down) would otherwise
  leave the UI spinning, so TTFB gives up after 60s and Lighthouse after 3 minutes.
- **Uptime is scheduler-driven.** There is no "check now" route: creating a monitor
  registers a repeatable BullMQ job, and results only arrive when a tick completes. Each
  monitor card shows `Waiting for a check` until the first result lands, then live values
  (status, HTTP code, total response, TTFB, DNS time, resolved address, reason).
- **Rooms survive reconnects.** The socket client remembers joined rooms and re-joins them
  on every `connect`, which the server needs because room membership lives on the socket.

## Checks

```bash
npm run lint     # eslint, including the react-hooks compiler rules
npm run build    # vite build
```
