# Reactor — Changelog

## June 13, 2026

### Fixes

**Imports — `card_instances.card_game` always written as 'pokemon' regardless of catalog game**
- All three insert paths in `import.service.ts` (graded CSV, raw purchase, legacy cards) were hardcoded to write `card_game: 'pokemon'` when creating `card_instances` rows. Even though `pokemon_set_aliases` correctly tagged Weiss / Union Arena / Black Clover set codes (SAO, KGL, BCV, SPY, etc.) with the right game, and the resulting `card_catalog` row carried `game = 'weiss-schwarz'` / `union_arena` / etc., the inventory row attached to it was force-stamped Pokémon. Result: imports rendered correctly in the catalog but binned under Pokémon everywhere the frontend filtered on `ci.card_game` (Inventory Summary, Reports, listings).
- Surfaced by a prod user (wanchi) whose entire Weiss Schwarz collection appeared under Pokémon. 80 instance rows + 4 catalog rows reconciled (4 of the catalog rows were also mislabeled as `pokemon` for clearly non-Pokémon cards: Noelle Silva / Miku Nakano / Catwoman / Coco — all updated to weiss-schwarz).
- Fix reads `card_catalog.game` after `getOrCreateCatalogId` resolves and uses that for `card_game`. Falls back to 'pokemon' only when no catalog match exists (legacy import already supports an explicit `card_game` CSV column).

### Features

**Inventory — Add Card / Add Slab now have a dynamic game picker with inline "+ Add new game"**
- Both quick-add forms had hardcoded `<select>` lists (Add Card: pokemon / one_piece / mtg / other; Add Slab: pokemon / one_piece / other) that didn't include Weiss Schwarz, Union Arena, or any user-registered game. The "Other" escape hatch produced rows tagged with the literal string `other`, which was useless — they couldn't be filtered, attributed to a set, or rolled up against any catalog.
- New shared `CardGameSelect` component queries `/sets/games` (same query key as the Catalog page, so the dropdown stays in sync with the rest of the app) and renders one option per registered game. A "+ Add new game…" sentinel opens an inline name + SKU prefix panel that POSTs to `/sets/games` and refetches before assigning the new game to the form — same pattern as `AddPartModal`.
- "Other" removed entirely. Every game must now be registered in `card_games`, which keeps `card_catalog.game` and `card_instances.card_game` aligned on a known vocabulary.

**Slab Detail — cert-uniqueness guards on every write path**
- `processReturn` rejects payloads that reuse a cert within the same return or against any existing slab for the company (catches the May 6 PSA dupe import and the cert 145655318 sub-return collision that produced two slabs from one return).
- `createCard` (Add Slab API) and `updateCard` (Slab Detail edit) now check `(user_id, company, cert_number)` and 409 if the cert already exists on another slab.
- Graded CSV import path checks the same constraint per row inside the existing try/catch so a single bad row doesn't kill the whole import.

**Slab Detail — Personal Collection + Card Show mutual exclusion**
- Personal Collection (intent: not for sale) and Card Show (intent: actively selling) are contradictory. The modal now shows an inline warning when both are toggled and the server still accepts either independently — the warning is purely a UX guardrail.

**Card Number — normalize to numerator-only at every write site**
- Users were typing card numbers as printed on the card (`215/172`, `110/100`) instead of just the numerator. New `normalizeCardNumber` util splits on `/` and trims; applied at every write site (`cards.service`, `catalog.service`, `raw-purchases.service`, `grading-submissions.service`, `import.service`).
- UI placeholders updated: Add Slab "Card Number" placeholder changed from `e.g. 4/102` → `e.g. 4` with hint "numerator only — e.g. 4, not 4/102"; Add Part Number modal got the same hint inline.

## June 11, 2026

### Features

**Edit Line Item — three tabs: Fix Identity, Replace from Inventory, Replace from Legacy**
- The pending-sub Edit Line Item modal used to only let you change Qty / Expected Grade / Est. Value. When a wrong `card_instance` got accidentally linked at sub-add time, the only recovery was deleting the line and re-adding it — losing position and needing to retype every other field. Worse, by the time the sub came back as returned the misidentification was baked into the slab.
- New tabbed UI mirrors Add Card to Batch:
  - **Fix Identity** — auto-fill from a pasted card name, then edits the *existing* linked `card_instance`'s overrides (name, set, #, language) and re-resolves the catalog link via `createCatalogResolver`. Use when the typo is in the identity but the right physical card is linked. Drives the slab's display + catalog attribution on the next return because `processReturn` reads from the source ci.
  - **Replace from Inventory** — single-card picker that points `gbi.card_instance_id` at a different inspected raw card via the new `POST /grading-subs/:id/items/:itemId/relink` endpoint. Restores the old `card_instance` to `inspected` / `decision=grade` (guarded — only flips when current status is `grading_submitted`, mirroring removeItem's guard so a back-linked sold slab can't be clobbered). Moves the new one to `grading_submitted` and clears `location_id`. Validates qty against the new card's available stock minus any other batch items already using it.
  - **Replace from Legacy** — full PartNumberField + legacy bucket picker, same UX as Add Card → Legacy. Uses `POST /grading-subs/:id/items/:itemId/relink-legacy`, which delegates to `addLegacyItem` then deletes the old gbi, restores the old ci, and slides the new line into the old `line_item_num` slot so display order is preserved. Reordered so `line_item_num` capture happens *before* `addLegacyItem` runs — if the bucket-validation throws, the old gbi is untouched.
- Fix Identity gains a **Raw ID** input. Pass `raw_purchase_label` (e.g. `2025R109`) and the server looks up the matching `raw_purchases.id` and re-links the source `card_instances.raw_purchase_id`. Blank string detaches. 404s cleanly if the label doesn't match.
- Replace from Inventory placeholder updated to call out Raw ID search; **Exact** toggle renamed **Exact ID** with a tooltip. The `/cards` endpoint already supported `purchase_id` in both fuzzy and exact modes — this just makes the affordance obvious.
- `relinkItem` rejects terminal-state targets (`graded` / `sold` / `lost_damaged`) so a direct API call can't clobber a slab by silently flipping its status to `grading_submitted`.

**Part Numbers (Inventory Summary) — 3-level hierarchy + In Grading column**
- Same part number with multiple grades + name variants used to render as a flat list of (sku × name × grade) tuples — 5+ rows for a single Slowpoke. Defeats the point of the catalog roll-up.
- New hierarchy on the Part Numbers page:
  - **Level 1**: part number summary (unchanged structure).
  - **Level 2**: one row per `(grade_label, company)` for graded slabs, plus a single **Raw** row if any raw cards exist. Grade rows sort DESC; Raw goes at the bottom. Single-variant buckets render flat inline with no extra chevron; multi-variant buckets show `N variants` with an expand chevron.
  - **Level 3**: `card_name_override` variants under multi-variant buckets, surfaced when level 2 is expanded.
- Added an **In Grading** column. Server's `getInventorySummary` now splits the old unsold bucket: rows at `status='grading_submitted'` (cards in transit to PSA) move to `qty_in_grading` so they no longer inflate the "available stock" count. Invariant `qty_total = qty_unsold + qty_in_grading + qty_sold` verified to hold across every prod row. No other consumer reads `qty_unsold`. Returned slabs continue to count under their `(grade, company)` graded line; the original raw line (now `graded_out=true`, `quantity=0`) contributes 0 — so no double counting.

**Dashboard — Pipeline tile splits Sell-Through into Graded + Raw 50/50**
- Single Sell-Through number replaced with a 2-column micro-stat inside the same tile cell. Computed client-side from `cards.sold.graded / (cards.sold.graded + cards.unsold.graded)` and the same formula for raw. Underneath each %, a small `sold / total` count makes the underlying numbers visible without drilling in. No server change, no row-height change, no layout reshuffle.

### Fixes

**Grading — Edit Legacy form rows misaligned + auto-fill leaves stale catalog match**
- The Replace from Legacy / Add Card → Legacy forms had a Quantity field that drifted out of vertical alignment with the Cost / Card cell next to it whenever the Cost label wrapped to two lines. Grid rows now use `items-end` so the input baselines stay aligned regardless of label height.
- The Auto-fill button populated the form's identity fields but didn't reset `PartNumberField`'s cached match, so the stale lock-in stuck until the user manually clicked the X. Now clears `catalogMatch` + `catalogId` after a successful auto-fill so the field re-resolves against the freshly-filled identity.

**Inspection — returned-graded raw lots falsely reappear in Needs Inspection**
- `raw-purchases.service.listRawPurchases` and `reports.service` both computed a lot's processed count as `SUM(quantity) FROM card_instances WHERE raw_purchase_id = rp.id`. After `processReturn` zeroes the source raw row's quantity (graded_out=true) and creates the new slab `card_instance` with `raw_purchase_id = null`, that sum drops to zero — so a fully-graded raw lot fell back into the Needs Inspection filter on the Inspection page and into the dashboard's `awaiting_intake` gap.
- Verified against prod: every raw lot whose source went through either of the two PSA returns (June 6, 11 lots; June 10, 42 lots) was stuck this way. The bug actually predates migration 057 — the prior hard-delete behavior produced the same zero-row sum — it just hadn't been noticed because the first really large return was the 195-card one.
- Fix adds a slab-from-this-lot subcount to both the SELECT and the HAVING clauses: `+ COALESCE((SELECT COUNT(*) FROM slab_details sd JOIN card_instances src ON src.id = sd.source_raw_instance_id WHERE src.raw_purchase_id = rp.id), 0)`. Slab `raw_purchase_id` stays null so cost-basis reports and raw inventory totals are unchanged. Verified with the same prod query — all 53 affected lots now return processed = card_count.

## June 9, 2026

### Features

**Sub Returns — View Return modal with grade distribution + origin context**
- Returned-sub rows on the list page are now clickable; click anywhere on the row (except the Revert Return cell, which stops propagation so it stays a discrete action) to open a View Return modal styled to match the existing Review Return panel. Eye icon dropped — whole-row click felt more natural.
- New endpoint `GET /api/v1/grading-subs/:id/returned-slabs` joins `slab_details` → `card_instances` → `card_catalog` → original raw `card_instances` (via `sd.source_raw_instance_id`) → `raw_purchases` → `grading_batch_items` for one batch.
- Left pane lists every slab returned by that sub with Card / Cert # / Grade / Label / Raw ID / Expected Grade / Condition / Notes. Right pane shows a per-sub Grade / Count / % summary table (grade DESC, totals row). Expected-grade cell is colored green when the actual beat it and red when it missed. Slabs ordered by `cert_number` ascending so the list reads in natural cert order.

