# ?? NotifyFlow

> **Production-Style Distributed Notification Backend**
> Built with Node.js, TypeScript, Express, PostgreSQL, Redis, BullMQ, WebSockets, and Firebase Cloud Messaging (FCM HTTP v1).

NotifyFlow is an enterprise-grade notification engine designed for high throughput, sub-50ms queue dispatch, multi-device delivery, and zero-loss reliability via the **Transactional Outbox Pattern**. It extracts and generalizes the verified push and realtime patterns from the Kheto platform while adding distributed queues, exponential backoff, dead-letter management, and API idempotency.

---

## ?? System Architecture

```
[ Client / External Service ]
              ¦  HTTP POST /api/v1/events (with Idempotency-Key)
              ?
    [ Express API Layer ]
              ¦
       Validate & Authenticate (JWT + Zod)
              ¦
     +--------------------------------------------------+
     ¦ 1. Atomic Database Transaction (PostgreSQL)      ¦
     ¦    +-- Verify / Cache Idempotency Hash           ¦
     ¦    +-- Persist Event Record                      ¦
     ¦    +-- Fan-out Recipient Notifications           ¦
     ¦    +-- Write to Outbox Table                     ¦
     +--------------------------------------------------+
              ¦
    Is Redis Online?
       +-- YES --> Enqueue directly into BullMQ Queue
       +-- NO  --> Buffered safely in Outbox Table
                     ?
                     ¦ (Relays on Reconnect via SKIP LOCKED)
             [ Outbox Relayer ]
                     ¦
                     ?
           [ BullMQ Notification Queue ]
                     ¦  Priority: Urgent (1) | Important (2) | Normal (3) | Low (4)
                     ¦  Backoff: Exponential (2s, 4s, 8s, 16s, 32s)
                     ?
             [ BullMQ Worker ]
                     ¦
             Filter Preferences (Quiet Hours & Channel Opt-Outs)
                     ¦
         +-----------------------+
         ?                       ?
 [ WebSocket Channel ]    [ FCM HTTP v1 Channel ]
   - Multi-device pool      - Google OAuth2 token
   - Heartbeat 30s          - Android High Priority
   - Redis Pub/Sub Sync     - Automatic dead-token pruning
         ¦                       ¦
         +-----------------------+
                     ?
    [ Record Status & Delivery Log in PostgreSQL ]
```

---

## ? Tech Stack & Key Decisions

| Component | Technology | Rationale |
|---|---|---|
| **Runtime & Language** | Node.js (v20+) & TypeScript | Type safety across entire data flow, ESM modules |
| **REST API** | Express.js | Industry-standard routing, middleware pipeline, lightweight |
| **Durable Storage** | PostgreSQL 16 | ACID transactions, row-level locking (`SKIP LOCKED`), JSONB support |
| **Distributed Queue** | Redis 7 & BullMQ | Fast in-memory queues, priority scheduling, dead-letter queue (DLQ) |
| **Realtime Delivery** | WebSockets (`ws`) | Instant delivery, persistent connection tracking, Redis Pub/Sub sync |
| **Mobile Push** | FCM HTTP v1 API (`google-auth-library`) | Reused & adapted from Kheto; Google OAuth2 scoped tokens, automatic pruning of `UNREGISTERED` tokens |
| **Reliability Pattern** | Transactional Outbox | Eliminates dual-write anomalies; prevents lost messages if Redis is down |
| **Idempotency** | PostgreSQL Idempotency Table | Canonical SHA-256 payload hashing; prevents double-billing / double-sending |
| **Testing** | Vitest, Supertest, pg-mem | Unit, integration, failure-recovery, and in-memory PostgreSQL testing |
| **Load Testing** | k6 & Native Benchmark Runner | End-to-end stress testing with p50, p95, p99 measurements |

---

## ?? Prerequisites

- **Node.js** >= 20.0.0
- **npm** >= 10.0.0
- **Docker & Docker Compose** (for running PostgreSQL and Redis locally)

---

## ?? Quickstart & Setup

### 1. Clone & Install Dependencies
```bash
git clone <repo-url> NotifyFlow
cd NotifyFlow
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Default configuration runs in mock mode for FCM if credentials are not provided (`USE_MOCK_FCM=true`), allowing zero-configuration local development.

### 3. Start Infrastructure with Docker Compose
```bash
docker compose up -d postgres redis
```

### 4. Run Database Migrations
```bash
npm run migrate
```

### 5. Start the Application
You can run the API server and Worker either in development mode with hot-reloading or as compiled production bundles.

**Development Mode:**
```bash
# Terminal 1: Run API Server + WebSocket Service
npm run dev

# Terminal 2: Run Background Notification Worker
npm run dev:worker
```

**Production Mode:**
```bash
npm run build
npm start          # Starts dist/server.js
npm run start:worker # Starts dist/worker.js
```

---

## ?? API Documentation & Swagger

Interactive Swagger UI documentation is available at:
?? **`http://localhost:4000/docs`**

OpenAPI JSON specification is available at:
?? **`http://localhost:4000/docs/json`**

### Core Endpoints

