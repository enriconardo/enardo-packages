import { playwright } from "@vitest/browser-playwright";
import { configDefaults } from "vitest/config";

/**
 * The `browser` test project of a package whose `src/` runs in browsers: every
 * test file but `*.node.test.ts`, in Chromium, Firefox and WebKit, through the
 * `playwright` service of the dev container (`docker/README.md`).
 *
 * Call it in `projects`, next to the package's `node` project. It checks
 * `PLAYWRIGHT_WS_ENDPOINT` when called, so a package's config fails at load
 * outside the dev container.
 *
 * @returns {import("vitest/config").TestProjectConfiguration}
 */
export function browserProject() {
  // The run-server of the playwright service, which runs the browsers. Set in
  // the dev container by docker/docker-compose.yml; turbo passes it through.
  const wsEndpoint = process.env.PLAYWRIGHT_WS_ENDPOINT;
  if (!wsEndpoint) {
    throw new Error(
      "PLAYWRIGHT_WS_ENDPOINT is not set: the tests run in the dev container (./dev.sh exec).",
    );
  }

  return {
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
  };
}
