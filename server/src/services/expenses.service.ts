import { sql } from 'kysely';
import PDFDocument from 'pdfkit';
import { db } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { getPaginationOffset, buildPaginatedResult } from '../utils/pagination';
import type { PaginationParams } from '../utils/pagination';

async function nextExpenseId(userId: string, year: number): Promise<string> {
  const result = await sql<{ next_seq: number }>`
    INSERT INTO expense_sequences (user_id, year, next_seq)
    VALUES (${userId}, ${year}, 2)
    ON CONFLICT (user_id, year)
    DO UPDATE SET next_seq = expense_sequences.next_seq + 1
    RETURNING next_seq - 1 AS next_seq
  `.execute(db);
  return `${year}E${result.rows[0].next_seq}`;
}

export interface ExpenseInput {
  date: Date;
  description: string;
  type: string;
  amount: number;
  currency?: string;
  link?: string;
  order_number?: string;
}

const SORT_COLS: Record<string, string> = {
  date:        'e.date',
  description: 'e.description',
  type:        'e.type',
  amount:      'e.amount',
  created_at:  'e.created_at',
};

export async function listExpenses(
  userId: string,
  pagination: PaginationParams,
  filters: { search?: string; types?: string[] },
  sortBy?: string,
  sortDir?: 'asc' | 'desc'
) {
  const base = () => db
    .selectFrom('expenses as e')
    .where('e.user_id', '=', userId)
    .$if(!!filters.search, (qb) => qb.where('e.description', 'ilike', `%${filters.search}%`))
    .$if(filters.types !== undefined, (qb) =>
      filters.types!.length === 0
        ? qb.where(db.dynamic.lit(false) as any)
        : qb.where('e.type', 'in', filters.types! as any)
    );

  const total = Number(
    (await base().select((eb) => eb.fn.count<number>('e.id').as('count')).executeTakeFirst())?.count ?? 0
  );

  const data = await base()
    .selectAll('e')
    .orderBy(SORT_COLS[sortBy ?? ''] ?? 'e.date', sortDir ?? 'desc')
    .limit(pagination.limit)
    .offset(getPaginationOffset(pagination.page, pagination.limit))
    .execute();

  return buildPaginatedResult(data, total, pagination.page, pagination.limit);
}

export async function getFilterOptions(userId: string) {
  const [types, years] = await Promise.all([
    db.selectFrom('expenses as e').select('e.type').distinct()
      .where('e.user_id', '=', userId).orderBy('e.type').execute(),
    db.selectFrom('expense_sequences').select('year')
      .where('user_id', '=', userId).orderBy('year', 'desc').execute(),
  ]);
  return { types: types.map((r) => r.type), years: years.map((r) => r.year) };
}

