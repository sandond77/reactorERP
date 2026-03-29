import React from 'react';
import type { ReactElement } from 'react';

// ── Shared types ───────────────────────────────────────────────────────────

export interface CardInstance {
  id: string;
  status: string;
  decision: string | null;
  condition: string | null;
  quantity: number;
  purchase_cost: number;
  currency: string;
  purchased_at: string | null;
  notes: string | null;
  raw_purchase_label: string | null;
  location_name: string | null;
}

export interface CardGroup {
  catalog_id: string | null;
  sku: string | null;
  card_name: string;
  set_name: string | null;
  card_number: string | null;
  language: string;
  card_game: string;
  total: number;
  for_sale_count: number;
  to_grade_count: number;
  grading_count: number;
  returned_count: number;
  sold_count: number;
  instances: CardInstance[];
}

// ── Shared helpers ─────────────────────────────────────────────────────────

export function instForSale(inst: CardInstance)  { return inst.status === 'raw_for_sale' ? inst.quantity : 0; }
export function instToGrade(inst: CardInstance)  {
  return inst.status === 'inspected' && inst.decision === 'grade' ? inst.quantity : 0;
}
export function instGrading(inst: CardInstance)  { return inst.status === 'grading_submitted' ? inst.quantity : 0; }
export function instGraded(inst: CardInstance)   { return inst.status === 'graded' ? inst.quantity : 0; }
export function instSold(inst: CardInstance)     { return inst.status === 'sold' ? inst.quantity : 0; }

export function groupKey(g: CardGroup) {
  return g.catalog_id ?? `${g.card_name}|${g.set_name}|${g.card_number}|${g.language}`;
}

export const num = (n: number): ReactElement =>
  n > 0
    ? React.createElement('span', { className: 'text-zinc-300' }, n)
    : React.createElement('span', { className: 'text-zinc-700' }, '—');