### Fixes

**Sub Returns — Cards column was counting line items, not cards**
- Returned-sub list table column labeled "Cards" was showing `item_count` (count of `grading_batch_items` rows). For a 195-card sub split across ~80 line items it read "80". Mirrored the Grading page pattern: split into "Line Items" + "Total Cards" so both numbers are visible at a glance. `Batch` type gained `total_qty` (already returned by `listBatches`). Select Submission modal subtitle also updated to show both ("N cards · M lines").

**Sub Returns — remap dropdown showed only the card name, slider scrollbar on Card column**
- Remap column options were just card name + line # — same card across two lines was ambiguous. Options now read `#{line} {Name — Set — #card}`. Card column had a horizontal scrollbar because the textarea was fixed-width with overflow; switched to inline `fieldSizing: 'content'` with `overflow-hidden` so it word-wraps and auto-grows. Card column widened from 260px → 325px and Remap shrunk 220px → 155px to balance the gain. Native `<select>` can't render multi-line text in its closed state, so Remap is now an invisible native select overlaid on a wrapped text display — keeps native click/keyboard behavior with full word-wrap on the selected label.

**Sub Returns — Select Submission modal listed newest sub first**
- Returns come back from PSA in submission order so the oldest sub is almost always the next one to record. Submitted batches in the modal are now sorted `submitted_at` ascending (earliest first) and each row shows the submit date next to the batch ID.

## June 8, 2026

### Features

