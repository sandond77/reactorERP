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

export type GradingCompany = 'PSA' | 'BGS' | 'CGC' | 'SGC' | 'HGA' | 'ACE' | 'OTHER';

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
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
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
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  deleted_at: Date | null;
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
  old_data: unknown | null;
  new_data: unknown | null;
  ip_address: string | null;
  created_at: Generated<Date>;
}

export interface PokemonSetAliasesTable {
  id: Generated<string>;
  language: string;
  alias: string;
  set_code: string;
  set_name: string | null;
  created_at: Generated<Date>;
}

// ============================================================
// Database interface (used by Kysely)
// ============================================================

export interface Database {
  users: UsersTable;
  card_catalog: CardCatalogTable;
  card_instances: CardInstancesTable;
  grading_submissions: GradingSubmissionsTable;
  slab_details: SlabDetailsTable;
  listings: ListingsTable;
  sales: SalesTable;
  csv_imports: CsvImportsTable;
  audit_log: AuditLogTable;
  pokemon_set_aliases: PokemonSetAliasesTable;
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
