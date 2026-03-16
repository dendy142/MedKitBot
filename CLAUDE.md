# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Telegram bot @my_med_kit_bot for managing home medicine cabinets. Russian-only interface. Private chat only (no groups). All navigation via inline keyboards — no reply keyboards.

## Stack

- **Runtime**: Node.js >=18, pure ESM modules, no build step
- **Bot framework**: grammY (Telegram Bot API)
- **Database**: Supabase PostgreSQL (service role key, no RLS enforcement)
- **Hosting**: Vercel serverless (webhook at `api/webhook.js`)
- **Cron**: Triggered externally via cron-job.org (NOT Vercel Cron). Files `api/cron/reminders.js` (every 5 min), `api/cron/digest.js` (hourly), `api/cron/expiry-check.js` (daily 6am) are endpoints called by the external service. These cron files should not be modified — they work correctly as-is.

## Commands

```bash
npm run dev          # Local dev via vercel dev
vercel --prod --yes  # Deploy to production
```

No tests, no linter, no build step.

## Architecture

### Request flow
Telegram → Vercel webhook (`api/webhook.js`) → `bot.handleUpdate(update)` → authMiddleware → handler chain

### State management
Stateful multi-step flows (add medicine, create medkit, rename, restock, edit) use the Supabase `sessions` table as a key-value store:
- `addmed:{userId}` — 8-step medicine addition wizard (managed in `src/handlers/addMedicine.js`)
- `state:{userId}` — simpler text-input flows like create/rename medkit, restock, edit field, add shopping item, create schedule, share username, settings (managed in `src/handlers/textState.js`)

Each state stores a `msgId` to edit the same bot message across steps. User messages are deleted after processing.

### Handler registration order (in bot.js)
Commands → noop/help → intake/schedule → onboarding → addMedicine callbacks (`/^addmed:/`) → sharing → medkits → medicines → settings → export/import → shopping → stats → search → document handler → photo handler → text handler (addMedicine → textState → search fallback)

Order matters: more specific regex patterns must register before broader ones.

### Message editing pattern
The bot maintains a single message per flow, editing it at each step via `ctx.editMessageText()` (from callbacks) or `ctx.api.editMessageText(chatId, msgId, ...)` (from text handlers using stored msgId). User text/photo messages are deleted with `ctx.deleteMessage()`.

### Database queries
All DB access goes through `src/db/queries/*.js` files. Direct `supabase` client imports are used in handlers only for sessions table and dashboard aggregation queries.

### User context
`authMiddleware` attaches `ctx.dbUser` (full user row with settings JSONB) and `ctx.isNewUser` (true if user has no medkit_members). Every handler can access `ctx.dbUser.id`, `ctx.dbUser.settings`, `ctx.dbUser.timezone`.

## Key conventions

- All user-facing text is in Russian
- Dates stored as ISO strings in DB, displayed as DD.MM.YYYY (configurable)
- Settings stored as JSONB in users.settings (see DEFAULT_SETTINGS in config.js)
- Pagination: 8 items per page via `src/keyboards/pagination.js`
- Callback data format: `entity:id:action` (e.g., `medkit:uuid:rename`, `med:uuid:edit:name`)
## Environment variables

`BOT_TOKEN`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `CRON_SECRET`
