
## 🗺️ Complete End-to-End Visual Blueprint

Here is the exact visual map of how every request travels through the system from the moment the user clicks **"Analyze"** to the moment the result pops up on their screen:

```text
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                                 📱 CLIENT LAYER (NETLIFY)                                               │
│                                                                                                                         │
│  [ Web Browser / Mobile / iPhone ]                                                                                      │
│   │                                                                                                                     │
│   ├─► 1. Connects Real-Time Socket ──► [ Socket.IO Handshake (auth: { token, guestId }) ]                              │
│   │                                                                                                                     │
│   └─► 2. Sends HTTP Analysis Request ─► POST /<service>/lookup (Headers: Authorization / x-guest-id)                    │
└───────────────────────────────────────────────┬─────────────────────────────────────────────────▲───────────────────────┘
                                                │                                                 │
                                                ▼                                                 │
┌───────────────────────────────────────────────────────────────────────────────────────────────┐ │
│                                  🚪 EXPRESS API GATEWAY (server.js)                           │ │
│                                                                                               │ │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────┐  │ │
│  │ 1. CORS & Headers Filter (Allows Authorization, x-guest-id, credentials)                │  │ │
│  └────────────────────────────────────────┬────────────────────────────────────────────────┘  │ │
│                                           ▼                                                   │ │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────┐  │ │
│  │ 2. Dual-Auth Actor Resolution (guestDemo.Mw / checkAuth)                                │  │ │
│  │    ├─► Valid Token (Bearer / sid)? ──► Authenticated User (Room: "user:<userId>")       │  │ │
│  │    └─► Valid Guest ID (header / gid)? ─► Guest Demo Visitor  (Room: "guest:<guestId>")   │  │ │
│  └────────────────────────────────────────┬────────────────────────────────────────────────┘  │ │
│                                           ▼                                                   │ │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────┐  │ │
│  │ 3. Rate Limiting & Quota Management                                                     │  │ │
│  │    ├─► Guest? ──► Atomic Redis Lua Script (Enforces strict 6 tests/day quota)           │  │ │
│  │    └─► User?  ──► Unlimited access bypass                                               │  │ │
│  └────────────────────────────────────────┬────────────────────────────────────────────────┘  │ │
│                                           ▼                                                   │ │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────┐  │ │
│  │ 4. Service Controller (e.g. dnsRecord.Controller.js)                                     │  │ │
│  │    ├─► Step A: Creates MongoDB Document (status: "queued")                              │  │ │
│  │    ├─► Step B: Enqueues Job in BullMQ with { jobId, roomId, targetUrl }                 │  │ │
│  │    └─► Step C: Returns Immediate HTTP 202 Accepted { jobId, roomId }                    │  │ │
│  └────────────────────┬────────────────────────────────────────────────────────────────────┘  │ │
└───────────────────────┼───────────────────────────────────────────────────────────────────────┘ │
                        │                                                                         │
                        ├──────────────────────────┐                                              │
                        ▼                          ▼                                              │
       ┌─────────────────────────────────┐   ┌────────────────────────────────┐                   │
       │    💾 MONGODB DATABASE          │   │      📦 REDIS QUEUE (BullMQ)   │                   │
       │  • Saves initial "queued" record│   │  • BullMQ Job Stream           │                   │
       │  • Stores persistent history    │   │  • Manages worker concurrency  │                   │
       └────────────────▲────────────────┘   └─────────────┬──────────────────┘                   │
                        │                                  │                                      │
                        │                                  ▼                                      │
                        │                    ┌────────────────────────────────┐                   │
                        │                    │   ⚙️ BACKGROUND WORKERS        │                   │
                        │                    │  • DNS Lookup Worker           │                   │
                        │                    │  • Lighthouse  │                   │
                        │                    │  • TTFB Latency Probes (Global)│                   │
                        │                    │  • Redirect Chain Tracer       │                   │
                        │                    │  • WHOIS / RDAP Lookup         │                   │
                        │                    │  • Uptime Periodic Monitor     │                   │
                        │                    └─────────────┬──────────────────┘                   │
                        │                                  │                                      │
                        │ 5. Writes Result                 │ 6. Emits Job "completed"             │
                        │    (status: "completed")         │    to Redis Stream                   │
                        │                                  ▼                                      │
                        │                    ┌────────────────────────────────┐                   │
                        │                    │   🔔 QUEUEEVENTS LISTENER      │                   │
                        │                    │  (e.g. dnsRecordCheckListener) │                   │
                        │                    └─────────────┬──────────────────┘                   │
                        │                                  │                                      │
                        │                                  │ 7. Triggers Handler with             │
                        │                                  │    { jobId, returnvalue, roomId }    │
                        │                                  ▼                                      │
                        │                    ┌────────────────────────────────┐                   │
                        │                    │   ⚡ SOCKET.IO DISPATCHER       │                   │
                        │                    │  • Looks up active sockets in: │                   │
                        │                    │    roomId ("guest:..."/"user:")│                   │
                        │                    │  • io.to(roomId).emit(...)     │───────────────────┘
                        │                    └────────────────────────────────┘ 8. Dispatches Real-Time Event
                        │                                                          (<service>:result)
                        │                                                          DIRECTLY TO YOUR SCREEN!
                        ▼
       ┌────────────────────────────────────────────────────────┐
       │             🛡️ AUTOMATIC FAILSAFE LAYER                │
       │  1. Socket Catchup: Replays DB result on reconnect.    │
       │  2. HTTP Polling: GET /demo/status/:service/:id if     │
       │     websockets are blocked by strict firewalls.        │
       └────────────────────────────────────────────────────────┘
```



