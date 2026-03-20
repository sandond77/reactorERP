import { sql } from 'kysely';
import { db } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import type { ListingPlatform, NewListing } from '../types/db';
import { getPaginationOffset, buildPaginatedResult } from '../utils/pagination';
import type { PaginationParams } from '../utils/pagination';

export async function listListings(
  userId: string,
  filters: { platform?: ListingPlatform; status?: string },
  pagination: PaginationParams
) {
  const total = Number(
    (await db
      .selectFrom('listings as l')
      .select((eb) => eb.fn.count<number>('l.id').as('count'))
      .where('l.user_id', '=', userId)
      .$if(!!filters.platform, (qb) => qb.where('l.platform', '=', filters.platform!))
      .$if(!!filters.status, (qb) => qb.where('l.listing_status', '=', filters.status as any))
      .executeTakeFirst())?.count ?? 0
  );

  const data = await db
    .selectFrom('listings as l')
    .innerJoin('card_instances as ci', 'ci.id', 'l.card_instance_id')
    .leftJoin('card_catalog as cc', 'cc.id', 'ci.catalog_id')
    .leftJoin('slab_details as sd', 'sd.card_instance_id', 'ci.id')
    .select([
      'l.id',
      'l.platform',
      'l.listing_status',
      'l.list_price',
      'l.asking_price',
      'l.currency',
      'l.ebay_listing_id',
      'l.ebay_listing_url',
      'l.show_name',
      'l.show_date',
      'l.listed_at',
      'l.sold_at',
      'l.created_at',
      'ci.id as card_instance_id',
      'ci.status as card_status',
      sql<string>`COALESCE(cc.card_name, ci.card_name_override)`.as('card_name'),
      sql<string>`COALESCE(cc.set_name, ci.set_name_override)`.as('set_name'),
      'sd.grade',
      'sd.grade_label',
      'sd.company as grading_company',
      'sd.cert_number',
      'ci.image_front_url',
      'cc.image_url as catalog_image_url',
    ])
    .where('l.user_id', '=', userId)
    .$if(!!filters.platform, (qb) => qb.where('l.platform', '=', filters.platform!))
    .$if(!!filters.status, (qb) => qb.where('l.listing_status', '=', filters.status as any))
    .orderBy('l.created_at', 'desc')
    .limit(pagination.limit)
    .offset(getPaginationOffset(pagination.page, pagination.limit))
    .execute();

  return buildPaginatedResult(data, total, pagination.page, pagination.limit);
}

export type CreateListingInput = Omit<NewListing, 'user_id'>;

export async function createListing(userId: string, input: CreateListingInput) {
  const card = await db
    .selectFrom('card_instances')
    .select(['id', 'status'])
    .where('id', '=', input.card_instance_id)
    .where('user_id', '=', userId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();

  if (!card) throw new AppError(404, 'Card not found');

  const listing = await db
    .insertInto('listings')
    .values({ ...input, user_id: userId })
    .returningAll()
    .executeTakeFirstOrThrow();

  if (['graded', 'inspected', 'purchased_raw'].includes(card.status)) {
    await db
      .updateTable('card_instances')
      .set({ status: 'raw_for_sale' })
      .where('id', '=', input.card_instance_id)
      .execute();
  }

  return listing;
}

export async function updateListing(
  userId: string,
  listingId: string,
  data: Partial<NewListing>
) {
  const listing = await db
    .selectFrom('listings')
    .select('id')
    .where('id', '=', listingId)
    .where('user_id', '=', userId)
    .executeTakeFirst();

  if (!listing) throw new AppError(404, 'Listing not found');

  return db
    .updateTable('listings')
    .set(data as any)
    .where('id', '=', listingId)
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function cancelListing(userId: string, listingId: string) {
  const listing = await db
    .selectFrom('listings')
    .select('id')
    .where('id', '=', listingId)
    .where('user_id', '=', userId)
    .executeTakeFirst();

  if (!listing) throw new AppError(404, 'Listing not found');

  await db
    .updateTable('listings')
    .set({ listing_status: 'cancelled' })
    .where('id', '=', listingId)
    .execute();
}
