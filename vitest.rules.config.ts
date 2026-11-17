import { defineConfig } from 'vitest/config';

// Security-rules tests: run through `npm run test:rules`, which starts the Firestore emulator.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/rules/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
