# ReachInbox Email Scheduler

A production-grade full-stack **email job scheduler**: compose a campaign (subject, body, a CSV/text list of leads), pick a start time, a delay between sends and an hourly sending limit — and the system reliably sends every email at the right moment using **BullMQ delayed jobs on Redis**, persisting every state transition in **PostgreSQL**, surviving restarts, enforcing rate limits across any number of workers, indexing everything into **Elasticsearch** for search, and notifying you on **Slack** when an hourly limit is reached.

---

## 1. Project overview

- Log in with your **Google account** (real OAuth).
- **Compose** an email campaign: choose a sender, subject, body, upload a leads file (CSV or plain text — the UI shows an "N email addresses detected" count), a future start time, a per-email delay, and an hourly limit.
- Scheduling creates **one persistent DB record and one delayed BullMQ job per recipient** (1000+ recipients without blocking the API), and returns immediately.
- **Scheduled / Sent** tabs list your emails (backed by Elasticsearch search with pagination and free-text search, strictly scoped to your account).
- A **worker** picks each job up when due, enforces the minimum send delay and the hourly limit, sends via **Ethereal SMTP**, and updates the record (`SCHEDULED → SENDING → SENT/FAILED`).
- When a campaign's hourly limit is exhausted, the remaining jobs are **rescheduled to the next hour** (never failed, never dropped) and a **Slack DM** notifies you once per campaign per hour.
- **Bull Board** (`/admin/queues`) exposes live queue inspection/retry/retry-less operations for the real BullMQ queue.

```
reachinbox-email-scheduler/
├── backend/            # Express + BullMQ + Prisma + ES + worker (TypeScript)
│   ├── prisma/         # schema + migrations
│   └── src/
│       ├── config/     # env (zod), logger (pino), prisma, redis
│       ├── controllers/ routes/ middleware/
│       ├── services/   # campaign, mailer, ratelimit, sendGate, search,
│       │               # google, slack, session, recipients, recovery, …
│       ├── queues/     # BullMQ queue definition
│       ├── workers/    # BullMQ worker (sending pipeline)
│       └── tests/      # vitest integration suite
├── frontend/           # React + Vite + Tailwind dashboard
├── docker-compose.yml  # PostgreSQL, Redis (AOF), Elasticsearch
└── .gitignore
```

## 2. Architecture

```text
React (Vite, Tailwind)
 ↓  fetch (cookies included) → http://localhost:3001
Express API  (auth, upload, schedule, search, slack, health, Bull Board)
 ↓  Prisma
PostgreSQL   ← SOURCE OF TRUTH: users, sessions, senders, campaigns, email records
 ↓  BullMQ (Queue.add with jobId = email record id, delay = scheduled time)
Redis        ← job storage (AOF-persisted) + shared rate counters + min-delay gate
 ↓  Worker (concurrency = WORKER_CONCURRENCY) reads due jobs
Worker       ← idempotent pipeline: claim → limit → gate → send → record
 ↓  Nodemailer
Ethereal SMTP
```

- **Elasticsearch**: every email is indexed on creation and re-indexed on every state change. All *listing/search* endpoints (`/api/emails/scheduled`, `/api/emails/sent`) query Elasticsearch (`term` filter on `userId` for tenant isolation + `status` terms + optional `multi_match` over recipient/subject/sender/messageId), then **hydrate the result ids back from PostgreSQL**, so ES never becomes a source of truth. ES failures never break sending (best-effort indexing, logged).
- **Slack**: real OAuth connect (`/api/slack/connect` → Slack → `/api/slack/callback`), bot token stored **AES-256-GCM encrypted** in Postgres. When the worker hits a campaign's hourly limit it DMs the connected user via `conversations.open` + `chat.postMessage`. If Slack is not connected, the notify path is a silent no-op — it can never crash the worker.

## 3. Setup requirements

- Node.js ≥ 20 (developed on Node 22/25)
- Docker Desktop (for PostgreSQL, Redis, Elasticsearch)
- npm
- A Google OAuth client (for login) and optionally a Slack app (for notifications) — see §8/§9. The app boots and everything else works without them; the affected routes report a clear "not configured" error.

## 4. Docker (infrastructure)

```bash
docker compose up -d          # start PostgreSQL, Redis, Elasticsearch
docker compose ps             # wait until healthy
docker compose down           # stop (add -v to also delete data volumes)
```

Ports (all overridable in `.env` / `docker-compose.yml`):

