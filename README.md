# Outbox Labs — Full-Stack Email Job Scheduler

> **Hiring Assignment Submission**
> **Deadline:** October 25, 2026, 12:00 PM IST
> **Current Status:** Phase 5 Complete (Live BullMQ Dashboard + Google OAuth 2.0 + Slack OAuth + Distributed Rate Limiting + Elasticsearch Integration Operational)

---

## 1. Project Overview

The **Outbox Labs Email Job Scheduler** is a distributed background job scheduling and delivery platform designed for high throughput, idempotency, resilience, and fast full-text search.

### Core Tech Stack
- **Backend:** Node.js 24 + Express.js + TypeScript
- **Authentication:** Google OAuth 2.0 + OpenID Connect (`google-auth-library` + HttpOnly JWT Sessions)
- **Queue & Monitoring:** BullMQ + ioredis (Hosted Upstash Redis) + Bull Board (`@bull-board/api` & `@bull-board/express`)
- **Database:** MySQL 8 (mysql2 connection pool)
- **Search & Indexing:** Elasticsearch 8/9 (`@elastic/elasticsearch`)
- **Email Delivery:** Nodemailer + Ethereal SMTP
- **Alerts & Integrations:** Slack OAuth v2 (`incoming-webhook` + `chat:write`)
- **Validation & Environment:** Zod + dotenv
- **Frontend:** React 19 + TypeScript + Vite + Tailwind CSS v4
- **Core Principle:** Distributed queue-based worker model; **no cron jobs or cron libraries** are used. MySQL is the authoritative single source of truth.

---

## 2. Architecture & Data Flow

```
[ Client / REST API / Frontend ]
         │
         ▼  (1) Validate Request with Zod & Check Idempotency Key
[ Express API: POST /api/emails/schedule ]
         │
         ├──► (2) Persist Record with Status 'PENDING'
         │    [ MySQL Database: email_jobs ] (AUTHORITATIVE SOURCE OF TRUTH)
         │
         ├──► (2b) Non-Blocking Idempotent Index (Doc ID = record.id)
         │    [ Elasticsearch: email_jobs ] ── (Async / Non-blocking)
         │
         ▼  (3) Enqueue Delayed Job (delay = scheduled_at - now)
[ BullMQ Queue: email-jobs ]  ──► (Stored in Hosted Redis / Upstash)
         │
         ▼  (4) When delay expires, Job picked up by Worker
[ BullMQ Worker: emailWorker ]
         │
         ├──► (4a) Check DB Status (Skip if already SENT or CANCELLED)
         ├──► (4b) Evaluate Atomic Redis Hourly Rate Limiter (Lua Script)
         │         └─ If exceeded: Reschedule in MySQL & BullMQ, update Elasticsearch
         ├──► (4c) Enforce MIN_SEND_INTERVAL_MS Throttle
         ├──► (4d) Verify Ethereal SMTP Credentials
         ├──► (4e) Dispatch via Nodemailer SMTP (smtp.ethereal.email)
         │
         ▼  (5) On Outcome: Update MySQL ('SENT' or 'FAILED')
[ MySQL Database: email_jobs ]
         │
         ▼  (6) Asynchronously Synchronize Search Document
[ Elasticsearch: email_jobs ] (doc_as_upsert with sent_at, attempts, ethereal URLs)
```

---

## 3. Directory Structure

