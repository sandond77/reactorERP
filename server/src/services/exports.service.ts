import { sql } from 'kysely';
import * as XLSX from 'xlsx';
import PDFDocument from 'pdfkit';
import { db } from '../config/database';

// ─── Shared helpers ───────────────────────────────────────────────────────────

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtDateISO(d: Date | string | null | undefined): string {
  if (!d) return '';
  return new Date(d).toISOString().slice(0, 10);
}

function fmtMoney(cents: number | null | undefined, currency = 'USD'): string {
  if (cents == null) return '';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

function csvEscape(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCSV(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [headers.map(csvEscape).join(',')];
  for (const r of rows) lines.push(r.map(csvEscape).join(','));
  return lines.join('\r\n');
}

function toXLSX(sheetName: string, headers: string[], rows: (string | number | null | undefined)[][]): Buffer {
  const data = [headers, ...rows.map((r) => r.map((v) => (v == null ? '' : v)))];
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31)); // Excel caps sheet names at 31 chars
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function toPDF(opts: {
  title: string;
  subtitle?: string;
  columns: { header: string; key: string; x: number; width: number; align?: 'left' | 'right' }[];
  rows: Record<string, string | number | null | undefined>[];
  totals?: { label: string; value: string }[];
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Landscape Letter (792x612) gives us 712px of usable horizontal width
    // at 40px margins — plenty for wide tables like sales/inventory exports.
    const doc = new PDFDocument({ margin: 40, size: 'LETTER', layout: 'landscape' });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageW = 792;
    const pageH = 612;
    const marginX = 40;
    const tableLeft = marginX;
    const tableRight = pageW - marginX;
    const tableWidth = tableRight - tableLeft;
    const rowH = 18;

    // Title block
    doc.fontSize(16).font('Helvetica-Bold').fillColor('#111111').text(opts.title);
    if (opts.subtitle) {
      doc.fontSize(9).font('Helvetica').fillColor('#666666').text(opts.subtitle);
    }
    doc.fontSize(8).fillColor('#999999').text(`Generated: ${fmtDate(new Date())}`);
    doc.moveDown(0.5);

    function drawHeader(y: number) {
      doc.rect(tableLeft, y, tableWidth, rowH).fill('#1f2937');
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff');
      for (const c of opts.columns) {
        doc.text(c.header, c.x, y + 5, { width: c.width, align: c.align ?? 'left', lineBreak: false });
      }
      return y + rowH;
    }

    let y = drawHeader(doc.y);
    doc.font('Helvetica').fontSize(8);

    opts.rows.forEach((row, i) => {
      // Page break
      if (y + rowH > pageH - 60) {
        doc.addPage();
        y = drawHeader(40);
        doc.font('Helvetica').fontSize(8);
      }
      if (i % 2 === 0) doc.rect(tableLeft, y, tableWidth, rowH).fill('#f9fafb');
      doc.fillColor('#111111');
      for (const c of opts.columns) {
        const v = row[c.key];
        doc.text(v == null ? '' : String(v), c.x, y + 5, { width: c.width, align: c.align ?? 'left', lineBreak: false });
      }
      y += rowH;
    });

    // Totals
    if (opts.totals && opts.totals.length) {
      doc.moveTo(tableLeft, y).lineTo(tableRight, y).stroke('#d1d5db');
      y += 6;
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#111111');
      for (const t of opts.totals) {
        doc.text(`${t.label}: ${t.value}`, tableLeft, y, { width: tableWidth, align: 'right' });
        y += 14;
      }
    }

    doc.end();
  });
}

// ─── SALES ────────────────────────────────────────────────────────────────────

export interface SalesExportFilters {
  from?: Date;
  to?: Date;
  platform?: string;
}

interface SaleRow {
  id: string;
  sold_at: Date;
  card_name: string | null;
  set_name: string | null;
  cert_number: string | null;
  raw_purchase_label: string | null;
  grading_company: string | null;
  grade_label: string | null;
  condition: string | null;
  quantity: number | null;
  platform: string;
  sale_price: number;
  platform_fees: number;
  shipping_cost: number;
  net_proceeds: number;
  total_cost_basis: number | null;
  profit: number;
  currency: string;
}