export async function createExpense(userId: string, input: ExpenseInput) {
  const year = input.date.getFullYear();
  const expenseId = await nextExpenseId(userId, year);
  return db
    .insertInto('expenses')
    .values({
      user_id:      userId,
      expense_id:   expenseId,
      date:         input.date,
      description:  input.description,
      type:         input.type,
      amount:       input.amount,
      currency:     input.currency ?? 'USD',
      link:         input.link ?? null,
      order_number: input.order_number ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function updateExpense(userId: string, id: string, input: Partial<ExpenseInput>) {
  const existing = await db.selectFrom('expenses').select('id').where('id', '=', id).where('user_id', '=', userId).executeTakeFirst();
  if (!existing) throw new AppError(404, 'Expense not found');

  return db
    .updateTable('expenses')
    .set({
      ...(input.date        !== undefined && { date: input.date }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.type        !== undefined && { type: input.type }),
      ...(input.amount      !== undefined && { amount: input.amount }),
      ...(input.currency    !== undefined && { currency: input.currency }),
      ...(input.link        !== undefined && { link: input.link }),
      ...(input.order_number !== undefined && { order_number: input.order_number }),
      updated_at: new Date(),
    })
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function deleteExpense(userId: string, id: string) {
  const existing = await db.selectFrom('expenses').select('id').where('id', '=', id).where('user_id', '=', userId).executeTakeFirst();
  if (!existing) throw new AppError(404, 'Expense not found');
  await db.deleteFrom('expenses').where('id', '=', id).where('user_id', '=', userId).execute();
}

// ── Export ────────────────────────────────────────────────────────────────────

interface ExportFilters {
  from?: Date;
  to?: Date;
  types?: string[];
}

async function fetchForExport(userId: string, filters: ExportFilters) {
  return db
    .selectFrom('expenses as e')
    .selectAll('e')
    .where('e.user_id', '=', userId)
    .$if(!!filters.from, (qb) => qb.where('e.date', '>=', filters.from! as any))
    .$if(!!filters.to,   (qb) => qb.where('e.date', '<=', filters.to! as any))
    .$if(filters.types !== undefined && filters.types.length > 0, (qb) =>
      qb.where('e.type', 'in', filters.types! as any)
    )
    .orderBy('e.date', 'asc')
    .orderBy('e.expense_id', 'asc')
    .execute();
}

function fmtAmount(cents: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

function fmtDate(d: Date | string) {
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export async function exportCSV(userId: string, filters: ExportFilters): Promise<string> {
  const rows = await fetchForExport(userId, filters);
  const headers = ['ID', 'Date', 'Type', 'Description', 'Amount', 'Currency', 'Order #', 'Link'];
  const lines = [
    headers.join(','),
    ...rows.map((r) => [
      r.expense_id ?? '',
      fmtDate(r.date),
      r.type,
      `"${(r.description ?? '').replace(/"/g, '""')}"`,
      (r.amount / 100).toFixed(2),
      r.currency,
      r.order_number ?? '',
      r.link ?? '',
    ].join(',')),
  ];
  return lines.join('\r\n');
}

export async function exportPDF(userId: string, filters: ExportFilters): Promise<Buffer> {
  const rows = await fetchForExport(userId, filters);
  const total = rows.reduce((s, r) => s + r.amount, 0);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'LETTER' });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.fontSize(18).font('Helvetica-Bold').text('Expense Report', { align: 'left' });
    doc.fontSize(10).font('Helvetica').fillColor('#666666');
    const rangeLabel = filters.from || filters.to
      ? `${filters.from ? fmtDate(filters.from) : '—'}  to  ${filters.to ? fmtDate(filters.to) : '—'}`
      : 'All dates';
    doc.text(rangeLabel);
    if (filters.types?.length) doc.text(`Types: ${filters.types.join(', ')}`);
    doc.text(`Generated: ${fmtDate(new Date())}`);
    doc.moveDown(0.5);

    // Column layout
    const cols = { id: 40, date: 110, type: 200, description: 295, amount: 490 };
    const rowH = 18;

    // Table header
    doc.rect(40, doc.y, 535, rowH).fill('#1a1a2e');
    const headerY = doc.y + 4;
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff');
    doc.text('ID',          cols.id,          headerY, { width: 65,  lineBreak: false });
    doc.text('Date',        cols.date,         headerY, { width: 85,  lineBreak: false });
    doc.text('Type',        cols.type,         headerY, { width: 90,  lineBreak: false });
    doc.text('Description', cols.description,  headerY, { width: 190, lineBreak: false });
    doc.text('Amount',      cols.amount,        headerY, { width: 80,  align: 'right', lineBreak: false });
    doc.y += rowH;

    // Rows
    doc.font('Helvetica').fontSize(8);
    rows.forEach((r, i) => {
      const y = doc.y;
      if (i % 2 === 0) doc.rect(40, y, 535, rowH).fill('#f8f8f8');
      doc.fillColor('#111111');
      doc.text(r.expense_id ?? '—', cols.id,         y + 4, { width: 65,  lineBreak: false });
      doc.text(fmtDate(r.date),     cols.date,        y + 4, { width: 85,  lineBreak: false });
      doc.text(r.type,              cols.type,        y + 4, { width: 90,  lineBreak: false });
      doc.text(r.description,       cols.description, y + 4, { width: 190, lineBreak: false });
      doc.text(fmtAmount(r.amount, r.currency), cols.amount, y + 4, { width: 80, align: 'right', lineBreak: false });
      doc.y += rowH;
    });

    // Total row
    doc.moveTo(40, doc.y).lineTo(575, doc.y).stroke('#cccccc');
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#111111');
    doc.text(`Total: ${fmtAmount(total, 'USD')}`, cols.id, doc.y, { align: 'right', width: 535 });

    doc.end();
  });
}
