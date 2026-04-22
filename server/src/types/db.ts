import type { Generated, Selectable, Insertable, Updateable, ColumnType } from 'kysely';

// ============================================================
// Enums
// ============================================================

export type CardStatus =
  | 'purchased_raw'
  | 'inspected'
  | 'grading_submitted'
  | 'graded'
  | 'raw_for_sale'
  | 'sold'
  | 'lost_damaged';

export type PurchaseType = 'raw' | 'pre_graded';

export type GradingCompany = 'PSA' | 'BGS' | 'CGC' | 'SGC' | 'HGA' | 'ACE' | 'ARS' | 'OTHER';

export type GradingStatus = 'submitted' | 'in_review' | 'graded' | 'returned' | 'cancelled';

export type ListingPlatform =
  | 'ebay'
  | 'card_show'
  | 'tcgplayer'
  | 'facebook'
  | 'instagram'
  | 'local'
  | 'other';

export type ListingStatus = 'active' | 'sold' | 'expired' | 'cancelled';

export type ImportStatus = 'pending' | 'processing' | 'completed' | 'failed';

export type RawPurchaseType = 'raw' | 'bulk';
export type RawPurchaseStatus = 'ordered' | 'received' | 'cancelled';

export type UserPlan = 'free' | 'pro' | 'enterprise';

// ============================================================
// Table definitions
// ============================================================

export interface UsersTable {
  id: Generated<string>;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  google_sub: string | null;
  plan: UserPlan;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  deleted_at: Date | null;
}

