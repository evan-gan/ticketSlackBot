# ticketSlackBot — Project Index

> Read this file first. It tells you where every feature lives so you can make a change without grepping the whole repo. Keep it current: update it at the end of any task that adds, removes, or changes a feature.

---

## What this project does

A **Slack FAQ ticketing bot** for a help channel. When a user posts in the help channel, the bot opens a ticket: it replies with a welcome message + "Resolve" button, and adds the ticket to a live **queue message** in a separate tickets (staff) channel. Staff claim tickets by replying in-thread; a grace timer re-queues a ticket if staff go quiet. Tickets can be resolved manually (button), automatically (AI matches the question to an FAQ entry and replies with a link), or re-opened if the user follows up. A daily **leaderboard** tracks who resolved the most tickets. All state is persisted to PostgreSQL so the bot survives restarts, and a startup-recovery pass catches anything missed while offline.

**Note:** Despite the project name, AI FAQ matching uses the **Groq API** (`openai/gpt-oss-20b`), not Anthropic.

---

## Tech stack

- **Language:** TypeScript (ES2020, strict mode), Node.js 18+
- **Package manager:** pnpm 9 (a `package-lock.json` also exists for npm compatibility — prefer pnpm)
- **Slack framework:** `@slack/bolt` 3.x (Socket Mode)
- **Database:** PostgreSQL 15+ via `pg` (local dev runs it in Docker, managed by `db.js`)
- **External APIs:** Slack, Groq AI (FAQ matching), a remote FAQ markdown URL
- **Other libs:** `dotenv`, `date-fns`, `fs-extra`, `tsx` (runs TS directly)

---

## Run / build / db commands

| Command | What it does |
|---|---|
| `pnpm start` | Installs deps, then runs the bot via `tsx ./src/main.ts` |
| `pnpm dev` | Runs the bot in watch mode (reloads on change) |
| `pnpm build` | Compiles TypeScript to `dist/` |
| `pnpm db:setup` | Creates + starts the Docker PostgreSQL container |
| `pnpm db:start` / `db:stop` / `db:clean` / `db:logs` | Start / stop / remove (destructive) / tail the DB container |
| `pnpm test` | Runs the test suite via `tests/run_all.ts`. AI tests hit the live Groq API + FAQ URL; they skip if `AI_API_KEY` is unset. |

---

## Environment variables

Set in `.env` (see `.env.example`). **Required** (bot throws on startup if missing):

- `SLACK_BOT_TOKEN` (`xoxb-…`), `SLACK_APP_TOKEN` (`xapp-…`)
- `HELP_CHANNEL` — channel ID where users ask for help
- `TICKETS_CHANNEL` — staff channel where the queue lives
- `DATABASE_URL` — `postgres://user:pass@host:port/db`

**Optional** (have defaults): `SLACK_WORKSPACE_DOMAIN`, `AI_API_KEY` (Groq; AI skipped if absent), `FAQ_BASE_URL`, `FAQ_MARKDOWN_URL`, and message-text overrides like `WELCOME_MESSAGE_TEXT`, `TICKET_RESOLVED_MESSAGE`. All secrets come from env — none are hardcoded.

---

## Codebase structure

```
ticketSlackBot/
├── src/
│   ├── main.ts             # Entry point: init bot, load data, register handlers, periodic tasks
│   ├── slack.ts            # Slack event handlers + API helpers (messages, buttons, members, leaderboard)
│   ├── tickets.ts          # Ticket lifecycle state machine (create/respond/resolve/queue/timers)
│   ├── data.ts             # PostgreSQL persistence + in-memory stores + data models
│   ├── hcai.ts             # AI FAQ matching via Groq
│   ├── rateLimiter.ts      # Per-endpoint priority rate limiter for Slack API
│   ├── startupRecovery.ts  # Recovery after restart/downtime
│   ├── utils.ts            # Slack URL + Block Kit formatting helpers
│   └── constants.ts        # All tunable config (timers, intervals, messages, rate limits)
├── tests/
│   ├── run_all.ts          # Single test entry point (pnpm test); registers all suites
│   ├── helpers.ts          # Zero-dependency test harness (assert/skip/runTests)
│   └── ai/
│       └── test_faq_matching.ts  # Live test of checkFAQ — same call path as the bot
├── db.js                   # Docker PostgreSQL container management (CLI)
├── manifest.yaml           # Slack app manifest (scopes, event subscriptions)
├── .env.example            # Env var template
├── readme.md               # User-facing setup guide
├── tsconfig.json
├── package.json
└── ticket-data.json        # Legacy JSON store — superseded by PostgreSQL, not used at runtime
```

