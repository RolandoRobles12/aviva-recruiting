import { defineConfig } from 'vitest/config';

// Tests live in /tests so neither tsconfig.app.json ("src") nor
// functions/tsconfig.json ("src") picks them up in a production build.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
