---
status: done
type: chore
packages: ["@enardo/http-client", repo]
branch: chore/repo/browser-tests
---

# Run the tests of `@enardo/http-client` in browsers

## Why

The first item of the backlog, queued by the user at checkpoint 2 of `feature/http-client/timeouts-and-abort` (2026-10-07): run the tests of `@enardo/http-client` in Chromium, Firefox and WebKit, as part of `pnpm verify`. `src/` runs in browsers, and nothing runs it in one. The package's `CLAUDE.md` guards the browser side with typechecks and lint only, and the specs of `fix/http-client/redact-cause` and `feature/http-client/timeouts-and-abort` left their browser behavior unprobed.

This is not an end-to-end suite. The package's existing tests run in real browsers through Vitest's browser mode. Playwright is only the driver that Vitest uses to launch and control the browsers: there is no `@playwright/test`, and no page of `@cambusa/web` (decision 1).

Probes ran on `master` (`31a614f`) in throwaway containers, as the root `CLAUDE.md` describes:
- the code: a copy of the package's `src/` and `__tests__/`, with the `dist/` of `@enardo/errors` and `@enardo/http-status` rebuilt by `turbo run build --filter=@enardo/http-client... --force`;
- the tools: `vitest@4.1.11`, `@vitest/browser-playwright@4.1.11` and `playwright@1.63.0`, installed with npm in the `en-probe` volume;
- the browsers: a container of `mcr.microsoft.com/playwright:v1.63.0-noble` on a throwaway network.

## Today

- `pnpm test` in the package runs `vitest run`, on Node only: 322 tests in 6 files.
- The dev container has Node, pnpm and shellcheck, and no Docker socket: `pnpm verify` cannot start a container of its own.
- `turbo.json` declares no environment variable for any task.

## What the probes showed

### The tooling

