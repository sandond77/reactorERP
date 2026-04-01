# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## System Overview

Reactor is a trading card inventory ERP (Pokemon focus) managing the full lifecycle from purchase to sale. There are two primary flows:

1. **Raw card workflow:** purchase → inspection → sell raw OR submit to grading → sell graded
2. **Graded card workflow:** direct slab purchase → sell

The system is designed around **inventory state transitions**, **lot traceability**, and **cost basis tracking**.

---

## Domain Model

### Purchase (Entry Point)
All inventory begins as a purchase. Each purchase generates a unique `purchase_id` (format: `RP-YYYY-NNN`) that acts as the **lot-level traceability key** across the entire system.

### Inventory Types

**Raw (ungraded):** Quantity-based. Stored as lots grouped by `raw_purchase_id` + condition. Must go through inspection before routing.

**Graded (slabs):** Item-based. Each slab is a unique individual record with cert number, grade, company, and cost basis.

### Raw Card Workflow
```
Purchase (raw_purchases)
  → Intake → card_instances [status: purchased_raw]
  → Inspection → card_instances [status: inspected, condition set, decision set]
      → decision: sell_raw → card_instances [status: raw_for_sale]
      → decision: grade   → card_instances [status: grading_submitted]
                              → graded: card_instances [status: graded] + slab_details row
```

### Graded Card Workflow
```
Purchase (pre_graded) → card_instances [status: graded] + slab_details row created immediately
```

### Card Status State Machine (actual DB enum `card_status`)
```
purchased_raw → inspected → grading_submitted → graded → sold
                          → raw_for_sale → sold
                                                 → lost_damaged (terminal)
```

### Cost Basis
- **Raw:** starts at purchase total cost, distributed proportionally across inspection allocations
- **Graded:** `total_cost = raw_cost (allocated) + grading_cost`
- **Sale profit:** `sale_price − fees − total_cost_basis`

Cost basis must always reconcile. No orphaned or lost cost.

---

## Design Constraints

- Every card traces back to a `purchase_id` (lot traceability)
- Raw inventory is quantity-based; graded inventory is item-based (never flatten them)
- State transitions are explicit — no implicit movement between stages
- No over-allocation of quantities during inspection
- No selling more than available inventory
- `purchase_id` values are immutable once created
- Do not treat graded cards as quantity-based
- Model grading as a transformation (raw → graded), not duplication

---

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

---

## Implementation Architecture

**Monorepo structure:** `client/` (React/Vite) + `server/` (Express/Node). Run from root with npm workspaces.

**API:** REST at `/api/v1`. Client uses Axios (`client/src/lib/api.ts`) with base URL `/api/v1` and a 401 interceptor that redirects to `/login`. Static uploads served at `/uploads`.

**Auth:** Google OAuth via Passport.js. Sessions stored in PostgreSQL (connect-pg-simple). All protected routes use `requireAuth` middleware. `req.user.id` is available in all authenticated handlers.

**Server pattern:** `routes/` → `controllers/` → `services/`. Controllers handle Zod validation and HTTP concerns; services contain all DB/business logic. Errors use `AppError(statusCode, message)` with a global handler.

**Database:** PostgreSQL (running in Docker — do NOT use `psql` directly) via Kysely (type-safe query builder). Types in `server/src/types/db.ts` are the source of truth. Migrations are sequential SQL files in `server/src/db/migrations/`. Prices stored as **cents** (integers) — use `toCents()` util when converting. To run raw queries use the Node.js `pg` Pool via the app's `DATABASE_URL`.

**Key tables:**
- `card_catalog` — shared canonical card reference (game, set, name, SKU/part number). Not user-specific.
- `card_instances` — user-owned cards. Carries status, condition, decision, cost, quantity, and optional `raw_purchase_id`. Soft-deleted via `deleted_at`.
- `raw_purchases` — grouped bulk purchase records, the lot-level entry point.
- `slab_details` — graded card data (cert number, grade, company) joined 1:1 to a `card_instances` row.
- `grading_submissions` / `grading_batches` — batch submission tracking.
- `listings`, `sales`, `trades`, `expenses` — commerce tracking.

**Card naming:** Display name resolves as `COALESCE(ci.card_name_override, cc.card_name)`. The catalog stores short names (e.g. "Shining Mew"); `card_name_override` stores user-chosen names like full PSA labels.

**Client state:** React Query for all server state (useQuery/useMutation). AuthContext for user session. Filter state persisted to localStorage via `lib/filter-store.ts`. No global state library.

**AI Agent** (`server/src/services/agent.service.ts`): Claude Sonnet agentic loop (up to 5 iterations) with tool use. Tools: `list_inventory`, `create_raw_purchase`, `add_card_to_purchase`, `add_graded_card`, `record_sale`, `update_card`, `submit_to_grading`, `record_expense`, `lookup_catalog`. Haiku pre-screens messages for abuse. Images stored in `pendingImages` Map keyed by userId across multi-turn conversations, saved to disk after card creation. Agent chat history persisted to localStorage on client.

**Image uploads:** Multer (30MB limit) → sharp resize (1600px max, JPEG 85%) → disk at `uploads/card-images/{userId}/{cardId}-{side}.jpg`. Vite dev proxy forwards `/uploads` to `localhost:3001`.

**Pagination:** All list endpoints return `{ data: T[], total, page, limit, total_pages }`. Default limit 25, max 100.

**Table columns:** Resizable via `useColWidths` + `ColHeader` (`client/src/components/ui/TableHeader.tsx`). Each column needs a key in both `MINS` (min-width) and the `useColWidths` call, plus a `ColHeader` in `<thead>` and a `<td>` in `<tbody>` — all three must stay in sync.

**Page consistency rule:** All inventory pages must have: search input, Add button, Clear Filters button, filter pattern, and empty state in `<tbody>`.

**Environment:** Server runs on port 3001. Vite dev server on 5173 and proxies `/api` and `/uploads` to `localhost:3001`. Server `.env` needs `DATABASE_URL`, `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `CLIENT_URL`.