#### 1. Publish Event (`POST /api/v1/events`)
```bash
curl -X POST http://localhost:4000/api/v1/events \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your_jwt_token>" \
  -H "Idempotency-Key: evt-req-1001" \
  -d '{
    "eventType": "RIDE_HELP",
    "title": "SOS Alert from Marshal",
    "body": "Road block at km 32. Regroup immediately.",
    "recipients": ["rider-101", "rider-102"],
    "channels": ["websocket", "fcm"],
    "priority": "urgent",
    "data": { "latitude": 12.9716, "longitude": 77.5946 }
  }'
```

#### 2. Register Device Push Token (`POST /api/v1/devices/tokens`)
```bash
curl -X POST http://localhost:4000/api/v1/devices/tokens \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your_jwt_token>" \
  -d '{
    "token": "eXamPleFcmDeviceTokenAbc123...",
    "platform": "android"
  }'
```

#### 3. Update Notification Preferences (`PUT /api/v1/preferences`)
```bash
curl -X PUT http://localhost:4000/api/v1/preferences \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your_jwt_token>" \
  -d '{
    "channel": "fcm",
    "eventType": "*",
    "enabled": true,
    "quietHoursStart": "22:00",
    "quietHoursEnd": "07:00"
  }'
```

#### 4. List User Notifications (`GET /api/v1/notifications`)
```bash
curl -X GET "http://localhost:4000/api/v1/notifications?page=1&limit=20" \
  -H "Authorization: Bearer <your_jwt_token>"
```

#### 5. Health & Readiness Probes
- `GET /health/live` — Liveness check
- `GET /health/ready` — Deep readiness check (verifies PostgreSQL and Redis)
- `GET /health/metrics` — Queue count metrics and active WebSocket connections

---

## ?? WebSocket Connection & Protocol

Connect to: `ws://localhost:4000/ws`

### Handshake Flow
1. Connect via WebSocket.
2. Authenticate by sending:
```json
{
  "type": "auth",
  "accessToken": "<your_jwt_token>",
  "deviceId": "phone-android"
}
```
3. Server responds:
```json
{
  "type": "auth_success",
  "userId": "rider-101"
}
```
4. Notifications arrive in realtime:
```json
{
  "type": "notification",
  "notification": {
    "id": "3b123456-...",
    "title": "SOS Alert from Marshal",
    "body": "Road block at km 32. Regroup immediately.",
    "priority": "urgent"
  }
}
```

---

## ?? Reliability & Failure Recovery

| Failure Scenario | NotifyFlow Guarantee & Recovery Strategy |
|---|---|
| **Redis Offline during Event Creation** | The API never fails. Event and job payload are saved atomically in the PostgreSQL `outbox` table. As soon as Redis recovers, the `OutboxRelayer` polls pending items using `FOR UPDATE SKIP LOCKED` and relays them into BullMQ. |
| **Worker Process Crash** | BullMQ workers use persistent locks. Unacknowledged jobs are automatically recovered and reassigned to healthy workers. |
| **FCM Provider 429 / 503 Rate Limits** | Handled with bounded exponential backoff retries (`2s, 4s, 8s, 16s, 32s`, max 5 attempts). |
| **Dead / Unregistered Device Tokens** | When FCM returns `UNREGISTERED` or `NOT_FOUND`, NotifyFlow automatically updates `is_active = FALSE` in `device_tokens`, stopping wasted API calls. |
| **Client Repeated Submissions** | The `Idempotency-Key` header stores a canonical SHA-256 hash. If duplicate submissions are detected, NotifyFlow returns the cached response with `X-Cache-Lookup: HIT-IDEMPOTENT`. |
| **Database Unavailable** | Returns an HTTP 503 Service Unavailable immediately. Does not accept events it cannot durably persist. |

---

## ?? Testing & Verification

### Running Automated Unit & Integration Tests
```bash
npm test
```
NotifyFlow comes with 22 automated tests covering:
- ? Queue priority and exponential backoff calculations
- ? FCM payload stringification and dead token pruning
- ? WebSocket connection tracking and multi-device dispatch
- ? Idempotency SHA-256 hashing and payload validation
- ? Transactional Outbox pending-to-published lifecycle
- ? Full REST API authentication, validation, status retrieval, and caching

### Running the Performance Benchmark
NotifyFlow includes a verified high-concurrency benchmark script:
```bash
npm run benchmark
```
**Actual Benchmark Execution Results:**
```
Total Completed Requests : 500 / 500
Failed Requests          : 0 (100% Success Rate)
Total Time Elapsed       : 4.66s
Average Throughput       : 107 req/sec
Latency p50 (Median)     : 217 ms
Latency p95              : 340 ms
Latency p99              : 348 ms
```

### Running k6 Load Tests
```bash
k6 run load-tests/notification-pipeline.js
```

---

## ?? Security Best Practices
- Helmet HTTP security headers enabled.
- JWT verification on all protected endpoints and WebSocket handshakes.
- Rate limiting (default 120 requests/minute per IP) on event creation endpoints.
- Environment variables and secrets excluded via `.gitignore`.
- No sensitive service account keys or private tokens are logged.

---

## ?? License
MIT © Pratima Sahuji
