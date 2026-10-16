import { playwright } from "@vitest/browser-playwright";
import { configDefaults, defineConfig } from "vitest/config";
import path from "path";

// The run-server of the playwright service, which runs the browsers. Set in
// the dev container by docker/docker-compose.yml; turbo passes it through.
const wsEndpoint = process.env.PLAYWRIGHT_WS_ENDPOINT;
if (!wsEndpoint) {
  throw new Error(
    "PLAYWRIGHT_WS_ENDPOINT is not set: the tests run in the dev container (./dev.sh exec).",
  );
}

export default defineConfig({
  resolve: {
    alias: {
      "~": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    projects: [
      { extends: true, test: { name: "node" } },
      {
        extends: true,
        test: {
          name: "browser",
          // A page cannot load what imports node:*: the tests that need Node
          // are in *.node.test.ts files, and run on Node only.
          exclude: [...configDefaults.exclude, "**/*.node.test.ts"],
          browser: {
            enabled: true,
            headless: true,
            // A library has no UI to show, and the screenshots would land in
            // __tests__/.
            screenshotFailures: false,
            provider: playwright({
              connectOptions: {
                wsEndpoint,
                // Vitest serves the test pages on this container's loopback:
                // the browsers, in the playwright service, load them through
                // the connection.
                exposeNetwork: "<loopback>",
              },
            }),
            instances: [
              { browser: "chromium" },
              { browser: "firefox" },
              { browser: "webkit" },
            ],
          },
        },
      },
    ],
  },
});
