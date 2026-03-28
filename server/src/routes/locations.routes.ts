import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import * as locationsService from '../services/locations.service';
import { z } from 'zod';

export const locationsRouter = Router();
locationsRouter.use(requireAuth);

const createSchema = z.object({
  name: z.string().min(1),
  card_type: z.enum(['graded', 'raw', 'both']).default('both'),
  is_card_show: z.boolean().default(false),
  is_container: z.boolean().default(false),
  notes: z.string().optional(),
  parent_id: z.string().uuid().optional().nullable(),
});

const updateSchema = createSchema.partial();

locationsRouter.get('/', async (req, res, next) => {
  try {
    const locations = await locationsService.listLocations(req.user!.id);
    res.json({ data: locations });
  } catch (err) { next(err); }
});

locationsRouter.post('/', async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body);
    const location = await locationsService.createLocation(req.user!.id, body);
    res.status(201).json({ data: location });
  } catch (err) { next(err); }
});

locationsRouter.patch('/:id', async (req, res, next) => {
  try {
    const body = updateSchema.parse(req.body);
    const location = await locationsService.updateLocation(req.user!.id, req.params.id, body);
    res.json({ data: location });
  } catch (err) { next(err); }
});

locationsRouter.delete('/:id', async (req, res, next) => {
  try {
    await locationsService.deleteLocation(req.user!.id, req.params.id);
    res.status(204).send();
  } catch (err) { next(err); }
});

locationsRouter.get('/:id/cards', async (req, res, next) => {
  try {
    const cards = await locationsService.getLocationCards(req.user!.id, req.params.id);
    res.json({ data: cards });
  } catch (err) { next(err); }
});

locationsRouter.post('/assign', async (req, res, next) => {
  try {
    const body = z.object({
      card_instance_id: z.string().uuid(),
      location_id: z.string().uuid().nullable(),
    }).parse(req.body);
    await locationsService.assignLocation(req.user!.id, body.card_instance_id, body.location_id);
    res.status(204).send();
  } catch (err) { next(err); }
});

locationsRouter.post('/assign-bulk', async (req, res, next) => {
  try {
    const body = z.object({
      card_instance_ids: z.array(z.string().uuid()).min(1),
      location_id: z.string().uuid().nullable(),
    }).parse(req.body);
    await locationsService.bulkAssignLocation(req.user!.id, body.card_instance_ids, body.location_id);
    res.status(204).send();
  } catch (err) { next(err); }
});
