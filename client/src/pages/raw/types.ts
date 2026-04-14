export type PurchaseType = 'raw' | 'bulk';
export type PurchaseStatus = 'ordered' | 'received' | 'cancelled';
export type Decision = 'sell_raw' | 'grade';

export interface PurchaseRow {
  id: string;
  purchase_id: string;
  type: PurchaseType;
  source: string | null;
  order_number: string | null;
  language: string;
  card_name: string | null;
  set_name: string | null;
  card_number: string | null;
  total_cost_yen: number | null;
  fx_rate: number | null;
  total_cost_usd: number | null;
  card_count: number;
  avg_cost_usd: number | null;
  status: PurchaseStatus;
  purchased_at: string | null;
  received_at: string | null;
  catalog_id: string | null;
  reserved: boolean;
  notes: string | null;
  receipt_url: string | null;
  inspected_count: number;
  sell_raw_count: number;
  grade_count: number;
}

export interface InspectionLine {
  id: string;
  card_name: string | null;
  set_name: string | null;
  card_number: string | null;
  part_number: string | null;
  condition: string | null;
  decision: Decision | null;
  quantity: number;
  purchase_cost: number;
  currency: string;
  status: string;
  notes: string | null;
}

export interface PurchaseDetail extends PurchaseRow {
  cards: InspectionLine[];
}

export const CONDITIONS = ['NM', 'LP', 'MP', 'HP', 'DMG'];

export const DECISION_LABELS: Record<Decision, string> = {
  sell_raw: 'Sell Raw',
  grade: 'Grade',
};

export const STATUS_COLORS: Record<PurchaseStatus, string> = {
  ordered:   'text-yellow-400',
  received:  'text-emerald-400',
  cancelled: 'text-zinc-500',
};

export const TYPE_COLORS: Record<PurchaseType, string> = {
  raw:  'bg-indigo-500/15 text-indigo-300',
  bulk: 'bg-amber-500/15 text-amber-300',
};