**Dashboard — Today pill on the revenue window selector**
- Added a Today option in front of 30D / 60D / 90D / This Year / Lifetime on the Overview revenue strip. Boundary is calendar-day midnight server-local, not a rolling 24h — matches how a card-show / POS day is read (clean $0 morning, no carry-over from yesterday's afternoon). Server gains a `queryToday` + `channelQueryToday` that hit the same SQL with `sold_at >= todayStart` and reuses the existing `expensesQuery` from-date branch. Response gets a `today` arm at top level and inside `by_channel`. Client added one arm to the `SalesWindow` union, the `wk`-key derivation, and the `SALES_WINDOWS` array — no render changes; the stat-tile grid was already keyed off `windowData`.

**Dashboard — Card Shows by-channel tile shows graded/raw breakdown**
- eBay tile already displayed `N listed · X Graded / Y Raw` but Card Shows only had `N unsold · M total inventory`. `cardCounts` query now also returns `card_show_graded` and `card_show_raw` via the existing `slabCheck` EXISTS pattern. Dashboard renders the new breakdown in place of the old total-inventory line.

**Grading — returned-cert column + status filter tabs on sub detail / list**
- Sub detail items table renders a Returned Cert column only when `data.status === 'returned'`. Server `getBatch` selects the slab's cert number + grade label via two scalar subqueries on `slab_details` (`source_raw_instance_id` matched in scope — kept live by migration 057's soft-convert refactor).
- Sub list header gains All / Adding / Submitted / Returned tabs next to the title (later moved to the right side of the header next to the Start Sub button to match the Intake page's title-left/filters-right pattern). Each tab carries its own count. 'Adding' maps to `status='pending'` which already displayed as "Adding Cards". Empty state text adapts to the active filter.

**Sales — clicking a cert in eBay set sale auto-pulls the whole set**
- Recording a Set Listing sale required adding every cert one by one even though they all share the same eBay listing URL. Picking a graded row now: if `bulkIsEbay && r.listing_url` is non-null, GET `/listings/by-url/all`, add every sibling (deduped against the current cart) in one click. Toast confirms `Added N cards from set listing`. Falls back to single-card add if no URL or the fetch errors. `SlabResult` gained `listing_url`; URL-mode (Listing URL tab) was already a whole-set lookup and is unchanged.

### Fixes

**Sales — recordSale's slab guard + cache invalidation after sale + listings cert search**
- Three connected issues. (1) `recordSale` only checked `card.status === 'sold'`. Confirmed on prod: cert 141640159 had a May-6 card_show sale; audit shows the card was silently reverted to `'inspected'` on May 23 without the sale row being deleted; today a second card_show sale was recorded against the same card. Added a slab-only secondary guard: if `slab_details` exists for this `card_instance_id` and any sale row exists, reject with `"A sale already exists for this slab"`. Raw lots with quantity>1 legitimately accumulate multiple sales so the guard is slab-gated. Prod data for the affected card was fixed via direct UPDATE (`status -> 'sold'`); zero other orphan slabs found.
- (2) Only `['sales']` was invalidated on sale completion, leaving the card-name search, copies picker, bulk search, slab inventory, raw inventory, listings, and dashboard summary caches stale — letting the just-sold cert reappear in the picker on reopen until React Query's own `staleTime` kicked in. Centralized into `invalidateAfterSale()` covering all relevant keys and wired into the single-sale and bulk-sale completion sites.
- (3) Listings page search box matched only against card name. Searching cert `152584770` returned "No listings found" even though the cert was listed under that name. Extended `searchCond` to OR against `sd.cert_number::text`, `cc.sku`, and `rp.purchase_id`. The graded-set CTE gained a `certs_concat` STRING_AGG and matches it under the same ILIKE so set rows surface when any sub-cert matches the query.

**Grading — guard revert-to-inspected updates on batch_item removal (root cause of the May 23 corruption)**
- `deleteBatch` and `removeBatchItem` unconditionally set the linked card's `status='inspected', decision='grade'` when reverting a batch item, regardless of what state the card was actually at. A back-linked sold slab (`decision='already_graded'`, `status='sold'`) that ever passed through a batch and got removed would have its terminal status silently clobbered to `'inspected'` without anyone touching its sale row — producing the exact `sold -> inspected` audit event on cert 141640159 that set up today's double-sell pretext. Added a `WHERE status='grading_submitted'` clause to both UPDATEs so the revert only fires when the card is actually in flight to the grader. Terminal states (sold, graded, lost_damaged) are left alone.

**Sales — single-sale picker skips set-listing certs + auto-jumps on cert match**
- Two footguns in the single graded sale flow. (1) FIFO auto-picked set-listing certs. Detection moved server-side via `is_set_listing` on `/grading/slabs`: TRUE iff the slab's `ebay_listing_url` has at least one sibling active listing for a different card. Same-card multi-qty listings correctly do *not* trip the flag; real cross-card sets are flagged regardless of which card the picker is filtered to. Client renders a rose SET badge alongside any FIFO badge with a rose-tinted card border; FIFO auto-pick uses `firstNonSetCopy`. Clicking a SET row or hitting Continue with a SET selection opens a Modal-driven confirm (rose action button) explaining the orphan-listing risk and offering the Set Listing flow. (2) Typing a numeric cert (3+ digits) that exactly matches a row's `cert_number` now skips the names dropdown and navigates directly to the copies step with the cert pre-selected; SET-cert guard on Continue still applies.

**Sales — strike price re-pulls when switching certs in the picker**
- Auto-fill effect bailed with `if (strikePrice) return`, so the FIFO copy's listed price would set strikePrice once and subsequent cert clicks couldn't update it. User picked a $1,484.99 cert and got the FIFO's $1,169.99 in Strike. Replaced with a `strikePriceDirty` flag that flips true only on user keypress. Auto-fill effects now re-pull on every `selectedCard` / `selectedRawCard` change unless dirty, so picker switches keep Strike in sync and manual edits are preserved. Dirty flag set from the three Strike onChange handlers. Modal unmount-on-close resets the flag naturally for the next sale.

**Grading — lock line + details edits when sub is not pending**
- Two leaks on the sub detail page allowed edits to a locked sub. Per-row trash gate was `data.status !== 'submitted'`, so it still rendered on `'returned'` subs and any future intermediate status. Edit Details button had no gate at all. Both now require `data.status === 'pending'`. For submitted subs the existing Unlock Sub button reverts to pending. For returned subs, unlocking requires reverting the return first (separate flow); the header shows a small *"Locked — revert the return to unlock"* note in place of the gone buttons so the path is obvious.

### Refactor

**UI — every native dialog call replaced with the styled Modal**
- `window.confirm` / `window.alert` / `window.prompt` produce un-styled OS chrome that breaks the dark theme and is generally bad JS practice (blocks main thread, untestable, inconsistent across browsers). Converted the three remaining sites: (1) Sales single-sale set-cert confirm now uses a `setConfirm` state with `'pick' | 'continue'` context so OK does the right thing; (2) Grading Add Card tab-switch warning uses a `confirmSwitchTo` state with a red "Discard & switch" action; (3) Intake `addNewSetForLine` uses a Modal with a styled uppercase input, Enter-to-submit / Escape-to-cancel, and a saving spinner. CLAUDE.md gained a hard rule forbidding native dialogs with rationale and Modal/toast pointers. Codebase verified free of `window.confirm` / `alert` / `prompt` calls.

### Security

**GitGuardian incident — Railway Postgres URL leak**
- `.claude/settings.json` got committed with a literal `postgresql://postgres:<password>@shinkansen.proxy.rlwy.net:22787/railway` baked into one of the auto-allow Bash patterns. GitGuardian flagged it within minutes of push. Credential rotated in Railway (auto-propagated to linked services). File scrubbed in a follow-up commit; `git rm --cached` untracked it; `.claude/settings.json` + `settings.local.json` added to `.gitignore`. Secret still exists in commit `6f08968` history but the credential is dead so it no longer matters.
- CLAUDE.md gained a "Secret handling (non-negotiable)" section: never inline literal secrets anywhere outside `server/.env`; always resolve prod DB via `railway variables --kv` at runtime; tripwire substrings (`postgres://`, `sk-`, `_SECRET=`, etc.) that should pause before any commit; rotate-first recovery playbook.

### Docs

**CLAUDE.md — header layout, filter-pill styling, and dialog rules**
- Recurring back-and-forth on filter placement and button styling (twice in the same session for the Grading page alone) prompted a mandatory pattern in CLAUDE.md. Header is `flex items-center justify-between px-6 py-4 border-b border-zinc-800` — title left, filters + primary action grouped right in a single `flex items-center gap-3` wrapper, modeled on `Intake.tsx`. Filter pills use exact class set: `px-3 py-1 text-xs rounded-md font-medium transition-colors` with `bg-indigo-600 text-white` active / `bg-zinc-800 text-zinc-400 hover:text-zinc-200` inactive. Count spans inside pills use `ml-1.5 text-[10px]` with `text-indigo-200` / `text-zinc-500`. Variations explicitly forbidden.

## June 7, 2026

### Features

**Grading — raw cards are soft-converted on return instead of hard-deleted (migration 057)**
- `processReturn` used to hard-delete the source raw card_instances when all copies were fully consumed by grading. The deletes cascaded two ways: `slab_details.source_raw_instance_id` (ON DELETE SET NULL) nulled out the slab's link back to its origin, and `grading_batch_items.card_instance_id` (FK dropped in migration 055 to even allow the delete) was left holding a dangling UUID. End result: reverted subs came back empty, audit-log re-insertion was needed to put cards back, and `revertReturn` had a 100-line audit-restore branch with edge cases. Worse, even a successful return left the sub detail page empty because the batch_items pointed at the deleted source.
- Migration 057 adds `card_instances.graded_out boolean default false` + a partial index on the true subset, and relaxes `card_instances_quantity_check` from `> 0` to `>= 0` so a fully-consumed row can carry `quantity = 0`. `processReturn` now flips the source to `graded_out=true, quantity=0` instead of DELETE. The source row stays alive forever, slab linkage stays valid, batch_items references stay live, and the sub detail page can JOIN through them for lifecycle display.
- `revertReturn` simplifies dramatically: no more audit-log re-insertion branch. For each batch_item, look up the live source and `UPDATE … SET graded_out=false, quantity = quantity + N, status='inspected', decision='grade'` where N is the count of slabs we just deleted from that source. Slabs are still found via `grading_batch_id` for the delete pass; `source_raw_instance_id` is also valid now (no cascade-to-null), so per-source attribution is exact.
- Filter rules: raw inventory queries now default to `graded_out = false` so soft-converted rows don't double-count against the slabs they produced. `/cards` list endpoint gains an `include_graded_out` opt-in for lifecycle/audit surfaces that intentionally want them. `listCardsGroupedByPart`, the Raw Cards dashboard's `inventoryByType` / `condition` / `pipeline` / `sales` / `turnover` queries, and the global Pipeline's `at_graders` / `unsubmitted` / `unsubmitted_cost` / `avg_days_at_graders` all picked up the filter.
- One-off prod cleanup: sub `26395859` had 11 orphan batch_items pointing at hard-deleted card_instances from before this migration. Restored the 11 sources from the audit-log snapshots with original UUIDs at `graded_out=true, quantity=0`, repointed the 11 slabs' `source_raw_instance_id` back via cert-number ordering, in a single Railway transaction. Sub view shows its line items again with correct slab linkage.

### Fixes

**Catalog — set picker token scoring**
- The Set Name / Set Code combobox in Add Part Number was doing a single substring `.includes(query)` match, so multi-word inputs (e.g. "2025 Taruka Hoppip") returned zero suggestions when the relevant alias only contained "Taruka". Replaced with a small scoring model: 4 pts for full-string substring, 2 for code prefix, 1 per token hit in name or code; pure 4-digit year tokens ignored to avoid year-name pollution; sort score desc, tie-break shortest name.

## June 6, 2026

### Fixes

**Grading — revert of a returned sub actually undoes the return**
- `revertReturn` looked up slabs to delete by `slab_details.source_raw_instance_id`, which has `ON DELETE SET NULL`. When `processReturn` hard-deletes a fully-consumed source raw card (every qty went to grading), the cascade sets every linked slab's `source_raw_instance_id` to NULL. So `revertReturn`'s per-source query returned zero rows, `slabsDeleted` stayed 0, and the per-batch_item `continue` skipped the source-restore step too — while the batch status flip still happened and the success toast still fired. End result: slabs lingered in graded inventory, sources weren't restored, reverted sub came back empty, and the user had to clean up manually.
- Fix: slab cleanup now keys on `grading_batch_id` (preserved through any source-raw deletes), tracking per-source deletion counts for the restore step. Both restore paths (partial-consumption update; fully-consumed audit-log re-insert) now set `status='inspected', decision='grade'` so the sub reopens with its cards visible and re-routable. Locked slabs (sold or listed) still survive and are reported via `kept_slabs`.
- One-off prod cleanup: the `26395859` batch on prod had 11 orphan `grading_batch_items` (lines 1–11) pointing at hard-deleted card_instances from the broken revert. Deleted the orphans and renumbered the surviving 11 items down from 12–22 to 1–11 in a scoped transaction (sandond77 only).

**Grading — Edit Submission Details modal now lets you change the name**
- The Create modal auto-generates a submission name from date + company + tier, but the Edit modal didn't expose it. Once a batch was created you were stuck with whatever auto-name it got. Added a `Submission Name` input at the top of the Edit modal pre-filled with `batch.name`, included in the PATCH body. The server's `updateBatch` already accepts the field; client just wasn't sending it.

**Grading — Add Card to Batch lets you re-add the same card up to inventory qty**
- PSA grades cards under one line item sequentially (one cert, qtys 1-of-N through N-of-N of the same card). If a user has N copies of a card and wants each graded as its own cert, they need N separate line items at qty=1. The Add Card modal hard-blocked re-adding the same `card_instance` with an `alreadyInBatch` filter — once added at qty=1, the card disappeared from search and the user couldn't add another line item for it.
- Client: filter removed. Track per-card_instance qty already in the batch and per-card_instance qty already in the current modal selection. Cap the row's qty input at `inventory − in-batch − pending`. Search result rows show `in batch: N` and `pending: N` chips and disable when the remaining qty hits zero.
- Each `BulkAddRow` now carries a unique `rowId`, so the same `card_instance_id` can appear in multiple selection rows in one add — supporting the workflow where you click the same card 13 times to create 13 separate line items.
- Server: `addItemsBulk` validates total qty across all batch_items for a `card_instance` can't exceed `card_instance.quantity`, combining this call with what's already in the batch. Returns a clear 400 with the remaining qty if over-allocated.

## June 5, 2026

### Features

**Mass Import — Migration Guide + persistent Field Reference sidebar**
- Onboarding gap reported by a beta user: the importer assumed you already knew the schema. New users had no scaffolding to prepare their CSV or understand what each column should contain. Added a Migration Guide card on the upload screen that lists the four import types (Graded Cards, Raw Purchases, Bulk Sales, Expenses), each with a one-line "when to use this" description, color-coded required/recommended field chips, and a per-type Template download link. The chips carry per-field `title` tooltips so hovering any field name surfaces what to put in it.
- New page-level layout splits the Import page into a 3-column main area (75%) and a persistent Field Reference sidebar (25%). Reference is always visible — initial upload state, preview state, and after-result — so users can map columns without losing the field documentation. Uses a CSS Grid with an absolutely-positioned reference Card inside its grid cell, so the row height is determined by the main column alone and the reference fills that height (and scrolls internally when its content is taller). `lg:min-h-[50vh]` keeps the sidebar from collapsing when the main column is short.
- Field Reference content: every mapping target field gets a one-line description (`card_name` → "Full card name as printed. Required for graded + raw imports. For PSA labels, paste the entire label.", `cost` → "Total cost of the order. Use for raw purchase imports (sums per row × quantity).", etc). Grouped by Card / Graded / Purchase / Sale / Listing / Expense / Bulk Sale. On the mapping screen the same descriptions render inline under each active dropdown, and the `<option>` elements carry per-field `title` tooltips for hover.

### Fixes

**Edit Listing — sub-row click opens a per-listing modal instead of a batch editor**
- Clicking a sub-row in the aggregated listings table previously opened the `EditListingModal` in group-edit mode — the modal showed every listing in the rollup and the bottom URL + Price fields would PATCH every one of them. Editing one price rewrote them all. `editRow` state now tracks both the parent row and the clicked `cert`; when a `cert` is provided the modal scopes to just that listing: header reads "1 listing", the listing list shows only the clicked one, bottom URL + Price are pre-filled with that listing's values, and save calls `PATCH /listings/${listingId}` instead of the group endpoint. Delete becomes "Cancel this listing" and routes to the single-listing endpoint. Parent click on a non-aggregated row still opens group-edit (which targets the one underlying listing) and graded set rollups still get the batch flow since a set is one eBay listing with one shared URL + total price.

**Raw Overall — hide graded children from the lot sub-row breakdown**
- The Raw Overall view expanded each raw lot to show its commerce breakdown (raw_for_sale, sold, grading_submitted, graded, lost_damaged). But `graded` children are also surfaced in graded-slab inventory — leaving them in the raw lot view double-counted them visually and was confusing. Added `'graded'` to the sub-row exclusion list alongside `'inspected'` and `'purchased_raw'`. `grading_submitted` stays since those cards are still raw, in flight to a grader.

**Raw listings — aggregate by part number, expand to per-listing details**
- The non-set listings query was grouping raw rows by `sku + condition + platform + currency + list_price + ebay_listing_url`, so two listings of the same SKU at the same condition + price + URL collapsed into one row but anything that varied — different conditions, different prices, different eBay URLs — fanned out into separate rows. A card with one LP / one NM / two NM- listings showed as three rows. There was no way to drill into which underlying listings rolled up since the graded chevron didn't render on raw rows. Now raw rows aggregate by `sku + platform + currency` (matches graded single behavior), so all listings of the same card on the same platform collapse to one row.
- The chevron renders on any row whose `cert_details` has more than one entry, regardless of tab. Raw rows now carry per-listing details: removed the `FILTER (WHERE sd.id IS NOT NULL)` guard on the cert_details `JSON_AGG`, added `condition` and `raw_purchase_label` (the `RP-YYYY-NNN` form) to each element. `CertDetail` on the client picked up both as optional fields.
- Parent row always blanks per-listing fields (Purchase ID, Condition, Platform, Price, eBay URL) regardless of listing count — only Part #, Card Name, # Listed, and # Sold render. Mirrors the graded singles UX where the parent is the summary and the sub-rows are the individual listings.
- Chevron renders on every raw row with at least one listing (was: only when count > 1). Click on the parent row always toggles inline expansion — the edit modal no longer opens on parent click. To edit a specific listing, expand and click the sub-row, which opens the existing `EditListingModal` with per-listing cancel buttons.
- New raw expansion render block matches the graded expansion layout (vertical-line indicator under Part#, indented `Purchase 2026R223` label that mirrors the graded `Cert #...` convention, empty trailing cells so column alignment stays intact). Each sub-row shows the purchase ID, condition, individual price, and individual eBay URL. Platform stays on the parent since it's part of the GROUP BY (each row is one platform).

## June 4, 2026

### Fixes

**Graded Set listings — # Listed / # Sold now count sets, not cards**
- The Graded Set tab's # LISTED column read `COUNT(DISTINCT l.id)` against the listing_group_id rollup, so a 3-card set showed `3` even though it was one set listing — easy to misread as "I have 3 set listings." # SOLD was hard-coded to `0`, so a sold set with the same composition (different physical certs) silently disappeared instead of surfacing on the matching active row.
- Rewrote the query with a two-stage CTE: `per_group` rolls up each `listing_group_id` and emits a sorted **composition signature** (`{name, grade, company}` tuples), `has_active`, and `all_sold` flags. `comp_counts` aggregates by composition: `num_listed = COUNT(WHERE has_active)`, `num_sold = COUNT(WHERE all_sold)`. The display still emits one row per active group — so $375 and $337.50 versions of the same set stay as separate rows — but each row carries the composition-wide counts. The previously-sold Snivy/Servine/Serperior set now surfaces as **# Sold = 1** on the still-active row, and the # Listed column counts sets rather than constituent cards. Cancelled groups are excluded from both counts. Search filter applies against a `names_concat` rollup so any card name in the set matches the whole row instead of dropping non-matching component listings.

**Graded Set listing flow — on-show indicator + non-show first ordering**
- The Set-mode cert picker (separate code path from the single-slab picker fixed earlier) had no on-show indicator. Same UX as the single flow now: card-name search results show an "N on show" badge next to unsold count; cert picker sorts off-show certs first; each cert row displays a fuchsia **On Show** badge when applicable. Manual click still works on any cert — only `takenElsewhere` (already picked in another slot) blocks selection.

**Raw-purchase import — type=raw rows now create matching `card_instances`**
- `executeRawPurchaseImport` only inserted a `raw_purchases` row per CSV line; the matching `card_instances` was never created. Every imported single-card raw order showed up under "Orders → Received" but **zero cards in inventory**, which is what made the Raw Cards dashboard look broken (Raw filter empty, Bulk view only showing the few cards that had been added by hand via the inspection panel). Fix: when `type='raw'`, also `INSERT INTO card_instances` with `purchase_type='raw'`, `status='purchased_raw'`, `quantity=card_count`, the imported cost, language, catalog/override fields, and `raw_purchase_id` pointing back at the new order. Bulk imports are unchanged — bulk is a lot, intake happens later via inspection.
- Local backfill: 13 orphan raw orders (`2025R1`–`2025R2`, `2026R1`–`2026R11`) got their missing `card_instances` rows inserted via a one-shot scoped `INSERT ... SELECT`. Prod was checked and had zero orphans, so no prod backfill was needed.

**Raw Cards dashboard — surface the bulk intake gap**
- New **Awaiting Intake** row in the Pipeline → Orders block, rendered in amber, only shown when `> 0`. Computed server-side as `SUM(GREATEST(rp.card_count − SUM(ci.quantity), 0))` over received raw_purchases, type-filtered like the rest of the panel. So Bulk view shows how many cards from received lots still haven't been split into `card_instances` (e.g. a 50-card bulk that's been partially inspected reports `card_count − sum(quantity)` outstanding). Raw view normally reads 0 once each raw order has its instance. `ordersQuery` was rewritten as a CTE so both `card_count` and per-rp `gap` could be summed in one trip.



**Card Show Inventory · Raw tab — replace inline CS Price input with row-click modal**
- The Raw tab's inline CS Price `<input>` + per-row × button shipped with May 31 didn't match the rest of the app — every other inventory surface uses a row-click → detail modal pattern. CS Price column is now read-only emerald text and clicking the row opens `CardDetailModal` in a new `cardShowMode`.
- `CardDetailModal` gains a `cardShowMode` prop that mirrors `SlabDetailModal`'s card-show behavior: view mode shows a CS Price row in the details grid; **Edit** collapses the form to a single CS Price (USD) input with a "to change card details, edit from Raw Overall" hint so card-show editing doesn't accidentally touch cost / condition / location; the footer's Delete button is replaced by **Remove from Card Show** with a two-step confirm that PATCHes `{ is_card_show: false, card_show_price: null }`.
- Dead code dropped from `Overall.tsx`: `rawPriceDraft` state, `rawPriceMut` + `rawRemoveMut` mutations, `commitRawPrice` helper, and the now-unused `useMutation` / `toast` imports. Pagination footer math (which keys off `cardShowMode && cardType === 'raw'`) is unchanged.

### Features

**AI Agent — `get_card_show_report` tool with multi-day prompt flow**
- Mirrors the existing `/reports/card-show-breakdown/:showId` endpoint as an agent-callable tool, so the agent can summarize a show end-to-end the same way the Reports page does — slab + raw counts, gross revenue, net revenue, total cost basis, profit. Previously the agent could only recite the sales it had personally recorded that session and silently missed anything entered via the browser.
- Multi-day shows get a prompt loop. When the show has multiple days and the agent calls the tool without a `day` arg, the response includes the overall totals **plus** a `days_available: [1, 2, 3]` array and a `note` field instructing the agent to ask the user whether they want the overall report or a specific day. A follow-up call with `day=2` returns just that day's slice. Single-day shows skip the prompt and return overall directly.

**AI Agent — eBay order URL parsing on Record Sale**
- Pasting an eBay order-details URL into the **Order Details Link** field now auto-fills **Order #** from the `orderid` query param. `parseEbayOrderId()` swallows malformed URLs and only fills when Order # is currently empty, so a manually-typed order number isn't clobbered. Wired into both the single-card eBay sale form and the eBay set bulk-review form — one less copy-paste step on every eBay sale.

**AI Agent — `update_sale`, `delete_sale`, `list_card_shows` tools + `card_show_id` filter on `list_sales`**
- The agent could record sales but couldn't edit or remove them. Added `update_sale` (partial update on platform / sale_price / fees / shipping / sold_at / etc.) and `delete_sale` (which routes through the existing service so the underlying card is restored to inventory — graded → graded slot, raw → raw quantity refund).
- `list_card_shows` returns active + past shows so the agent can resolve a show by name without the user having to paste an ID.
- `list_sales` gained a `card_show_id` filter and its default limit was bumped from 20 → 50 (cap 50 → 500). Previously summarizing a show only saw the most recent 20 sales and silently truncated older browser-entered ones — now the agent can pull a full show's worth in one tool call.

### Fixes

**Delete Sale confirmation — wrong label for raw sales**
- The confirmation modal said *"returned to inventory as graded"* even for raw sales. Now keys off `sale.cert_number` (`"graded"` when present, `"raw"` otherwise) so the label matches what the server actually restores when delete is confirmed.

**Listings page — raw rows of same SKU collapsed across conditions**
- Two raw listings of the same card in different conditions (e.g. NM + LP) were merging into a single grouped row because the `GROUP BY` only used `cc.sku + grade_label`. Added `CASE WHEN sd.grade_label IS NULL THEN ci.condition END` to the grouping key so raw rows split by condition while graded rows still group by grade.

**Record Sale on eBay — CS Price input was redundant**
- eBay sales hid the CS Price (per-card sticker) input — Listed Price is the only reference that's relevant on that platform, and showing both was confusing. CS Price still renders on all other platforms.

**eBay listing flow — FIFO auto-pick now avoids card-show certs + click-to-swap**
- When listing a multi-copy graded card on eBay, the cert picker's FIFO default would happily auto-select a cert that was already sitting on the card-show table — easy to miss, and the only way to override was to bump qty up, click the cert you actually wanted, then drop qty back down and deselect the original. Now FIFO sorts `is_card_show=false` first before slicing to `qty`, so the auto-pick skips on-show certs whenever an off-show one is available. Falls through to picking on-show certs only when they're the only option.
- Click-to-swap at limit. Previously clicking an unselected cert when you were already at `qty` was a no-op (cursor-not-allowed). Now it swaps in place — drops the first-inserted entry from the selection and adds the clicked one — so changing your mind is a single click instead of a deselect-then-reselect dance.
- **On Show** indicator surfaces in three places: a fuchsia badge next to the cert number on the per-cert row, an inline "· N on show" tag in the count summary on the cert pick step ("5 unlisted PSA 10 copies · 2 on show"), and an "N on show" badge on each card-name row at the search step so you can see at a glance which titles have show inventory before drilling in.



### Features

**Record Sale modal — set CS / Listed prices without leaving the flow**
- For any sale platform, once a card is picked the details step renders a **CS Price (sticker)** form line above Strike Price. Saves on blur via `PATCH /cards/:id`, updates `selectedRawCard` / `selectedCard` locally so the "CS: $X" summary line above re-renders without a refetch, and invalidates `['sale-raw-search']` + `['card-show-raw']` so other surfaces stay in sync. Helper text underneath notes it persists to the card automatically and is independent of the Strike Price recorded for this sale.
- For eBay sales specifically, a second **Listed Price (eBay)** form line renders next to CS Price (two-column grid on `sm+`, stacked below). Editable: saves on blur via the new `PATCH /listings/:listingId` endpoint, reflects into `selectedRawCard.listed_price` / `selectedCard.listed_price` so the summary re-renders, and invalidates `['sale-raw-search']` + `['listings']`. Disabled with `— no active listing —` placeholder when the card isn't currently listed; empty value is rejected with a toast suggesting the Listings page cancel flow instead of nulling the price.
- New endpoint **`PATCH /api/v1/listings/:listingId`** accepts `{ list_price }` (dollars, coerced to cents server-side). Calls the existing `updateListing` service so an audit-log entry is written. Same shape as the existing group-update endpoint but scoped to a single listing — the new editable form line uses this.
- `listCards` (`/cards`) now exposes `al.id as listing_id` on every row alongside the existing `listed_price`, so the client can target the active listing for a raw card pick. `SlabResult` already had `listing_id` from the slabs query; `RawCardResult` on the client picked it up to match.

**Card Show Raw inventory — inline CS Price edit + remove button**
- Each row in the Raw tab of Card Show Inventory has its CS Price as an editable input (was static text). Type a new value, **Enter** or blur to save (`PATCH /cards/:id`), **Escape** cancels. Negative or non-numeric values rejected; empty clears the sticker to `NULL`. Draft state stays local until commit, so typing is responsive without round-tripping each keystroke.
- New per-row **×** button calls `PATCH /cards/:id` with `is_card_show=false, card_show_price=null` — mirrors how the SlabDetailModal removes a graded card from the show.

### Fixes

**Card Show Inventory pagination — Raw tab read graded counts**
- The pagination footer at the bottom of Card Show Inventory always read from the graded query's `data` object. On the Card Show > Raw tab the graded query is disabled, so the footer either rendered stale graded totals or — worse — clicking **Next** pushed `page` beyond the raw query's actual page count and the table rendered empty rows. Footer now picks `rawData` when `cardShowMode && cardType === 'raw'`, otherwise `data`; the Next button is properly disabled when there's no next page. Tab switching already resets `page` to 1, so no additional sync was needed.

## May 28, 2026

### Features

**Sub Returns rebuilt around a per-cert slot model (PSA CSV-driven)**
- PSA returns one row per physical slab and shuffles the order — the previous one-row-per-sub-line return form fell apart on multi-qty subs and on mixed legacy/non-legacy batches. The form now expands each sub-line of qty N into N independent **slots** (one per physical card). Server `processReturn` accepts a per-cert input array, groups entries by `batch_item_id`, creates one `card_instances` row (qty=1) + one `slab_details` row per graded entry, then decrements the source raw by the entries-in-payload count.
- **Multi-signal CSV matcher.** Replaces the line-number-then-name fallback with a scoring matcher: card name substring (4) + Jaccard token overlap fallback (up to 2), card # match (+3, **−3 on explicit mismatch**), year (1), set token overlap (up to 1.5), language (1), line position (1). Card # is now extracted from PSA's Description column when no separate column exists (PSA's CSV has Cert/Type/Description/Grade/After Service/Images — everything's embedded in Description). Greedy one-to-one assignment by score descending; the −3 mismatch penalty keeps confidently-wrong rows out of the picker. Confidence tiers Strong (≥8) / Good (≥5) / Weak (≥2) / Manual — each row's dot + score is visible in a Match column.
- **Preview + remap without re-upload.** After CSV match, every slot is editable in a wide table: Line · Card · ID · Cost · Exp · Cert # · Grade · Label · Match · Remap · Disposition. The **Remap** column is a dropdown listing every batch item so a mis-assigned slot can be reassigned in memory — no need to fix the CSV and re-upload.
- **Four dispositions per slot:** `graded` (default — creates the slab), `not_graded` (card returned ungraded — creates a new raw `card_instances` row back in inventory with cost = original + grading_cost), `lost` (write-off — consume source, no new row), `not_submitted` (never actually shipped — creates a new raw row with cost = original, no grading fee). Per-row **Ignore (×)** button drops a slot from the payload entirely (qty mismatch — source stays in `grading_submitted` to be handled in a future return). Only graded slots require cert # + grade; the others can submit blank.
- **CSV-import lock + per-row override.** Cert #, Grade, and Label are locked (read-only) once a CSV upload populates them so a user can't accidentally retype PSA's authoritative values. A small lock icon on each CSV-matched row toggles override — 🔒 (locked, default) → 🔓 (amber, editable). Manual rows are always editable.
- **Label dropdown sourced from `server/src/utils/grade-labels.ts`** — the same map the Dashboard's Grade Distribution chart uses. PSA `GEM MINT 10 / MINT 9 / NEAR MINT-MINT 8 / ...`, BGS `PRISTINE / GEM MINT 9.5 / ...` with full half-grade scale, CGC with both pre-2024 (Perfect 10, Gem Mint 9.5) and post-2024 (Pristine 10, Gem Mint 10, Mint+ 9.5) forms in the same list so legacy slabs and new submissions both resolve. ARS has no descriptive labels — UI shows the grade as plaintext. handleConfirm detects grade-inclusive labels (ARS) and skips re-appending.
- **Inputs validated server-side.** Empty `items` array → `400 Return must include at least one item`. Per-graded-item: `cert_number` must match `^\d{1,12}$`; `grade` must be a finite number in `[0, 10]`. Stops a typo from poisoning a half-applied return.

**Grading-cost edits propagate to existing slabs**
- Migration **056** adds `slab_details.grading_batch_id` (UUID → `grading_batches`, ON DELETE SET NULL). `processReturn` stamps it on every slab going forward. `updateBatch` now fans out any `grading_cost` change to every linked slab AND recomputes `sales.total_cost_basis` (via `computeCostBasis`) for slabs that have since been sold — so edit-after-return keeps cost basis correct on held inventory AND historical profit numbers correct on sold inventory. `grading_cost` is coerced to integer cents and validated `≥ 0` before update; comparison uses the coerced value so propagation only fires on real changes. Legacy slabs (created before migration 056) have NULL `grading_batch_id` and stay frozen at their snapshot value — no way to back-fill without traversing the audit log.

**Delete a sub now rolls back everything**
- For a **returned** batch: `revertReturn(skipLockedSlabs: true)` runs first — deletes every slab not currently sold or actively listed and restores the original raw `card_instances` from the audit log. Slabs that are sold or listed stay intact (you'd lose revenue records otherwise) and are reported back as `kept_slabs`. For each restored / still-pending batch_item, the card is then routed: **legacy** (`legacy_source_catalog_id` set) → quantity is credited back to an existing grade-decision stash row under the same bucket (or a fresh stash row is created), then the row is hard-deleted; **non-legacy** → status flips to `inspected/grade-decision` (the previous behavior). Batch row deleted, audit entry written.
- Client surfaces what happened: clean delete → "Batch deleted"; legacy credit → "Batch deleted. N card(s) credited back to legacy bucket."; sold/listed slabs survived → orange warning toast "Batch deleted. X sold, Y listed slab(s) kept in inventory." (6s). `revertReturn` standalone (Revert Return button on the Sub Returns list) now throws a specific 400 — `"Cannot revert — line 5 slab is sold. Unwind first or use Delete Batch."` — instead of silently failing on the dropped FK.

**Add to Card Show — multi-select cap + inspection notes on price step**
- The picker now caps at **5 cards** (down from unlimited) — counter reads `N of 5 selected`, rows beyond the cap dim to 40% with `cursor-not-allowed`. The price step's selected-card cell shows an **Inspection:** line under each raw card: amber notes when `condition_notes` / `notes` are populated, muted italic `no notes recorded` placeholder when empty so it's obvious nothing was captured. Graded cards don't show the line. `/cards` listing now returns `ci.condition_notes` alongside the existing `ci.notes` to feed this.

### Fixes

**`processReturn` FK violation on full-consume returns (migration 055)**
- `grading_batch_items.card_instance_id` had a no-action FK to `card_instances(id)`. When a qty-1 sub-line was fully returned, the original card_instance was deleted — but the FK from the historical batch_item blocked it with constraint `23503`. The same bug existed in the previous single-line code path but rarely surfaced; the per-cert rewrite triggers it on every typical return. Migration **055** drops the FK constraint entirely; the column keeps its UUID value and NOT NULL as a soft reference (which `revertReturn` already looks up via the audit log to restore the original on revert).

**Closed/Returned sub allowed Add Card + re-adding existing items**
- The Add Card and Close Sub buttons rendered on any non-`submitted` batch — including `returned` and `cancelled`. Now they render only when `status === 'pending'`. Submitted batches still show Unlock Sub. The From Inventory picker also filters out any `card_instance_id` already in this batch (read from the React Query cache) so even on a pending batch you can't accidentally re-add the same card.

**Match-column labels misread as no-match for valid CSV matches**
- The Match column was reading "No match (3.0)" for rows that had clearly been populated from the CSV — confusing because the matcher actually had assigned them, just at a low score. Relabeled the bands as **Strong (≥8) / Good (≥5) / Weak (≥2) / Manual (<2)** with colored dots (green / lime / amber / grey), and lowered the assignment threshold to 2 so anything below that stays Manual rather than auto-filling a bad pick.

**Per-cert form columns + Card cell wrapping**
- The form was sized for the old one-row-per-sub-line model. Padding tightened from `px-4` → `px-2` on every non-Card column to free horizontal space; Card column got `min-w-[260px]` and the input swapped to a `<textarea rows={2}>` with `whitespace-normal break-words leading-snug` so full PSA labels wrap to two lines instead of being truncated. Remap dropdown lost its `max-w-36` cap (was hiding most of the card name when closed) and got `min-w-[220px]` on the column header. Three new columns — **ID** (RP-YYYY-NNN), **Cost** (per-card basis, right-aligned), **Exp** (expected grade) — were added so the user can correlate which lots are producing which grades; review modal widened to `max-w-6xl` to fit them.

**Missing migrations 049–054 on local DB**
- Several migrations had never been applied locally — `legacy_source_catalog_id does not exist` was erroring `/cards/by-part`, the Grading tab, and Ungraded Inventory. Applied 049 (rename EN promo set codes to `XX-P`), 050 (split JP `L1` into `L1HG` / `L1SS`), 051 (backfill multi-qty `total_cost_basis`), 052 (add `grading_batch_items.expected_grade`), 053 (seed per-user Legacy catalog buckets), 054 (add `card_instances.legacy_source_catalog_id`). All idempotent — production needs to land them too at deploy time.

## May 26, 2026

### Features

**Legacy bucket workflow — pull pre-Reactor stash directly via the legacy part #**
- The Legacy tab in Add Card to Batch now has two part-number fields that mirror the actual mental model: **Legacy Part #** picks the catalog entry your stash sits under (`set_code='LEGACY'`) — the dropdown shows current stash qty + per-card cost — and **Card Part #** assigns the real card identity for what you're actually grading, which is the part the slab ultimately lands under. No `raw_purchases` lot abstraction in between. Picking a legacy bucket auto-fills language + per-card cost (read-only), and the quantity input is capped by the bucket's remaining stash.
- Server-side: `addLegacyItem` now accepts `legacy_catalog_id`. When provided it finds your existing stash card_instance under that catalog entry (status not in grading/graded/sold), decrements its `quantity` by the pull amount, carries that row's `purchase_cost` onto the new grading row, and uses the real `catalog_id` as the slab's destination part. No phantom lot created. Leaving the field blank falls back to the original phantom-lot behavior for one-off backdated cards.
- Cost-basis flow is automatic: stash `qty × purchase_cost` is the bucket's reported raw cost (e.g. `1000 × $10 = $10,000`). Pull 1 → stash becomes `999 × $10 = $9,990`, grading row carries `1 × $10` in flight. Return → slab carries `1 × $10`. Standard status-based report rollups handle the rest — raw cost shrinks, graded cost grows, total cost basis stays equal to original spend. Nothing to chase; the stash row is the single source of truth.

**`GET /api/v1/catalog/legacy-buckets`**
- New endpoint returning the user's legacy catalog entries (`set_code='LEGACY'`) with their aggregated stash snapshot — `stash_qty` (sum of child `card_instances.quantity` for rows that haven't moved to grading/graded/sold) and `per_card_cost` (from the largest stash row). Powers the Legacy Part # dropdown.

**Legacy cross-tally on grading return**
- The slab that comes back from grading lands under its real `catalog_id`, but the legacy bucket it was pulled from also needs to see "1 graded" so its lifecycle counts add up. Migration **054** adds `legacy_source_catalog_id` to `card_instances` — a nullable FK back to the legacy catalog entry. `addLegacyItem` stamps it on the new grading row at submit; `processReturn` copies it onto the new slab. The per-catalog grouping in `cards.service.ts:listCardsGroupedByPart` now does a cross-tally: for any row with `status='graded' AND legacy_source_catalog_id` set, the slab's quantity is also added to that legacy bucket's `returned_count`. Total inventory counts under the slab's real part are unchanged — this is a tracking dimension on top, not a duplicate inventory record.
- End state in the inventory view: a legacy bucket shows `to_grade_count` shrinking as you pull, `returned_count` growing as slabs come back — even though those slabs themselves now live under their proper parts. Cumulative legacy pulls visible at a glance.

**Returned column on To Be Submitted**
- The "To Be Submitted" inventory page now shows a **Returned** column alongside Total / To Grade / Submitted / Sold. The data was already computed (`returned_count` on the group rollup) — just exposed in the UI. Sortable like the others.

**Legacy picker / pull scoped to `decision='grade'` only**
- Cards on the same legacy bucket but marked for raw sale (`decision='sell_raw'`) were inflating the dropdown's "left" count and could be accidentally drained by a grading pull. The picker query (`/catalog/legacy-buckets`) and the pull-side stash finder in `addLegacyItem` both now filter to `decision='grade'`, so raw-sale inventory stays out of the grading flow.

**Bulk Add to Batch — up to 10 cards per submit (From Inventory tab)**
- Add Card to Batch's **From Inventory** tab now accepts multi-select. Search-result rows click into a Selected list (max 10) instead of replacing a single pick. Each selected row has its own inline **Qty** (bounded by that card's available quantity), **Expected Grade**, and **Est. Value / Card** inputs plus an `×` remove button. Submit button reads `Add N to Batch` and posts the whole list at once. Picking the same card twice is rejected — the per-row Qty field is the right knob for multiple copies.
- New endpoint `POST /api/v1/grading-subs/:id/items/bulk` accepts `{ items: [{ card_instance_id, quantity, expected_grade?, estimated_value? }, …] }`. Server validates duplicates and the 10-item cap, then runs the same per-item logic the single-add endpoint uses (status flip to `grading_submitted`, line_item_num assignment, location cleared). Modal widened to `max-w-2xl` to fit the row layout. Legacy (no lot) tab is unchanged.