```text
Outbox/
├── .env.example                 # Root environment template (placeholders only)
├── .gitignore                   # Excludes dependencies, builds, logs, and secrets
├── package.json                 # Monorepo orchestration scripts
├── README.md                    # Project documentation & status
├── backend/                     # Express.js + TypeScript Service
│   ├── .env.example             # Backend environment template
│   ├── package.json             # Backend dependencies and scripts
│   ├── tsconfig.json            # Strict TypeScript configuration
│   └── src/
│       ├── __tests__/           # Automated test suites (35 tests across 7 suites)
│       │   ├── emailValidation.test.ts      # Unit tests for Zod schemas
│       │   ├── emailApi.test.ts             # API integration tests (Supertest)
│       │   ├── emailEndToEndWorker.test.ts  # End-to-end BullMQ -> Ethereal delivery
│       │   ├── emailRestartRecovery.test.ts # Queue persistence & restart recovery
│       │   ├── rateLimiter.test.ts          # Distributed sliding-window rate limiting
│       │   ├── elasticsearch.test.ts        # Indexing, lifecycle sync, search & resilience
│       │   └── googleAuth.test.ts           # Google OAuth 2.0 login, CSRF, sessions & data isolation
│       ├── config/
│       │   └── env.ts           # Zod schema validation & robust .env loader
│       ├── controllers/
│       │   ├── emailController.ts # Scheduling, listing, details & Elasticsearch search handlers
│       │   └── authController.ts  # Google OAuth initiation, callback, me, and logout handlers
│       ├── database/
│       │   ├── models/
│       │   │   └── emailJob.ts  # TypeScript interfaces & types (with user_id & user_email)
│       │   ├── repositories/
│       │   │   └── emailJobRepository.ts # MySQL CRUD, state transitions & user data isolation
│       │   ├── initSchema.ts    # Database schema migration runner
│       │   ├── mysql.ts         # Connection pool & health probe
│       │   └── schema.sql       # MySQL table definition with indexes & constraints
│       ├── middleware/
│       │   └── authMiddleware.ts # authenticateSession & requireAuth middlewares
│       ├── queue/
│       │   ├── emailQueue.ts    # BullMQ Queue & deterministic delayed job enqueue
│       │   └── redis.ts         # Hosted Redis config (TLS, retry policy, no-eval fallback)
│       ├── routes/
│       │   ├── emailRoutes.ts   # /api/emails endpoints (including /search)
│       │   ├── authRoutes.ts    # /api/auth endpoints (/google, /google/callback, /me, /logout)
│       │   ├── healthRoutes.ts  # /health and /health/live endpoints
│       │   └── index.ts         # Root API router
│       ├── scripts/
│       │   ├── createEtherealAccount.ts # Ethereal test credential generator
│       │   ├── verifyConnections.ts     # 5-way CLI connectivity verification
│       │   └── syncElasticsearch.ts     # Full MySQL -> Elasticsearch reconciliation tool
│       ├── services/
│       │   ├── authService.ts           # Google OAuth2Client, ID token verification & JWT sessions
│       │   ├── elasticsearchService.ts  # Elasticsearch client, explicit mapping & queries
│       │   ├── healthService.ts         # Aggregated system health reporter
│       │   ├── mailerService.ts         # Nodemailer Ethereal SMTP transport service
│       │   └── rateLimiterService.ts    # Atomic Redis sliding window rate limiter
│       ├── validation/
│       │   └── emailSchemas.ts  # Request validation schemas (Zod)
│       ├── worker/
│       │   └── emailWorker.ts   # BullMQ Worker with rate limiting, throttling & ES updates
│       ├── app.ts               # Express app instance, middlewares & error handling
│       └── server.ts            # Server bootstrap & graceful shutdown listeners
└── frontend/                    # React 19 + TypeScript + Vite + Tailwind CSS v4
    ├── .env.example             # Frontend environment template
    ├── index.html               # Entry HTML with Inter typography
    ├── package.json             # Frontend dependencies and scripts
    ├── vite.config.ts           # Vite config with Tailwind v4 & backend proxy
    └── src/
        ├── components/          # Reusable UI dashboard tabs & components
        │   ├── ScheduleEmailTab.tsx
        │   ├── ScheduledJobsTab.tsx
        │   ├── DeliveryHistoryTab.tsx
        │   └── SystemHealthTab.tsx
        ├── services/
        │   └── api.ts           # Typed Axios/Fetch API client with error handling
        ├── types/
        │   └── email.ts         # Email, search params & health response interfaces
        ├── App.tsx              # Tabbed dark-mode dashboard shell
        └── index.css            # Tailwind CSS v4 setup
        └── main.tsx             # React root mount point
```

---

## 4. Database Schema: `email_jobs`