| Service       | Host port | Note                                                        |
| ------------- | --------- | ----------------------------------------------------------- |
| PostgreSQL    | **5433**  | 5433 chosen so a locally installed PostgreSQL on 5432 can't clash |
| Redis         | 6379      | AOF (`appendonly yes`, everysec) + RDB snapshots — required for BullMQ durability |
| Elasticsearch | 9200      | single node, security disabled for local dev                 |

## 5. Backend

```bash
cd backend
npm install
npx prisma migrate dev        # applies prisma/migrations + generates client
npm run dev                   # tsx watch src/server.ts (API + worker on :3001)
```

- API: `http://localhost:3001` — see §12 for the endpoint list.
- Health: `GET /health` (checks Postgres, Redis, BullMQ, Elasticsearch).
- Bull Board: `http://localhost:3001/admin/queues` (requires login — it sits behind the same session middleware).
- Tests: `npm test` (`vitest run`) — requires the compose stack running. The suite covers health, auth boundaries, CSV upload, scheduling, delayed jobs, ES indexing + tenant isolation, worker state transitions, duplicate prevention, atomic claim, hourly-limit rescheduling, permanent failure handling, rate limiter / min-delay gate / crypto units, and restart reconciliation. Tests use a **dedicated Redis DB (index 9) and a dedicated ES index (`emails_test`)** so they can never interfere with a running dev instance.
- Typecheck: `npx tsc --noEmit`.

## 6. Frontend

```bash
cd frontend
npm install
npm run dev                   # Vite on http://localhost:5173
```

Copy `frontend/.env.example` → `frontend/.env` if your API runs on another port (`VITE_API_BASE_URL`).

## 7. Environment variables

Backend (`backend/.env`, see `.env.example` for the full annotated list):

| Variable | Meaning |
| --- | --- |
| `PORT` / `FRONTEND_URL` / `BACKEND_URL` | API port; CORS allow-list; base URL used in OAuth redirects |
| `SESSION_COOKIE_NAME` / `SESSION_TTL_DAYS` | session cookie name / lifetime (DB-backed sessions) |
| `DATABASE_URL` | PostgreSQL (Prisma) — default points at compose on **5433** |
| `REDIS_URL` | Redis for BullMQ, rate counters, min-delay gate, OAuth state |
| `ELASTICSEARCH_URL` / `EMAIL_SEARCH_INDEX` | ES node and index name |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | Ethereal credentials (§8). `smtp.ethereal.email:587` is pre-filled; only user/pass are needed |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | Google OAuth (§8) |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` / `SLACK_REDIRECT_URI` / `SLACK_BOT_SCOPES` | Slack OAuth (§9) |
| `TOKEN_ENCRYPTION_KEY` | ≥32-char random string; AES-256-GCM key for Slack tokens at rest |
| `WORKER_CONCURRENCY` | BullMQ worker concurrency (§10) |
| `MIN_EMAIL_DELAY_MS` | enforced minimum gap between any two sends (§11) |
| `HOURLY_EMAIL_LIMIT` | **global** system-wide hourly send cap (§12) |
| `EMAIL_MAX_ATTEMPTS` | BullMQ send attempts before `FAILED` |
| `MAX_RECIPIENTS_PER_FILE` | upload guard |
| `LOG_LEVEL` | pino level |

Frontend (`frontend/.env`): `VITE_API_BASE_URL`.

All backend variables are validated at boot with zod. Missing *credentials* don't crash the app; they are logged at startup as "Missing credentials: …" and the corresponding integration reports `not configured` until set.

## 8. Ethereal SMTP

Ethereal is a fake SMTP service for safe development sending.

1. Go to **https://ethereal.email** → "Create a new account" → note `username` / `password`.
2. Put them in `backend/.env`: `SMTP_USER=…`, `SMTP_PASS=…` (`SMTP_HOST=smtp.ethereal.email`, `SMTP_PORT=587` are defaults).
3. Sent messages are **not delivered** — you can inspect each one: the worker logs the Ethereal **message URL** preview and stores `messageId` on the email record (visible in the Sent table and via `/api/emails/sent`).

(If no credentials are set, the mailer creates an ephemeral Ethereal test account on boot via `nodemailer.createTestAccount()` so flows remain testable.)

## 9. Google OAuth

1. [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials → **Create OAuth client ID** (Web application).
2. Authorized redirect URI: `http://localhost:3001/api/auth/google/callback`.
3. Set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
4. Login flow (`/api/auth/google/login` → consent → callback): standard authorization-code exchange plus the OIDC `userinfo` call; the user is upserted (name/email/picture) and a default sender is auto-created from `SMTP_USER`. The session is a random 256-bit token stored in Postgres, delivered as an httpOnly `SameSite=Lax` cookie. OAuth `state` anti-forgery is stored in Redis.