### Where each feature lives

- **Bot startup & scheduled jobs** → [src/main.ts](../src/main.ts). Intervals: member refresh (1 hr), grace-timer check (30 s), data backup (5 min), leaderboard post (24 hr). Also kicks off startup recovery.
- **Reacting to Slack events** → [src/slack.ts](../src/slack.ts). New help-channel message → create ticket. Thread replies → `handleStaffResponse` / `handleUserResponse`. "Resolve" button → `resolveTicket`. Also: `getBotUserId`, `refreshTicketChannelMembers` (who counts as staff), `notifyStartup`, `postLeaderboardAndReset`.
- **Ticket state machine** → [src/tickets.ts](../src/tickets.ts). `createTicket`, `handleStaffResponse`, `handleUserResponse`, `resolveTicket`, `unresolveTicket`, `updateQueueMessage` (renders the live queue, splits across 2 messages if > 3800 chars), `checkGraceTimers` (re-queues stale tickets unless `!open` was used), `cleanupOldBotMessages`.
- **Persistence & data models** → [src/data.ts](../src/data.ts). Interfaces `TicketInfo`, `LBEntry`. Tables: `tickets`, `leaderboard`, `leaderboard_history`, `metadata`. Functions: `initDB`, `saveTicketData`, `loadTicketData`, `addResolution`, `resetLeaderboard`, lookups `getTicketByOriginalTs` / `getTicketByTicketTs`. In-memory mirrors: `tickets`, `ticketsByOriginalTs`, `lbForToday`, `queueMessageTs`.
- **AI FAQ auto-answers** → [src/hcai.ts](../src/hcai.ts). Fetches + parses FAQ markdown into slugged entries, `checkFAQ` asks Groq which slugs match, returns linked message or `null`. Entries are cached.
- **Slack rate limiting** → [src/rateLimiter.ts](../src/rateLimiter.ts). `EndpointRateLimiter` (sliding-window, priority queue), `RateLimiterManager`, and the `rateLimitedCall(endpoint, fn, priority)` wrapper used for every Slack call.
- **Restart recovery** → [src/startupRecovery.ts](../src/startupRecovery.ts). `scanForMissedMessages`, `initializeQueueOnStartup`, `cleanupOldQueueMessages`, `performStartupRecovery`, `checkThreadStatus`.
- **Formatting helpers** → [src/utils.ts](../src/utils.ts). `formatTs`, `getThreadUrl`, `createWelcomeBlocks`, `splitQueueMessage`.
- **Tuning behavior** → [src/constants.ts](../src/constants.ts). Grace period, check/save/refresh/leaderboard intervals, all message strings (most read from env), startup-notification user, and `ENDPOINT_RATE_LIMITS` (per-endpoint Slack limits).

---

## Conventions & gotchas

- **Every Slack API call should go through `rateLimitedCall()`** (src/rateLimiter.ts) with an appropriate priority, not the raw client — this is how the bot avoids throttling.
- **State is dual-tracked:** in-memory stores in `data.ts` are the working copy; `saveTicketData()` flushes to PostgreSQL after state changes and every 5 min. When adding ticket fields, update both the `TicketInfo` interface and the save/load SQL.
- **`!open`** in a staff reply force-opens a ticket so the grace timer won't re-queue it — see `checkGraceTimers` / `handleStaffResponse`.
- **Timestamps:** Slack uses `1234567890.123456`; `formatTs` strips the dot for URLs. Don't mix the two forms.
- **Tests** live under `tests/` with `run_all.ts` as the single entry point (`pnpm test`). They use a tiny custom harness in `tests/helpers.ts` (no framework installed). The AI test makes real Groq/FAQ calls and skips when `AI_API_KEY` is absent. Add new suites by appending to the array in `run_all.ts`.
- **Groq TPM cap:** the org's on-demand tokens-per-minute limit is 8000. `checkFAQ`'s `max_tokens` must stay well under it (currently 512) or Groq rejects the whole request with HTTP 413 and AI auto-resolve silently stops working.
- Supplementary design notes live in [.github/](../.github/) (`MIGRATION.md`, `REFACTORING_SUMMARY.md`, `copilot-instructions.md`).
