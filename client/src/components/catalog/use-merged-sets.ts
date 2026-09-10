import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';

// Shared type + hook used by SetCombobox and its callers. Split into its own
// module so SetCombobox.tsx only exports components (satisfies the
// react-refresh/only-export-components rule that keeps HMR reliable).

export interface SetOption { code: string; name: string; }

export function useMergedSets(language: string): SetOption[] {
  const codesQ = useQuery<{ language: string; set_code: string; names: string[] }[]>({
    queryKey: ['set-codes-static'],
    queryFn: () => api.get('/sets/codes').then(r => r.data),
    staleTime: 5 * 60 * 1000,
  });
  const aliasQ = useQuery<{ language: string; set_code: string; alias: string; set_name: string | null }[]>({
    queryKey: ['set-aliases'],
    queryFn: () => api.get('/sets/aliases').then(r => r.data),
    staleTime: 60 * 1000,
  });
  const list: SetOption[] = [];
  const seen = new Set<string>();
  (codesQ.data ?? []).filter(s => s.language === language).forEach(s => {
    const key = s.set_code.toUpperCase();
    if (!seen.has(key)) { seen.add(key); list.push({ code: s.set_code, name: s.names[0] ?? s.set_code }); }
  });
  (aliasQ.data ?? []).filter(a => a.language === language).forEach(a => {
    const key = a.set_code.toUpperCase();
    if (!seen.has(key)) { seen.add(key); list.push({ code: a.set_code, name: a.set_name ?? a.alias }); }
  });
  return list;
}
