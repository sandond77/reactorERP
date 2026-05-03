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

    const server = app.listen(PORT, () => {
      console.log(`[reactor] Server running on http://localhost:${PORT}`);
      console.log(`[reactor] Environment: ${env.NODE_ENV}`);
    });

    // Graceful shutdown — Railway sends SIGTERM on every deploy to stop the old
    // container. Without this, Node exits via signal and npm reports "lifecycle
    // script failed", which Railway flags as a deploy failure.
    const shutdown = (signal: string) => {
      console.log(`[reactor] ${signal} received, shutting down`);
      server.close(() => process.exit(0));
      // Hard timeout so a stuck connection can't block the deploy rollover
      setTimeout(() => process.exit(0), 10_000).unref();
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (err) {
    console.error('[reactor] Failed to start server:', err);
    process.exit(1);
  }
}

main();
