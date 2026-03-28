import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import * as tradesService from '../services/trades.service';
import { z } from 'zod';
import { toCents } from '../utils/cents';

export const tradesRouter = Router();
tradesRouter.use(requireAuth);

const outgoingSchema = z.object({
  card_instance_id: z.string().uuid(),
  listing_id: z.string().uuid().optional(),
  sale_price: z.union([z.string(), z.number()]).transform((v) => toCents(v)),
  currency: z.string().default('USD'),
});

const incomingSchema = z.object({
  card_name_override: z.string(),
  set_name_override: z.string().optional(),
  card_number_override: z.string().optional(),
  rarity: z.string().optional(),
  language: z.string().default('EN'),
  condition: z.string().optional(),
  decision: z.enum(['sell_raw', 'grade']).default('sell_raw'),
  market_value: z.union([z.string(), z.number()]).optional().transform((v) => (v != null ? toCents(v) : undefined)),
  purchase_cost: z.union([z.string(), z.number()]).transform((v) => toCents(v)),
  currency: z.string().default('USD'),
  catalog_id: z.string().uuid().optional(),
  slab_company: z.string().optional(),
  slab_grade_label: z.string().optional(),
  slab_cert_number: z.string().optional(),
  slab_grade: z.coerce.number().optional(),
});

const createTradeSchema = z.object({
  outgoing: z.array(outgoingSchema).min(1),
  incoming: z.array(incomingSchema).min(1),
  trade_date: z.string().optional(),
  person: z.string().optional(),
  cash_from_customer: z.union([z.string(), z.number()]).optional().transform((v) => (v != null ? toCents(v) : 0)),
  cash_to_customer: z.union([z.string(), z.number()]).optional().transform((v) => (v != null ? toCents(v) : 0)),
  trade_percent: z.coerce.number().default(80),
  notes: z.string().optional(),
});

const listQuerySchema = z.object({
  page: z.coerce.number().default(1),
  limit: z.coerce.number().min(1).max(100).default(25),
});

tradesRouter.post('/', async (req, res, next) => {
  try {
    const body = createTradeSchema.parse(req.body);
    const trade = await tradesService.createTrade(req.user!.id, {
      outgoing: body.outgoing.map((o) => ({
        card_instance_id: o.card_instance_id,
        listing_id: o.listing_id,
        sale_price: o.sale_price,
        currency: o.currency,
      })),
      incoming: body.incoming.map((i) => ({
        card_name_override: i.card_name_override,
        set_name_override: i.set_name_override,
        card_number_override: i.card_number_override,
        rarity: i.rarity,
        language: i.language,
        condition: i.condition,
        decision: i.decision,
        market_value_cents: i.market_value,
        purchase_cost_cents: i.purchase_cost,
        currency: i.currency,
        catalog_id: i.catalog_id,
        slab_company: i.slab_company,
        slab_grade_label: i.slab_grade_label,
        slab_cert_number: i.slab_cert_number,
        slab_grade: i.slab_grade,
      })),
      trade_date: body.trade_date,
      person: body.person,
      cash_from_customer_cents: body.cash_from_customer,
      cash_to_customer_cents: body.cash_to_customer,
      trade_percent: body.trade_percent,
      notes: body.notes,
    });
    res.status(201).json({ data: trade });
  } catch (err) {
    next(err);
  }
});

tradesRouter.get('/', async (req, res, next) => {
  try {
    const { page, limit } = listQuerySchema.parse(req.query);
    const result = await tradesService.listTrades(req.user!.id, { page, limit });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

const updateTradeSchema = z.object({
  trade_date: z.string().optional(),
  person: z.string().optional(),
  notes: z.string().optional(),
  trade_percent: z.coerce.number().optional(),
});

tradesRouter.patch('/:id', async (req, res, next) => {
  try {
    const body = updateTradeSchema.parse(req.body);
    const trade = await tradesService.updateTrade(req.user!.id, req.params.id, body);
    res.json({ data: trade });
  } catch (err) {
    next(err);
  }
});

tradesRouter.delete('/:id', async (req, res, next) => {
  try {
    await tradesService.deleteTrade(req.user!.id, req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
