import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { sql } from 'kysely';
import { env } from './env';
import { db } from './database';

export function configurePassport() {
  passport.use(
    new GoogleStrategy(
      {
        clientID: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        callbackURL: env.GOOGLE_CALLBACK_URL,
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          if (!email) return done(new Error('No email from Google profile'));

          // Allowlist check — if ALLOWED_EMAILS is set, reject unlisted emails
          if (env.ALLOWED_EMAILS) {
            const allowed = env.ALLOWED_EMAILS.split(',').map((e) => e.trim().toLowerCase());
            if (!allowed.includes(email.toLowerCase())) {
              return done(null, false, { message: 'This email is not on the beta access list.' });
            }
          }

          const googleSub = profile.id;
          const displayName = profile.displayName;
          const avatarUrl = profile.photos?.[0]?.value;

          // Upsert user on google_sub — or match by email if migrating
          const existing = await db
            .selectFrom('users')
            .selectAll()
            .where('google_sub', '=', googleSub)
            .executeTakeFirst();

          if (existing) {
            const updated = await db
              .updateTable('users')
              .set({
                display_name: displayName,
                avatar_url: avatarUrl,
              })
              .where('id', '=', existing.id)
              .returningAll()
              .executeTakeFirstOrThrow();
            return done(null, updated);
          }

          // Check if user already exists with this email (e.g. imported)
          const byEmail = await db
            .selectFrom('users')
            .selectAll()
            .where('email', '=', email)
            .executeTakeFirst();

          if (byEmail) {
            const updated = await db
              .updateTable('users')
              .set({ google_sub: googleSub, display_name: displayName, avatar_url: avatarUrl })
              .where('id', '=', byEmail.id)
              .returningAll()
              .executeTakeFirstOrThrow();
            return done(null, updated);
          }

          // New user
          const created = await db
            .insertInto('users')
            .values({
              email,
              google_sub: googleSub,
              display_name: displayName,
              avatar_url: avatarUrl,
              plan: 'free',
            })
            .returningAll()
            .executeTakeFirstOrThrow();

          // Auto-create a solo org for the new user
          const org = await db
            .insertInto('organizations')
            .values({ name: displayName || email })
            .returning('id')
            .executeTakeFirstOrThrow();

          await db
            .insertInto('org_members')
            .values({ org_id: org.id, user_id: created.id, role: 'owner' })
            .execute();

          // Seed card catalog from shared seed table
          await sql`
            INSERT INTO card_catalog (
              user_id, game, set_name, set_code, card_name, card_number,
              variant, rarity, language, image_url, image_url_hi,
              image_url_back, tcgplayer_id, external_id, sku,
              created_at, updated_at
            )
            SELECT
              ${created.id}, game, set_name, set_code, card_name, card_number,
              variant, rarity, language, image_url, image_url_hi,
              image_url_back, tcgplayer_id, external_id, sku,
              created_at, updated_at
            FROM card_catalog_seed
          `.execute(db);

          return done(null, created);
        } catch (err) {
          return done(err as Error);
        }
      }
    )
  );

  passport.serializeUser((user: any, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await db
        .selectFrom('users')
        .selectAll()
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      done(null, user ?? false);
    } catch (err) {
      done(err);
    }
  });
}
