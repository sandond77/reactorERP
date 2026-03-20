import type { Request, Response, NextFunction } from 'express';
import { getInventorySummary, listTCGdexSets, fetchSetCards, upsertCatalogCard } from '../services/catalog.service';

export async function inventorySummary(req: Request, res: Response, next: NextFunction) {
  try {
    const rows = await getInventorySummary(req.user!.id);
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

export async function listSets(req: Request, res: Response, next: NextFunction) {
  try {
    const lang = (req.query.lang as 'en' | 'ja') ?? 'en';
    const sets = await listTCGdexSets(lang);
    res.json({ data: sets });
  } catch (err) { next(err); }
}
