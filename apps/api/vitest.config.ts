import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // first run downloads a mongod binary for the in-memory replica set
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
