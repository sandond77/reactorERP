import type { Request, Response, NextFunction } from 'express';
import { db } from '../config/database';
import { getInventorySummary, listTCGdexSets, fetchSetCards, upsertCatalogCard, updateCatalogCard, deleteCatalogCard, createCatalogCard, getEmptyCatalogEntries, searchCatalog } from '../services/catalog.service';

export async function inventorySummary(req: Request, res: Response, next: NextFunction) {
  try {
    const rows = await getInventorySummary(req.dataUserId);
    res.json({ data: rows });
  } catch (err) { next(err); }
}

// Trigger a sync for a single set on demand (used from UI if needed)
export async function syncSet(req: Request, res: Response, next: NextFunction) {
  try {
    const { set_id, lang = 'en' } = req.body as { set_id: string; lang?: 'en' | 'ja' };
    if (!set_id) return res.status(400).json({ error: 'set_id required' });

    const language = lang === 'ja' ? 'JP' : 'EN';
    const cards = await fetchSetCards(set_id, lang);
    let count = 0;
    for (const card of cards) {
      await upsertCatalogCard({
        externalId: card.id,
        setCode: set_id,
        setName: set_id,
        cardNumber: (card as any).localId ?? '',
        cardName: card.name,
        language,
      });
      count++;
    }
    res.json({ synced: count });
  } catch (err) { next(err); }
}

export async function createCard(req: Request, res: Response, next: NextFunction) {
  try {
    const { game, sku, card_name, set_name, set_code, card_number, language, rarity, variant } = req.body;
    if (!card_name || !set_name || !language) {
      return res.status(400).json({ error: 'card_name, set_name, and language are required' });
    }
    const id = await createCatalogCard({ game: game ?? 'pokemon', sku, card_name, set_name, set_code, card_number, language, rarity, variant });
    res.status(201).json({ id });
  } catch (err: any) {
    if (err?.code === '23505') return res.status(409).json({ error: 'A catalog entry with this SKU already exists.' });
    next(err);
  }
}

export async function emptyCatalog(req: Request, res: Response, next: NextFunction) {
  try {
    const rows = await getEmptyCatalogEntries(req.dataUserId);
    res.json({ data: rows });
  } catch (err) { next(err); }
}

export async function updateCard(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const { game, sku, card_name, set_name, set_code, card_number, rarity, variant, language } = req.body;
    await updateCatalogCard(id, { game, sku, card_name, set_name, set_code, card_number, rarity, variant, language });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

export async function deleteCard(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    await deleteCatalogCard(id);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

export async function search(req: Request, res: Response, next: NextFunction) {
  try {
    const { q, card_name, set_name, card_number, language, limit } = req.query as Record<string, string | undefined>;
    const results = await searchCatalog({ q, card_name, set_name, card_number, language, limit: limit ? parseInt(limit, 10) : undefined });
    res.json({ data: results });
  } catch (err) { next(err); }
}

export async function listSets(req: Request, res: Response, next: NextFunction) {
  try {
    const lang = (req.query.lang as 'en' | 'ja') ?? 'en';
    const sets = await listTCGdexSets(lang);
    res.json({ data: sets });
  } catch (err) { next(err); }
}

export async function namesBySku(req: Request, res: Response, next: NextFunction) {
  try {
    const { sku } = req.query as { sku?: string };
    if (!sku) return res.status(400).json({ error: 'sku required' });
    const rows = await db
      .selectFrom('card_catalog')
      .select(['id', 'card_name'])
      .where('sku', '=', sku)
      .orderBy('card_name', 'asc')
      .execute();
    res.json(rows);
  } catch (err) { next(err); }
}
