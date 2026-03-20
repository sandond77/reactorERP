import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
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
