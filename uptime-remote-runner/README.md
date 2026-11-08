# Uptime Monitoring - Remote HTTP Runner (`uptime-remote-runner`)

A lightweight Express service that runs batched uptime health checks on a separate server (e.g. secondary shared hosting, VPS, or dedicated machine) and returns results to the primary application server.

---

## Security Architecture & Best Practices

### 1. Mandatory HTTPS
In production, this runner must **always** be served over HTTPS. Never expose plain HTTP over public networks, as the shared secret (`x-runner-secret`) and probe details could be intercepted in transit.

Use a reverse proxy with automated TLS (e.g., Caddy or Nginx with Let's Encrypt, or Cloudflare):

#### Example Caddy Configuration:
```caddy
runner.yourdomain.com {
    reverse_proxy localhost:5050
}
```

#### Example Nginx Configuration:
```nginx
server {
    listen 443 ssl http2;
    server_name runner.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/runner.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/runner.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:5050;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

---

### 2. IP Allowlisting (Defense in Depth)
To prevent unauthorized parties from probing websites through your runner, restrict access to `POST /run-checks` strictly to the public IP address(es) of your primary backend server:

#### Via Linux Firewall (`ufw`):
```bash
# Allow SSH
ufw allow 22/tcp

# Allow HTTPS only from the primary backend server IP (e.g. 203.0.113.50)
ufw allow from 203.0.113.50 to any port 443 proto tcp

# Enable firewall
ufw enable
```

#### Via Nginx:
```nginx
location /run-checks {
    allow 203.0.113.50;  # Primary backend server IP
    deny all;

    proxy_pass http://127.0.0.1:5050;
}
```

---

### 3. Shared Secret & Authentication
Requests must include the `x-runner-secret` header matching the environment variable `RUNNER_SECRET`.
Validation uses `crypto.timingSafeEqual` to safeguard against timing attacks.

Set your secret in the environment:
```env
RUNNER_SECRET="a_very_long_secure_random_string_min_32_chars"
PORT=5050
```

---

## API Specification

### 1. Health Probe: `GET /health`
Returns server status:
```json
{
  "status": "ok",
  "runner": "http"
}
```

### 2. Run Checks: `POST /run-checks`
**Headers:**
- `Content-Type: application/json`
- `x-runner-secret: <RUNNER_SECRET>`

**Request Body:**
```json
{
  "monitors": [
    { "id": 1, "url": "https://example.com" },
    { "id": 2, "url": "https://api.github.com" }
  ]
}
```

**Response Body:**
```json
{
  "results": [
    {
      "monitorId": 1,
      "result": {
        "status": "UP",
        "httpStatus": 200,
        "responseTime": 110,
        "timings": { "dns": 15, "tcp": 20, "tls": 30, "ttfb": 45 }
      }
    },
    {
      "monitorId": 2,
      "result": {
        "status": "UP",
        "httpStatus": 200,
        "responseTime": 92
      }
    }
  ]
}
```

---

## Running the Server

```bash
cd uptime-remote-runner
npm install
npm start
```

