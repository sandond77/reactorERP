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
// the UI can optionally surface them.
export function reconcilePicks(eligibleIds: Set<string>): string[] {
  const current = readRaw();
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const id of current) {
    (eligibleIds.has(id) ? kept : dropped).push(id);
  }
  if (dropped.length > 0) writeRaw(kept);
  return dropped;
}