async function fetchSales(userId: string, f: SalesExportFilters): Promise<SaleRow[]> {
  const rows = await db
    .selectFrom('sales as s')
    .leftJoin('card_instances as ci', 'ci.id', 's.card_instance_id')
    .leftJoin('card_catalog as cc', 'cc.id', 'ci.catalog_id')
    .leftJoin('slab_details as sd', 'sd.card_instance_id', 'ci.id')
    .leftJoin('raw_purchases as rp', 'rp.id', 'ci.raw_purchase_id')
    .select([
      's.id',
      's.sold_at',
      sql<string | null>`COALESCE(ci.card_name_override, cc.card_name)`.as('card_name'),
      sql<string | null>`COALESCE(cc.set_name, ci.set_name_override)`.as('set_name'),
      sql<string | null>`sd.cert_number::text`.as('cert_number'),
      sql<string | null>`rp.purchase_id`.as('raw_purchase_label'),
      'sd.company as grading_company',
      'sd.grade_label',
      'ci.condition',
      'ci.quantity',
      's.platform',
      's.sale_price',
      's.platform_fees',
      's.shipping_cost',
      's.net_proceeds',
      's.total_cost_basis',
      sql<number>`COALESCE(s.net_proceeds, 0) - COALESCE(s.total_cost_basis, 0)`.as('profit'),
      's.currency',
    ])
    .where('s.user_id', '=', userId)
    .$if(!!f.from, (qb) => qb.where('s.sold_at', '>=', f.from! as any))
    .$if(!!f.to, (qb) => qb.where('s.sold_at', '<=', f.to! as any))
    .$if(!!f.platform, (qb) => qb.where('s.platform', '=', f.platform! as any))
    .orderBy('s.sold_at', 'asc')
    .execute();
  return rows as SaleRow[];
}

const SALES_HEADERS = [
  'Sale Date', 'Card', 'Set', 'Cert / Lot', 'Company', 'Grade / Cond', 'Qty',
  'Platform', 'Sale Price', 'Fees', 'Shipping', 'Net Proceeds', 'Cost Basis', 'Profit', 'Currency',
];

function salesToTable(rows: SaleRow[]): (string | number | null)[][] {
  return rows.map((r) => [
    fmtDateISO(r.sold_at),
    r.card_name ?? '',
    r.set_name ?? '',
    r.cert_number ?? r.raw_purchase_label ?? '',
    r.grading_company ?? '',
    r.grade_label ?? r.condition ?? '',
    r.quantity ?? 1,
    r.platform,
    (r.sale_price / 100).toFixed(2),
    (r.platform_fees / 100).toFixed(2),
    (r.shipping_cost / 100).toFixed(2),
    (r.net_proceeds / 100).toFixed(2),
    r.total_cost_basis != null ? (r.total_cost_basis / 100).toFixed(2) : '',
    (r.profit / 100).toFixed(2),
    r.currency,
  ]);
}

export async function exportSalesCSV(userId: string, f: SalesExportFilters): Promise<string> {
  const rows = await fetchSales(userId, f);
  return toCSV(SALES_HEADERS, salesToTable(rows));
}

export async function exportSalesXLSX(userId: string, f: SalesExportFilters): Promise<Buffer> {
  const rows = await fetchSales(userId, f);
  return toXLSX('Sales', SALES_HEADERS, salesToTable(rows));
}

export async function exportSalesPDF(userId: string, f: SalesExportFilters): Promise<Buffer> {
  const rows = await fetchSales(userId, f);
  const totalSales = rows.reduce((s, r) => s + r.sale_price, 0);
  const totalNet = rows.reduce((s, r) => s + r.net_proceeds, 0);
  const totalProfit = rows.reduce((s, r) => s + r.profit, 0);
  const rangeLabel = f.from || f.to
    ? `${f.from ? fmtDate(f.from) : '—'} to ${f.to ? fmtDate(f.to) : '—'}`
    : 'All dates';

  // Compressed-column PDF — drops some fields the CSV has so each row fits.
  return toPDF({
    title: 'Sales Report',
    subtitle: `${rangeLabel}${f.platform ? `  ·  Platform: ${f.platform}` : ''}`,
    columns: [
      { header: 'Date',     key: 'date',     x: 40,  width: 60 },
      { header: 'Card',     key: 'card',     x: 105, width: 200 },
      { header: 'Grade',    key: 'grade',    x: 310, width: 65 },
      { header: 'Platform', key: 'platform', x: 380, width: 70 },
      { header: 'Qty',      key: 'qty',      x: 455, width: 30, align: 'right' },
      { header: 'Sale',     key: 'sale',     x: 490, width: 65, align: 'right' },
      { header: 'Net',      key: 'net',      x: 560, width: 65, align: 'right' },
      { header: 'Profit',   key: 'profit',   x: 630, width: 65, align: 'right' },
    ],
    rows: rows.map((r) => ({
      date: fmtDateISO(r.sold_at),
      card: (r.card_name ?? '').slice(0, 38),
      grade: r.grade_label ?? r.condition ?? '',
      platform: r.platform,
      qty: r.quantity ?? 1,
      sale: fmtMoney(r.sale_price, r.currency),
      net: fmtMoney(r.net_proceeds, r.currency),
      profit: fmtMoney(r.profit, r.currency),
    })),
    totals: [
      { label: 'Gross sales', value: fmtMoney(totalSales, 'USD') },
      { label: 'Net proceeds', value: fmtMoney(totalNet, 'USD') },
      { label: 'Profit', value: fmtMoney(totalProfit, 'USD') },
    ],
  });
}