**Auto-recalc per-card cost when inspection-line qty changes (single-line lot)**
- After relaxing the R-purchase qty=1 rule, changing an inspection line's quantity from 1 → 2 left the line's `purchase_cost` at the lot's full total (e.g. lot total $131.13, line qty=2, cost/card still $131.13) — even though the avg/card displayed elsewhere correctly recalculated to $65.57. `updateInspectionLine` now auto-derives `purchase_cost = round(lot.total_cost_usd / lot.card_count)` when the user changes qty on the **only** line of a lot and doesn't explicitly pass a new `purchase_cost`. Multi-line lots are left alone so custom per-line allocations (e.g. one chase card at $50 + commons at $1) aren't clobbered. Explicit `purchase_cost` in the request is always respected.

**R-purchase qty=1 invariant relaxed**
- The May 18 rule that forced R (single-raw) purchases to `card_count = 1` and rejected any inspection-line qty != 1 turned out to be too rigid in practice. Removed the four server-side hard rejects (`createRawPurchase`, `updateRawPurchase`, `addInspectionLine`, `updateInspectionLine`) and the B→R conversion block. The Intake form's # of Cards / Quantity Received / multi-line row qty inputs are no longer read-only for raw type. Switching a line from Bulk to Raw no longer snaps qty back to 1. A soft warning ("Bulk (B) is recommended for >1 card") with an amber input border appears whenever an R-type line has qty > 1, but it's just a UX hint — submit isn't blocked.

