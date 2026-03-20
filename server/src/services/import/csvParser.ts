import Papa from 'papaparse';

export interface ParseResult {
  headers: string[];
  rows: Record<string, string>[];
  rowCount: number;
  errors: string[];
}

export function parseCsvBuffer(buffer: Buffer, filename: string): ParseResult {
  const text = buffer.toString('utf-8');

  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  const errors = result.errors.map(
    (e) => `Row ${e.row ?? '?'}: ${e.message}`
  );

  return {
    headers: result.meta.fields ?? [],
    rows: result.data,
    rowCount: result.data.length,
    errors,
  };
}

// Known column aliases for auto-mapping
export const FIELD_ALIASES: Record<string, string[]> = {
  card_name: ['card name', 'name', 'card', 'title', 'item', 'item name', 'description'],
  set_name: ['set', 'set name', 'expansion', 'series'],
  card_number: ['number', 'card #', 'card number', '#', 'num'],
  card_game: ['game', 'tcg', 'product type'],
  condition: ['condition', 'cond', 'grade (raw)', 'raw grade'],
  purchase_cost: ['cost', 'price', 'purchase price', 'buy price', 'paid', 'amount paid', 'cost (usd)', 'buy'],
  currency: ['currency', 'cur'],
  quantity: ['qty', 'quantity', 'count', 'amount'],
  order_number: ['order', 'order #', 'order number', 'order id'],
  source_link: ['link', 'url', 'listing url', 'source'],
  purchased_at: ['date', 'purchase date', 'buy date', 'date purchased', 'order date'],
  language: ['language', 'lang'],
  // Graded-specific
  cert_number: ['cert', 'cert #', 'cert number', 'certification', 'psa #', 'bgs #', 'cgc #', 'serial'],
  grade: ['grade', 'psa grade', 'bgs grade', 'cgc grade', 'score'],
  grading_company: ['company', 'grader', 'grading company', 'graded by'],
  grading_fee: ['grading fee', 'grading cost', 'submission cost'],
  // Sale-specific
  sale_price: ['sale price', 'sell price', 'sold for', 'selling price', 'final price'],
  platform_fees: ['fees', 'platform fees', 'ebay fees', 'selling fees'],
  unique_id: ['item id', 'item #', 'listing id', 'ebay item', 'unique id'],
};

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
