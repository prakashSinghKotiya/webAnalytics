# Guest demo API flow

Guests receive one TTFB run and one Lighthouse run per UTC day. Signed-in users
are not subject to this limit and retain their existing history APIs.

1. Before connecting Socket.IO, call `POST /demo/session` with credentials
   enabled. It sets a signed, HTTP-only `gid` cookie and returns `204`.
2. Open Socket.IO with `withCredentials: true`. A guest joins `guest:<gid>` on
   the server; a signed-in person joins `user:<userId>`.
3. Submit either `POST /ttfb/find` (`url`, `region`) or
   `POST /lighthouse/report` (`url`, optional `strategy`) with credentials.
4. On success, the API returns `202`, `jobId`, `roomId`, `guest: true`, and
   `remaining: 0`. Listen for `ttfbCompleted` or `lighthouseCompleted`.
5. A repeat guest request for that service returns `429` with
   `code: GUEST_DEMO_ALREADY_USED` and `nextAvailableAt`.

Guest results are deliberately socket-only. `/results` and `/result/:id`
remain authenticated, preventing an ID from becoming guest authorization.

## Deployment requirements

- Set a strong `COOKIE_SECRET` in every environment.
- Use HTTPS in production. Production guest cookies are `Secure` and
  `SameSite=None` for credentialed cross-origin clients.
- Set `CLIENT_ORIGIN` and `SOCKET_ORIGIN` to the exact frontend origin.
- Ensure MongoDB can build the unique `guestId + service + day` index.
- For public deployment, put the API behind network-level egress controls or a
  DNS-aware SSRF policy as additional defense against hostile hostnames.