### Fixes

**Bulk Add to Batch — column headers + clearer placeholders**
- The first cut of the bulk picker labelled each row's inputs with placeholder text only ("Qty", "Grade", "$ / card"). "$ / card" read like cost-per-card rather than the estimated graded value. Added a header strip above the rows (`Card / Qty / Expected Grade / Est. Value / Card`) so the columns are labelled once, and the inputs use neutral hints (`1`, `e.g. 9`, `0.00`) that don't conflict with the headers.

**Part Numbers — `GRADE` column counted raw sub-rows as grades**
- A part with multiple raw sub-rows (e.g. two raw lots of the same card at different conditions) was rendering "2 grades" in the GRADE column even though `grade` is `NULL` on both — the multi-row summary did `groupRows.length` unconditionally. Now counts only sub-rows where `grade IS NOT NULL`, renders `—` when none, and pluralizes correctly (`1 grade` vs `2 grades`). Also cleaned up the GRADER cell so placeholder `—` company values don't appear in the comma-joined list.

**Sub detail header — `Cards` split into `Line Items` + `Total Cards`**
- The header pill labelled `Cards: N` was rendering `data.items.length` (line-item count). Renamed to `Line Items` for clarity and added a separate `Total Cards` pill showing the sum of per-line quantities (the actual physical card count). Server `getBatch` now exposes `stats.totalQty` alongside the existing cost stats.

