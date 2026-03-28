import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Location, LocationCardType } from '../pages/LocationManager';

export function useLocations(cardType?: 'graded' | 'raw') {
  const { data } = useQuery<{ data: Location[] }>({
    queryKey: ['locations'],
    queryFn: () => api.get('/locations').then(r => r.data),
    staleTime: 60_000,
  });

  const all = data?.data ?? [];

  const filtered = cardType
    ? all.filter(l => !l.is_container && (l.card_type === cardType || l.card_type === 'both'))
    : all.filter(l => !l.is_container);

  return { locations: filtered, allLocations: all };
}
