import type { QueryClient } from '@tanstack/react-query';

export type Resource =
  | 'sales'
  | 'slabs'
  | 'cards'
  | 'raw_purchases'
  | 'grading'
  | 'listings'
  | 'trades'
  | 'expenses';

export const RESOURCE_QUERY_KEYS: Record<Resource, string[]> = {
  sales:         ['sales', 'sale-filter-options', 'sales-summary', 'inventory-summary', 'inventory-value', 'raw-dashboard', 'overall', 'pnl', 'yearly-summary', 'audit-log'],
  slabs:         ['inventory-slabs', 'slab-filter-options', 'overall', 'inventory-summary', 'inventory-value', 'card-name-search', 'card-copies', 'audit-log'],
  cards:         ['raw-overall', 'raw-inventory-grouped', 'raw-flat-filter-options', 'inventory-summary', 'inventory-value', 'raw-dashboard', 'card-picker-grading', 'audit-log'],
  raw_purchases: ['raw-purchases', 'raw-overall', 'raw-inventory-grouped', 'inventory-summary', 'inventory-value', 'raw-dashboard', 'audit-log'],
  grading:       ['grading-batches', 'grading-batch', 'grading-subs', 'grading-sub-detail', 'pending-grading-sub', 'inventory-summary', 'audit-log'],
  listings:      ['listings', 'listing-filter-options', 'stale-ebay-listings', 'audit-log'],
  trades:        ['trades', 'audit-log'],
  expenses:      ['expenses', 'audit-log'],
};

export function invalidateResources(qc: QueryClient, resources: Resource[]) {
  const keys = new Set<string>();
  resources.forEach(r => RESOURCE_QUERY_KEYS[r].forEach(k => keys.add(k)));
  keys.forEach(k => qc.invalidateQueries({ queryKey: [k] }));
}
