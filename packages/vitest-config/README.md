# @enardo/vitest-config

The vitest presets of the `@enardo/*` packages, and the projects built on them. Two: the `browser` test project, for a package whose `src/` runs in browsers and on Node, and the in-memory Mongo replica set of the adapters' tests. The package ships `index.js` and `replica-set.js` as they are and carries `@vitest/browser-playwright` and `playwright`, so a package adds one devDependency and no browser tooling of its own. Both presets share the package: a package that calls only `mongoReplicaSet()` installs the browser tooling too, and loads it with `index.js`.

## Presets

| Preset | For | Runs |
| --- | --- | --- |
| `browserProject()` | packages whose `src/` runs in browsers | every test file but `*.node.test.ts`, in Chromium, Firefox and WebKit, one file at a time in each browser, headless, with no screenshots of failures |
| `mongoReplicaSet()` | packages whose tests need MongoDB transactions | one in-memory single-node replica set for the whole run, started by a global setup |

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

## The Mongo replica set

`mongoReplicaSet()` returns `{ globalSetup }`: spread it into `test`. The global setup starts one replica set with `mongodb-memory-server` before the first test file and stops it after the last, and provides its URI as `mongoUri`. Each test then creates a database of its own. The first run downloads a `mongod` binary.

```ts
// vitest.config.ts
import { mongoReplicaSet } from "@enardo/vitest-config";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { ...mongoReplicaSet() },
});
```

The preset is JavaScript, so the type of the key is the package's to declare, in a file its typecheck includes:

```ts
// __tests__/support/fixtures.ts
import { inject } from "vitest";

declare module "vitest" {
  export interface ProvidedContext {
    mongoUri: string;
  }
}

const uri = inject("mongoUri");
```

`mongodb-memory-server` is an optional peer: a package that calls `mongoReplicaSet()` installs it itself (`pnpm add -D mongodb-memory-server`), and one that calls only `browserProject()` does not.

## Tests that need Node

A page cannot load what imports `node:*`. A test that needs Node (a local server, `node:vm`, `util.inspect`) goes in a `*.node.test.ts` file beside its `*.test.ts`: the `node` project runs it, the `browser` project skips it. Helpers both kinds of test share import nothing from `node:*`.

## The browsers

The browsers run in the `playwright` service of the dev container's compose stack (`docker/README.md`), not on the machine running the tests. `browserProject()` reads the service's run-server from `PLAYWRIGHT_WS_ENDPOINT`, which the compose file sets in the dev container, and throws when it is called without it: a package's `vitest.config.ts` fails at load outside that container. The test pages are served on the loopback of the test process and reached through the connection (`exposeNetwork`).

The `playwright` version must be the one of the browsers' image: `docker/playwright/check-version.sh` compares them.