// ─── INVENTORY ────────────────────────────────────────────────────────────────

export interface InventoryExportFilters {
  type?: 'graded' | 'raw' | 'all';
  status?: string;
}

interface InvRow {
  id: string;
  cert_number: string | null;
  raw_purchase_label: string | null;
  sku: string | null;
  card_name: string | null;
  set_name: string | null;
  card_number: string | null;
  language: string;
  condition: string | null;
  decision: string | null;
  status: string;
  quantity: number;
  grading_company: string | null;
  grade_label: string | null;
  grade: number | null;
  purchase_cost: number;
  grading_cost: number | null;
  location_name: string | null;
  is_card_show: boolean;
  card_show_price: number | null;
}

async function fetchInventory(userId: string, f: InventoryExportFilters): Promise<InvRow[]> {
  let q = db
    .selectFrom('card_instances as ci')
    .leftJoin('card_catalog as cc', 'cc.id', 'ci.catalog_id')
    .leftJoin('slab_details as sd', 'sd.card_instance_id', 'ci.id')
    .leftJoin('raw_purchases as rp', 'rp.id', 'ci.raw_purchase_id')
    .leftJoin('locations as loc', 'loc.id', 'ci.location_id')
    .select([
      'ci.id',
      sql<string | null>`sd.cert_number::text`.as('cert_number'),
      sql<string | null>`rp.purchase_id`.as('raw_purchase_label'),
      'cc.sku',
      sql<string | null>`COALESCE(ci.card_name_override, cc.card_name)`.as('card_name'),
      sql<string | null>`COALESCE(cc.set_name, ci.set_name_override)`.as('set_name'),
      sql<string | null>`COALESCE(cc.card_number, ci.card_number_override)`.as('card_number'),
      'ci.language',
      'ci.condition',
      'ci.decision',
      'ci.status',
      'ci.quantity',
      'sd.company as grading_company',
      'sd.grade_label',
      'sd.grade',
      'ci.purchase_cost',
      'sd.grading_cost',
      'loc.name as location_name',
      'ci.is_card_show',
      'ci.card_show_price',
    ])
    .where('ci.user_id', '=', userId);

  if (f.type === 'graded') q = q.where('sd.company', 'is not', null);
  else if (f.type === 'raw') q = q.where('sd.company', 'is', null);

  if (f.status) q = q.where('ci.status', '=', f.status as any);

  return q.orderBy('ci.created_at', 'desc').execute() as Promise<InvRow[]>;
}

const INVENTORY_HEADERS = [
  'ID / Cert', 'Part #', 'Card', 'Set', '#', 'Lang', 'Status', 'Decision', 'Qty',
  'Company', 'Grade', 'Condition', 'Purchase Cost', 'Grading Cost', 'Location', 'On Show', 'Show Price',
];

function inventoryToTable(rows: InvRow[]): (string | number | null)[][] {
  return rows.map((r) => [
    r.cert_number ?? r.raw_purchase_label ?? '',
    r.sku ?? '',
    r.card_name ?? '',
    r.set_name ?? '',
    r.card_number ?? '',
    r.language,
    r.status,
    r.decision ?? '',
    r.quantity,
    r.grading_company ?? '',
    r.grade_label ?? (r.grade != null ? String(r.grade) : ''),
    r.condition ?? '',
    (r.purchase_cost / 100).toFixed(2),
    r.grading_cost != null ? (r.grading_cost / 100).toFixed(2) : '',
    r.location_name ?? '',
    r.is_card_show ? 'Yes' : '',
    r.card_show_price != null ? (r.card_show_price / 100).toFixed(2) : '',
  ]);
}

export async function exportInventoryCSV(userId: string, f: InventoryExportFilters): Promise<string> {
  const rows = await fetchInventory(userId, f);
  return toCSV(INVENTORY_HEADERS, inventoryToTable(rows));
}

export async function exportInventoryXLSX(userId: string, f: InventoryExportFilters): Promise<Buffer> {
  const rows = await fetchInventory(userId, f);
  return toXLSX('Inventory', INVENTORY_HEADERS, inventoryToTable(rows));
}