**Edit Line Item — qty edit for legacy-sourced lines now pulls/returns from the bucket's stash**
- The Edit Line Item modal was capping qty at the line's `available_quantity`. For a card pulled via the Legacy tab the underlying `card_instance.quantity` equals what was originally pulled (often 1), so the max stayed `1` and there was no way to grade more without deleting + re-adding. The modal now uses `available_quantity + legacy_stash_remaining` as the cap for legacy-sourced lines and reads `… — N in bucket` in the label. On save, the server moves the delta between the stash row and the line's card_instance: increase qty → pull from stash and grow the line; decrease qty → return to stash. The grading_batch_items row updates atomically with both sides; stash-row updates are logged to the audit table. From-Inventory lines behave the same as before.
- Required to expose two new fields on each batch item from `getBatch`: `legacy_source_catalog_id` and a subquery-computed `legacy_stash_remaining` (sum of grade-decision stash rows under the legacy bucket, status not in terminal states).

**Legacy tab — Auto-fill (paste card name → AI parses fields)**
- After redesigning Card Part # to use `PartNumberField`, the paste-anything entry from the old bespoke search was missing. Added an **Auto-fill** input + button at the top of the Legacy form (same `/agent/auto-fill` endpoint Add Slab uses). Paste a PSA-label-style card name like `2024 Pokemon Indonesian SV-P Promo 154 Pikachu` and the agent parses it into Card Name / Set Name / Card # / Language; the `PartNumberField` below then auto-resolves against the catalog. If no match, the "+ Create new part #" affordance opens `AddPartModal` pre-filled with the parsed fields.

**Legacy tab — Card Part # picker redesigned to match Add Card / Add Slab**
- The bespoke search input + separate "Generate part" badge in the Legacy tab were confusing — the dropdown's "click Generate part" hint *looked* like a button but wasn't, and the actual Generate-part button sat in a banner that was often hidden behind the dropdown. Replaced both with the shared **`PartNumberField`** component (the same one [`AddCardForm`](client/src/components/inventory/AddCardForm.tsx) and the part-resolver on [`AddSlabForm`](client/src/components/inventory/AddSlabForm.tsx) use). Card Name / Set Name / Card # / Language now drive the part lookup directly; if no match, a "+ Create new part #" affordance opens the full `AddPartModal` (with SetCombobox, set-code resolution, and the complete language list) pre-filled from those same fields. Created parts auto-select back into the form. Consistent UX with every other part-creation flow in the app.

**Add Card to Batch — Legacy required, expanded languages, Strict Match, hidden picker filter bug**
- **Legacy Part # is now required** in the Legacy tab. The optional fallback was confusing — leaving it blank silently dropped into the phantom-lot path. Submit is blocked unless a bucket is picked; the placeholder reads `— Pick a legacy bucket to pull from —`.
- **Language dropdown** in the Legacy tab now matches `AddPartModal`'s full list — adds **ID** (Indonesian) and FR/DE/IT/ES/PT/PL/NL/RU/TH alongside the existing EN/JP/KR/ZH-TW/ZH-CN, with clearer labels (`EN — English`). Picked legacy entries with non-EN/JP/KR/Chinese languages now render correctly in the dropdown instead of falling back to a wrong value.
- **Strict Match checkbox** under the From Inventory search — same pattern as Sales/Listings. When ticked, passes `exact=true` to `/cards` so e.g. `2026R2` won't pull in `2026R20`/`2026R248`.
- **Long-standing schema gap fixed:** `cardFiltersSchema` didn't include `decision`, so the `decision='grade'` / `decision='sell_raw'` params Grading/Sales/Listings have all been sending were being silently stripped by Zod. The decision filter actually applies now.
- **Grading picker status filter broadened** to include `purchased_raw`. Grade-decision cards that hadn't been promoted to `status='inspected'` yet (e.g. mass-imported rows that bypass the Inspection Panel) are findable instead of needing a manual delete-and-re-add as a workaround.

