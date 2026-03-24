// In-memory filter persistence — state survives route changes, resets on hard refresh.
// Usage:
//   const saved = loadFilters('listings', { fPlatform: null, search: '' });
//   const [fPlatform, setFPlatform] = useState(saved.fPlatform);
//   useEffect(() => saveFilters('listings', { fPlatform, search }), [fPlatform, search]);

type FilterState = Record<string, unknown>;
const _store: Record<string, FilterState> = {};

export function loadFilters<T extends FilterState>(page: string, defaults: T): T {
  return { ...defaults, ..._store[page] } as T;
}

export function saveFilters(page: string, state: FilterState): void {
  _store[page] = { ...state };
}
