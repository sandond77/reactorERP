/**
 * Seed script: import slab inventory CSV into card_instances + slab_details + grading_submissions + listings + sales
 *
 * Usage:
 *   npx tsx server/src/db/seeds/seed-slabs.ts [csv-path] [user-email]
 *
 * Defaults:
 *   csv-path  = ~/Desktop/Master Card Inventory - Slab Inventory.csv
 *   user-email = first user in DB
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Papa from 'papaparse';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../../../.env') });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL not set — check server/.env');

const CSV_PATH =
  process.argv[2] ??
  path.join(os.homedir(), 'Desktop', 'Master Card Inventory - Slab Inventory.csv');

const USER_EMAIL_ARG = process.argv[3];

// ─── Types ───────────────────────────────────────────────────────────────────

type GradingCompany = 'PSA' | 'BGS' | 'CGC' | 'SGC' | 'HGA' | 'ACE' | 'ARS' | 'OTHER';
type CardStatus = 'graded' | 'sold';
type PurchaseType = 'raw' | 'pre_graded';
type ListingPlatform = 'ebay' | 'card_show' | 'tcgplayer' | 'facebook' | 'instagram' | 'local' | 'other';

interface ParsedRow {
  cert: string;
  cardName: string;
  grade: string;
  company: GradingCompany;
  numericGrade: number | null;
  language: string;
  purchaseCost: number;     // cents
  gradingCost: number;      // cents
  purchaseType: PurchaseType;
  purchasedAt: Date | null;
  notes: string | null;
  status: CardStatus;
  // listing/sale fields (only if sold)
  listedPrice: number;      // cents
  afterEbay: number;        // cents
  listingUrl: string | null;
  dateListed: Date | null;
  dateSold: Date | null;
  platform: ListingPlatform;
  isListed: boolean;
}

// ─── Parsing helpers ──────────────────────────────────────────────────────────

function parseDollars(val: string | undefined): number {
  if (!val) return 0;
  const cleaned = val.replace(/[$, ]/g, '').trim();
  if (!cleaned || cleaned === '-') return 0;
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : Math.round(n * 100);
}

function parseMMDDYYYY(val: string | undefined): Date | null {
  if (!val?.trim()) return null;
  const parts = val.trim().split('/');
  if (parts.length !== 3) return null;
  let [m, d, y] = parts.map(Number);
  if (isNaN(m) || isNaN(d) || isNaN(y)) return null;
  // Handle 2-digit years: new Date(24, ...) = 1924, not 2024
  if (y >= 0 && y <= 99) y += 2000;
  return new Date(y, m - 1, d);
}

function inferCompany(grade: string): GradingCompany {
  const g = grade.trim().toUpperCase();
  if (g.startsWith('ARS')) return 'ARS';
  // BGS grades are bare numbers or "N Gem Mint" / "N Pristine"
  if (/^\d+(\.\d+)?(\s+(GEM MINT|PRISTINE))?$/i.test(g)) return 'BGS';
  // PSA grade strings all contain the grade word followed by a number
  return 'PSA';
}

function parseNumericGrade(grade: string): number | null {
  const g = grade.trim();
  // ARS: "ARS10", "ARS10+", "ARS 9"
  const arsMatch = g.match(/^ARS\s*(\d+(\.\d+)?)/i);
  if (arsMatch) return parseFloat(arsMatch[1]);
  // BGS: bare number or "10 Gem Mint" / "10 Pristine"
  const numMatch = g.match(/^(\d+(\.\d+)?)/);
  if (numMatch) return parseFloat(numMatch[1]);
  // PSA: extract last number in string ("GEM MINT 10" → 10, "MINT 9 OC" → 9)
  const psaMatch = g.match(/(\d+(\.\d+)?)\s*(OC)?$/i);
  if (psaMatch) return parseFloat(psaMatch[1]);
  return null;
}

function detectLanguage(cardName: string): string {
  return /japanese/i.test(cardName) ? 'JPN' : 'EN';
}

function detectPurchaseType(notes: string, gradingCost: number): PurchaseType {
  if (/bought\s+graded/i.test(notes)) return 'pre_graded';
  if (gradingCost > 0) return 'raw';
  return 'pre_graded'; // default: most slabs are purchased pre-graded
}

function detectPlatform(listingUrl: string | null, isCardShow: boolean): ListingPlatform {
  if (listingUrl && /ebay/i.test(listingUrl)) return 'ebay';
  if (isCardShow) return 'card_show';
  return 'other';
}

// ─── Row parser ───────────────────────────────────────────────────────────────

function parseRow(raw: Record<string, string>): ParsedRow | null {
  const cert = raw['Cert']?.trim();
  const grade = raw['Grade']?.trim();
  if (!cert || !grade || grade === 'Shipped to you') return null;

  const cardName = raw['Card']?.trim() ?? '';
  const company = inferCompany(grade);
  const numericGrade = parseNumericGrade(grade);
  const language = detectLanguage(cardName);
  const purchaseCost = parseDollars(raw['Raw']);
  const gradingCost = parseDollars(raw['Grading Cost']);
  const notes = raw['Notes']?.trim() || null;
  const purchaseType = detectPurchaseType(notes ?? '', gradingCost);
  const purchasedAt = parseMMDDYYYY(raw['Raw Purchase Date']);
  const dateSold = parseMMDDYYYY(raw['Date Sold']);
  const dateListed = parseMMDDYYYY(raw['Date Listed']);
  const status: CardStatus = dateSold ? 'sold' : 'graded';
  const listedPrice = parseDollars(raw['Listed Price']);
  const afterEbay = parseDollars(raw['After Ebay']);
  const listingUrl = raw['Listing']?.trim() || null;
  const isListed = raw['Listed?']?.trim().toLowerCase() === 'yes' || !!listingUrl;
  const isCardShow = raw['Card Show?']?.trim().toLowerCase() === 'yes';
  const platform = detectPlatform(listingUrl, isCardShow);

  return {
    cert,
    cardName,
    grade,
    company,
    numericGrade,
    language,
    purchaseCost,
    gradingCost,
    purchaseType,
    purchasedAt,
    notes,
    status,
    listedPrice,
    afterEbay,
    listingUrl,
    dateListed,
    dateSold,
    platform,
    isListed,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`CSV not found: ${CSV_PATH}`);
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  console.log('Connected to database.');

  try {
    // Add ARS to enum if not present (idempotent)
    await client.query(`ALTER TYPE grading_company ADD VALUE IF NOT EXISTS 'ARS'`);
    console.log('Ensured ARS grading company exists.');

    // Get user
    let userId: string;
    if (USER_EMAIL_ARG) {
      const res = await client.query('SELECT id FROM users WHERE email = $1 LIMIT 1', [USER_EMAIL_ARG]);
      if (!res.rows.length) throw new Error(`User not found: ${USER_EMAIL_ARG}`);
      userId = res.rows[0].id;
    } else {
      const res = await client.query('SELECT id, email FROM users WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1');
      if (!res.rows.length) throw new Error('No users found in database. Please log in first to create your user account.');
      userId = res.rows[0].id;
      console.log(`Using user: ${res.rows[0].email}`);
    }

    // Parse CSV
    const csvContent = fs.readFileSync(CSV_PATH, 'utf-8');
    const { data: rawRows } = Papa.parse<Record<string, string>>(csvContent, {
      header: true,
      skipEmptyLines: true,
    });

    const rows: ParsedRow[] = [];
    for (const raw of rawRows) {
      const parsed = parseRow(raw);
      if (parsed) rows.push(parsed);
    }
    console.log(`Parsed ${rows.length} valid rows from ${rawRows.length} total CSV rows.`);

    // Import stats
    let cardCount = 0;
    let slabCount = 0;
    let submissionCount = 0;
    let listingCount = 0;
    let saleCount = 0;
    const errors: Array<{ cert: string; message: string }> = [];

    for (const row of rows) {
      try {
        await client.query('BEGIN');

        // 1. Insert card_instance
        const cardRes = await client.query(
          `INSERT INTO card_instances (
            user_id, catalog_id,
            card_name_override, set_name_override, card_number_override,
            card_game, language, variant, rarity, notes,
            purchase_type, status, quantity,
            purchase_cost, currency,
            source_link, order_number,
            condition, condition_notes,
            image_front_url, image_back_url,
            purchased_at
          ) VALUES (
            $1, NULL,
            $2, NULL, NULL,
            'pokemon', $3, NULL, NULL, $4,
            $5, $6, 1,
            $7, 'USD',
            NULL, NULL,
            NULL, NULL,
            NULL, NULL,
            $8
          ) RETURNING id`,
          [
            userId,
            row.cardName,
            row.language,
            row.notes,
            row.purchaseType,
            row.status,
            row.purchaseCost,
            row.purchasedAt,
          ]
        );
        const cardInstanceId: string = cardRes.rows[0].id;
        cardCount++;

        // 2. Insert slab_details
        await client.query(
          `INSERT INTO slab_details (
            card_instance_id, user_id,
            source_raw_instance_id, grading_submission_id,
            company, cert_number, grade, grade_label,
            subgrades, additional_cost, currency
          ) VALUES (
            $1, $2,
            NULL, NULL,
            $3, $4, $5, $6,
            NULL, 0, 'USD'
          )`,
          [
            cardInstanceId,
            userId,
            row.company,
            row.cert,
            row.numericGrade,
            row.grade,
          ]
        );
        slabCount++;

        // Grading submissions are not created during seeding — they are entered manually
        // when raw cards are physically submitted to a grading company.

        // 4. Insert listing + sale (if sold or listed)
        if (row.isListed || row.dateSold) {
          const listPrice = row.listedPrice > 0 ? row.listedPrice : row.afterEbay;
          if (listPrice > 0) {
            const listingStatus = row.dateSold ? 'sold' : 'active';
            const listingRes = await client.query(
              `INSERT INTO listings (
                user_id, card_instance_id,
                platform, listing_status,
                ebay_listing_id, ebay_listing_url,
                show_name, show_date, booth_cost,
                list_price, asking_price, currency,
                listed_at, sold_at
              ) VALUES (
                $1, $2,
                $3, $4,
                NULL, $5,
                NULL, NULL, NULL,
                $6, NULL, 'USD',
                $7, $8
              ) RETURNING id`,
              [
                userId,
                cardInstanceId,
                row.platform,
                listingStatus,
                row.platform === 'ebay' ? row.listingUrl : null,
                listPrice,
                row.dateListed,
                row.dateSold,
              ]
            );
            const listingId: string = listingRes.rows[0].id;
            listingCount++;

            // 5. Insert sale
            if (row.dateSold) {
              const salePrice = row.listedPrice > 0 ? row.listedPrice : row.afterEbay;
              const platformFees =
                row.listedPrice > 0 && row.afterEbay > 0
                  ? Math.max(0, row.listedPrice - row.afterEbay)
                  : 0;
              const totalCostBasis = row.purchaseCost + row.gradingCost;

              await client.query(
                `INSERT INTO sales (
                  user_id, card_instance_id, listing_id,
                  platform, sale_price, platform_fees, shipping_cost, currency,
                  total_cost_basis,
                  order_details_link, unique_id, unique_id_2,
                  sold_at
                ) VALUES (
                  $1, $2, $3,
                  $4, $5, $6, 0, 'USD',
                  $7,
                  $8, NULL, NULL,
                  $9
                )`,
                [
                  userId,
                  cardInstanceId,
                  listingId,
                  row.platform,
                  salePrice,
                  platformFees,
                  totalCostBasis,
                  row.listingUrl,
                  row.dateSold,
                ]
              );
              saleCount++;
            }
          }
        }

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        errors.push({
          cert: row.cert,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    console.log('\n=== Import complete ===');
    console.log(`  card_instances:      ${cardCount}`);
    console.log(`  slab_details:        ${slabCount}`);
    console.log(`  grading_submissions: ${submissionCount}`);
    console.log(`  listings:            ${listingCount}`);
    console.log(`  sales:               ${saleCount}`);
    console.log(`  errors:              ${errors.length}`);

    if (errors.length > 0) {
      console.log('\nFirst 20 errors:');
      errors.slice(0, 20).forEach((e) => console.log(`  cert ${e.cert}: ${e.message}`));
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