- **Versions.** `playwright` 1.63.0 is the latest release, published on 2026-09-04 (npm registry, 2026-10-07). `@vitest/browser-playwright` 4.1.11 has the peer dependencies `vitest: 4.1.11`, the version in the lockfile, and `playwright: *`. None of the packages that the provider and `playwright` install has an install script (searched in the volume's `node_modules`).
- **The image** has:
  - the browsers in `/ms-playwright`: Chromium 153.0.8010.12, Firefox 155.0 and WebKit 26.6, as `browser.version()` reports them;
  - Node 24.20 and a `pwuser` user.

  It has no `playwright` package: Playwright's documented recipe runs `npx -y playwright@<version> run-server` at every start. A derived image, which installs `playwright@1.63.0` globally at build time, starts `playwright run-server --port 3000 --host 0.0.0.0` as `pwuser`. The three browsers launch through it.
- **The versions must match.** A 1.62.1 client fails at once against the 1.63.0 server: `428 Precondition Required`, with a banner that starts "Playwright version mismatch: server version: v1.63". A 1.63.0 client connects.
- **Vitest's provider connects to a remote server**: `playwright({ connectOptions: { wsEndpoint, ...ConnectOptions } })` calls `playwright[browser].connect(wsEndpoint, …)` (`@vitest/browser-playwright/dist/index.js`).
- **The browsers reach Vitest's server through `exposeNetwork: "<loopback>"`.**
  - Vitest serves the test pages on `localhost:63315` of the container it runs in.
  - With the option, the remote browsers open them through Playwright's connection.
  - Without it, the run fails with `page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:63315/…`.
- **An unknown host** (`ws://no-such-service:3000/`) fails with `getaddrinfo ENOTFOUND` after about 4 s.
- **turbo 2.10.12 keeps undeclared variables out of a task's environment.**
  - A script that prints `PLAYWRIGHT_WS_ENDPOINT` prints it unset under `{"test": {}}`.
  - With `"passThroughEnv": ["PLAYWRIGHT_WS_ENDPOINT"]`, it prints the value.
  - Neither Playwright nor Vitest reads a variable of that name (searched).
- **compose `depends_on`.** The setup: service `a` with `depends_on: [b]`, and `b` built from a Dockerfile. `docker compose up -d --build a`:
  - builds and starts `b`;
  - after an edit of `b`'s Dockerfile, rebuilds and recreates `b`, and keeps `a` running, with the same container id.

  `stop` and `rm` of `a` leave `b` running.
- **Duration.** The browser project ran the whole suite in 17.5 to 22.9 s, the three browsers together. The Node project took 3.0 s. The server container used 160 to 400 MiB.
- **Failure screenshots.** Vitest writes one per failing test to `__tests__/__screenshots__/`, even headless.
- **Two runs at once**, as when turbo runs the `test` tasks of two packages (**added at checkpoint 1**). Two copies of the package ran the browser project in one container, at the same time, against one server.
  - The second Vitest took port 63316, since the first held 63315.
  - Each run gave 95 failures, all expected: the 128 of the first run, less the 33 (11 tests in 3 browsers) that the neutral `errorsReachingProcess` fixes. None came from the concurrency.
  - Each run took about 39 s, against about 20 s alone. The server used 349 MiB after them.

### The tests in the browsers

Each browser ran the 322 tests. Every `node:*` import was mapped to a stub that throws `NODE_ONLY`, so each failure shows what it needs:

| Tests | Chromium | Firefox | WebKit | Why |
| --- | --- | --- | --- | --- |
| 271 | pass | pass | pass | |
| 11 | fail | fail | fail | `process`, in the helper `errorsReachingProcess` |
| 17 | fail | fail | fail | `util.inspect` (16), `node:vm` (1) |
| 1 | fail | fail | fail | `getEventListeners` of `node:events` |
| 5 | fail | fail | fail | Node's `fetch` and local `node:http` servers |
| 6 | skipped | skipped | skipped | the same, after a `beforeAll` that fails |
| 5 | fail | fail | fail | `code: "ERR_INVALID_URL"`, a field that only Node sets on the `TypeError` of `new URL()` |
| 2 | fail | pass | fail | undici's message `invalid header name`; Chromium's says `Failed to execute 'append' on 'Headers': Invalid name` |
| 3 | pass | fail | fail | a `stack` whose first line is `Name: message`, which is V8's format: a Firefox or WebKit stack starts with its first frame |
| 1 | pass | fail | pass | timing, below |

**The timing failure:** `should log the reduced URL and no marker of a request 'answered 404 with throwOnError'`.
- **The test.** It fires the request, moves the fake clock to 100 ms, and reads the logs without awaiting the request.
- **Firefox.** It reads a `Response` body later than the other runtimes do. The read settles neither within 20 microtasks nor after one real `setTimeout(0)`. Node, Chromium and WebKit settle it within microtasks, so on them the request has logged by then.
- **The client.** It is right in Firefox. With real timers, the same request rejects with an `HttpResponseError` whose `body` is `"body-secret"`, and logs once, at `warn`.

**`errorsReachingProcess`, made runtime-neutral (section 5):**
- **In the browsers.** It listens on the page. The 11 tests that use it then pass in all three browsers, and no other test changes outcome. The helper collects an unhandled rejection and a throw in an `abort` listener in each browser, under real and under fake timers, and collects nothing when nothing leaks.
- **On Node.** It waits with the global `setImmediate`, captured when the module loads, in place of `node:timers/promises`. The 236 tests of `http-client.test.ts` pass, and the helper still collects an unhandled rejection under fake timers.

## Changes

### 1. The browsers: a `playwright` service

`docker/playwright/Dockerfile`, with a comment on each choice (one version for the image and the server; the catalog's rule):

```dockerfile
ARG PLAYWRIGHT_VERSION=1.63.0
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble
ARG PLAYWRIGHT_VERSION
RUN npm install --global --no-audit --no-fund "playwright@${PLAYWRIGHT_VERSION}"
USER pwuser
WORKDIR /home/pwuser
CMD ["playwright", "run-server", "--port", "3000", "--host", "0.0.0.0"]
```

`docker/docker-compose.yml`:
- **A `playwright` service** built from it:
  - `init: true`, because the browsers start child processes, and Playwright's docs run the image with `--init`;
  - no `ports`, so only the compose network reaches it;
  - no volumes: nothing is mounted into it.
- **The `dev` service** gets:
  - `depends_on: [playwright]`, so that every `./dev.sh up` builds and starts the service;
  - `PLAYWRIGHT_WS_ENDPOINT: ws://playwright:3000/` in its environment.

`dev.sh`: only the usage text of `up` changes. The other commands already treat `playwright` as a service:
- `down dev` leaves it running, and `down` stops it;
- `down cambusa` leaves it alone, since it has no profile;
- `logs playwright` and `shell playwright` work.

The dev image does not change: it stays Node, pnpm and shellcheck.

Applying the change recreates the dev container, because its environment changes (not probed). That stops whatever runs in it, so I ask before running `./dev.sh up -d`.

### 2. Dependencies

- In the catalog of `pnpm-workspace.yaml`:
  - `'@vitest/browser-playwright': ^4.1.11`, beside `vitest`;
  - `playwright: 1.63.0`, exact, with a comment that it must be the version in `docker/playwright/Dockerfile`.
- In `@enardo/http-client`'s `devDependencies`: both, as `catalog:`.
- `pnpm install` in the dev container. Not probed with pnpm, only with npm: the release-age and build-script settings of pnpm 11 apply at that step.

### 3. Vitest: two projects

`packages/http-client/vitest.config.ts`:

```ts
const wsEndpoint = process.env.PLAYWRIGHT_WS_ENDPOINT;
if (!wsEndpoint) {
  throw new Error("PLAYWRIGHT_WS_ENDPOINT is not set: the tests run in the dev container (./dev.sh exec).");
}

export default defineConfig({
  resolve: { alias: { "~": path.resolve(import.meta.dirname, "src") } },
  test: {
    projects: [
      { extends: true, test: { name: "node" } },
      {
        extends: true,
        test: {
          name: "browser",
          exclude: [...configDefaults.exclude, "**/*.node.test.ts"],
          browser: {
            enabled: true,
            headless: true,
            screenshotFailures: false,
            provider: playwright({
              connectOptions: { wsEndpoint, exposeNetwork: "<loopback>" },
            }),
            instances: [{ browser: "chromium" }, { browser: "firefox" }, { browser: "webkit" }],
          },
        },
      },
    ],
  },
});
```

- **Comments in the file** give each choice its reason:
  - who sets the endpoint;
  - why `exposeNetwork`: the browsers load the pages from this container's loopback;
  - why no screenshots: a library has no UI to show, and the screenshots would land in `__tests__/`.
- **Runs.** `pnpm test` (`vitest run`) runs both projects, and `vitest run --project node` runs Node alone. The package's scripts do not change.

### 4. turbo

`turbo.json`: the `test` task gets `"passThroughEnv": ["PLAYWRIGHT_WS_ENDPOINT"]`.
- **Pass-through, not `env`.** The endpoint does not change a result, so it stays out of the cache key.
- **The scope of `pnpm verify`.** Whether a change to `turbo.json` makes `--filter=...[master]` select every package is not probed. At worst, `pnpm verify` checks every package on this branch.

### 5. The tests, by runtime

A page cannot load a module that imports `node:*`. So the tests that need Node move to a file of their own: `<name>.node.test.ts`, beside `<name>.test.ts`, as `*.mongo.test.ts` names the tests that need Mongo. The Node project runs every file. The browser project runs every file but those.

**Moved, unchanged.** Each is a whole `it` or `it.each` block. It moves with its describe path, and with the hooks and describe-scoped declarations it uses, so its full name and its body stay the same.

From `__tests__/http-client.test.ts` to `__tests__/http-client.node.test.ts`, 31 tests:

| Describe (under `HttpClient`) | Block | Tests | Needs |
| --- | --- | --- | --- |
| constructor | `should throw the TypeError of new URL() for the baseUrl %j, which is not an absolute URL` | 3 | Node's `code` |
| constructor | `should throw a TypeError holding no part of a baseUrl with credentials: $shape` | 4 | `util.inspect` |
| constructor | `should throw a TypeError holding no part of the baseUrl %j, which has a query string or a fragment` | 2 | `util.inspect` |
| constructor | `should throw the TypeError of the first check that fails, holding no part of the URL: $shape` | 2 | `util.inspect` |
| request() building the request | `should reject an invalid URL with the TypeError of new URL(), with no call and no log` | 1 | Node's `code` |
| request() building the request | `should reject an invalid header name with a TypeError, with no call and no log` | 1 | undici's message |
| request() building the request › a URL with credentials | `should reject $url with a TypeError holding no part of the URL, with no call and no log` | 4 | `util.inspect` |
| request() with no response › with Node's fetch and local servers | the whole describe | 4 | Node's `fetch`, `node:http`, `node:net` |
| the caller's signal | `should leave no listener on the caller's signal, nor on init.signal, after each of five requests, settled in turn` | 1 | `getEventListeners` |
| the caller's signal › already aborted, behind a caller's error | `should reject an invalid URL with the TypeError of new URL(), with no call and no log` | 1 | Node's `code` |
| the caller's signal › already aborted, behind a caller's error | `should reject an invalid header name with a TypeError, with no call and no log` | 1 | undici's message |
| timeouts and aborts with Node's fetch and local servers | the whole describe | 5 | Node's `fetch`, `node:http` |
| stream bodies › with Node's fetch | the whole describe | 2 | Node's `fetch`, `node:http` |

From `__tests__/errors/network-error.test.ts` to `__tests__/errors/network-error.node.test.ts`, 6 tests:
- `is named "NetworkError", and its stack starts with the method and the reduced URL`: V8's stack;
- `lets no marker of a $shape rejection reach the JSON of the error, nor the JSON or util.inspect of an error wrapping it`: 4 tests, `util.inspect`;
- `gives an undefined cause for an Error from another realm`: `node:vm`.

From `__tests__/errors/http-response-error.test.ts` and `__tests__/errors/timeout-error.test.ts`, each to its `.node.test.ts`: the test of the stack, one in each file.

**After the moves**, the Node project runs the same 322 tests, with the same full names, in 10 files. The browser project runs 283 in each browser.

**Helpers.**
- **Shared by both `HttpClient` files:** they move to `__tests__/support/http-client.ts`. It imports nothing from `node:*`, since a page loads it.
- **Used by the Node file only:** the servers, `trackUntilSettled`, `expectNoMarkerInspected` and `DEADLINE` move with it.
- **In `errors/`:** each `.node.test.ts` file repeats the constants and builders it uses (`MARKED_URL`, `REDUCED_URL`, `firstLineOf`, `buildError`), as the sibling files already repeat them.
  - **Except `network-error`** (**amended during implementation**). Its two files share the 80-line table `SHAPES` and the builders `buildError` and `buildErrorWithoutThrowing`, so these move to `__tests__/support/network-error.ts`, with the `MARKED_URL` that `buildError` uses.
  - **Exported helpers get explicit types.** `isolatedDeclarations` in `tsconfig.json` covers `__tests__/` too, so an exported helper whose type was inferred now writes its type out.

**Changed: two tests' mechanics, the exception this spec makes to "refactors do not change tests".**

1. **`errorsReachingProcess` listens where the runtime reports.**
   - **On Node:** on `process`, as today (`unhandledRejection`, `uncaughtException`).
   - **In a browser:** on `globalThis`, for `unhandledrejection` (it collects `event.reason`) and `error` (it collects `event.error`).
   - **Telling them apart:** `typeof process`.
   - **The wait:** it still waits three real macrotasks after `run`. It uses the `setImmediate` (Node) or `setTimeout` (browser) captured when the module loads, before a test installs fake timers, in place of `node:timers/promises`.
   - **No `preventDefault()`:** Vitest still sees what reaches the page, as it sees what reaches `process` on Node.
   - **Names:** the helper's name and the titles that say "process" stay. Its JSDoc says what reaching "process" means in a browser.
   - **Why it matters:** the 11 tests that use it stay in `http-client.test.ts`. They check the late settlements and the cancels of `feature/http-client/timeouts-and-abort`, the behavior that branch left unprobed in browsers.
2. **`should log the reduced URL and no marker of a request $outcome` awaits its request.** It keeps the promise of its request (with its `.catch(() => undefined)`), and awaits it after `advanceTo(100)`, before it reads the logs.
   - It waits for more, not for less: for the request to settle, in every runtime.
   - A request that never settles makes the test time out.

### 6. Other packages

**Added at checkpoint 1**, after the user asked whether the service could serve other packages.

- **Repo-level, for every package:**
  - the `playwright` service;
  - `PLAYWRIGHT_WS_ENDPOINT` on the dev container;
  - the turbo pass-through, on the `test` task of every package.

  Nothing in them names `@enardo/http-client`, and two packages can use the server at once (probed above).
- **Per package, to opt in:**
  - the two `devDependencies`, as `catalog:`;
  - a `browser` project in its `vitest.config.ts`;
  - its Node-only tests in `*.node.test.ts` files.
- **Other Playwright clients.** Any Playwright 1.63 client can connect to the server, so an end-to-end suite of `@cambusa/web` with `@playwright/test` could use it too. Not probed: only Vitest's provider and `playwright`'s `connect()` were.
- **The browser project's configuration stays in `@enardo/http-client`'s file for now** (decision 10). The second package that opts in moves it into a shared preset.
- **Cost.** Each package that opts in launches the three browsers for its own run. Two runs at once took about twice as long as one.

### 7. Docs

- **Root `CLAUDE.md`:**
  - *Development environment*: the `playwright` service. What it runs, why it starts with the dev container, why nothing publishes its port, the version rule, and `exposeNetwork`. `pnpm verify` needs it, and any package can use it.
  - *Tooling*: vitest, with its browser mode where a package's code runs in browsers.
  - *Testing*: a package whose `src/` runs in browsers runs its tests there too, and a test that needs Node goes in a `*.node.test.ts` file. How a package opts in (section 6), and that the second package to opt in moves the browser project into a preset.
- **`packages/http-client/CLAUDE.md`:**
  - *Checks* gets a row for the browser run. Its *Misses* cell: the `*.node.test.ts` tests, and a browser's own `fetch`, since every test there stubs `fetchImpl`.
  - The paragraph "Tests run on Node only …" describes the two projects and the file rule. Its sentence "The browser side is guarded by the checks above, not by tests" goes.
- **`packages/http-client/README.md`:**
  - *Runtimes*: "no browser runs the tests" becomes: the tests run in the Chromium, Firefox and WebKit builds of the Playwright version in the catalog. MDN's minimum versions stay as they are: the tests cover only those builds.
  - *Contributing*: the commands run in the dev container, whose `playwright` service the browser tests need.
- **The comments** of `docker/docker-compose.yml` and of the new Dockerfile.
- **`docs/backlog.md`:**
  - The item leaves, in a commit of its own, before the merge.
  - The item *Runtime checks for `@enardo/errors` and `@enardo/http-status`* takes over what this item's *Also* said. Their tests could run in browsers in the same way, and the first of them to opt in moves the browser project into a shared preset (section 6).

## Decisions (to confirm at checkpoint 1)

1. **The existing tests in real browsers, not an end-to-end suite.** The item asks how the package behaves in browsers. Its tests already describe that behavior, and Vitest's browser mode runs them there.
   - **Playwright's role:** only the driver that launches the browsers.
   - **An end-to-end suite** (`@playwright/test` driving `@cambusa/web`) would be a different item. It would test the app, not the client, and would need the api-server and Mongo running.
2. **The browsers in a service of their own, from Playwright's image**, as the item says. The dev image stays Node and pnpm, and the browser builds come with the Playwright version that drives them.
   - **A derived image installs the server at build time.** The alternative is `npx -y playwright@1.63.0` at start, which needs the registry each time the container is created.
3. **The service starts with the dev container** (`depends_on`), not under a profile. `pnpm verify` needs it, and the `Stop` hook runs `pnpm verify` at the end of every turn.
4. **`*.node.test.ts` files, rather than `skipIf` in one file.**
   - **Why not `skipIf`:** a page cannot load a file that imports `node:*`, so `skipIf` would also need those imports aliased to stubs in the browser project.
   - **Why the suffix:** a file's name says where its tests run, and the browser project picks files by glob, so a new Node-only test needs no configuration.
5. **Tests move whole and unchanged**, even when only one of their assertions needs Node, as `util.inspect` does in 16 of them.
   - **Splitting them** would change 16 tests to run, in browsers, assertions on messages that the client writes itself, which do not depend on the runtime.
   - **Moving them** keeps every full name and every body, which the review checks mechanically.
6. **Node's assertions stay on Node**: `ERR_INVALID_URL`, undici's message and V8's stack describe what the client lets through on Node. Rewriting them for every runtime would change what they test, which is outside this item.
7. **An exact `playwright` version in the catalog.** A caret would let pnpm move the client past the image. A mismatch fails at the first connection, with Playwright's own message, so the repo needs no check of its own.
8. **The endpoint in the environment** (`PLAYWRIGHT_WS_ENDPOINT`, set by compose), not written in `vitest.config.ts`.
   - **Where it lives:** the compose file names the service, so it also names its address.
   - **How it arrives:** turbo passes it through.
   - **Without it:** the config throws, with a message that says where the tests run.
9. **No `test-author` run.** No production code changes, and no behavior is added.
   - **The step:** it moves tests, and changes how two of them wait and listen, each change probed above in all four runtimes.
   - **The check:** the `reviewer` checks the moves.
   - **Why the policy does not apply:** the test-first policy covers behavior, and this is a refactor of the tests.
10. **The browser project's configuration stays in the package until a second package needs it** (**added at checkpoint 1**). The root `CLAUDE.md` moves into a preset what two or more packages need, and only one package runs its tests in browsers today.
    - **The shared preset:** a function that returns the `browser` project. The second package decides where it lives: in a new `@enardo/vitest-config`, as ADR 0001 keeps the other configurations, or elsewhere.
    - **The alternative:** that preset now, as a new package with one consumer.

## Found while exploring

- **Firefox needs more than one macrotask to read a `Response` body.** The client behaves correctly there (probed with real timers). One test assumed otherwise (section 5). Nothing for the backlog.
- **In Firefox and WebKit, `Error.prototype.stack` holds the frames only**, so a stack logged in a browser has no name or message on its first line. Nothing for the client to do.

## Out of scope

- **A browser's own `fetch`.**
  - **The gap:** every test that runs in a browser stubs `fetchImpl`. What only a real `fetch` does stays tested against Node's `fetch` only: CORS, a stream body and `duplex`, redirects, its rejections.
  - **What closing it needs:** a server the page can reach, such as Vitest's own, or one in the dev container exposed through `exposeNetwork`.
  - **Next step:** I can propose it for the backlog, to evaluate.
- **`@enardo/errors` and `@enardo/http-status`**: they have their own item, to evaluate.
- **`@cambusa/web`**, and any end-to-end test (decision 1).
- **Branded browsers** (Chrome, Edge, Safari): the run uses Playwright's builds only.

## Test cases

No new case. Section 5 lists every test that moves and the two that change.

The rules of sections 1 to 4 are configuration: the browser project leaves out `*.node.test.ts`, and the endpoint comes from the environment. No test can check them, so the verification steps do.

## Verification

1. **`pnpm verify`**: `@enardo/http-client` and its dependent `@cambusa/web`, or every package if turbo takes the change to `turbo.json` as a global one. shellcheck still runs over `dev.sh`.
2. **The same tests on Node.** `vitest list --project node --json` lists the same 322 full names on `master` and on the branch. Probed: the command lists each test's full name, file and project.
3. **The browser runs**: 283 tests in each of Chromium, Firefox and WebKit, none from a `*.node.test.ts` file.
4. **The moves.** `git diff master --color-moved=dimmed-zebra -- packages/http-client/__tests__` shows each moved block as moved. Only the imports and the two changes of section 5 show as edits.
5. **Seen failing.** These run on a copy of the package outside the repo, never in the working tree:
   - **A runtime-only break:** `src/` calls `process.nextTick` on a path every request takes. The Node project passes, and the browser project fails in all three browsers. This shows that the browser run executes `src/` in the browsers.
   - **A cancel that throws:** `cancelQuietly` loses its `try`/`catch`. The tests that use `errorsReachingProcess` fail in each browser, as on Node. This shows that the helper catches what reaches the page.
6. **Without the service.** After `./dev.sh down playwright`, `pnpm --filter @enardo/http-client test` fails, naming the host it cannot reach. `./dev.sh up -d` brings the service back.

### Results

1. **`pnpm verify`**: green, 140 tasks. turbo takes the change to `turbo.json` as a global one, and checks every package.
2. **On Node**: the same 322 full names as on `master`, 39 of them from `.node.test.ts` files.
3. **In the browsers**: 283 tests in each of Chromium, Firefox and WebKit, the same in all three, none from a `.node.test.ts` file. The whole run (1171 tests) takes about 15 s.
4. **The moves**: the lines that git does not see as moved are only these:
   - imports and intro comments;
   - the describe skeletons, with the hooks and the `ABORTED` constant they repeat;
   - `export` and the explicit types of the support modules;
   - the new `errorsReachingProcess`, and the wait of the log test;
   - the builders that the error `.node.test.ts` files repeat.

   No line of a moved test body is edited.
5. **Seen failing**, on copies in the `en-probe` volume, against the `playwright` service:
   - `process.nextTick` in `request()`: the Node project passes its 322 tests. Each browser fails 194 of its 283, with `ReferenceError: process is not defined` in Chromium.
   - `cancelQuietly` without its `try`/`catch`: the same two tests fail in each of the four runtimes, with `expected [ Error: The cancel threw ] to deeply equal []`.
6. **Without the service**: `pnpm --filter @enardo/http-client test` fails after about 10 s, exit status 1, with `browserType.connect: WebSocket error: getaddrinfo ENOTFOUND playwright`. The Node project's files still pass. `./dev.sh up -d` starts the service again and keeps the dev container.

## Review follow-ups

**Added after the first review**, which found no defect in the moves, the helper, the log test or the infrastructure.

1. **The timing rule of the docs was broader than the tests** (blocking). Root `CLAUDE.md` and the package's said that a test reads a request's outcome only once the request has settled. About 20 tests in `http-client.test.ts` check, on purpose, what has settled at an instant of the fake clock (`track`, `advanceTo`, `rejectionNow`): a `test-author` following the rule would turn their failures into test timeouts. Both files now limit the rule to a check that needs a real body to have been read.
2. **Decision 7 assumed that a mismatch fails at the first connection.** That connection can come on another branch.
   - **Probed** on a clone: a branch that bumps only `docker/playwright/Dockerfile` selects no package under `--filter=...[<base>]`. `pnpm verify` stays green, and `verify:all` replays cached results.
   - **The fix:** `"globalDependencies": ["docker/playwright/Dockerfile"]` in `turbo.json`.
   - **Probed with the fix:** the same bump selects all 33 packages, and the hash of `@enardo/http-client#test` changes. A docs-only change still selects none.
   - **The cost:** a change to the Dockerfile re-checks every package, as the change to `turbo.json` on this branch did.
3. **`dev.sh` hinted `./dev.sh up <project>` for `playwright`.** A service outside every profile (`is_base_service`: `dev`, `playwright`) now gets `./dev.sh up`, both in the refusal of `up <service>` and in the "not running" message. Tried for `playwright`, `dev` and `cambusa-mongodb`.
4. **"The image is `node:24-bookworm` plus pnpm"** became ambiguous with a second image. It was already inaccurate before this branch, since the dev image also installs shellcheck. It now reads "The dev image is `node:24-bookworm` plus pnpm and shellcheck".
5. **Two doc claims that nobody had checked:**
   - **The down case.** The text no longer gives `ENOTFOUND` as the only error: that one is probed for a stopped service, and the error while the service starts is not probed.
   - **A failed image build.** Probed with a throwaway compose project: when the image of a `depends_on` service fails to build, `up --build` creates neither container, and `up --no-deps` starts the dependent alone. Root `CLAUDE.md` says so, with the command.

## Second review follow-ups

**Added after the second review.**

1. **`globalDependencies` did not close the gap of follow-up 2** (blocking). The cache key now holds the Dockerfile, but the tests run against whatever container is running, and nothing rebuilds it before `pnpm verify`. A run that passes against the old container is cached under the new key, and replayed once the image is rebuilt (the reviewer probed it on a clone, with a stand-in for the server).
2. **The server refuses another minor version only** (blocking). `userAgentVersionMatchesErrorMessage` in `playwright-core` compares major.minor, and a `Playwright/1.63.7` client gets `101` from the 1.63.0 server (probed by the reviewer). The comments of the Dockerfile and the catalog, and the root `CLAUDE.md`, said "another version".

**Decision 7 is amended:** a mismatch does not always fail at the first connection, so the repo checks it itself.
- **The check:** `docker/playwright/check-version.sh` compares the `ARG PLAYWRIGHT_VERSION` of the Dockerfile with the catalog's `playwright`, which the lockfile installs, and fails on any difference, a patch one included.
- **Where it runs:** `pnpm verify` and `pnpm verify:all` run it as `lint:playwright`, after `lint:sh`, outside turbo, so no cache can hide it. shellcheck covers it.
- **Tried** on a copy: equal versions pass; a patch bump of the image fails, naming both; a quoted catalog entry passes; a missing entry fails.
- **`globalDependencies` stays.** After a change to the Dockerfile and a `./dev.sh up -d`, it makes the next verify re-run every package against the new image. Root `CLAUDE.md` says to rebuild before verifying.

Non-blocking, applied:
3. **A change to `docker/docker-compose.yml` alone re-runs nothing either** (probed by the reviewer). Adding it to `globalDependencies` would re-check every package on any compose edit, cambusa's included. Root `CLAUDE.md` names the gap instead, with the uncached command to run.
4. **"Without the browser tests"** after `up --no-deps`: they fail, they are not skipped. Reworded.
5. **The Dockerfile's comment** said "the dev image stays Node and pnpm"; it now says the dev image gets no browsers.
6. **The rule for `__tests__/support/`** now allows what the error pairs do: a constant or a builder of a few lines may be repeated.
7. **"Today that is `@enardo/http-client`"** now names `@enardo/errors` and `@enardo/http-status`, which run in browsers and whose tests do not yet.
8. **The comment on `--build` in `dev.sh`** names both Dockerfiles.

Found by the review, for the backlog (*To evaluate*): a change to `docker/dev/Dockerfile` alone, which sets the Node version every test runs on, selects no package either.

The lockfile now resolves every importer's `vitest` with the optional peer `@vitest/browser-playwright`. The 140 tasks of `pnpm verify` ran every package's tests on it, green.

## Third review follow-ups

**Added after the third review**, which found nothing blocking. It ran 16 wrong inputs against `check-version.sh`: none passes while the two files disagree, apart from versions written where the conventions forbid them (a package's own version, an override).

1. **`check-version.sh` also reads the lockfile.** It now compares every version of `playwright` that `pnpm-lock.yaml` resolves with the Dockerfile. That catches a package's own version, an override, and a catalog edit with no `pnpm install` after it. It reads the catalog's key within the `catalog:` block only, and drops a CR.
   - **Tried on copies, failing as they should:** a patch bump of the image; a bumped catalog and image with the old lockfile; a lockfile with a second version; a missing catalog entry.
   - **Tried on copies, passing as they should:** CRLF in all three files; a `playwright` key in another block; a quoted `ARG` and catalog value.
2. **Root `CLAUDE.md`, the `--no-deps` case:** turbo replays a cached run as it passed, so `pnpm verify` is red only when it re-runs the tests.
3. **Root `CLAUDE.md`, rebuilds:** after a change to compose, `./dev.sh up -d` comes before the uncached run. `pnpm verify --force` re-runs everything after a verify that ran before the rebuild; the reviewer saw the flag reach turbo.
4. **The backlog edits:**
   - this item leaves;
   - the item *Runtime checks for `@enardo/errors` and `@enardo/http-status`* takes over the note on browser tests;
   - two items enter *To evaluate*: a browser's own `fetch` (*Out of scope* above), and the blind spot of `docker/dev/Dockerfile` (second review).

## Plan

Each step ends with `pnpm verify` green, and one commit.

1. **Spec** (this file).
2. **The tests by runtime**: the support module, the four `.node.test.ts` files, and the two changes. Node only. Verification 2 and 4.
3. **The browsers**: the Dockerfile, compose, the usage text of `dev.sh`, the catalog and the `devDependencies`, `pnpm install`, `vitest.config.ts` and `turbo.json`. Before recreating the dev container, I ask. Verification 3, 5 and 6.
4. **Docs**: the root `CLAUDE.md`, and the package's `CLAUDE.md` and README.
5. **Review, checkpoint 2, integration.** The item leaves the backlog in a commit of its own. The `en-probe` volume and the `en-probe-playwright` image are removed.
