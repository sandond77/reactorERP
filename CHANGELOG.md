# Reactor — Changelog

## May 15, 2026

### Features

**Part Numbers manager**
- Now **counts raw cards** in Total/Unsold/Sold — previously it was inner-joined to `slab_details`, hiding every raw `card_instance` from the page. Raw rows aggregate under a single "no grade / no company" row per part number.

**Catalog / Set codes**
- **Standardized set code format** to "generation - set" everywhere. EN promo codes `PROMO-XY`, `PROMO-BW`, `PROMO-HGSS`, `PROMO-DP`, `PROMO-EX`, `PROMO-WOTC` renamed to `XY-P`, `BW-P`, `HGSS-P`, `DP-P`, `EX-P`, `WOTC-P` (consistent with `SV-P`, `SWSH-P`, `SM-P`). Migration 049 rewrites existing `card_catalog.set_code` and `sku` rows, dedup'ing first when both the old and new code already exist.
- **Mega era carved out** — JP M-series sets (M1L, M1S, M2, M2a, M3, M4, M5, Mbg) now show under their own *Mega Series Era* group in the Set Codes manager, separate from Scarlet & Violet. EN side gets *Mega Evolution Era*.

### Fixes

**Part # search (Intake/Add Card/Edit Purchase)**
- **`card_number` over-narrowing** — exact-equality match meant "051" wouldn't find a catalog row stored as "51". Now strips leading zeros on both sides.
- **Set name over-narrowing** — substring match meant "Tag Team All Stars" wouldn't match "Tag Team GX All Stars". Now tokenized: each word in the set field must appear in `set_name` *or* `set_code`. As a side effect, typing a set code (`sm12a`) into the Set Name field also resolves.

**Purchase → inspection-line backfill**
- Editing a purchase and saving now **propagates `catalog_id`, `card_name`, `set_name`, and `card_number`** down to any child inspection lines whose corresponding column is still NULL. Runs on every save (not just when those fields change) so a re-save fixes lines created before the parent had a part #.

**Inspection page**
- **Sort headers actually sort** — the click handler was hardcoded to a no-op; clicking did nothing. Now wires `sortCol`/`sortDir`/`handleSort` matching the Purchases page pattern, persists to filter-store, threads through to the server.

**Part Numbers manager crash**
- Page no longer crashes with `Cannot read properties of null (reading 'toLowerCase')` when raw rows are present — `companyOptions` / `languageOptions` now strip nulls before going into the filter dropdown.

### Migrations
- `049_rename_en_promo_set_codes` — renames `PROMO-XX` set codes to `XX-P` in both `set_codes` and `card_catalog`, plus rewrites `card_catalog.sku` prefixes. Deletes collisions first so the rename can't trip the unique constraint.

---

## May 14, 2026

### Features

**Purchases**
- **Uncancel button** for cancelled rows on the Purchases page — hover-reveal `RotateCcw` icon flips the purchase back to Ordered. Same UX pattern as the Unreceive button. A mistakenly-cancelled purchase isn't dead-ended anymore.

**Add Card / Add Slab consistency**
- Add Card (raw) now uses the shared **`PartNumberField`** component — same auto-detect + manual search dropdown + inline "Create new part #" flow that Intake's Add Purchase, Trades' Add Incoming Card, and Edit Purchase already had. You can now type a partial card name and pick from a catalog dropdown instead of having to fill in name/set/# perfectly to trigger auto-match.

### Fixes

**Inspection / Purchases**
- Cancelled purchases no longer appear on the Inspection page (any tab). The All tab used to leak them in because no status filter was applied — added an explicit `exclude_cancelled` filter that Inspection always passes.
- `addInspectionLine` now rejects with a clear 409 when the parent purchase is `cancelled`. Previously a cancelled lot still accepted inspection lines silently.