### Reverted

**Lot-based legacy bucket picker (`45bd2bf`)** — the original first cut required maintaining a separate `raw_purchases` lot per legacy catalog entry with its own `card_count` and `total_cost_usd` decremented on return. The lot abstraction didn't fit — the catalog entry alone is the natural bucket and the stash card_instance is the natural source of truth. Migration 053 (per-user EN/JP legacy seed) and the auto-relink on grading return (set_code='LEGACY' detection) were both kept since they're still useful for the simpler model.

---

## May 23, 2026

### Features

**Legacy part numbers — sentinel buckets for unnumbered / orphan raw cards**
- Convention for cataloging legacy raw inventory (vintage cards, cards already in subs that were never in the system) without trying to catalog each one properly. Create one per language with **Set Code = `LEGACY`** in the Add Part modal — you'll get `PKMN-JP-LEGACY-…`, `PKMN-EN-LEGACY-…`, etc. The raw rows you add against them carry their own purchase cost, so submitting them to grading and bringing them back keeps cost basis intact.

**Auto-relink on grading return when source was bucketed under a legacy part**
- Previously the grading-return flow only re-resolved a card's catalog link if the raw was completely unlinked (`catalog_id IS NULL`). Cards intentionally linked to a legacy bucket stayed on the legacy bucket forever, so a slab that came back with a corrected name would still display under `PKMN-JP-LEGACY-…` instead of its real part. The return resolver in [grading-submissions.service.ts:453](server/src/services/grading-submissions.service.ts#L453) now also fires when the source is linked to a `set_code = 'LEGACY'` catalog row (case-insensitive). If the resolver finds a real match the new slab picks up that catalog_id; if not, the legacy link is preserved (no silent drop to unlinked). Cost basis flows through `card_instances.purchase_cost` exactly as before — only the catalog pointer changes.

### Fixes

