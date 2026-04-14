import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../config/env';

export interface ParseResult {
  headers: string[];
  rows: Record<string, string>[];
  rowCount: number;
  errors: string[];
}

export function parseCsvBuffer(buffer: Buffer, filename: string): ParseResult {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.ods')) {
    return parseExcelBuffer(buffer);
  }
  return parseCsv(buffer);
}

function parseCsv(buffer: Buffer): ParseResult {
  const text = buffer.toString('utf-8');
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  return {
    headers: result.meta.fields ?? [],
    rows: result.data,
    rowCount: result.data.length,
    errors: result.errors.map((e) => `Row ${e.row ?? '?'}: ${e.message}`),
  };
}

function parseExcelBuffer(buffer: Buffer): ParseResult {
  try {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });

    if (rawRows.length === 0) return { headers: [], rows: [], rowCount: 0, errors: [] };

    const allHeaders = Object.keys(rawRows[0]).map((h) => String(h).trim());

    // Build string rows first
    const allRows: Record<string, string>[] = rawRows.map((r) =>
      Object.fromEntries(
        Object.entries(r).map(([k, v]) => {
          let str: string;
          if (v instanceof Date) {
            str = v.toISOString().split('T')[0];
          } else {
            str = v == null ? '' : String(v).trim();
          }
          return [String(k).trim(), str];
        })
      )
    );

    // Filter out __EMPTY_* columns and columns where every row is blank
    const headers = allHeaders.filter((h) => {
      if (/^__EMPTY/.test(h)) return false;
      return allRows.some((r) => (r[h] ?? '').length > 0);
    });

    // Filter out rows where all kept-header values are empty
    const rows = allRows.filter((r) => headers.some((h) => (r[h] ?? '').length > 0));

    // Strip dropped headers from rows to keep payload small
    const cleanRows = rows.map((r) =>
      Object.fromEntries(headers.map((h) => [h, r[h] ?? '']))
    );

    return { headers, rows: cleanRows, rowCount: cleanRows.length, errors: [] };
  } catch (err) {
    return { headers: [], rows: [], rowCount: 0, errors: [`Failed to parse Excel file: ${err instanceof Error ? err.message : String(err)}`] };
  }
}

// Known column aliases for auto-mapping
export const FIELD_ALIASES: Record<string, string[]> = {
  card_name: ['card name', 'name', 'card', 'title', 'item', 'item name', 'description'],
  set_name: ['set', 'set name', 'expansion', 'series'],
  card_number: ['number', 'card #', 'card number', '#', 'num'],
  card_game: ['game', 'tcg', 'product type'],
  condition: ['condition', 'cond', 'grade (raw)', 'raw grade'],
  purchase_cost: ['cost', 'price', 'purchase price', 'buy price', 'paid', 'amount paid', 'cost (usd)', 'buy', 'raw', 'raw cost', 'raw price', 'base cost'],
  currency: ['currency', 'cur'],
  quantity: ['qty', 'quantity', 'count', 'amount'],
  order_number: ['order', 'order #', 'order number', 'order id'],
  source_link: ['link', 'url', 'listing url', 'source'],
  purchased_at: ['date', 'purchase date', 'buy date', 'date purchased', 'order date', 'raw purchase date', 'purchase date (raw)', 'bought date'],
  language: ['language', 'lang'],
  // Graded-specific
  cert_number: ['cert', 'cert #', 'cert number', 'certification', 'psa #', 'bgs #', 'cgc #', 'serial', 'slab id', 'cert id'],
  grade: ['grade', 'psa grade', 'bgs grade', 'cgc grade', 'score', 'slab grade'],
  company: ['company', 'grader', 'grading company', 'graded by', 'grading service', 'grading co'],
  grading_cost: ['grading fee', 'grading cost', 'submission cost', 'grading cost', 'sub cost', 'grading'],
  // Sale-specific
  sale_price: ['sale price', 'sell price', 'sold for', 'selling price', 'final price', 'sold price', 'after ebay'],
  platform_fees: ['fees', 'platform fees', 'ebay fees', 'selling fees'],
  unique_id: ['item id', 'item #', 'listing id', 'ebay item', 'unique id'],
};