## 📂 Project Structure Map

```
Backend/
├── src/
│   ├── config/              # Database & Redis connection pool
│   │   ├── db.mongoose.js   # MongoDB connection
│   │   └── redis.js         # Shared Redis client for queues & rate limiting
│   │
│   ├── Controllers/         # Express endpoint controllers
│   │   ├── AuthController.js
│   │   ├── User.Controller.js
│   │   ├── dnsRecord.Controller.js
│   │   ├── lighthouse.Controller.js
│   │   ├── ttfb.Controller.js
│   │   ├── redirectCheck.Controller.js
│   │   └── whoisLookup.Controller.js
│   │
│   ├── Middleware/          # Security, Auth, Rate Limiting
│   │   ├── authentication.Mw.js      # User auth (Bearer token & signed cookies)
│   │   ├── guestDemo.Mw.js           # Guest actor resolution (x-guest-id & gid)
│   │   ├── guestDemoUsage.Mw.js      # Atomic Redis Lua 6-request quota limiter
│   │   ├── guestDemoRateLimit.Mw.js  # DDoS burst protection
│   │   └── Socket.middleware.js      # Socket.IO handshake auth & room routing
│   │
│   ├── Models/              # Mongoose database models
│   │   ├── User.Model.js
│   │   ├── Session.Model.js
│   │   ├── GuestDemoUsage.Model.js
│   │   └── [Service].Model.js (Ttfb, Lighthouse, DnsRecord, etc.)
│   │
│   ├── queue/               # BullMQ queue instances & event listeners
│   │   ├── [Service].Queue.js
│   │   └── [Service].QeventListner.js
│   │
│   ├── socket/              # Real-time WebSocket handlers & dispatchers
│   │   ├── catchup.Service.js        # Reconnection replay engine
│   │   └── [Service]/                # Queue-to-Socket bridge handlers
│   │
│   ├── Workers/             # Dedicated background task processors
│   │   ├── worker.js                 # Unified worker runner
│   │   └── [Service].Worker.js
│   │
│   ├── server.js            # Express application, routes, and health checks
│   └── index.js             # HTTP server entrypoint & Socket.IO server
```

