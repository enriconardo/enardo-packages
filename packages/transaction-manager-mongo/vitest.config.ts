import { mongoReplicaSet } from "@enardo/vitest-config";
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    // One in-memory replica set serves every test file; each test uses its own database.
    ...mongoReplicaSet(),
  },
  resolve: {
    alias: {
      "~": path.resolve(import.meta.dirname, "src"),
    },
  },
});
