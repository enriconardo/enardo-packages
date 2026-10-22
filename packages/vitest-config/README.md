# @enardo/vitest-config

The vitest presets of the `@enardo/*` packages, and the projects built on them. Today one: the `browser` test project, for a package whose `src/` runs in browsers and on Node. The package ships `index.js` as it is and carries `@vitest/browser-playwright` and `playwright`, so a package adds one devDependency and no browser tooling of its own.

## Presets

| Preset | For | Runs |
| --- | --- | --- |
| `browserProject()` | packages whose `src/` runs in browsers | every test file but `*.node.test.ts`, in Chromium, Firefox and WebKit, headless, with no screenshots of failures |

It returns a project to put in `test.projects`, next to the package's own `node` project, which keeps running every file. It extends the root config (`extends: true`), so the `~` alias and the other options apply to both.

## Usage

```ts
// vitest.config.ts
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
```

Install it from the `@enardo` registry (`https://npm.enriconardo.com`, which needs a token to read), with `vitest`, its peer. `@vitest/browser-playwright`, which the preset carries, peers exactly its own `vitest` version: keep one `vitest` in the install.

```sh
pnpm add -D @enardo/vitest-config vitest
```

## Tests that need Node

A page cannot load what imports `node:*`. A test that needs Node (a local server, `node:vm`, `util.inspect`) goes in a `*.node.test.ts` file beside its `*.test.ts`: the `node` project runs it, the `browser` project skips it. Helpers both kinds of test share import nothing from `node:*`.

## The browsers

The browsers run in the `playwright` service of the dev container's compose stack (`docker/README.md`), not on the machine running the tests. `browserProject()` reads the service's run-server from `PLAYWRIGHT_WS_ENDPOINT`, which the compose file sets in the dev container, and throws when it is called without it: a package's `vitest.config.ts` fails at load outside that container. The test pages are served on the loopback of the test process and reached through the connection (`exposeNetwork`).

The `playwright` version must be the one of the browsers' image: `docker/playwright/check-version.sh` compares them.