The database schema is defined in [`backend/src/database/schema.sql`](file:///c:/Users/laksh/OneDrive/Desktop/Outbox/backend/src/database/schema.sql):

| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | `VARCHAR(36)` | Primary Key UUIDv4. |
| `recipient` | `VARCHAR(255)` | Destination email address (indexed). |
| `subject` | `VARCHAR(255)` | Subject line of the email. |
| `body` | `MEDIUMTEXT` | Plain text / HTML content. |
| `sender` | `VARCHAR(255)` | Sender email (default: `scheduler@outbox.labs`). |
| `scheduled_at` | `DATETIME(3)` | Target execution timestamp with millisecond precision (indexed with `status`). |
| `status` | `ENUM(...)` | `PENDING`, `PROCESSING`, `SENT`, `FAILED`, `CANCELLED`. |
| `idempotency_key`| `VARCHAR(255)`| Optional unique constraint preventing duplicate requests. |
| `attempts` | `INT UNSIGNED` | Execution attempt counter. |
| `max_attempts` | `INT UNSIGNED` | Configurable retry threshold (default: 3). |
| `last_attempt_at`| `DATETIME(3)`| Timestamp of most recent dispatch attempt. |
| `sent_at` | `DATETIME(3)` | Delivery timestamp on SMTP `250 OK`. |
| `failed_at` | `DATETIME(3)` | Timestamp when retries exhausted or fatal error occurred. |
| `error_message` | `TEXT` | Sanitized error log (passwords/secrets redacted). |
| `ethereal_message_id` | `VARCHAR(255)` | SMTP Message-ID returned by Ethereal. |
| `ethereal_preview_url` | `TEXT` | Public inspection URL on ethereal.email. |
| `created_at` | `DATETIME(3)` | Record creation timestamp (indexed). |
| `updated_at` | `DATETIME(3)` | Last record modification timestamp. |

---

## 5. API Endpoints

### 1. Schedule an Email
- **Endpoint:** `POST /api/emails/schedule`
- **Request Body:**
  ```json
  {
    "recipient": "interview@example.com",
    "subject": "Interview Scheduled",
    "body": "Your interview is scheduled for tomorrow at 10 AM IST.",
    "scheduledAt": "2026-10-25T10:00:00.000Z",
    "idempotencyKey": "unique-client-key-12345",
    "sender": "talent@outbox.labs"
  }
  ```
- **Response (201 Created):**
  ```json
  {
    "success": true,
    "message": "Email scheduled successfully",
    "jobId": "email-job-40489a26-b8b4-4e20-be16-ef63cb33a94f",
    "email": {
      "id": "40489a26-b8b4-4e20-be16-ef63cb33a94f",
      "recipient": "interview@example.com",
      "subject": "Interview Scheduled",
      "status": "PENDING",
      "scheduled_at": "2026-10-25T10:00:00.000Z"
    }
  }
  ```
- **Idempotent Re-submission (200 OK):**
  If the same `idempotencyKey` is submitted again, the API returns the existing record with `"idempotent": true` without inserting duplicates or creating additional BullMQ jobs.

### 2. List Scheduled Emails
- **Endpoint:** `GET /api/emails/scheduled?limit=50&offset=0`
- **Description:** Returns currently pending and processing emails sorted chronologically by `scheduled_at ASC`.

### 3. List Delivery History
- **Endpoint:** `GET /api/emails/history?limit=50&offset=0`
- **Description:** Returns delivered (`SENT`) and failed (`FAILED`) emails with message IDs and Ethereal preview URLs.

### 4. Query All Emails
- **Endpoint:** `GET /api/emails?status=SENT&recipient=candidate@example.com&limit=25`
- **Description:** Paginated query with optional status and recipient filters.

### 5. Get Email by ID
- **Endpoint:** `GET /api/emails/:id`
- **Description:** Returns full details, delivery status, timestamps, attempt count, and preview URL.

---

## 6. Distributed Scheduling & Resilience Design

### BullMQ Delayed Jobs (No Cron)
Jobs are enqueued using BullMQ's native delayed job functionality:
```ts
const delay = Math.max(0, new Date(record.scheduled_at).getTime() - Date.now());
await queue.add('send-email', jobData, { delay, jobId: `email-job-${record.id}` });
```
This avoids polling loops, tick intervals, and external cron schedulers.

### Deterministic Job IDs & Idempotency Safeguards
- **Deterministic Job ID:** Each job is assigned `jobId = email-job-${record.id}`. If BullMQ receives a duplicate enqueue request for the same database record, the duplicate job ID is naturally deduplicated by Redis.
- **Worker Pre-Check:** Before dispatching an email, the worker runs `EmailJobRepository.markProcessing(id)`. If the database status is already `SENT` or `CANCELLED`, the worker skips execution immediately.

### The Limits of Exactly-Once Delivery with SMTP
> [!IMPORTANT]
> **Why Guaranteed Exactly-Once Delivery is Physically Impossible with SMTP:**
> SMTP (Simple Mail Transfer Protocol, RFC 5321) is an inherently asynchronous transport protocol that does not support two-phase commit (2PC) or distributed consensus.

> When the worker issues `transporter.sendMail()`:
> 1. The worker transmits the payload to the SMTP server.
> 2. The SMTP server delivers the message and writes `250 OK`.
> 3. If a network partition, process crash, or database connection drop occurs **after** the SMTP server accepts the email but **before** the worker can update MySQL status to `SENT`:
>    - The worker's job will be marked as failed or timed out by BullMQ.
>    - BullMQ will retry the job upon backoff.
>    - The retried job will re-send the email to the recipient.

> Therefore, distributed email schedulers can guarantee **at-least-once delivery** with deduplication safeguards, but cannot guarantee exactly-once delivery across external SMTP boundaries. Our architecture mitigates duplicates up to the exact moment of SMTP transmission.

### Worker Concurrency & Local Throttling
- **Configurable Concurrency:** Configured via `WORKER_CONCURRENCY` (default: `5`).
- **Configurable Send Interval:** Configured via `MIN_SEND_INTERVAL_MS` (default: `200` ms). The worker pauses between dispatches to prevent flooding SMTP relays.
- *Note:* Distributed global hourly rate limiting across multiple worker clusters will be implemented in subsequent phases.

---

## 7. Setup & Run Instructions (PowerShell)

### Step 1: Install Dependencies
```powershell
npm run install:all
```

### Step 2: Configure Environment Variables
Ensure [`backend/.env`](file:///c:/Users/laksh/OneDrive/Desktop/Outbox/backend/.env) is configured:
```env
PORT=5000
NODE_ENV=development
CORS_ORIGIN=http://localhost:5173

# MySQL Configuration (Dedicated outbox_app Account)
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=outbox_app
DB_PASSWORD=your_outbox_app_password
DB_NAME=outbox_scheduler
DB_CONNECTION_LIMIT=10

# Redis / BullMQ Configuration (Hosted Redis instance)
REDIS_URL="rediss://default:your_redis_password@your-hosted-redis:6379"
REDIS_TLS=true
REDIS_DB=0

# Ethereal SMTP Email Configuration
SMTP_HOST=smtp.ethereal.email
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_ethereal_user@ethereal.email
SMTP_PASS=your_ethereal_password
DEFAULT_SENDER=scheduler@outbox.labs

# Worker Concurrency & Local Throttling
WORKER_CONCURRENCY=5
MIN_SEND_INTERVAL_MS=200

# Distributed Hourly Rate Limiting (Redis-backed atomic sliding window)
HOURLY_RATE_LIMIT=10
RATE_LIMIT_WINDOW_MS=3600000

# Elasticsearch Search Engine Configuration
# For local Docker: http://localhost:9200
# For Elastic Cloud or managed cluster: https://your-deployment.es.io:9243
ELASTICSEARCH_NODE=http://localhost:9200
ELASTICSEARCH_INDEX=email_jobs
# Optional credentials (leave blank for unauthenticated local instances):
ELASTICSEARCH_USERNAME=elastic
ELASTICSEARCH_PASSWORD=your_elastic_password
ELASTICSEARCH_API_KEY=
ELASTICSEARCH_REQUEST_TIMEOUT_MS=5000

# Google OAuth 2.0 & Session Configuration
# Obtain credentials from https://console.cloud.google.com/apis/credentials
# Authorized Redirect URI: http://localhost:5000/api/auth/google/callback
GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=http://localhost:5000/api/auth/google/callback
SESSION_SECRET=your_random_32_character_session_signing_secret
AUTH_ENFORCED=false
```

*(Tip: Run `npm run ethereal:create` to automatically generate and save Ethereal credentials).*

### Step 3: Run Database Migrations
```powershell
npm run db:migrate
```

### Step 4: Verify All Connections (MySQL, Redis, SMTP, Elasticsearch, Google OAuth)
```powershell
npm run verify:connections
```

### Step 5: (Optional) Start Local Elasticsearch with Docker
If running a local Elasticsearch node for full-text search:
```powershell
docker run -d --name outbox-elasticsearch `
  -p 9200:9200 -p 9300:9300 `
  -e "discovery.type=single-node" `
  -e "xpack.security.enabled=false" `
  docker.elastic.co/elasticsearch/elasticsearch:8.15.0
```

### Step 6: (Optional) Reconcile / Backfill MySQL Records to Elasticsearch
```powershell
npm run es:sync
```

### Step 7: Run Automated Tests
```powershell
npm test
```

### Step 8: Start Applications
**Terminal 1 — Backend & Worker:**
```powershell
npm run dev:backend
```

**Terminal 2 — Frontend Dashboard:**
```powershell
npm run dev:frontend
```

---

## 8. Distributed Hourly Rate Limiting Architecture

The scheduler enforces an atomic, distributed rate limit on a per-sender basis (`HOURLY_RATE_LIMIT`, default: 10 emails/hour) using hosted Redis without any in-memory state.

### How It Works:
1. **Atomic Sliding Window via Redis Lua Script:**
   - Every send attempt evaluates an atomic Lua script over a Redis Sorted Set (`ratelimit:sender:{sender}`).
   - Scores represent send timestamps in milliseconds.
   - Expired scores outside the sliding window (`now - RATE_LIMIT_WINDOW_MS`) are automatically purged with `ZREMRANGEBYSCORE`.
   - If count `< HOURLY_RATE_LIMIT`:
     - The token is added with `ZADD` and key TTL refreshed.
     - The worker proceeds to send the email.
   - If count `>= HOURLY_RATE_LIMIT`:
     - The script inspects the oldest timestamp in the window (`ZRANGE 0 0 WITHSCORES`) and calculates the exact `retryAfterMs` until a slot becomes eligible.
2. **Automatic Non-Destructive Rescheduling:**
   - Rate-limited emails are **never discarded** and **never burned as failed attempts**.
   - MySQL updates the record's `scheduled_at` to the future eligible time, resets `status` to `PENDING`, and reverts the `attempts` increment.
   - The worker moves the BullMQ job to delayed storage using `await job.moveToDelayed(nextEligibleTime, token)` and raises BullMQ's native `DelayedError`.
   - BullMQ cleanly transitions the job into the delayed set without incrementing failure attempts, freeing worker capacity immediately for other senders without tight loops.
3. **Refund on Downstream Infrastructure Failures:**
   - If Nodemailer encounters an SMTP network failure, `RateLimiterService.refund()` removes the consumed slot so the sender's quota is not penalized for infrastructure issues.
4. **Telemetry Endpoint:**
   - `GET /api/emails/rate-limit?sender=...` exposes current usage, limit, remaining quota, and millisecond countdown to reset.

---

## 9. Elasticsearch Integration & Full-Text Search Engine

The application integrates with Elasticsearch using the official `@elastic/elasticsearch` client to provide millisecond full-text search, filtering, and deterministic sorting across millions of email jobs.

### Authoritative Architecture & MySQL Single Source of Truth
- **MySQL is the single authoritative source of truth.** Elasticsearch is treated as a secondary search index.
- **Non-blocking asynchronous synchronization:** Elasticsearch indexing failures or cluster outages **never fail, abort, or roll back MySQL transactions**, and **never block SMTP email delivery**.
- **Deterministic Document IDs:** Document IDs in Elasticsearch match the MySQL UUID (`_id = record.id`). Indexing operations are fully idempotent upserts (`doc_as_upsert: true`).

### Explicit Index Schema Mapping
The index (`email_jobs`) is automatically initialized on startup with explicit typed mappings:

| Field | Type | Purpose / Capabilities |
| :--- | :--- | :--- |
| `id` | `keyword` | Exact document matching & tie-breaking |
| `recipient` | `text` + `keyword` | Full-text prefix/fuzzy search + exact filtering |
| `sender` | `text` + `keyword` | Full-text domain/name search + exact filtering |
| `subject` | `text` + `keyword` | Full-text relevance ranking + exact matching |
| `body` | `text` | Analyzed full-text message content search |
| `status` | `keyword` | Exact status filtering (`PENDING`, `PROCESSING`, `SENT`, `FAILED`) |
| `scheduled_at` | `date` | Date range filtering (`from`, `to`) and sorting |
| `created_at` / `sent_at` | `date` | Date range queries and audit history |
| `attempts` / `max_attempts` | `integer` | Numeric filtering & retry tracking |
| `error_message` | `text` | Error message diagnostic search |
| `ethereal_message_id` | `keyword` | Exact SMTP message reference |
| `ethereal_preview_url` | `keyword (index: false)` | Retained for preview retrieval without indexing overhead |
| `idempotency_key` | `keyword` | Client-supplied idempotency key |

### Lifecycle Index Synchronization
1. **On Schedule (`POST /api/emails/schedule`):** Persisted in MySQL, then immediately indexed via `ElasticsearchService.indexEmail()`.
2. **On Worker Pickup (`PROCESSING`):** Updated via `ElasticsearchService.updateEmail()`.
3. **On Rate-Limit Reschedule:** Status updated to `PENDING` with new `scheduled_at`.
4. **On Ethereal SMTP Success (`SENT`):** Updated with `sent_at`, `ethereal_message_id`, and `ethereal_preview_url`.
5. **On Delivery Failure (`FAILED`):** Updated with `failed_at` and `error_message`.

### Dedicated Search Endpoint: `GET /api/emails/search`
Provides fast full-text searching across email jobs.

#### Supported Query Parameters:
- `q`: Free-text query matched against `subject^3`, `body`, `recipient^2`, and `sender^2`.
- `status`: Optional filter (`PENDING`, `PROCESSING`, `SENT`, `FAILED`).
- `sender`: Optional exact sender email filter.
- `recipient`: Optional exact recipient email filter.
- `from`: ISO 8601 start date (`scheduled_at >= from`).
- `to`: ISO 8601 end date (`scheduled_at <= to`).
- `page`: Page number (default: `1`).
- `limit`: Results per page (default: `20`, maximum: `100`).
- `sortBy`: Field to sort on (`scheduled_at`, `created_at`, `status`, default: `scheduled_at`).
- `sortOrder`: `asc` or `desc` (default: `desc`).

#### Example Request:
```http
GET /api/emails/search?q=digest&status=SENT&page=1&limit=10 HTTP/1.1
Host: localhost:5000
```

#### Example Response (`200 OK`):
```json
{
  "success": true,
  "data": {
    "total": 1,
    "page": 1,
    "limit": 10,
    "totalPages": 1,
    "tookMs": 3,
    "emails": [
      {
        "id": "e4b6c310-91a2-4d2b-98f2-841f38e210ac",
        "recipient": "client@example.com",
        "sender": "scheduler@outbox.labs",
        "subject": "Monthly Digest Report",
        "body": "Here is your monthly platform performance digest.",
        "status": "SENT",
        "scheduled_at": "2026-10-25T10:00:00.000Z",
        "created_at": "2026-10-24T18:00:00.000Z",
        "updated_at": "2026-10-25T10:00:02.000Z",
        "sent_at": "2026-10-25T10:00:02.000Z",
        "failed_at": null,
        "attempts": 1,
        "max_attempts": 3,
        "last_attempt_at": "2026-10-25T10:00:01.000Z",
        "error_message": null,
        "ethereal_message_id": "<abc-123@ethereal.email>",
        "ethereal_preview_url": "https://ethereal.email/message/abc",
        "idempotency_key": "monthly-digest-oct-2026"
      }
    ]
  }
}
```

#### Resilient Outage & Unconfigured Response (`503 Service Unavailable`):
If `ELASTICSEARCH_NODE` is not configured or the cluster is temporarily unreachable, the endpoint returns a clear, non-crashing 503 response:
```json
{
  "success": false,
  "error": "Elasticsearch service is unavailable or unconfigured.",
  "details": "Elasticsearch is not configured (ELASTICSEARCH_NODE not set)"
}
```

---

## 11. Google OAuth 2.0 Authentication & Session Architecture

The application implements real Google OAuth 2.0 authentication powered by Google's official `google-auth-library` and OpenID Connect standards.

### Authentication Flow & Lifecycle
1. **Login Initiation (`GET /api/auth/google`):**
   - Generates a cryptographically random 24-byte `state` parameter to prevent CSRF attacks.
   - Stores the state in a short-lived (10 min) `HttpOnly`, `SameSite=Lax` cookie (`oauth_state`).
   - Redirects the browser to Google's consent screen requesting `openid`, `profile`, and `email` scopes.
2. **Callback Handling (`GET /api/auth/google/callback`):**
   - Validates that the callback `state` matches the `oauth_state` cookie.
   - Exchanges the authorization `code` for Google OAuth tokens via `OAuth2Client.getToken()`.
   - Cryptographically verifies the Google ID token via `OAuth2Client.verifyIdToken()`, ensuring audience matches `GOOGLE_CLIENT_ID`.
   - Extracts verified Google user identity: `{ id: sub, email, name, avatar: picture }`.
3. **Session Strategy:**
   - Issues a secure JWT signed with `SESSION_SECRET` (algorithm: `HS256`, 7-day expiration).
   - Transmits the JWT in a secure, `HttpOnly`, `SameSite=Lax` cookie named `outbox_session`.
   - The browser automatically sends this cookie on all API requests without exposing tokens to frontend JavaScript.
4. **Session Inspection & Logout:**
   - `GET /api/auth/me`: Verifies the session cookie and returns `{ authenticated: true, user: { id, email, name, avatar } }`.
   - `POST /api/auth/logout`: Clears the `outbox_session` cookie and ends the session.

### Data Ownership & Per-User Isolation
- The MySQL `email_jobs` table stores `user_id` (Google Subject ID) and `user_email`.
- Scheduled jobs created by an authenticated user are associated with their `user_id`.
- Email queries (`/api/emails`, `/api/emails/scheduled`, `/api/emails/history`, `/api/emails/:id`) strictly isolate data so **User A cannot view or retrieve User B's private email records**.
- **Legacy Record Compatibility:** Existing records without an owner (`user_id IS NULL`) remain accessible for system inspection and backward compatibility.

### Google Cloud Console Configuration Guide
To configure Google OAuth credentials:
1. Navigate to the [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
2. Create or select a project.
3. Configure the **OAuth consent screen** (User Type: External, Scopes: `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`).
4. Go to **Credentials** -> **Create Credentials** -> **OAuth client ID**.
5. Select **Application type:** *Web application*.
6. Add **Authorized JavaScript origins**:
   - `http://localhost:5173`
   - `http://127.0.0.1:5173`
7. Add **Authorized redirect URIs**:
   - `http://localhost:5000/api/auth/google/callback`
8. Copy the **Client ID** and **Client secret** into `backend/.env`:
   ```env
   GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your_client_secret
   GOOGLE_CALLBACK_URL=http://localhost:5000/api/auth/google/callback
   SESSION_SECRET=your_random_32_character_signing_secret
   AUTH_ENFORCED=true
   ```

---

## 11. Slack OAuth v2 & Hourly Rate-Limit Notifications

The application implements real Slack OAuth v2 integration to automatically notify teams when a sender reaches their hourly email sending limit.

### Architecture & Security Guarantees
1. **Genuine Slack OAuth v2 Flow:**
   - **Authorization initiation:** `GET /api/slack/authorize` (or `/api/auth/slack`) sets a signed `slack_oauth_state` cookie and redirects to `https://slack.com/oauth/v2/authorize`.
   - **Scopes:** Requests minimal bot scopes: `incoming-webhook` and `chat:write`.
   - **Callback handling:** `GET /api/slack/callback` (or `/api/auth/slack/callback`) validates CSRF state, exchanges code via `POST https://slack.com/api/oauth.v2.access`, and records metadata.
2. **Encryption at Rest (AES-256-GCM):**
   - Access tokens and webhook URLs are encrypted at rest using AES-256-GCM before storage in MySQL table `slack_integrations`.
   - Plaintext credentials and webhook URLs are **never exposed** through API responses or logged in console logs.
3. **Multi-Tenant Connection Isolation:**
   - Slack connections are strictly associated with the authenticated user (`user_id`).
   - User A cannot view, access, or disconnect User B's Slack workspace.
4. **Redis-Backed Alert Deduplication & Cooldown:**
   - When a sender hits the hourly sending limit, queued jobs are automatically rescheduled.
   - To prevent spamming the Slack channel when dozens of queued jobs are rescheduled in rapid succession, the system coordinates an atomic cooldown lock in Redis:
     `slack:ratelimit:cooldown:{sender}` with a configurable TTL (`SLACK_NOTIFICATION_COOLDOWN_SECONDS`, default: 900s).
   - Exactly **1 alert** is dispatched per sender per cooldown window.
5. **Non-Blocking Fault Isolation:**
   - Slack notification dispatches are non-blocking and isolated in try-catch handlers with timeouts.
   - Slack API outages or revoked tokens **never drop scheduled emails**, **never burn retry attempts**, and **never crash BullMQ worker processes**.
   - If Slack returns `token_revoked` or HTTP 404/410, the integration status is automatically marked as `REVOKED`.
6. **Privacy Guarantee:**
   - Rate-limit alerts include only operational metadata (sender address, quota limit, approximate resume time, estimated delay).
   - Alerts **never contain email bodies, recipient addresses, or credentials**.

### Slack App Setup Guide
1. Navigate to [api.slack.com/apps](https://api.slack.com/apps) and click **Create New App** -> **From scratch**.
2. Go to **OAuth & Permissions**:
   - Add **Redirect URL**: `http://localhost:5000/api/auth/slack/callback`.
   - Under **Scopes** -> **Bot Token Scopes**, add:
     - `incoming-webhook`
     - `chat:write`
3. Go to **Basic Information** -> **App Credentials**:
   - Copy **Client ID** and **Client Secret** into `backend/.env`:
     ```env
     SLACK_CLIENT_ID=your_slack_client_id
     SLACK_CLIENT_SECRET=your_slack_client_secret
     SLACK_CALLBACK_URL=http://localhost:5000/api/auth/slack/callback
     SLACK_NOTIFICATION_COOLDOWN_SECONDS=900
     ```

---

## 12. Live BullMQ Monitoring Dashboard (Bull Board)

The Outbox Scheduler includes a live, production-grade BullMQ queue monitoring dashboard powered by `@bull-board/api` and `@bull-board/express`, embedded directly within the dark-themed UI and accessible as a standalone interface.

### Key Capabilities
- **Job Observability:** Real-time visibility into `waiting`, `active`, `delayed`, `completed`, and `failed` jobs in the `email-jobs` queue.
- **Job Details & Failure Reasons:** Inspect job IDs, timestamps, attempt counts, stack traces, and failure error messages.
- **Live Telemetry KPI Cards:** High-level dashboard counters refreshing automatically every 10 seconds.
- **Embedded & Pop-Out Views:** Embedded Bull Board UI inside the React dashboard with one-click direct access to `/admin/queues`.

### Architecture & Security Guarantees
1. **Existing Queue & Redis Reuse:**
   - Mounts Bull Board directly onto the existing BullMQ queue (`email-jobs`) and shared hosted Redis connection via `getEmailQueue()`.
   - **No secondary queues or duplicate processing pipelines are created.**
2. **Access Control & Session Protection:**
   - Mounted at `/admin/queues` and strictly protected by `requireQueueAuth` middleware.
   - When authentication is active (`AUTH_ENFORCED=true` or Google OAuth configured), unauthenticated browser requests are redirected to `/?auth_error=...` with an informative sign-in notice; API requests receive standard `401 Unauthorized`.
3. **Zero Secret Exposure:**
   - BullMQ delayed job payloads contain **strictly operational pointers**: `{ emailId, recipient, subject, sender }`.
   - **Email bodies, SMTP passwords, OAuth tokens, and Redis credentials are never stored in BullMQ** and therefore never visible in Bull Board. Email bodies reside exclusively in MySQL.
4. **Read-Only Protection:**
   - Initialized with `{ readOnlyMode: true, allowRetries: true }`.
   - Destructive queue actions (such as queue obliteration or bulk purging) are disabled to protect in-flight email deliveries, while safe retries of failed jobs are permitted for operators.
5. **Graceful Redis Degradation:**
   - If Redis becomes unreachable, `/admin/queues` returns a styled, user-friendly `503 Service Unavailable` status page or JSON response without crashing Express.

---

## 13. Verification Results

| Suite / Check | Result | Details |
| :--- | :--- | :--- |
| **Connection Verification (`verify:connections`)** | **ALL PASSED** | MySQL (88ms), Hosted Redis (199ms), Ethereal SMTP (3379ms), Elasticsearch Status, Google OAuth Probe, Slack OAuth Probe |
| **Validation Unit Tests (`emailValidation.test.ts`)** | **6 / 6 PASSED** | Zod schemas for recipient, subject, body, dates, and query limits |
| **API Integration Tests (`emailApi.test.ts`)** | **6 / 6 PASSED** | Scheduling, 400 validations, idempotency handling, paginated listing |
| **End-to-End Worker Delivery (`emailEndToEndWorker.test.ts`)** | **1 / 1 PASSED** | Schedule -> BullMQ delay -> Worker pickup -> Ethereal delivery -> MySQL `SENT` status |
| **Worker Restart & Recovery (`emailRestartRecovery.test.ts`)** | **1 / 1 PASSED** | Queue persistence across worker downtime and immediate processing upon recovery |
| **Distributed Rate Limiting (`rateLimiter.test.ts`)** | **6 / 6 PASSED** | Atomic sliding window, sender isolation, refunding on failure, telemetry API, worker auto-reschedule, and explicit Redis error handling |
| **Elasticsearch Integration & Search (`elasticsearch.test.ts`)** | **7 / 7 PASSED** | Document mapping, idempotent upsert, lifecycle sync (PROCESSING/SENT/FAILED), full-text search, date filters, bulk sync, and outage resilience |
| **Google OAuth 2.0 & Session Lifecycle (`googleAuth.test.ts`)** | **8 / 8 PASSED** | Unconfigured 503 handling, CSRF state cookie, code-for-token exchange, ID token verification, session restoration, logout, 401 unauthenticated protection, and user data isolation |
| **Slack OAuth v2 & Rate-Limit Alerts (`slackOAuth.test.ts`)** | **10 / 10 PASSED** | State validation, cancelled consent, code exchange, token encryption at rest, API isolation, disconnect, notification dispatch, Redis deduplication cooldown, revoked token handling, 404 webhook fallback to chat.postMessage |
| **Live BullMQ Dashboard & Telemetry (`bullBoard.test.ts`)** | **8 / 8 PASSED** | Unauthenticated 401/302 protection, authenticated dashboard access, existing queue reuse, live telemetry counts, scheduled job tracking, and graceful 503 degradation |
| **Total Automated Tests** | **53 / 53 PASSED** | **100% pass rate across all 10 test suites** |
| **TypeScript Compilation (`npm run type-check`)** | **PASSED** | 0 type errors across backend (`tsc --noEmit`) and frontend (`tsc -b && vite build`) |
| **Production Build (`npm run build:all`)** | **PASSED** | Backend (`tsc`) and frontend (`vite build`) production bundles built cleanly |