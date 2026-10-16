# enardo-packages

Personal TypeScript monorepo of reusable infrastructure packages (`@enardo/*`), published to a private registry (see [Publishing](#publishing)). The projects built on them live in repos of their own (currently `cambusa`) and install them from that registry. Solo developer.

## Layout

```
packages/<name>                    @enardo/<name>    shared, project-agnostic libraries
packages/typescript-config         @enardo/typescript-config  tsconfig presets (library, node-app, react-app)
packages/eslint-config             @enardo/eslint-config      ESLint presets (node, react)
docker/                            dev container image, the test browsers' image, and compose stack (driven by ./dev.sh)
docs/specs/                        task specs (see Workflow)
docs/adr/                          architecture decision records
docs/backlog.md                    work queued or to evaluate, in order
```

Workspaces are declared in `pnpm-workspace.yaml`; internal dependencies use `workspace:^`, which packs as a caret range on the current version. Dev tooling shared by the packages (typescript, eslint, prettier, vitest, tsdown, …) takes its version from the `catalog:` in `pnpm-workspace.yaml`: a package references `"catalog:"`, never a range of its own, so versions cannot drift apart.

## Development environment

Every command that touches `node_modules` runs inside the `dev` container. The host starts things and runs everything else — the editor, git, and Claude Code itself. `./dev.sh` is the interface:

```
./dev.sh up [-d]             # start the dev container and the test browsers;
                             # without -d it drops you into a shell
./dev.sh shell [service]     # a shell in a service (default: dev)
./dev.sh exec <command>      # run one command in the dev container
./dev.sh logs [service...]   # follow logs (default: every service)
./dev.sh down [service]      # everything, or one service: 'down dev'
./dev.sh clean               # remove every node_modules and dist
```

`up` without `-d` opens a shell, unless no terminal is attached (a script or a hook), where it stays detached.

**Claude Code runs on the host**, so it can start and stop the containers, and routes every package command through `./dev.sh exec` (for example `./dev.sh exec pnpm --filter @enardo/uow-repository test`).

- **Never run `pnpm` on the host.** `bcrypt` and `mongodb-memory-server` are native modules; installing from two different environments into the same `node_modules` breaks them. Recovery: `./dev.sh clean` then `./dev.sh exec pnpm install`. The one exception is publishing (see [Publishing](#publishing)): `pnpm whoami` and `pnpm publish <tarball>` run from outside the repo, where they touch no `node_modules`.
- **A probe that needs a package outside the lockfile** (another library, another version) installs it in a throwaway container, never in the dev container. The repo is mounted read-only, so the probe can read built `dist/` files and cannot touch `node_modules`; a named volume keeps the installs between runs:
  ```
  docker run --rm -v "$PWD":/workspaces/enardo-packages:ro -v en-probe:/probe -w /probe node:24-bookworm \
    sh -c 'npm init -y && npm i <packages>'    # then more runs with the same mounts
  docker volume rm en-probe                   # when done
  ```
  In `feature/http/client-errors`, an `npm i` under `/tmp` in the dev container most likely moved `packages/http/node_modules/@types/node` to a temporary name, and the package's typecheck stayed red for three `test-author` runs.
- Shared packages need no service of their own: Mongo-backed tests start their own in-memory replica set, and browser tests use the `playwright` service, which starts with the dev container.
- **The browser tests run in the `playwright` service** (`docker/playwright/`).
  - **What it runs:** Playwright's builds of Chromium, Firefox and WebKit, behind Playwright's `run-server` on port 3000.
  - **When it starts:** with the dev container (`depends_on`), since `pnpm verify` runs the browser tests. `./dev.sh down dev` leaves it running.
  - **Who reaches it:** its port is not published, so only the compose network reaches it, at `ws://playwright:3000/`. The dev container gets that address as `PLAYWRIGHT_WS_ENDPOINT`, and turbo passes it through to `test`. Vitest serves the test pages on the dev container's loopback, and the browsers load them through the connection (`exposeNetwork: "<loopback>"`). Nothing is mounted into it.
  - **Versions:** the catalog pins `playwright` to the version in its Dockerfile, so an upgrade changes both. `pnpm verify` compares the two, and the versions the lockfile installs, on every run, outside turbo's cache (`docker/playwright/check-version.sh`). A test run cannot be trusted to catch a mismatch: the server refuses a client of another minor version only (`428`, "Playwright version mismatch"), and turbo can replay a run that passed against a container not yet rebuilt.
  - **After a change to its Dockerfile:** run `./dev.sh up -d` before `pnpm verify`, so that the tests run against the new image. The Dockerfile is a `globalDependencies` entry of `turbo.json`, so the next verify re-runs every package; a run against the old container would be cached under the new key. If a verify already ran before the rebuild (the `Stop` hook runs one at the end of every turn), `pnpm verify --force` runs everything again. A change to `docker/docker-compose.yml` alone re-runs nothing: after renaming the service or its endpoint, run `./dev.sh up -d`, then `pnpm --filter <package> test` for each package with browser tests, which does not go through turbo's cache.
  - **When it is down:** a browser test run fails at its connection to `ws://playwright:3000/`, with `getaddrinfo ENOTFOUND playwright` when the service is stopped. `./dev.sh up -d` starts it again.
  - **When its image cannot be built** (the first pull of Playwright's 2.5 GB image, offline), `./dev.sh up` stops before the dev container starts. `DEV_UID=$(id -u) DEV_GID=$(id -g) docker compose -f docker/docker-compose.yml up -d --no-deps dev` starts the dev container alone. The browser tests then fail whenever they run, so `pnpm verify` is red when it re-runs the tests of a package that has them; a run turbo has cached replays as it passed.
- The repo is bind-mounted at `/workspaces/enardo-packages` inside the container, so paths differ from the host's. Editors run on the host and read `node_modules` through the bind mount.
- The pnpm store is `.pnpm-store/` at the repo root (gitignored, a few hundred MB): it has to sit on the same filesystem as `node_modules` for packages to be hard-linked instead of copied. Do not delete it to free space unless you mean to redownload everything.
- `./dev.sh up` rebuilds an image when its Dockerfile (`docker/dev/`, `docker/playwright/`) changed. A rebuilt `playwright` image recreates that service only, not the dev container.
- The dev image is `node:24-bookworm` plus pnpm and shellcheck; nothing else is added. git comes with that base and must stay: turbo's `--filter=...[main]` resolves the affected packages by diffing against git, inside the container.
- Nothing sensitive is mounted into the container: no Docker socket (a container that can reach the host daemon is root on the host), no SSH key, no credentials — only `~/.gitconfig`, read-only. Pushing and authenticating happen on the host.

## Tooling & commands

- Node 24, pnpm 11, turbo, TypeScript (strict, ESM only), tsdown (build), vitest (test; its browser mode, through Playwright, where a package's code runs in browsers), eslint + prettier.
- Every package exposes the same scripts: `build`, `dev`, `lint`, `lint:fix`, `format`, `format:check`, `typecheck`, `test` (where tests exist). The two config packages are consumed as source: they have no build, and only the lint/format scripts that apply to them.
- Every `tsconfig.json` extends a preset of `@enardo/typescript-config` and every `eslint.config.js` calls a preset of `@enardo/eslint-config`. The presets are defaults, not a cage: a package may override an option or a rule in its own file, with a comment saying why; an override needed by two or more packages moves into a preset; when a preset gets stricter, a package may keep the old behavior through a temporary override. Presets are dependencies, so changing one makes `pnpm verify` re-check every package that uses it.
- The compiler runs with `strict`, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `noImplicitOverride` and `noFallthroughCasesInSwitch`; ESLint is type-aware (`recommendedTypeChecked` + `stylisticTypeChecked`), so `lint` depends on the upstream builds like `typecheck` does. Fix findings rather than suppress them; in production code, an unchecked index gets a real check, not `!`.
- Run scripts for one package with `pnpm --filter <package-name> <script>` (e.g. `pnpm --filter @enardo/uow-repository test`), inside the container or through `./dev.sh exec`.
- Packages are consumed through their built `dist/`: after changing a dependency package, build it (`pnpm --filter <pkg> build`, or `pnpm exec turbo run build --filter=<consumer>...`) before typechecking/testing its consumers. `turbo` is a devDependency of the root, and not on the container's `PATH`: it runs through `pnpm exec`, or a root script.
- Root scripts: `pnpm verify`, `pnpm verify:all`, `pnpm packages:build`.
- `pnpm verify` runs shellcheck over the tracked shell scripts (`*.sh` and `.githooks/`), compares the `playwright` versions of the catalog and of the browser image, then `format:check`, `lint`, `typecheck` and `test` on the packages changed against `main` **and every package that depends on them**. Shell scripts get no other check: eslint and vitest do not see them. A `Stop` hook runs it at the end of each turn, so a red state blocks finishing; outside the container the hook routes it through `./dev.sh exec`.
- **A cached result is only as fresh as turbo's key.** A task whose outcome depends on something outside the key can be replayed after that thing has changed: a running container, a variable that `passThroughEnv` lets through, a file outside the package that no `inputs` or `globalDependencies` entry names. Such a fact gets a check of its own that turbo does not cache, as `lint:playwright` is for the browser image's version, or a rule in the docs that says what to re-run. In `chore/repo/browser-tests`, adding the browser image's Dockerfile to `globalDependencies` only made turbo cache a pass against the old container under the new key; the second review found it.
- Mongo-backed tests use `mongodb-memory-server` (in-memory replica set via vitest `globalSetup`); no external DB needed.

## Publishing

- The packages are published to the private Verdaccio registry `https://npm.enriconardo.com`, which needs a token to read and to publish. Each manifest pins it with `publishConfig.registry`: with `pnpm publish`, it wins over `--registry` and over the scope's registry, so a publish never reaches the public npm registry. `npm publish` lets `--registry` and the scope's registry override it: never publish with npm.
- Only the user's account can publish or unpublish `@enardo/*`. A project installs with the token of a read-only user, kept in that project's dev environment.
- `pnpm pack` runs in the dev container, after a build (`pnpm exec turbo run build --filter=<package>... --force`, then `pnpm --filter <package> pack --pack-destination <dir>`): it turns `workspace:^` into a caret range, and `catalog:` into its range. `pnpm publish <tarball>` runs on the host, from outside the repo, with the user's own login (`pnpm login --registry https://npm.enriconardo.com`, which pnpm keeps in `~/.config/pnpm/auth.ini`; `pnpm whoami --registry https://npm.enriconardo.com` answers `enardo`), so the publish token never enters a container. `--dry-run` shows the registry each tarball goes to: `publishConfig` wins over `--registry` and over the scope's registry. A publish is outward-facing: the user approves each one.
- A published version never changes: a change to a published package ships under a new `version`. A project on `^x.y.z` takes a minor or a patch when it updates, so a breaking change is a new major. Below 1.0.0 the caret is narrower: `^0.1.0` takes patches only, so a breaking change to a 0.x package is a new minor.

## Architecture conventions

### Shared packages (`@enardo/*`)

- **Ports & adapters**: a contract package defines interfaces and technology-agnostic logic (`transaction-manager`, `uow-repository`, `database`, `email`); a separate `<name>-<technology>` package implements it (`transaction-manager-mongo`, `uow-repository-mongo`, `database-mongo`, `email-nodemailer`).
- Contract packages must not depend on a concrete technology. Third-party drivers (`mongodb`, `bcrypt`, `nodemailer`) are `peerDependencies` of the adapter, and `devDependencies` too, so that it builds and tests in the workspace without relying on `autoInstallPeers`. The app of a project lists in its own `dependencies` the driver of every adapter it runs, directly or through other packages, which the adapter gets once installed from the registry: pnpm reports nothing when one is missing. Any other package lists a driver only when its own code runs it.
- `@enardo/*` packages never depend on a project's packages.
- Single entry point `src/index.ts` → `dist/index.mjs` + `.d.mts`. Exception: the two config packages, which ship their JSON/JS files as they are.
- Errors extend `BaseError` from `@enardo/errors`: a concrete class declares its `name` as a field (`override readonly name = "UserNotFoundError"`) and passes a `code`; see [its README](packages/errors/README.md).

## Code conventions

- Files in kebab-case with a role suffix: `product.entity.ts`, `product.repository.ts`, `create-product.handler.ts`, `*.mongo.test.ts`, `*.node.test.ts`.
- `~/*` is aliased to `src/*` inside each package (tsconfig `paths` + vitest `resolve.alias`); use it instead of long relative paths.
- Use `import type` for type-only imports (enforced: `verbatimModuleSyntax` plus `consistent-type-imports`). Prefer a separate `import type` over inline `type` specifiers next to a default import: `import x, { type T }` is valid but compiles to `import x, {}`.
- Library packages declare `"sideEffects": false`: a module must not run code at load beyond pure declarations.
- Library packages declare `"files": ["dist"]`, so that a tarball or a `pnpm deploy` carries `dist/`, `package.json` and the README only. The two config packages list their own files.
- Each folder re-exports its public surface through an `index.ts`.
- JSDoc on public API of shared packages; comments explain *why*, not *what*.
- A package's README never names a package it does not depend on: a contract's README describes its implementations without naming them, and what an adapter does not meet yet goes in the adapter's own README. In `refactor/email/contract-docs`, `@enardo/email`'s README named its nodemailer adapter, and listed the rules that adapter breaks.
- In shared packages, a type guard (`x is T`) narrows only to what its runtime check proves, relative to its parameter's type; when one question hides two (class vs membership), write two guards. See [ADR 0003](docs/adr/0003-type-guards-claim-only-what-they-check.md).
- To find every use of a symbol, use `git grep` over tracked files, not `grep --include`, which silently skips the extensions you didn't list (`.tsx`).
- Match the style of the surrounding code; do not introduce new libraries without asking.

## Testing

- Tests live in `<package>/__tests__/`, mirroring `src/`, named `*.test.ts`.
- Unit-test domain and pure logic; test adapters and repositories against the in-memory Mongo replica set (`__tests__/setup/replica-set.ts`, one database per test).
- **A package whose `src/` runs in browsers runs its tests there too.** Today that is `@enardo/http-client`. `@enardo/errors` and `@enardo/http-status` run in browsers as well, and their tests do not yet: see their item in the backlog.
  - **How:** vitest's browser mode, in Chromium, Firefox and WebKit, through the `playwright` service. Its `vitest.config.ts` has two projects: `node` runs every test file, and `browser` runs every file but `*.node.test.ts`.
  - **What needs Node:** a test that needs Node goes in a `*.node.test.ts` file beside its `*.test.ts`. That covers Node's `fetch`, a local server, `util.inspect` and `node:vm`, and what only Node or V8 puts on a value, such as an error's `code` or a stack that starts with the message. A page cannot load a module that imports `node:*`.
  - **Shared helpers:** helpers that both files use go in `__tests__/support/`, which imports nothing from `node:*`. A constant or a builder of a few lines may be repeated instead, as sibling test files already repeat theirs.
  - **Opting in:** a package adds `@vitest/browser-playwright` and `playwright` (`catalog:`) to its `devDependencies`, and a `browser` project to its `vitest.config.ts`, copied from `@enardo/http-client`'s. The second package that opts in moves that project into a shared preset.
  - **Timing:** a check that needs a real `Response` body to have been read waits for the request to settle. Firefox reads a body later than Node, Chromium and WebKit, after more than one real macrotask, so a move of the fake clock alone does not get there. A check of what has settled at an instant of the fake clock (`track`, then `advanceTo` and `rejectionNow`) stays valid when nothing it checks waits on such a read.
- Refactors keep existing tests green before and after, without changing them (unless the spec says so).
- When a spec makes the code reject an input it used to accept, its test cases list every existing test that sends that input: search for the value, then for the uses of every constant that holds it. In `fix/http-client/base-url`, the spec found the two tests that wrote a URL with credentials out in full, and missed the one that sent it through `MARKED_URL`; the `test-author` found it.
- A case that checks one rule without side effects gives an input where the side effect would show: to test that a failing read of `code` keeps the `cause`, the error needs a `cause`. On an input with nothing else on it, a wrong implementation gives the same result. In `fix/http-client/redact-cause`, three wrong implementations passed every case of the first two runs.

### Test-first policy

The spec always lists the test cases, so tests are *designed* before the code even when they are *written* after. On top of that:

- **Bug fixes are always test-first**: a test that reproduces the bug and fails, then the fix.
- **Domain logic and the public API of `@enardo/*` packages default to test-first**: the test defines the contract. A review follow-up that adds or changes that public API is a test-first step like any other: the `test-author` writes its tests, however small the change.
- **Wiring may be tested after the fact**: composition root, routes, UI.
- **Every rule the spec states has a test case, or the spec says why not**: an order ("in this order"), a count ("one trailing `/`"), a sequence ("before the headers"), an edge that passes. For each rule, ask which wrong implementation would break it and still pass every case. In `fix/http-client/base-url`, four rules were in the spec's text and not in its cases; the review found them with four mutants that passed the whole suite.
- **A wrong implementation is tried on a copy of the package outside the repo, or on committed code**, never by editing the working tree and reverting it: `git checkout` and `git stash` take uncommitted work with them. In `feature/http-client/timeouts-and-abort`, a loop that reverted each mutant with `git checkout -- src` wiped the uncommitted fix it was checking, and the next mutants ran against the code without it.
- A spec can override these defaults, with a reason.
- **A test written before the code is seen failing for the expected reason before anything is implemented.** A test that passes against missing code proves nothing: an import of something that doesn't exist yet is `undefined`, and `expect(p).rejects.toThrow(undefined)` accepts any error. Assert what identifies the failure (`toBeInstanceOf`, the error's `code` and `details`), not only that something was thrown.

## Workflow

Every non-trivial task follows: **intake → explore → spec → plan → implement → verify → review → integrate → learn**.

1. **Branch**: create a dedicated branch from an up-to-date `main` before touching anything (see [Branches](#branches)).
2. **Spec**: write `docs/specs/YYYY-MM-DD-<slug>.md` and commit it as the first commit of the branch. Size it to the task (a trivial fix needs none; a bug needs a short report + root cause; a new package needs a full spec). Facts the plan relies on are probed in the dev container before the spec states them: how a tool behaves (an API's behavior, a flag's effect, what a build emits), and how the existing code behaves wherever the spec describes it, including the expected result of a manual check meant to show unchanged behavior, which is first run on `main`. A claim that was not probed is marked as such. Why a dependency is declared where it is, is a claim too: remove it in a throwaway clone and see what breaks, including an app that loads the package. A probe through a package's `dist/` first rebuilds it and its dependencies, with `pnpm exec turbo run build --filter=<package>... --force`, and the spec names that command: a `dist/` imports its dependencies' `dist/`, so rebuilding the package alone runs it over builds of unknown state. In `fix/http-client/base-url`, the probes ran after a build of `@enardo/http-client` alone; the user asked whether the build was current, and the probes had to run again. A library's documentation is not a probe: when a spec lists the cases a library produces (its errors, their types or statuses, its options), take the list from the installed source or by running them. In `fix/cambusa/api-server/malformed-json-body`, a list taken from the body-parser README missed two client errors, which two review rounds then found. Nor is a data package or a type declaration a probe of a runtime: when a spec relies on what a runtime defines (its globals, its modules), enumerate them in that runtime, every one, not a sample. In `fix/http/runtime-neutral-types`, `globals` and `@types/node` both listed `ErrorEvent` for Node, which Node 24 does not define; the spec had spot-checked only Web Storage, and the review found it. Nor is one advisory a probe of the version that closes a module's advisories: `pnpm audit --json` gives each advisory on a module its own `patched_versions`, and the version is read from all of them. In `chore/repo/arch-review-skill`, a summary that kept one advisory per module gave `tar` 7.5.7, which left nine of its twelve open, the critical one among them; all twelve needed 7.5.21, and the first review found it. Nor do the advisories of the installed version say which version has none: a later version can bring advisories of its own, so the version an upgrade moves to is audited itself, with `npm audit` on a lockfile of that version in a throwaway container. In `chore/email-nodemailer/nodemailer-10`, the 15 advisories of nodemailer 6.10.1 all closed from 10.0.6, and the spec called 10.0.6 the version that closes every advisory; `GHSA-g57g-f23g-4646` covers `>=9.1.0 <10.0.9`, and the first review found it. The same goes for a command (a lookup, a filter) that a skill, an agent definition or this file gives to agents: it is probed on every package it can run on, not on the one at hand. In `chore/repo/arch-review-skill`, the skill's lookup of a package's former name was probed on `@enardo/http-client` only; on `@enardo/transaction-manager` and `@cambusa/web` it printed the renames of the package their manifest had been copied from, and the second review found it. An error's serialized form is a probe of its own: when a spec says what an error exposes or keeps out, probe its `toJSON()` or the log it lands in, with the whole `cause` chain, not its message. In `feature/http/client-errors`, the spec searched undici's error messages for URLs; two reviews found URLs and raw response bytes in own fields of nested causes (`base`, `data`). Saying that something is missing is a claim too: "no blind spot", "nothing else changes". When a change closes one way into a gap, keep describing the mechanism behind it, not only the way that was closed, and look for its other triggers before you remove it from the docs. In `chore/http/package-hygiene`, removing `undici` emptied the browser program's *Misses* cell, but a `/// <reference types="node" />` still loads `@types/node`. When a change removes a dependency between two packages, look for every current doc line that names both of them, not only for the symbols that move. In `refactor/errors/drop-http-errors`, the inventory searched the class names, and missed the sentence in `http-status`'s `CLAUDE.md` that gave `@enardo/errors` as the reason for an invariant. A change that makes code read a value it does not control, where it used to pass it along (a rejection, an abort reason, a parsed body), states in its spec what happens when a read throws, and when the value is cyclic or very deep. On an error path this is not an edge case: a throw there replaces the error being reported, and skips its log. In `fix/http-client/redact-cause`, the spec said which fields of fetch's rejection to keep, but not what a getter that throws does; the first review found that it made `request()` reject with the getter's error, and log nothing. A fix that copies a caller's value so that it is read once changes what a library reads downstream: a spread keeps own enumerable properties only, and loses the prototype, its getters and the non-enumerable ones. Check what the library produced from the value (the class it built, whether it kept the object itself) rather than rebuild its input. In `fix/email-nodemailer/contract-compliance`, `createTransport({ ...transport })` kept a `pool` getter from being read twice, and lost a `url` defined on a class's prototype: the mail went to `localhost:587`, with no error, and the second review found it. When a spec relies on a tool refusing what does not match (a version, a protocol), probe every level the tool could compare, patch, minor and major, not only one that it refuses. In `chore/repo/browser-tests`, the spec saw Playwright's server refuse a client of another minor version, and concluded that any mismatch fails at the first connection; the server compares major.minor only, and the second review found a client a patch apart connecting.
3. **⏸ Checkpoint 1**: stop and wait for the user to approve the spec. Do not write production code before approval.
4. **Implement** in small steps. For a test-first step, the `test-author` subagent writes the failing tests from the spec before any production code is written. Each step ends green (`pnpm verify`) and is committed.
   - Every change to those tests goes to a new `test-author` run in the foreground: a spec amendment, or a review follow-up. Don't resume a finished run with `SendMessage`. A resumed agent runs in the background. The turn ends while red tests sit in the tree, and the `Stop` hook blocks it. Under that pressure, production code gets written before the tests are settled, so they are never seen failing against it. That happened in `fix/logger/serialize-nested-errors`.
   - Production code waits for the `test-author`'s report.
5. **Verify** with `pnpm verify` (touched packages and their dependents).
6. **Review** the full diff against the spec with the `reviewer` subagent, and fix what it reports. A finding names one path into a defect: its fix looks for the other paths through the same mechanism, not only the one the review took. In `feature/http-client/timeouts-and-abort`, the first review found the body of a late response left uncancelled; the fix covered that path, and the second review found the same leak through the read of the error body, which `response.text()` kept locked.
7. **⏸ Checkpoint 2**: present the summary and diff; wait for the user's go-ahead.
8. **Integrate**: update package README/docs, set spec `status: done`, then `git checkout main && git merge --no-ff <branch>` and delete the branch. No PRs.
9. **Learn**: if something went wrong in a way that could recur, propose an update to this file, a skill, or a hook.

### Roles

| Step | Who | Why |
| --- | --- | --- |
| spec, plan, implement, integrate | main agent | holds the conversation and the intent behind the task |
| write tests (when test-first) | `test-author` subagent | works from the spec only, so tests describe required behavior instead of mirroring the implementation |
| verify | deterministic script/hook, no agent | running checks needs no judgement, and a script cannot talk itself into accepting a failure |
| review | `reviewer` subagent, read-only, fresh context | independence is the point: whoever wrote the code shares its blind spots |
| learn | main agent | the retrospective needs the context of what actually went wrong; the outcome is a proposal for the user |

Specs are historical snapshots: never edit them after merge. The current truth lives in package READMEs and CLAUDE.md files. Decisions that apply beyond a single task go in `docs/adr/`. Work that is queued or proposed but not started goes in `docs/backlog.md`; a merged branch leaves it.

An architectural assessment of a package runs with `/arch-review <package>` (`.claude/skills/arch-review/`). It is read-only: its findings enter the backlog's *To evaluate* when the user approves them.

### Branches

- Format: `<type>/<scope>/<short-description>`, or `<type>/<scope>/<ticket-id>-<short-description>` when the work refers to a ticket (Jira, Trello, …).
- Types:
  - `feature`: new functionality (including new packages)
  - `fix`: bug fix
  - `hotfix`: critical patch for production
  - `refactor`: cleanup or restructuring without behavior change
  - `test`: work on tests only
  - `docs`: work on documentation only
  - `chore`: maintenance (dependency updates, configuration, tooling)
- Scope:
  - shared package: its name without `@enardo/` (`uow-repository`)
  - whole repo: `repo`
  - never include `@enardo` or `@`; if the name is too long, use a short alias (`@enardo/design-system-components` → `ds-components`)
- Short description: kebab-case, a few words; never just a package name (it would collide with a scope path).
- Examples: `feature/email/send-errors`, `fix/uow-repository/EN-209-snapshot-diff`, `chore/repo/turbo-tasks`.

### Commits

- Format: `[<scope>] <type>: <summary>`, or `[<scope>][<ticket-id>] <type>: <summary>` only when the work refers to a ticket.
  Example: `[@enardo/uow-repository][EN-209] fix: handle missing key in snapshot diff`.
- Scope: the full package name (`@enardo/uow-repository`), or `repo` for repo-wide changes.
- Types (Conventional Commits): `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `ci`, `chore`.
- Summary: imperative mood ("add", not "added"), lowercase, no trailing period, ideally ≤ 50 characters and never over 72 for the whole subject line. Add a body (wrapped at 72) when the *why* is not obvious.
- The `commit-msg` hook in `.githooks/` refuses a subject over 72 characters, on `git commit` and `git merge` alike. Enable it once per clone, on the host: `git config core.hooksPath .githooks`. `--no-verify` skips it: never use it to get past the limit.
- One logical change per commit; never commit a red state.

## Definition of done

For every touched package: `format`, `lint`, `typecheck` and `test` all pass; dependents still typecheck and pass their tests; README updated if the public API changed; spec marked done.
