import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    // One in-memory replica set serves every test file; each test uses its own database.
    globalSetup: ["__tests__/setup/replica-set.ts"],
    include: ["__tests__/**/*.test.ts"],
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      "~": path.resolve(import.meta.dirname, "src"),
    },
  },
});
