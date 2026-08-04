import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Run only tests colocated with source under src/. Keeps the surface area
    // focused; if a bigger integration folder ever shows up we'll broaden.
    include: ['src/**/*.test.ts'],
    // Don't touch the real database or Anthropic API by default. Tests that
    // want a live client can override this via process.env in their own file.
    environment: 'node',
  },
});