**Grading sub detail page 500 — missing `expected_grade` column**
- `GET /api/v1/grading-subs/:id` selected `gbi.expected_grade` ([grading-submissions.service.ts:99](server/src/services/grading-submissions.service.ts#L99)) and the TypeScript type declared it, but no migration ever created the column on `grading_batch_items`. Any DB that didn't receive an out-of-band ALTER hit `column gbi.expected_grade does not exist` → 500 the moment you clicked into a sub (the list page didn't reference the column, so subs looked fine until you opened one). Migration **052** adds `expected_grade NUMERIC(4,1)` (matches `slab_details.grade` precision so half-grades round-trip) — idempotent via `IF NOT EXISTS`, existing rows get `NULL`.

**Inspection Line modal — Already Graded UX cleanup**
- Two friction points when back-linking an existing slab to a lot via the inspection-line modal:
  - The **Condition** dropdown was still shown for the Already Graded decision even though a slab's condition isn't meaningful (and the submit handler ignored it). Now hidden whenever Decision = Already Graded; the Decision dropdown takes the full row. Condition state is preserved if you switch back to Sell Raw / Grade.
  - **Editing an existing `Grade` / `Sell Raw` line and switching it to Already Graded failed** with "Only 0 cards remaining in lot" — the original line still occupied its slot during the back-link's capacity check. The edit flow now deletes the original line first (via the inspection-line delete endpoint) before posting the back-link, freeing the slot. Same delete-then-post pattern the existing `_replace_slab_id` swap uses.

**Add Part — `no card # (unnumbered)` left the Part # field blank**
- `autoSku` short-circuited to empty whenever the unnumbered checkbox was ticked, so creating a sentinel like `PKMN-JP-LEGACY` produced no SKU at all (saved as `sku = NULL`, displayed only via the synthesized `… (no #)` label at render time). For real bucket parts you want an addressable SKU. The generator now substitutes a normalized form of the **Card Name** for the missing card-number segment — `Legacy Cards` under set code `LEGACY` → `PKMN-JP-LEGACY-LEGACYCARDS`. Normalization is `[A-Z0-9]`-only, uppercase, truncated to 24 chars; if the name yields no ASCII chars the SKU falls back gracefully to `prefix-lang-setcode`. The Part # field also updates live as you type the Card Name now (previously the name didn't influence the SKU at all).

---

## May 22, 2026

### Features

**Card show inventory can be cross-listed on eBay**
- The eBay listing picker excluded any card flagged `is_card_show` (graded single + set modes), so a card sitting in card-show inventory couldn't also be listed online. Removed that exclusion — card-show cards now appear in the listing flow and can be cross-listed. The raw-card listing path already allowed it; this brings graded in line. A card stays in card-show inventory while listed (true cross-listing); only personal-collection and already-listed copies remain excluded.

**Part-level reassign — move a whole part's cards at once**
- The existing Reassign only moved one grade-row at a time and was reachable solely from a multi-grade part's expanded sub-rows — so consolidating a mis-filed part meant repeating it row by row. Edit Part now has a **Reassign** button: pick a target part and *every* card under the current part (raw + graded, all grades) moves in one action via the new `PATCH /catalog/reassign-part`. Afterward it reports how many cards moved and offers to delete the now-empty source part. Makes the "A different part number already exists with this Set + Card #… Use Reassign" error actionable instead of a dead end.

### Fixes

**Catalog page crash — `M.map is not a function` after opening Add Part**
- `AddPartModal` shared the React Query cache key `['card-games']` with the catalog page's game queries but fetched a different endpoint: `/card-games` returns `{ data: [...] }` while `/sets/games` returns a bare array. Opening the modal overwrote the shared cache with the object shape, and the catalog page's `gameOptions = gamesData.map(...)` then ran `.map` on an object → hard crash (recovered only on page refresh). `AddPartModal` now uses `/sets/games` like every other consumer, so the cached shape is consistent.

**Edit Part modal — broken "Set" field in custom-set mode**
- The custom set-code input carried both `w-full` (from the shared input class) and `w-28`; Tailwind's `w-full` wins, so the input took the whole row and squeezed the set-name input into an unusable sliver. Stripped `w-full` from that input.

**Add Slab — "no card #" didn't surface the part-number resolver**
- Ticking "no card # (unnumbered)" didn't re-run the catalog lookup (the `unnumbered` flag wasn't a resolver dependency, and clearing an already-empty field is a no-op), and the resolver only offered "Create part" when a card number was present. So unnumbered cards never got a Create-part badge — you had to type a digit and delete it to nudge it. The resolver now reacts to the unnumbered toggle and offers Create part for unnumbered cards; the create modal opens with "no card #" pre-ticked.

**Graceful shutdown — faster, cleaner deploy rollover**
- The SIGTERM handler called `server.close()`, which ignores idle keep-alive sockets — so the old container always waited the full 10s hard timeout before exiting. Added `server.closeIdleConnections()` so the close callback fires immediately, and the pg pool is now drained on shutdown. The old container exits 0 promptly, well inside Railway's grace window.

---

## May 19, 2026

### Fixes

**Import card-number parser — wrong SKU on PSA labels with numeric set names**
- Labels like `2023 POKEMON JAPANESE SV2a-POKEMON 151 168 CHARMANDER` were getting stamped as `PKMN-JP-SV2a-151` because the parser took the **first** 3-digit match — and "Pokemon 151" (the set name) contains `151`. The actual card number is `168` (PSA labels always put the card # right before the card name). Switched `threeDigit` / `twoDigit` matchers to use the **last** match. Going forward, new imports are correct; existing rows with bad SKUs (Squirtle, Charmander stuck at `-151`) need a manual fix via the Part Numbers manager.

**Card Trend — "No data" on cards with short canonical names**
- Trend was joining strictly by `card_instances.catalog_id = seed.catalog_id`. When imports produced duplicate catalog rows for the same physical card (e.g. canonical `"Squirtle"` + full PSA-label variant `"2023 Pokemon Japanese SV2a 170 Squirtle…"` sharing the same SKU), the search returned one row but instances were linked to the other → empty trend. Joins now OR-match across four arms: `catalog_id` ∪ `sku` ∪ `(set_code + card_number)` ∪ `card_name_override ILIKE seedName`. Same fix on the cost-history side.

**Card Trend — x-axis label crowding**
- Sales clustered on close dates were piling labels on top of each other (`Dec 24 25`, `Mar 26 Apr 26` etc.). Added `minTickGap={60}` + `interval="preserveStartEnd"` so the renderer skips ticks until each label has ~60px of breathing room. First/last dates always preserved so the range is still readable.

**Raw Overall sub-rows — commerce-only**
- Expanded lot sub-rows were including transient `inspected` and `purchased_raw` workflow states, cluttering the view. Now only commerce-relevant statuses (`raw_for_sale`, `sold`, `grading_submitted`, `graded`, `lost_damaged`) appear in the breakdown.

---

## May 18, 2026 (PM)

### Features

**$0 sales are valid (giveaways / total losses)**
- Every price validation across the sale flows relaxed to reject only empty / NaN / negative — `0` is now an accepted value. Covers single Record Sale (raw + slab), bulk cart sticker, bulk review final, and the bulk eBay total-strike field. Server `/sales/batch` `sale_price` schema flipped from `.positive()` → `.nonnegative()`. The sticker→final cascade in review also respects an intentional `0`.

**In-app re-add confirm**
- Replaced the native browser `window.confirm()` with a proper Reactor-styled modal when re-adding a raw lot that's already in the bulk-sale cart. Sits on `z-[60]` over the parent Record Sale modal with a backdrop click-away. Same content (`X is already in the cart (N of LOT). Only add another if a second copy sold at a different price.`) just without the OS chrome.

### Fixes

**Bulk-sale Review & Confirm button flicker / silent disable**
- Disabled state was evaluated on every render, so intermediate keystrokes (e.g. emptying a field to retype) flipped the button off mid-typing — making it look permanently broken when in fact a single off-screen row had `0` or empty `final`. Validation now runs on click; the button stays enabled, and clicking with invalid data toasts the offending card names (`Missing final price: Chespin`). The earlier diagnostic `console.warn` is gone.

**Record Sale — stale Sell qty silently sold whole lot**
- `rawSaleQty` persisted across `selectedRawCard` changes. If you typed `5` for a 5-card lot then picked a different lot via raw-select, the input still held `5`. When the new lot's quantity matched, validation passed and `sellQty == card.quantity` skipped the split path → whole stack flipped sold. `rawSaleQty` now resets to `1` on every `selectedRawCard.id` change.

**Bulk-sale re-add visibility**
- "in cart ×N" amber badge on the raw search-result row when the lot already has cart entries — clicking pops the new confirm prompt. Multi-add still available for cards that legitimately sold at different prices.

---

## May 18, 2026

### Features

**Bulk sale — multi-add per source lot**
- A single B-lot can now be added to the bulk-sale cart **multiple times**, one entry per discrete sale, each with its own price. Solves the "two Piplups sold at $15 and $5 got averaged to $10" problem — the prior cart forced one consolidated row with one price field. New `cart_entry_id` keeps React keys + edit helpers stable across duplicate source IDs. Cross-entry validation: cart-row qty input, Add button on the search list, and the Review Sale button all use the per-source sum (`sum of all cart entries for source X ≤ X.lot_quantity`). Warning reads "Each lot's cart qty must fit within its remaining inventory."
- **Record Sale always shows Sell qty for raw** (read-only when lot=1) so users can see/confirm what's about to flip sold. Was hidden whenever the picked lot had only 1 card left.

**Strict search**
- New **Strict Match** checkbox in the bulk-sale search panel. As the catalog has grown, the default `ILIKE '%term%'` fuzzy match returns too many false positives when you know the exact value (e.g. `2026R2` matched `2026R20`, `2026R248`…). Strict mode switches to case-insensitive whole-term equality across the same searched fields (card name, set name, cert #, purchase_id). Server `/cards` accepts `exact=true`.

**R-purchase invariant: single card always qty=1**
- Domain rule: R-type purchases represent one card; only B (bulk) and L can carry qty ≥ 1. Enforced everywhere — `createRawPurchase` + `updateRawPurchase` reject `card_count != 1` for type='raw' and block in-flight B → R flips when child quantities already exceed 1. `addInspectionLine` / `updateInspectionLine` reject `quantity != 1` on raw parents. Client `Intake.tsx`: # of Cards input + Receive modal Quantity + multi-line row qty input all read-only/grayed for raw, with type-flip snapping qty back to 1.

**JP set codes — L1 split**
- Added `L1HG` (HeartGold Collection) and `L1SS` (SoulSilver Collection) as standalone codes; legacy `L1` preserved for already-imported data (to be reclassified by hand). Migration 050 seeds both for every existing JP user.

### Fixes

**Cost basis math**
- `computeCostBasis()` now multiplies `purchase_cost × quantity` (+ grading_cost) instead of returning per-card cost as-is. Every multi-qty raw sale was writing one card's basis into `sales.total_cost_basis`, overstating profit by `(qty - 1) × per_card_cost`. Slabs are always qty=1 so no-op for graded.
- **Migration 051** backfills `total_cost_basis` for every existing sale whose linked `card_instance.quantity > 1`.
- **Edit Sale qty edit now recomputes basis** and writes it back — without this, a sale edited from qty=11 down to qty=1 kept the original $42 basis and the Net column went wildly negative.

**Bulk sale qty payload — "sold whole lot" bug**
- Cart was submitting `quantity: item.quantity > 1 ? item.quantity : undefined`. When you added a B-lot to the cart (default cart qty=1), `undefined` got sent, and server's `recordSale` defaulted to `card.quantity` (full lot count) — flipping the entire stack sold. Always send the cart qty now.

**Display alignment — totals everywhere**
- Sales list `Raw Cost` cell now multiplies `× qty` so all money columns are sale-totals (was per-card, mismatched against per-sale Strike/Net).
- Raw Overall lot-aggregate main row uses `raw_cost × totalQty`; single-instance main row uses `raw_cost × first.quantity` (NetCell + RoiCell follow). Sub-rows on expanded lots stay per-instance as the granular view.
- Bulk-sale cart + review steps show `total — ≈ $X.XX per card` hint under multi-qty price inputs.
- Bulk-cart warning text reads "total per line, not per card."
- Sales `Grade / Cond.` column shows `Raw NM` for raw rows to match the `PSA GEM MINT 10` format on graded rows.
- Sales `Qty` column is now sortable.

**Record Sale — Listed price cue**
- `/cards` was returning `is_listed` but never the actual `list_price` from the active-listing subquery, so the `Listed: $X` line in Record Sale never appeared. Subquery now selects `list_price` and exposes it as `listed_price`.

**Form glitch — empty-string location_id blocks Add Slab / Add Card**
- The Location `<select>` emits `''` for "— No location —", but the Zod schema was `z.string().uuid().optional().nullable()` — `.optional()` only allows `undefined`, so `''` failed `.uuid()` and quietly blocked submit with a confusing focus highlight on the (supposedly optional) field. Preprocess `''` → `undefined` before the uuid check.

**Docs**
- `CLAUDE.md` corrected: `card_instances` is hard-deleted (no `deleted_at` column — dropped in migration 014). The stale soft-delete claim led to a 500 yesterday when a new sales subquery filtered on the phantom column.

---

## May 17, 2026

### Features

**Lot-quantity invariant — single source of truth**
- **Edit Sale qty rebalances the lot.** Changing a sale's quantity now finds the source sibling in the same `raw_purchase + condition + catalog` and shifts the delta between them, so the lot's original inspection-set total stays constant. If the whole lot had been sold off, shrinking a sale recreates a `raw_for_sale` sibling for the leftover. Increases beyond `source.qty` are rejected.
- **Quantity is no longer freely editable.** Removed the Quantity input from the shared `CardDetailModal` — qty is set at intake/inspection and only changes through sale splits. Server `cards.updateCard` strips any `quantity` from the patch payload as defense-in-depth.
- **Dynamic max-bound validation in Edit Sale.** Sales list now returns `lot_available_qty` (sum of non-sold sibling qty in the same lot via correlated subquery). Modal shows max in the label, live inline error, live preview ("Will pull 2 more from the source lot" / "Will return 1 to the source lot"), and disables Save until valid.

**Raw Overall — Total / Unsold / Sold columns**
- Replaced the single Qty column with three (Total / Unsold / Sold, 65px each). Lot mainrows sum across siblings; single-instance rows put qty in the matching column; sub-rows under expanded lots do the same. Much easier to scan than the prior crammed `10 (3 sold · 7 left)` cell.

**Raw Overall — flat-tab lot grouping**
- All flat tabs (All / Unsold / Sold / For Sale / To Grade / Submitted) now group consecutive rows by `(raw_purchase_label, condition)`. Lots split by partial sales render as one main row with aggregate totals + a chevron to expand the underlying instances. Single-instance lots render unchanged.

**Sales page**
- **Qty column** added to the sales table.
- **Grade / Cond. column** added (was missing for raw sales).
- **Bulk sale modal** now has a per-item Qty input (with `1 ≤ qty ≤ lot_quantity` validation) when the picked card is a raw lot with multiple copies.
- **Bulk sale pre-flight check** lists every already-sold card in the cart by name in the 409 error, instead of failing mid-loop and leaving the batch partially committed.

### Fixes

**Numeric input rounding (cents)**
- App-wide swap of `type="number" step="0.01"` → `type="text" inputMode="decimal"`. Browsers were snapping `175` → `174.98` on scroll. Affects every price/cost input that feeds `toCents()`.

**Raw Overall**
- `/cards/raw-flat` now returns `ci.quantity` + `ci.status` (was missing, causing NaN in Qty and an `undefined.replace` crash on row expand).

**Sales placeholder text**
- Sales search placeholder no longer suggests the nonexistent `RP-#` format — purchase IDs are `2026R…` / `2026B…` / `2026L…`.

---

## May 16, 2026

### Features

**Raw card sales**
- **Partial-quantity sales** — Record Sale (raw) now has a **Sell qty** input when the picked lot has more than 1 card. Selling fewer than the row holds splits the source `card_instance`: shaves the sold qty off the original, inserts a sibling instance with `status='sold'` + `quantity=sellQty`, and links the sale to the sibling. Selling 1 of 6 HP no longer flips the whole stack sold.
- **Strike-price label clarifies "total"** when selling multiple copies, with a small "≈ $X.XX per card" hint underneath.
- **CS / Listed price surfaced** on the raw card summary in Record Sale: shows `CS Price: $X` for card-show platform or `Listed: $X` for eBay, matching the existing graded-side cue.

**Raw Overall**
- **Lot-aggregation for split siblings** (option C / hybrid). When a partial sale has split a lot (e.g. qty=5 raw_for_sale + qty=1 sold sibling), Raw Overall renders one consolidated row with combined per-status counts and a "split ×N" indicator instead of two separate rows. Click to expand and see the individual sibling instances. Single-instance lots render unchanged. Sales analytics still point at the sibling UUIDs.

### Fixes

**Part # search / autofill**
- **Fallback when set filter zeroes out** — if `card_name` + `card_number` are present and the set filter produces 0 results, retry without the set filter. Rescues cases where the autofill returned a set label that doesn't appear in the catalog row (e.g. "Legendary Holo Collection" when the row is stored as "Legendary Shine Collection").
- **Autofill canonicalizes set_name** from the resolved set_code via the seeded set list — and now exposes the resolved `set_code` to the client. So autofilling "Dialga CP2 012" lands in the form as `Legendary Shine Collection` (canonical JP name), not whatever the AI hallucinated.
- **`XY-CP4` seed corrected** to "Champions Premium Pack" (was incorrectly mapped to "Hyper Metal Chain Deck").

**Sales**
- **Bulk raw sale at card shows** wasn't finding anything — required `status='raw_for_sale'` AND `is_card_show='yes'`. Raw cards aren't pre-tagged to shows in this workflow, so the filter hid every sellable card. Loosened to match the individual raw sale flow (any of `purchased_raw` / `inspected` / `raw_for_sale` with decision `sell_raw`).

---

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