**Forms — double-submit prevention**
- **Add Purchase** Save button now has a ref-based double-click guard (same as the Inspection Add Line modal). Ref mutates synchronously so a rapid second click can't double-add before React renders the disabled state.
- **Mark Received** form got the same ref-based guard.
- Audited the rest of the app's submit buttons; everything else (Add Slab, Add Card, Sales, Grading, Listings, Expenses, Locations) was already disable-on-submit. SubReturns "Review & Process" just opens a review modal — the real Confirm Return inside is already isPending-disabled.

---

## May 13, 2026

### Features

**Inspection**
- New condition grades available everywhere a condition is picked: **NM-, LP+, LP-, MP+, MP-** (slotted between the existing NM / LP / MP / HP / DMG tiers). DB column is plain text, so no migration required — also wired into the AI agent's tool schemas and prompt.

### Fixes

**Inspection**
- Over-allocation guard on inspection lines — `addInspectionLine` and `updateInspectionLine` now reject any input that would push the sum of allocated quantities above the purchase's `card_count`. Returns a 409 with the exact remaining capacity. Previously you could allocate 13 cards against a 12-card lot with no pushback.
- Rapid double-click on the Save button in the Add/Edit Inspection Line modal no longer double-adds. The submit guard now lives in a ref so a second click in the same tick short-circuits synchronously (React state batching meant the previous state-based guard didn't catch this).
- Toast error messages for Add/Update Line now surface the actual server error (e.g. the over-allocation 409) instead of generic "Failed to update". The raw-purchases controller forwards errors through the error middleware so AppError status codes reach the client intact.

**Listings / Sales**
- Slab `is_listed` and the "Listed?" filter now only count **active** listings. Historical sold/cancelled listings no longer make a card report as listed, and the slab search no longer hands back a stale `listing_id` that could route a sale to the wrong listing row.
- Yanked the Record Set cert-auto-select feature added on May 12 — its all-digit guard tripped on partial cert prefixes as you typed, picking the wrong slab and clearing your input. Record Set search now reverts to the original name → cert two-step.

---

## May 10–12, 2026

### Features

**Card Games**
- Editable game abbreviations now cascade to `card_catalog.sku` — `PUT /sets/games/:id` rewrites every prefix for that game in place, so future renames stay in sync without another migration
- Card Games tab shows the Abbreviation column and an explicit "Edit" affordance on each row

**Purchases**
- Unreceive button on Purchases for accidentally-received orders (hover-reveal `RotateCcw` icon on `received` rows with no inspection lines; single-confirm amber modal; gated by the existing no-inspection-lines guard on `POST /raw-purchases/:id/unreceive`)

**Listings**
- Bulk sale "Find All Cards in Listing" now works for set listings — added `GET /listings/by-url/all` so one eBay URL resolves every slab tied to that set (was previously called by the client but never existed on the server, so set sales via URL always toasted "Could not find listing")
- Record Set per-card search supports cert numbers (backend was already cert-aware via `fuzzyNameClause`; placeholder now reads "Search card name or cert #…")

### Fixes

**Purchases**
- Card column widened (280 → 400) with long names wrapping instead of being truncated

**Listings**
- Record Listing modal widened (`max-w-2xl` → `max-w-3xl`); search result rows wrap so full PSA labels are readable

### Migrations
- `048_consolidate_games` — collapses Weiss Schwarz aliases into one `weiss-schwarz` row (abbreviation `WC`), adds `union_arena` (UA), drops unused `old_maid`, re-syncs any drifted `card_catalog.sku` prefix via game→abbreviation JOIN

---

## May 9, 2026 (afternoon)

### Features

**Trades**
- Part Number selector/search/generator added to the Add Incoming Card form (same component used in Intake — auto-search by name/set/#, manual search, or "Create new part #" inline)

**Catalog**
- Card game dropdown in Add Part Number is now driven by the `card_games` table instead of a hardcoded list — Weiss Schwarz, plus any other games you have in catalog, now show up automatically

### Fixes

**Trades**
- `deleteTrade` now reverts inventory 100%:
  - Outgoing card status restored intelligently (graded slabs → graded; listed/card-show/decision=sell_raw → raw_for_sale; to-grade → inspected; otherwise → purchased_raw — was always falling back to purchased_raw)
  - Cards that came from card show inventory return to the Card Show location
  - Trade-source `raw_purchases` lots are deleted instead of being left behind as ghost rows on the Purchases page

**Part Numbers / SKUs**
- Non-Pokémon catalog rows no longer get a `PKMN-` prefix. Weiss Schwarz cards now generate `WS-JP-…`, One Piece `OP-…`, etc. — the prefix is pulled from `card_games.abbreviation`
- SQL fallback paths (when `card_catalog.sku` is null) also game-aware

### Migrations
- `044_cleanup_ghost_trade_lots` — one-shot cleanup for any orphan `source='trade'` `raw_purchases` rows left behind by pre-fix `deleteTrade`
- `045_card_games_abbreviations` — seeds known game abbreviations (`pokemon=PKMN`, `weiss-schwarz/weiss=WS`, `one_piece=OP`, `old_maid=OM`), inserts rows for any other games already in catalog, and rewrites `card_catalog.sku` so prefixes match the game (only touches rows whose prefix was wrong)

---

## May 6 → May 9, 2026

### Features

**Card Show**
- Auto-link `platform=card_show` sales to shows by sale date (skips eBay-URL sales)
- Card show breakdown shows per-day rows for multi-day shows
- Auto-seed a "Card Show" root location per user (undeletable); adding cards to card show assigns them there
- Auto-pick part number when catalog search returns exactly one match

**Inventory & Sets**
- Legacy grading flow: "Already Graded" inspection decision with multi-select slab picker to back-link existing slabs to raw lots
- Editable per-user set codes (modal in Inventory Summary — edit name, aliases, reset to default)
- Manual part number search dropdown in Edit Purchase modal

**Search & Filters**
- Status filter on Purchases (All / Not Received / Received / Cancelled)
- Sales search matches cert number, SKU, raw purchase ID, and order ID

### Fixes

**Card Show**
- Card show inventory delete no longer wipes the slab from main inventory — it now "Removes from Card Show" instead
- CS Price input no longer rounds (e.g. 55 → 54.98) — switched away from `type=number step=0.01` quirks
- In card show mode, slab edit is restricted to CS Price only (other fields edited from Overall Slabs)
- Card-show backfill + report label honor multi-day show date ranges

**Sales**
- Cert-search FIFO auto-pick no longer clobbers user's manual override
- Card show breakdown includes unassigned `platform=card_show` sales

**Catalog & Imports**
- "Link to Catalog" uses original `card_name` for matching; added "Show Unlinked" filter
- Edit Purchase shows saved part number as locked-in match (no more "1 match — select one")
- Part number badge shows card name instead of set name
- Edit-part SKU collision returns 409 with a clear message

**Data & Reliability**
- Cache invalidation after Add Card / Add Slab so lists refresh immediately
- Reassign card row no longer 500s on graded cards
- Removed bogus JP BW10 set; seeded `set_codes` entries can now be deleted
- Migration runner supports `-- @no-transaction` directive (for `ALTER TYPE ADD VALUE` etc.)
- Set Postgres timezone as startup option (silences pg@9 deprecation warning)
- Graceful SIGTERM handler stops Railway deploy-failure emails

### Migrations
- `040_raw_purchase_legacy_type` — adds `legacy` to raw purchase type enum
- `041_decision_already_graded` — adds `already_graded` to decision enum
- `042_set_codes_table` — per-user editable set codes
- `043_seed_card_show_location` — seeds Card Show root location + backfills existing card-show inventory locations

---

## Release notes (May 6 cont'd)

### Card Shows / Reports
"By Card Show" breakdown now actually shows your sales. Previously the INNER JOIN required a `card_show_id` on every sale, so any sale imported before the matching show existed (or whose show was added later) got silently excluded — the totals strip showed 2,578 sales but the table said "No sales data". Switched to a LEFT JOIN with an "Unassigned (no show linked)" bucket so nothing disappears.

Sales auto-link to card shows by date. Adding or editing a show now scans your past `platform='card_show'` sales and links any whose `sold_at` falls within that show's date range. Sales import does the same in reverse (after the import, link any unassigned card-show sales to shows that already exist). The matcher skips sales whose `order_details_link` looks like an eBay URL, so an eBay sale that happened to fall on a card-show date can't get mis-attributed. Prod data has been backfilled — about 1,400 sales linked across both passes.

Multi-day shows are honored. Schema already had `show_date` / `end_date` / `num_days`, but the backfill only matched the start date and the report label only printed the start date. Now matches the full range (`show_date` through `end_date` inclusive) and the label reads "Mon DD–Mon DD, YYYY" for multi-day shows. Editing a show's `end_date` or `num_days` re-runs the link pass.

### Part Numbers / Catalog
Reassign Card no longer 500s on graded slabs. The grade WHERE clause used a parameter Postgres couldn't infer a type for (`$N IS NULL` with no column context), causing a generic 500 instead of running. Replaced with `sd.grade IS NOT DISTINCT FROM ${grade}::int`.

Edit Part SKU collisions now return a clear 409 instead of "Internal server error". Editing a row to use a Set + Card # combo that already exists on a different catalog entry gets the message: "A different part number already exists with this Set + Card #. Use Reassign to merge the cards into that part instead."

---

## Release notes (May 3 → May 6, 2026)

### Card Trender (Reports)
Card Trend tooltip no longer shows nonsense numbers like "$1,729,382,400,000.00". The raw millisecond timestamp from the x-axis was being run through the currency formatter. Tooltip now shows date + price + grade label, one row per hover.

### Deploys / Ops
Server now handles SIGTERM gracefully on Railway. Each deploy was previously emitting an "npm ERR! Lifecycle script failed … signal SIGTERM" message because npm wrapped Node and Railway flagged it as a failed shutdown — generating a deploy-failure email every push. Server now drains in-flight requests and exits 0 on signal, so deploys are quiet.

### Part Numbers / Catalog
"Link to Catalog" actually links cards now. Editing the card name in the modal to clean up an OCR-mangled name used to result in "Linked 0 cards" plus an orphaned new catalog entry, because the server matched against the edited name instead of the original stored name. The modal now sends both the original (for matching existing instances) and the cleaned-up name (for the catalog row), and rewrites `card_name_override` on linked instances so the clean name appears in the UI right away.

New "Show Unlinked" toggle on the Part Numbers page next to Show Empty. Filters to rows with no catalog link so you can sweep through OCR-corrupted imports / mass-link to a single canonical entry.

### Performance / UX
Adding a slab or raw card now refreshes the list and dashboard counts on the same page automatically. Previously a buggy invalidation key meant the Add Card form on the Raw Overall page never refreshed at all (had to reload the page or wait for the staleTime). Add Slab from one page also left counts stale on others. All inventory mutations now route through a shared query-invalidation map so future regressions of this kind don't recur.

---

## May 3, 2026

### Unnumbered Cards
- Every part-number form (AddPart, AddCard, AddSlab, single + multi-line PurchaseForm) has a "no card # (unnumbered)" checkbox. Multiple unnumbered cards in the same set no longer collide on the SKU constraint.
- Unnumbered linked entries display as `PKMN-LANG-CODE (no #)` everywhere — Raw Overall, To Be Submitted, Inspection, Inventory Summary — instead of `—`.
- Catalog auto-match no longer fires on blank card numbers, so unnumbered receipts can't silently link to the wrong card.

### Inspection Page
- New two-row header: state tabs (Needs Inspection / Inspected / All) on top, Type filter on bottom.
- Card column widened with proper text wrapping for long set names.
- Trash icon removed — records persist now. Each row gets a context-aware revert: clears inspection lines on inspected rows, or rolls a received purchase back to ordered.
- "Sell raw" → "grade" decision flip now correctly puts the card back in the Grading queue (was previously losing the inspection state).

### Locations
- Add Slab and the inspection line form expose a Location dropdown with parent → child nesting.
- Submitting a card to grading clears its location (the card is physically gone). User re-assigns on return.
- Location Manager redesign:
  - Container locations no longer ask for a card type — the Type column shows "Container" instead.
  - Containers display rolled-up totals (graded + raw) summed across all sub-locations.
  - New eye icon opens a modal listing the cards inside. For containers, it recurses into all sub-locations and shows which one each card lives in.
  - Cleaner column layout: Name / Cards / Type / Actions.

### Misc
- Removed duplicate PCG-P set entry causing React duplicate-key warnings.
- Save button on multi-line modal now toasts validation errors instead of failing silently.
- Receipt images on multi-line save are parse-only and aren't persisted.

---

## May 2, 2026

### Intake & Purchases
- New auto-fill panel on Add Purchase: drop a receipt image or single card image and the form populates Card Name, Set, Card #, Cost, FX, etc.
- Multi-line mode for receipts with multiple cards — each line becomes its own raw purchase with per-row Type (raw/bulk), currency (¥/$), Set, Part #, Qty, Cost.
- Per-line catalog auto-match shows a green ✓ when a card is already on file. Inline "Create part" when it isn't, plus inline "Add set" when the receipt mentions a set we don't have yet.
- Set Name and Set Code are both searchable dropdowns sharing the same list. Pick from either and the other syncs.
- Japanese / Korean receipts auto-translate card and set names to English; printing language is still captured.
- Long set names in the Intake table now wrap instead of being clipped.
- Add Part modal: Part # field is read-only and live-generated from set code + card #.

---

## April 28, 2026

### AI Agent
- Save-image follow-up no longer creates duplicate expense records. The mobile agent's "yes save it" reply on a prior expense now resolves correctly via display ID lookup.

---

## April 26, 2026

### Purchases
- Sort buttons on the Purchases table actually sort now (were no-ops).

---

## April 25, 2026

### Imports
- Raw purchase CSV import: each row creates its own raw purchase entry (no longer merged by order #).
- Raw imports now resolve catalog (part number) the same way graded imports do.

### Purchases
- Pagination styling on Purchases now matches the rest of the inventory views.

### Raw Overall
- Sort buttons fixed for Part #, Listed?, Strike Price, Net (were silently falling back to `created_at`).

---

## April 24, 2026

### AI Agent
- `lookup_catalog` now runs before any add operation, so cards/slabs land linked to the right catalog entry instead of orphaned.
- Established card names come from the oldest matching inventory record so a bad AI-generated PSA name can't overwrite the canonical name. Server enforces this for `add_graded_card`.
- Required fields enforced in tool schemas (`purchased_at`, `currency`, `source`, `purchase_cost`) — agent must collect them before calling.
- Slab cert # in Add Slab is now a clickable link to PSA / BGS / CGC / SGC's lookup page.
- Image previews in the agent panel work for all image types (JPEG, HEIC, etc.) and on Railway (CSP fix).
- Add Slab properly links to the right catalog entry (was creating slabs unlinked when auto-fill found a match).
- Removed image-save prompt for cards (cert link covers it).

### Reports / Sales
- Card show NET column shows true profit (gross − cost basis) instead of gross.
- Card show Reports exposes the Graded/Ungraded card type filter.
- Reverting a sale picks the right status (`raw_for_sale` vs `graded`) based on whether the card has a slab.
- Price-change card compares within the dominant grade/series (e.g. PSA 10 vs PSA 10) instead of mixing grades.
- Trend-line regression no longer overflows into nonsense values like $1.7T.
- Removed redundant Graded filter from Overall page.

### Personal Collection Guard
- Personal-collection cards hidden from every raw picker (Sales, Listings, Trades, Card Show).
- Sale and listing creation return 400 if the card is flagged personal collection — must uncheck first.

### Alerts
- eBay Listings and Card Show alerts gained a delete button; ignored items stay visible (dimmed) with an undo.
