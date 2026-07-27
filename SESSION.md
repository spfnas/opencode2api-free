# opencode-gate session state

## Current Status (last updated: 2026-07-23 11:55 CST)

### Running
- Gateway container `opencode-gate` on port 13339, working
- 27273 candidates (4 sources + proxy-pool + FreeSub subscription)
- FreeSub subscription: 129 SOCKS5 nodes added (dedup'd)
- Subscription auto-refresh every 8h
- WARP probe throttled (backoff: 60s → 120s → ... → 1h max)

### WARP — Blocked
- All WARP protocols blocked by GFW from this network:
  - WireGuard UDP 2408 — no handshake
  - MASQUE/QUIC 443/500/8443 — timeouts
  - H2/TCP 443 — TLS handshake EOF
- Registration not rate-limited anymore (wgcf works), but tunnel can't establish
- `caomingjun/warp` container tested — stays unhealthy

### Subscription
- `CLASH_SUBSCRIBE_URLS` supports comma-separated URLs (backward compat with `CLASH_SUBSCRIBE_URL`)
- Default: `https://raw.githubusercontent.com/ovmvo/FreeSub/refs/heads/main/sub/permanent/mihomo.yaml`
- Runtime management via API:
  - `GET /api/subscriptions` — list URLs
  - `POST /api/subscriptions {"action":"set","urls":[...]}` — replace URLs
  - `POST /api/subscriptions {"action":"reset"}` — revert to default
  - `POST /api/subscriptions {"action":"refresh"}` — force re-fetch
- Parses mihomo YAML, extracts SOCKS5/HTTP type proxies

### Proxy Sources
| Source | Type | Size | Status |
|--------|------|------|--------|
| speedx-socks5 | Text SOCKS5 list | ~1954 | Some usable |
| speedx-http | Text HTTP list | ~2520 | Some usable |
| amux | JSON API | ~60-180 | Some usable |
| hproxy | Text | ~24067 | Many dead |
| proxy-pool | External API | ~97 | Preferentially used |
| FreeSub subscription | YAML | ~129 SOCKS5 | Parsed OK |

### Env Vars (docker-compose.yml)
- `PORT=13339`
- `WARP_MODE=off`
- `CLASH_SUBSCRIBE_URLS=https://raw.githubusercontent.com/ovmvo/FreeSub/refs/heads/main/sub/permanent/mihomo.yaml`
- `DATA_DIR=/app/data`
- `API_KEY=admin123`
- `PROXY_POOL_URL=http://host.docker.internal:13340/proxies?format=text`

### Changes in gate.ts (this session)
- WARP probe: exponential backoff on consecutive failures (max 1h), reset on manual enable
- `refreshCandidates()`: uses `probeWarp(1)` instead of 3 retries
- `CLASH_SUBSCRIBE_URL` → `CLASH_SUBSCRIBE_URLS` (comma-separated array)
- Added `/api/subscriptions` GET/POST endpoint for runtime management
- Subscription parsed as source type, dedup'd on address

### Key commands
- `docker logs --tail 50 opencode-gate` — view recent requests
- `docker compose -f docker-compose.yml up -d` — rebuild from host gate.ts
- `docker build -t opencode-gate . && docker compose up -d` — rebuild image + deploy
- `curl -X POST http://localhost:13339/api/subscriptions -H 'Content-Type: application/json' -d '{"action":"refresh"}'` — force subscription refresh
- `curl http://localhost:13339/api/status` — full status