export interface AIDetectionResult {
  import_type: 'graded' | 'raw_purchase' | 'bulk_sale' | 'expenses' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
  mapping: Record<string, string>;
}

export async function aiDetectImport(headers: string[], sampleRows: Record<string, string>[]): Promise<AIDetectionResult> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const sampleText = sampleRows.slice(0, 3).map((row, i) =>
    `Row ${i + 1}: ${JSON.stringify(row)}`
  ).join('\n');

  const fieldOptions = {
    graded:       ['card_name', 'set_name', 'card_number', 'cert_number', 'grade', 'company', 'purchase_cost', 'grading_cost', 'currency', 'purchased_at', 'order_number', 'notes'],
    raw_purchase: ['card_name', 'set_name', 'card_number', 'condition', 'quantity', 'cost', 'currency', 'order_number', 'source', 'purchased_at', 'language', 'type', 'notes'],
    bulk_sale:    ['identifier', 'sale_price', 'platform', 'platform_fees', 'shipping_cost', 'currency', 'sold_at', 'unique_id'],
    expenses:     ['description', 'amount', 'type', 'date', 'order_number', 'currency', 'link'],
  };

  const prompt = `You are analyzing a CSV/Excel file for a Pokemon card inventory management system called Reactor.

Column headers: ${JSON.stringify(headers)}

Sample data:
${sampleText}

Determine what type of import this is and map the columns to the correct fields.

Import types:
- "graded": Graded slabs (PSA/BGS/CGC cards) being added to inventory. Usually has cert_number, grade, company.
- "raw_purchase": Raw/ungraded card purchases. Usually has card_name, condition, cost, quantity.
- "bulk_sale": Recording sales of cards already in inventory. Usually has a price and some identifier (cert# or purchase ID).
- "expenses": Business expenses (shipping, fees, supplies). Usually has description, amount, date.
- "unknown": Cannot determine with confidence.

Column name hints (common aliases users use):
- "Cert" or "Cert #" → cert_number
- "Card" → card_name
- "Grade" → grade
- "Raw" or "Raw Cost" or "Raw Price" → purchase_cost (the cost of the card before grading)
- "Grading Cost" or "Grading" → grading_cost
- "Raw Purchase Date" or "Bought Date" → purchased_at
- "Notes" → notes
- "Company" or "Grading Service" → company

Target fields per type:
${JSON.stringify(fieldOptions, null, 2)}

Respond with ONLY valid JSON in this exact shape:
{
  "import_type": "graded" | "raw_purchase" | "bulk_sale" | "expenses" | "unknown",
  "confidence": "high" | "medium" | "low",
  "reasoning": "one sentence explanation",
  "mapping": { "CSV Column Name": "target_field_name", ... }
}

Only include columns in mapping that you can confidently match to a target field. Skip columns that don't match anything.`;

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const json = text.match(/\{[\s\S]*\}/)?.[0];
    if (!json) throw new Error('No JSON in response');
    const parsed = JSON.parse(json) as AIDetectionResult;
    return parsed;
  } catch {
    // Fall back to heuristic detection
    const heuristic = autoDetectMapping(headers);
    const hasGradeFields = headers.some((h) => /cert|grade|psa|bgs|cgc/i.test(h));
    const hasSaleFields = headers.some((h) => /sale.?price|sold.?for|selling/i.test(h));
    const hasExpenseFields = headers.some((h) => /description|expense|amount/i.test(h));
    const type = hasGradeFields ? 'graded' : hasSaleFields ? 'bulk_sale' : hasExpenseFields ? 'expenses' : 'raw_purchase';
    return { import_type: type, confidence: 'low', reasoning: 'AI unavailable — heuristic detection used', mapping: heuristic };
  }
}

export function autoDetectMapping(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const normalizedHeaders = headers.map((h) => h.toLowerCase().trim());

  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const header of normalizedHeaders) {
      if (aliases.some((alias) => header.includes(alias) || alias.includes(header))) {
        const originalHeader = headers[normalizedHeaders.indexOf(header)];
        if (originalHeader && !Object.values(mapping).includes(field)) {
          mapping[originalHeader] = field;
        }
        break;
      }
    }
  }

  return mapping;
}