export interface CardCatalogTable {
  id: Generated<string>;
  user_id: string;
  game: string;
  set_name: string;
  set_code: string | null;
  card_name: string;
  card_number: string | null;
  variant: string | null;
  rarity: string | null;
  language: string;
  image_url: string | null;
  image_url_hi: string | null;
  image_url_back: string | null;
  tcgplayer_id: string | null;
  external_id: string | null;
  sku: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

// Shared seed table — no user_id, used to initialise new user catalogs
export interface CardCatalogSeedTable {
  id: Generated<string>;
  game: string;
  set_name: string;
  set_code: string | null;
  card_name: string;
  card_number: string | null;
  variant: string | null;
  rarity: string | null;
  language: string;
  image_url: string | null;
  image_url_hi: string | null;
  image_url_back: string | null;
  tcgplayer_id: string | null;
  external_id: string | null;
  sku: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export type LocationCardType = 'graded' | 'raw' | 'both';

export interface LocationsTable {
  id: Generated<string>;
  user_id: string;
  parent_id: string | null;
  name: string;
  card_type: LocationCardType;
  is_card_show: Generated<boolean>;
  is_container: Generated<boolean>;
  notes: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface TradesTable {
  id: Generated<string>;
  user_id: string;
  trade_label: string | null;
  trade_date: Date | null;
  person: string | null;
  cash_from_customer_cents: Generated<number>;
  cash_to_customer_cents: Generated<number>;
  trade_percent: Generated<number>;
  notes: string | null;
  created_at: Generated<Date>;
}

export interface TradeSequencesTable {
  user_id: string;
  year: number;
  next_seq: number;
}

export interface CardInstancesTable {
  id: Generated<string>;
  user_id: string;
  catalog_id: string | null;
  card_name_override: string | null;
  set_name_override: string | null;
  card_number_override: string | null;
  card_game: string;
  language: string;
  variant: string | null;
  rarity: string | null;
  notes: string | null;
  purchase_type: PurchaseType;
  status: CardStatus;
  quantity: number;
  purchase_cost: number;
  currency: string;
  source_link: string | null;
  order_number: string | null;
  condition: string | null;
  condition_notes: string | null;
  image_front_url: string | null;
  image_back_url: string | null;
  purchased_at: Date | null;
  raw_purchase_id: string | null;
  trade_id: string | null;
  location_id: string | null;
  decision: string | null;
  is_card_show: Generated<boolean>;
  card_show_added_at: Date | null;
  card_show_price: number | null;
  is_personal_collection: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface GradingSubmissionsTable {
  id: Generated<string>;
  user_id: string;
  card_instance_id: string;
  company: GradingCompany;
  submission_number: string | null;
  service_level: string | null;
  status: GradingStatus;
  grading_fee: number;
  shipping_cost: number;
  currency: string;
  submitted_at: Date | null;
  estimated_return: Date | null;
  returned_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface SlabDetailsTable {
  id: Generated<string>;
  card_instance_id: string;
  user_id: string;
  source_raw_instance_id: string | null;
  grading_submission_id: string | null;
  company: GradingCompany;
  cert_number: number | null;
  grade: number | null;
  grade_label: string | null;
  subgrades: unknown | null;  // JSONB
  grading_cost: Generated<number>;
  additional_cost: number;
  currency: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ListingsTable {
  id: Generated<string>;
  user_id: string;
  card_instance_id: string;
  platform: ListingPlatform;
  listing_status: ListingStatus;
  ebay_listing_id: string | null;
  ebay_listing_url: string | null;
  show_name: string | null;
  show_date: Date | null;
  booth_cost: number | null;
  list_price: number;
  asking_price: number | null;
  currency: string;
  listed_at: Date | null;
  sold_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface SalesTable {
  id: Generated<string>;
  user_id: string;
  card_instance_id: string;
  listing_id: string | null;
  trade_id: string | null;
  card_show_id: string | null;
  platform: ListingPlatform;
  sale_price: number;
  platform_fees: number;
  shipping_cost: number;
  currency: string;
  total_cost_basis: number | null;
  net_proceeds: ColumnType<number, never, never>;  // computed column
  order_details_link: string | null;
  unique_id: string | null;
  unique_id_2: string | null;
  sold_at: Generated<Date>;
  created_at: Generated<Date>;
}

export interface CardShowsTable {
  id: Generated<string>;
  user_id: string;
  name: string;
  location: string | null;
  show_date: Date;
  end_date: Date | null;
  num_days: Generated<number>;
  num_tables: string | null;  // NUMERIC(5,1) — stored as string by pg driver
  notes: string | null;
  created_at: Generated<Date>;
}

export interface CsvImportsTable {
  id: Generated<string>;
  user_id: string;
  filename: string;
  import_type: string;
  row_count: number | null;
  imported_count: number | null;
  error_count: number | null;
  status: ImportStatus;
  error_log: unknown | null;   // JSONB
  mapping: unknown | null;     // JSONB
  raw_headers: unknown | null; // JSONB
  preview_rows: unknown | null; // JSONB
  created_at: Generated<Date>;
  completed_at: Date | null;
}

export interface AuditLogTable {
  id: Generated<bigint>;
  user_id: string | null;
  entity_type: string;
  entity_id: string;
  action: string;
  actor: string; // 'user' | 'agent'
  actor_name: string | null;
  old_data: unknown | null;
  new_data: unknown | null;
  ip_address: string | null;
  created_at: Generated<Date>;
}

export interface RawPurchasesTable {
  id: Generated<string>;
  user_id: string;
  purchase_id: string;
  type: RawPurchaseType;
  source: string | null;
  order_number: string | null;
  language: string;
  catalog_id: string | null;
  card_name: string | null;
  set_name: string | null;
  card_number: string | null;
  total_cost_yen: number | null;
  fx_rate: number | null;
  total_cost_usd: number | null;
  card_count: number;
  status: RawPurchaseStatus;
  purchased_at: Date | null;
  received_at: Date | null;
  reserved: Generated<boolean>;
  notes: string | null;
  receipt_url: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface RawPurchaseSequencesTable {
  user_id: string;
  year: number;
  type: RawPurchaseType;
  next_seq: number;
}

export interface CardGamesTable {
  id: Generated<string>;
  name: string;
  abbreviation: string | null;
  languages: Generated<string[]>;
  created_at: Generated<Date>;
}

export interface PokemonSetAliasesTable {
  id: Generated<string>;
  user_id: string;
  language: string;
  game: string;
  alias: string;
  set_code: string;
  set_name: string | null;
  created_at: Generated<Date>;
}

export interface GradingBatchesTable {
  id: Generated<string>;
  user_id: string;
  batch_id: string;
  name: string | null;
  company: string;
  tier: string;
  submitted_at: Date | null;
  grading_cost: Generated<number>;  // cost per card, in cents
  status: Generated<string>;
  notes: string | null;
  submission_number: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface GradingBatchItemsTable {
  id: Generated<string>;
  batch_id: string;
  card_instance_id: string;
  line_item_num: number;
  quantity: Generated<number>;
  expected_grade: number | null;
  estimated_value: number | null;
  created_at: Generated<Date>;
}

export interface GradingBatchSequencesTable {
  user_id: string;
  year: number;
  next_seq: number;
}

// ============================================================
// Database interface (used by Kysely)
// ============================================================

export interface ExpensesTable {
  id: Generated<string>;
  user_id: string;
  expense_id: string | null;
  date: Date;
  description: string;
  type: string;
  amount: number;
  currency: string;
  link: string | null;
  order_number: string | null;
  receipt_url: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ExpenseSequencesTable {
  user_id: string;
  year: number;
  next_seq: number;
}

export interface ReorderThresholdsTable {
  id: Generated<string>;
  user_id: string;
  catalog_id: string;
  min_quantity: number;
  is_ignored: Generated<boolean>;
  muted_until: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface GradeMoreThresholdsTable {
  id: Generated<string>;
  user_id: string;
  catalog_id: string;
  company: string;
  grade: number | null;
  grade_label: string | null;
  min_quantity: number;
  is_ignored: Generated<boolean>;
  muted_until: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface OrganizationsTable {
  id: Generated<string>;
  name: string;
  max_members: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface OrgMembersTable {
  id: Generated<string>;
  org_id: string;
  user_id: string;
  role: 'owner' | 'member';
  joined_at: Generated<Date>;
}

export interface OrgInvitesTable {
  id: Generated<string>;
  org_id: string;
  invited_by: string;
  token: string;
  name: string | null;
  email: string | null;
  expires_at: Date;
  used_at: Date | null;
  used_by: string | null;
  created_at: Generated<Date>;
}

export interface Database {
  organizations: OrganizationsTable;
  org_members: OrgMembersTable;
  org_invites: OrgInvitesTable;
  grade_more_thresholds: GradeMoreThresholdsTable;
  reorder_thresholds: ReorderThresholdsTable;
  expenses: ExpensesTable;
  expense_sequences: ExpenseSequencesTable;
  locations: LocationsTable;
  users: UsersTable;
  card_catalog: CardCatalogTable;
  card_catalog_seed: CardCatalogSeedTable;
  card_instances: CardInstancesTable;
  grading_submissions: GradingSubmissionsTable;
  slab_details: SlabDetailsTable;
  listings: ListingsTable;
  sales: SalesTable;
  trades: TradesTable;
  trade_sequences: TradeSequencesTable;
  csv_imports: CsvImportsTable;
  audit_log: AuditLogTable;
  card_games: CardGamesTable;
  pokemon_set_aliases: PokemonSetAliasesTable;
  raw_purchases: RawPurchasesTable;
  raw_purchase_sequences: RawPurchaseSequencesTable;
  grading_batches: GradingBatchesTable;
  grading_batch_items: GradingBatchItemsTable;
  grading_batch_sequences: GradingBatchSequencesTable;
  card_shows: CardShowsTable;
  alert_overrides: AlertOverridesTable;
}

export interface AlertOverridesTable {
  id: Generated<string>;
  user_id: string;
  entity_type: 'ebay_listing' | 'card_show';
  entity_id: string;
  muted_until: Date | null;
  is_ignored: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

// ============================================================
// Convenience types (Selectable, Insertable, Updateable)
// ============================================================

export type User = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;
export type UserUpdate = Updateable<UsersTable>;

export type CardCatalog = Selectable<CardCatalogTable>;
export type NewCardCatalog = Insertable<CardCatalogTable>;

export type CardInstance = Selectable<CardInstancesTable>;
export type NewCardInstance = Insertable<CardInstancesTable>;
export type CardInstanceUpdate = Updateable<CardInstancesTable>;

export type GradingSubmission = Selectable<GradingSubmissionsTable>;
export type NewGradingSubmission = Insertable<GradingSubmissionsTable>;

export type SlabDetail = Selectable<SlabDetailsTable>;
export type NewSlabDetail = Insertable<SlabDetailsTable>;

export type Listing = Selectable<ListingsTable>;
export type NewListing = Insertable<ListingsTable>;

export type Sale = Selectable<SalesTable>;
export type NewSale = Insertable<SalesTable>;

export type CsvImport = Selectable<CsvImportsTable>;
