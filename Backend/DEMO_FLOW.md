# Guest Demo API Flow & Architecture

Guests receive a daily quota of 6 free requests across all demo services (TTFB, Lighthouse, DNS, Redirect, WHOIS). Signed-in users bypass these limits and retain unlimited access and full history APIs.

---

## Complete Demo Flow

### 1. Initialize Demo Session (Socket-First)
Before triggering any analysis or connecting Socket.IO:
- Call `POST /demo/session` with `credentials: "include"`.
- Response: `200 OK`
  ```json
  {
    "success": true,
    "guestId": "a1b2c3d4e5f67890123456789abcdef0",
    "roomId": "guest:a1b2c3d4e5f67890123456789abcdef0"
  }
  ```
- This sets the signed, HttpOnly `gid` cookie in the browser.

### 2. Connect Socket.IO
- Connect with `withCredentials: true`.
- The socket automatically reads the signed `gid` cookie and joins room `guest:<guestId>`.
- Authenticated users automatically join room `user:<userId>`.

### 3. Submit Demo Analysis Request
Submit a request with `credentials: "include"`:
- **TTFB**: `POST /ttfb/find` (body: `{ url, region }`) or `POST /ttfb/findAll`
- **Lighthouse**: `POST /lighthouse/report` (body: `{ url, strategy? }`)
- **DNS Record**: `POST /dns/lookup` (body: `{ url }`)
- **Redirect Check**: `POST /redirect/check` (body: `{ url }`)
- **WHOIS Lookup**: `POST /whois/lookup` (body: `{ url }`)

On success, the API returns `202 Accepted`:
```json
{
  "success": true,
  "jobId": "65b...",
  "roomId": "guest:a1b2...",
  "guest": true,
  "remaining": 5,
  "totalLimit": 6
}
```

### 4. Receive Real-Time Results via Socket.IO
Each service emits both standardized events (`<service>:result`) and legacy events:

| Service | Standard Event | Legacy Event(s) |
|---|---|---|
| TTFB | `ttfb:result` | `ttfbCompleted` |
| Lighthouse | `lighthouse:result` | `lighthouseCompleted`, `Lighthouse-completed` / `Lighthouse-failed` |
| DNS Record | `dns:result` | `dnsRecordCompleted` / `dnsRecordFailed`, `dnsRecordCheck-completed` |
| Redirect | `redirect:result` | `redirectCheckCompleted` / `redirectCheckFailed`, `redirect-completed` |
| WHOIS | `whois:result` | `whoisLookupCompleted` / `whoisLookupFailed`, `whoisLookup-completed` |
| Uptime | `uptime:result` | `uptimeCompleted`, `uptimeMonitor-failed` |

### 5. Result Recovery & Failsafe Delivery (100% Delivery Guarantee)
Even if network interrupts the socket:
1. **Socket Catchup**:
   On socket reconnect or connection, emit:
   ```javascript
   socket.emit("catchup", {
     jobs: [{ service: "ttfb", id: jobId }]
   });
   ```
   The server checks the job status in MongoDB and replays the completed result directly to the socket.

2. **HTTP Polling Fallback**:
   If the socket event hasn't arrived within a timeout (e.g. 15-30s), query the status endpoint with `credentials: "include"`:
   - Specific route: `GET /<service>/status/:id` (e.g. `GET /ttfb/status/65b...`)
   - Unified route: `GET /demo/status/:service/:id` (e.g. `GET /demo/status/dns/65b...`)
   - Or `GET /<service>/result/:id`

3. **Infrastructure Health**:
   - `GET /demo/health` returns MongoDB, Redis, and Socket connection stats.

---

## Rate Limiting & Quota Management

- Enforced atomically via Redis Lua script with seed recovery from MongoDB.
- Quota rollback is surgical: uses unique `reservationId` to ensure concurrent requests never pop the wrong history audit item.
- Exceeded quota returns `429 Too Many Requests` with `code: GUEST_DEMO_LIMIT_EXCEEDED` and `nextAvailableAt`.