## 10. Slack OAuth + notification behavior

1. [api.slack.com](https://api.slack.com/apps) → Create app → enable **OpenID Connect and Sign in with Slack** (Features) → **OAuth & Permissions**.
2. User Token Scopes: `openid`, `email`, `profile`. Bot Token Scopes: `chat:write`, `im:write` (`SLACK_BOT_SCOPES`).
3. Redirect URL under "Redirect URLs for OAuth": `http://localhost:3001/api/slack/callback`. Set client id/secret in `.env`.
4. Frontend "Connect Slack" → `/api/slack/connect` (redirects to `slack.com/openid/connect/authorize`) → Slack consent → callback exchanges the code (`oauth.v2.access`), stores the **bot token encrypted** in `SlackConnection`, then redirects to the dashboard with a success/error toast. `/api/slack/status` reports connection state.

**Exactly when a notification is sent**: the moment a job for campaign *C* is blocked by *C*'s hourly limit, the worker DMs the campaign owner (`conversations.open` + `chat.postMessage`) saying the limit was reached and the rest of the queue was delayed to the next hour. It is sent **at most once per campaign per hourly window** (Redis `SETNX key slack:notified:{campaignId}:{bucket}`, 1h TTL). No Slack connection → silent skip; any Slack error → logged and swallowed; sending is never affected.

## 11. Queue / worker architecture (BullMQ)

- One queue `send-emails`; **one job per email**, added at schedule time with `delay = scheduledAt − now`. `addBulk` (500-job chunks) makes 1000+ recipient campaigns fast and non-blocking.
- Job options: `attempts = EMAIL_MAX_ATTEMPTS`, exponential backoff (5s), `removeOnFail: false` (failed jobs stay inspectable in **Bull Board**), completed jobs pruned after 24h.
- Worker pipeline per job:
  `load record → terminal-state guard → atomic claim (DB) → hourly limit (Redis) → min-delay gate (Redis) → SMTP send → SENT + ES re-index → campaign completion check`.
- Transient SMTP errors release the claim and rethrow so BullMQ retries; permanent errors (or exhausted attempts) mark the record `FAILED` with the error text.
- `WORKER_CONCURRENCY` controls parallel job processing (default 5). Correctness under concurrency does **not** rely on a single worker: claims, counters and the gate are all shared-state-safe.

## 12. Persistence — surviving backend restarts

Redis runs with AOF (`appendfsync everysec`) + snapshots, so **delayed jobs themselves survive restarts**; PostgreSQL holds the authoritative email state. On top of that, `reconcileOnStartup()` runs before the API starts serving:

1. **Stuck claims**: rows `SENDING` for > 5 minutes (crashed mid-send) are reset to `SCHEDULED`.
2. **Lost jobs** (e.g. Redis volume wiped): every `SCHEDULED` email whose `bull:send-emails:{id}` key is missing is **re-armed** as a delayed job for its original `scheduledAt`. Deterministic job ids make re-arming idempotent — never duplicates.
3. Campaigns whose work is finished are marked `COMPLETED`.

Restart test scenario: schedule ~50 emails a few minutes out, `Ctrl+C` the backend, restart → logs show reconciliation and all emails still send on time, exactly once.

## 13. Idempotency & duplicate prevention

- `jobId` = the email record's UUID (and the record has a **unique `jobId` column**), so re-adding the same email (double submit, recovery re-arm, retry) can never create a second job.
- The worker claims each email with a **conditional atomic update** `SCHEDULED → SENDING`; a claim that affects 0 rows means someone else owns it → the job no-ops. Exactly one worker can ever send one email.
- `SENT`/`FAILED` are terminal — a re-delivered job for a sent email never re-sends (covered by tests).

## 14. Minimum delay between sends

`MIN_EMAIL_DELAY_MS` (env) is enforced by a **Redis-side token gate**, not in-memory timers: a Lua script (`email:send:gate`) atomically reads Redis server `TIME` and grants the right to send only if `now ≥ nextAllowed`, otherwise returns the exact `waitMs`; the job then `moveToDelayed(now + wait)` (no worker sleeps). Because the state lives in Redis and the decision is one atomic script, the gap holds for **N workers on M machines**. Campaigns also stagger each email's `scheduledAt` by at least the configured per-campaign delay.

## 15. Hourly rate limit & rescheduling

- Two fixed-window (UTC-hour bucket) counters consumed **atomically in one Lua script**: per-campaign (`campaign.hourlyLimit`, user-configurable in Compose) and global (`HOURLY_EMAIL_LIMIT`). A send needs both.
- When the campaign limit is reached the job is **not failed**: the claim is released and the job is `moveToDelayed()` to the **next window start**, plus a small per-sequence jitter (`sequence × 100ms`, capped at 5 min) that preserves the original sending order at the next hour.
- The owner gets the once-per-window Slack DM (§10). Nothing is lost; nothing errors.

## 16. Large batches (1000+ emails)

`POST /api/emails/schedule` never sends anything and never touches recipients one-by-one: one Prisma `createMany` (transactional, with the campaign row) + chunked `addBulk` + one ES `_bulk` call. 1000 records + 1000 delayed jobs are created in well under a second of API time; the load shifts entirely to the worker pool, which drains jobs at `scheduledAt` pace under the limit/gate rules above.

## 17. Elasticsearch indexing & search

- Index `EMAIL_SEARCH_INDEX` is created on boot (`ensureEmailIndex`) with an explicit mapping (`userId`/`status`/`recipient` as `keyword`, `subject`/body-adjacent fields as `text`, dates as `date`). Documents are written on campaign creation and re-indexed on every state change.
- Searching (`?q=`) runs a `bool` query: hard `term: userId` filter (tenant isolation at query level), `terms: status`, optional `multi_match` (recipient, subject, sender, messageId), sorted by `scheduledAt`, `from`/`size` pagination. Returned ids are hydrated from Postgres (preserving ES order), so the UI always shows authoritative rows.
- Indexing is best-effort: ES being down delays search freshness but never blocks scheduling or sending; `/health` reports ES status.

## 18. REST API summary

| Method & path | Auth | Purpose |
| --- | --- | --- |
| `GET /health` | – | dependency status |
| `GET /api/auth/google/login` · `GET /api/auth/google/callback` | – | OAuth login (sets session cookie, redirects to `/dashboard`) |
| `POST /api/auth/logout` · `GET /api/auth/me` | ✓ | session management / current user + senders |
| `GET/POST/DELETE /api/senders[/:id]` | ✓ | multiple sender identities |
| `POST /api/emails/upload` | ✓ | multipart CSV/text → parsed, deduped, validated recipient list + count |
| `POST /api/emails/schedule` | ✓ | create campaign + delayed jobs (zod-validated: future start, limits, ownership) |
| `GET /api/emails/scheduled` / `sent` | ✓ | ES search: `?q=`, `?page=`, `?pageSize=`; own data only |
| `GET /api/slack/connect` / `callback` / `status` | ✓ | Slack OAuth |
| `GET /admin/queues` | ✓ | Bull Board |

## 19. Assumptions & tradeoffs (documented decisions)

- **Postgres port 5433** in compose/.env so a pre-existing local PostgreSQL on 5432 can't shadow the container.
- **Two-layer hourly limit** (per-campaign + global `HOURLY_EMAIL_LIMIT`): the assignment requires a configurable hourly limit *and* per-campaign user input; treating both as binding is the production-safe reading.
- **Fixed hourly windows** (UTC-hour buckets) rather than sliding windows: simple, atomic in one Lua script, matches "next hour" rescheduling semantics.
- **Rate-limited jobs keep their original attempt count** — rescheduling via `moveToDelayed` is not a failure and never consumes an attempt.
- `MIN_EMAIL_DELAY_MS` acts as a system-wide floor: a campaign's smaller delay is raised to it (`effectiveDelayMs` is echoed back to the client).
- **ES failures degrade search only** (logged, retried naturally on next state change) instead of failing sends — DB remains source of truth.
- Sessions are DB-backed (revocable, no JWT key management) — cheap at this scale, and logout is real.
- Slack bot token is stored **encrypted (AES-256-GCM)**; the tradeoff is one more secret (`TOKEN_ENCRYPTION_KEY`) to manage.
- Bull Board is protected by the same session auth (queue UI exposes data-adjacent info).
- Ethereal message preview URLs are logged (pino) since Ethereal mailboxes aren't POP/IMAP-retrievable.
- The suite runs tests sequentially (`fileParallelism: false`) against real infra in isolated Redis DB 9 / index `emails_test` — slower but genuinely end-to-end, and it can't corrupt a running dev instance's state.
