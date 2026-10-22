import { browserProject } from "@enardo/vitest-config";
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "~": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    projects: [{ extends: true, test: { name: "node" } }, browserProject()],
  },
});