export async function exportInventoryPDF(userId: string, f: InventoryExportFilters): Promise<Buffer> {
  const rows = await fetchInventory(userId, f);
  const totalCost = rows.reduce((s, r) => s + r.purchase_cost * r.quantity + (r.grading_cost ?? 0), 0);
  const totalQty = rows.reduce((s, r) => s + r.quantity, 0);

  return toPDF({
    title: 'Inventory Report',
    subtitle: `${f.type === 'graded' ? 'Graded slabs' : f.type === 'raw' ? 'Raw cards' : 'All cards'}${f.status ? `  ·  Status: ${f.status}` : ''}`,
    columns: [
      { header: 'ID / Cert', key: 'id',       x: 40,  width: 80 },
      { header: 'Card',      key: 'card',     x: 125, width: 200 },
      { header: 'Set',       key: 'set',      x: 330, width: 120 },
      { header: 'Status',    key: 'status',   x: 455, width: 65 },
      { header: 'Qty',       key: 'qty',      x: 525, width: 30, align: 'right' },
      { header: 'Grade',     key: 'grade',    x: 560, width: 55 },
      { header: 'Cost',      key: 'cost',     x: 620, width: 75, align: 'right' },
    ],
    rows: rows.map((r) => ({
      id: (r.cert_number ?? r.raw_purchase_label ?? '').slice(0, 14),
      card: (r.card_name ?? '').slice(0, 38),
      set: (r.set_name ?? '').slice(0, 22),
      status: r.status,
      qty: r.quantity,
      grade: r.grade_label ?? (r.grade != null ? String(r.grade) : r.condition ?? ''),
      cost: fmtMoney(r.purchase_cost * r.quantity + (r.grading_cost ?? 0), 'USD'),
    })),
    totals: [
      { label: 'Total qty', value: String(totalQty) },
      { label: 'Total cost basis', value: fmtMoney(totalCost, 'USD') },
    ],
  });
}

// ─── EXPENSES ─────────────────────────────────────────────────────────────────

export interface ExpensesExportFilters {
  from?: Date;
  to?: Date;
  types?: string[];
}

interface ExpRow {
  expense_id: string | null;
  date: Date;
  type: string;
  description: string | null;
  amount: number;
  currency: string;
  order_number: string | null;
  link: string | null;
}

async function fetchExpensesForExport(userId: string, f: ExpensesExportFilters): Promise<ExpRow[]> {
  const rows = await db
    .selectFrom('expenses as e')
    .select(['e.expense_id', 'e.date', 'e.type', 'e.description', 'e.amount', 'e.currency', 'e.order_number', 'e.link'])
    .where('e.user_id', '=', userId)
    .$if(!!f.from, (qb) => qb.where('e.date', '>=', f.from! as any))
    .$if(!!f.to, (qb) => qb.where('e.date', '<=', f.to! as any))
    .$if(f.types !== undefined && f.types.length > 0, (qb) =>
      qb.where('e.type', 'in', f.types! as any)
    )
    .orderBy('e.date', 'asc')
    .orderBy('e.expense_id', 'asc')
    .execute();
  return rows as ExpRow[];
}

const EXPENSES_HEADERS = ['ID', 'Date', 'Type', 'Description', 'Amount', 'Currency', 'Order #', 'Link'];

function expensesToTable(rows: ExpRow[]): (string | number | null)[][] {
  return rows.map((r) => [
    r.expense_id ?? '',
    fmtDateISO(r.date),
    r.type,
    r.description ?? '',
    (r.amount / 100).toFixed(2),
    r.currency,
    r.order_number ?? '',
    r.link ?? '',
  ]);
}

export async function exportExpensesCSV(userId: string, f: ExpensesExportFilters): Promise<string> {
  const rows = await fetchExpensesForExport(userId, f);
  return toCSV(EXPENSES_HEADERS, expensesToTable(rows));
}

export async function exportExpensesXLSX(userId: string, f: ExpensesExportFilters): Promise<Buffer> {
  const rows = await fetchExpensesForExport(userId, f);
  return toXLSX('Expenses', EXPENSES_HEADERS, expensesToTable(rows));
}

export async function exportExpensesPDF(userId: string, f: ExpensesExportFilters): Promise<Buffer> {
  const rows = await fetchExpensesForExport(userId, f);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const rangeLabel = f.from || f.to
    ? `${f.from ? fmtDate(f.from) : '—'} to ${f.to ? fmtDate(f.to) : '—'}`
    : 'All dates';
  return toPDF({
    title: 'Expense Report',
    subtitle: rangeLabel + (f.types?.length ? `  ·  Types: ${f.types.join(', ')}` : ''),
    columns: [
      { header: 'ID',          key: 'id',     x: 40,  width: 70 },
      { header: 'Date',        key: 'date',   x: 115, width: 75 },
      { header: 'Type',        key: 'type',   x: 195, width: 95 },
      { header: 'Description', key: 'desc',   x: 295, width: 320 },
      { header: 'Amount',      key: 'amount', x: 620, width: 75, align: 'right' },
    ],
    rows: rows.map((r) => ({
      id: r.expense_id ?? '',
      date: fmtDateISO(r.date),
      type: r.type,
      desc: (r.description ?? '').slice(0, 60),
      amount: fmtMoney(r.amount, r.currency),
    })),
    totals: [
      { label: 'Total', value: fmtMoney(total, 'USD') },
    ],
  });
}
