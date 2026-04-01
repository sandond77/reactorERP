# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start both client and server in dev mode (from root)
npm run dev

# Run migrations
npm run migrate           # run all pending
npm run migrate:up        # up one
npm run migrate:down      # down one
npm run migrate:create "description"   # create new migration file

# Client only
cd client && npm run dev
cd client && npm run lint
cd client && npm run build

# Server only
cd server && npm run dev   # tsx watch
cd server && npm run build
```

No test suite exists. Validate changes by running the dev server.

## Architecture

**Monorepo structure:** `client/` (React/Vite) + `server/` (Express/Node). Run from root with npm workspaces.

**API:** REST at `/api/v1`. Client uses Axios (`client/src/lib/api.ts`) with base URL `/api/v1` and a 401 interceptor that redirects to `/login`. Static uploads served at `/uploads`.

**Auth:** Google OAuth via Passport.js. Sessions stored in PostgreSQL (connect-pg-simple). All protected routes use `requireAuth` middleware. `req.user.id` is available in all authenticated handlers.

**Server pattern:** `routes/` → `controllers/` → `services/`. Controllers handle Zod validation and HTTP concerns; services contain all DB/business logic. Errors use `AppError(statusCode, message)` with a global handler.

**Database:** PostgreSQL via Kysely (type-safe query builder). Types in `server/src/types/db.ts` are the source of truth. Migrations are sequential SQL files in `server/src/db/migrations/`. Prices stored as **cents** (integers) — use `toCents()` util when converting.

**Key domain models:**
- `card_catalog` — shared canonical card reference (game, set, name, SKU/part number). Not user-specific.
- `card_instances` — user-owned cards. Status state machine: `purchased_raw → inspected → grading_submitted → graded → sold` or `raw_for_sale → sold`. Soft-deleted via `deleted_at`.
- `raw_purchases` — grouped bulk purchase records (ID format: `RP-YYYY-NNN`).
- `slab_details` — graded card data (cert number, grade, company) joined to `card_instances`.
- `grading_submissions` / `grading_batches` — batch submission tracking.
- `listings`, `sales`, `trades`, `expenses` — commerce tracking.

**Card naming:** Display name resolves as `COALESCE(ci.card_name_override, cc.card_name)`. The catalog stores short names (e.g. "Shining Mew"); `card_name_override` on the instance stores user-chosen names like full PSA labels.

**Client state:** React Query for all server state (useQuery/useMutation). AuthContext for user session. Filter state persisted to localStorage via `lib/filter-store.ts`. No global state library.

**AI Agent** (`server/src/services/agent.service.ts`): Claude Sonnet agentic loop (up to 5 iterations) with tool use. Tools: `list_inventory`, `create_raw_purchase`, `add_card_to_purchase`, `add_graded_card`, `record_sale`, `update_card`, `submit_to_grading`, `record_expense`, `lookup_catalog`. Haiku pre-screens messages for abuse. Images stored in `pendingImages` Map keyed by userId across multi-turn conversations, saved to disk after card creation. Agent chat history persisted to localStorage on client.

**Image uploads:** Multer (30MB limit) → sharp resize (1600px max, JPEG 85%) → disk at `uploads/card-images/{userId}/{cardId}-{side}.jpg`. Vite dev proxy forwards `/uploads` to `localhost:3001`.

**Pagination:** All list endpoints return `{ data: T[], total, page, limit, total_pages }`. Default limit 25, max 100.

**Page consistency rule:** All inventory pages must have: search input, Add button, Clear Filters button, filter pattern, and empty state in `<tbody>`.
