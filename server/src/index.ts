import 'dotenv/config';
import { app } from './app';
import { env } from './config/env';
import { db } from './config/database';

const PORT = env.PORT;

async function main() {
  try {
    // Verify DB connection
    await db.selectFrom('users').select('id').limit(1).execute().catch(() => {
      // Table may not exist yet — that's OK on first run before migrations
    });

    app.listen(PORT, () => {
      console.log(`[reactor] Server running on http://localhost:${PORT}`);
      console.log(`[reactor] Environment: ${env.NODE_ENV}`);
    });
  } catch (err) {
    console.error('[reactor] Failed to start server:', err);
    process.exit(1);
  }
}

main();
