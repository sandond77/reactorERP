// Card-show pick list — a per-browser working list of graded slabs the user
// intends to bring to their next card show, before physically pulling and
// committing them. Modeled on the "Move" column workflow: mark first, filter,
// then physically segregate and commit.
//
// Persistence: localStorage. Not synced across browsers or devices — that's
// the deliberate trade-off vs. a DB table. Matches how the user's spreadsheet
// worked (one machine, one file at a time).
//
// Data shape: array of card_instance UUIDs. All extra info (name, price,
// physically-found status) is derived at render time from a fresh slabs
// query — localStorage never stores anything that can go stale.

const STORAGE_KEY = 'reactor:card-show-picks';
const REVIEW_KEY  = 'reactor:card-show-review';

// Per-pick transient review state — Found flag + CS Price the user is
// entering during the physical-pull step. Persisted so accidental
// backdrop-clicks don't wipe entries mid-review. Pruned when the pick is
// removed, cleared entirely on commit for the committed rows.
export interface ReviewEntry { found: boolean; price: string; }

function readRaw(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Filter to strings only — a bad hand-edit or a different app version
    // shouldn't crash reads.
    return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    return [];
  }
}

function writeRaw(ids: string[]): void {
  try {
    // De-dup + sort for stable equality checks. Order doesn't matter — the
    // display query orders results.
    const unique = Array.from(new Set(ids)).sort();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(unique));
    notifyListeners();
  } catch {
    // Private tabs, quota, disabled storage — treat writes as no-ops rather
    // than crashing the caller.
  }
}

const listeners = new Set<() => void>();
function notifyListeners() {
  for (const l of listeners) l();
}

// Subscribe to pick-list changes. Any component that renders based on the
// current picks calls this in a useEffect and unsubscribes on unmount so
// two modal instances (or the header count + open modal) stay in sync.
export function subscribeToPicks(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function getPicks(): string[] {
  return readRaw();
}

export function isPicked(id: string): boolean {
  return readRaw().includes(id);
}

export function togglePick(id: string): void {
  const current = readRaw();
  const next = current.includes(id) ? current.filter(x => x !== id) : [...current, id];
  writeRaw(next);
}

export function addPicks(ids: string[]): void {
  writeRaw([...readRaw(), ...ids]);
}

export function removePicks(ids: string[]): void {
  const drop = new Set(ids);
  writeRaw(readRaw().filter(id => !drop.has(id)));
}

export function clearPicks(): void {
  writeRaw([]);
}

// Prune picks whose IDs are no longer eligible (sold, in card-show inventory
// already, or otherwise gone). Called on modal open with the current set of
// eligible IDs from the search endpoint. Returns the IDs that were dropped so
// the UI can optionally surface them. Also drops any orphaned review-state
// entries for the same dropped IDs so nothing lingers.
export function reconcilePicks(eligibleIds: Set<string>): string[] {
  const current = readRaw();
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const id of current) {
    (eligibleIds.has(id) ? kept : dropped).push(id);
  }
  if (dropped.length > 0) {
    writeRaw(kept);
    clearReviewEntries(dropped);
  }
  return dropped;
}

// ── Review state (Found + CS Price) ──────────────────────────────────────────

function readReview(): Record<string, ReviewEntry> {
  try {
    const raw = localStorage.getItem(REVIEW_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, ReviewEntry> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const obj = v as Record<string, unknown>;
        const found = typeof obj.found === 'boolean' ? obj.found : false;
        const price = typeof obj.price === 'string' ? obj.price : '';
        out[k] = { found, price };
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeReview(state: Record<string, ReviewEntry>): void {
  try {
    localStorage.setItem(REVIEW_KEY, JSON.stringify(state));
    notifyListeners();
  } catch {
    // Private tabs / quota / disabled — treat as no-op
  }
}

export function getReviewState(): Record<string, ReviewEntry> {
  return readReview();
}

// Merge a partial patch into one row's review state. Preserves price when
// Found is unticked — commit already gates on found && priceValid, so a
// stale price on an un-Found row is inert. A previous version wiped price
// on found=false to guard against "re-check commits stale price," but that
// same wipe caused visible data loss when Found was toggled accidentally
// (or when an earlier reconciliation bug flipped state under the user).
export function updateReviewEntry(id: string, patch: Partial<ReviewEntry>): void {
  const cur = readReview();
  const existing = cur[id] ?? { found: false, price: '' };
  const next: ReviewEntry = { ...existing, ...patch };
  writeReview({ ...cur, [id]: next });
}

// Clear review entries for specific IDs — called on commit (for committed
// rows) or when a pick is removed.
export function clearReviewEntries(ids: string[]): void {
  if (ids.length === 0) return;
  const cur = readReview();
  const next = { ...cur };
  let changed = false;
  for (const id of ids) {
    if (id in next) { delete next[id]; changed = true; }
  }
  if (changed) writeReview(next);
}

// Wipe all review state — called from the header "Clear All picks" action.
export function clearAllReviewState(): void {
  writeReview({});
}
