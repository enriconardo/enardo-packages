---
status: done
type: chore
packages: ["@enardo/*", "@cambusa/*"]
branch: chore/repo/split-repos
---

# Split the monorepo into `enardo-packages` and `cambusa`

## Why

The user wants the shared packages in a repo of their own, `enardo-packages`, published to their Verdaccio registry, and each project in its own repo, consuming the packages from that registry (2026-10-15). Cambusa is the only project today. The memory *shared packages as separate repos* already judged every `@enardo/*` manifest as if published; `chore/repo/package-files` made the packages ship `dist/` only, as a first step.

## Decisions

Taken by the user on 2026-10-15:

- **Names and places.** `~/Projects/enardo-packages` and `~/Projects/cambusa`. `en-monorepo` stays as it is, archived.
- **History.** Each new repo starts from one commit; neither carries git history. The specs travel as documents.
- **Branches.** `main` in both new repos.
- **Registry.** Verdaccio at `https://npm.enriconardo.com`. Every read needs authentication.
- **Licence.** All rights reserved: `"license": "UNLICENSED"`. `enardo-packages` will be hosted on GitHub.
- **Registry token in Cambusa's dev container.** The container has it at all times, as an environment variable, so every `pnpm` command works there. The token belongs to a read-only Verdaccio user. Only the user's own account can publish or unpublish `@enardo/*`.
- **No check of `files` in `verify` for now** (checkpoint 1 of `chore/repo/package-files`).

## Probes

They ran on `master` (`7d82e33`), in a throwaway clone in the `en-probe-split` volume, in containers of the dev image (`en-monorepo-dev`: Node 24.21.0, pnpm 11.1.3). The registry was a throwaway `verdaccio/verdaccio:6` container on its own network.

### The registry today

- `GET https://npm.enriconardo.com/-/ping` answers `200`. Without a token, `@enardo/errors` answers `401` (`authorization required to access package @enardo/errors`), and so does `lodash`, which Verdaccio would proxy.
- On the host, `~/.npmrc` already maps `@enardo:registry=https://npm.enriconardo.com/` and holds no token for it: `npm whoami --registry https://npm.enriconardo.com` gives `ENEEDAUTH`. Host npm is 11.12.1.

### What publishing needs

In the clone, on the 20 `@enardo/*` packages: `"private": true` removed, `"license": "UNLICENSED"` added, and every dependency on another `@enardo/*` package changed from `workspace:*` to `workspace:^`. `pnpm install` then rewrites 52 lines of the lockfile, its specifiers, and nothing else. `turbo run build --filter="./packages/*" --force` builds all 18 (no build for the two config packages), and `pnpm pack` packs all 20.

- **`workspace:^` packs as a caret range on the current version.** `@enardo/uow-repository-mongo` 0.1.0 depends on `^0.1.0` of `uow-repository` and `transaction-manager-mongo`, and `^1.0.0` of `errors`. `workspace:*` packs as the exact version, which pins every consumer to one copy.
- **`catalog:` packs as its range.** `@enardo/eslint-config` depends on `@eslint/js ^10.0.1`, `eslint-config-prettier ^10.1.8`, `globals ^17.11.0`, `typescript-eslint ^8.68.0`, with `eslint ^10.0.0` as a peer.
- **`publishConfig.registry` pins the registry.** A tarball whose manifest carries `"publishConfig": { "registry": "<verdaccio>" }`, published with `npm publish <tarball>`, with npm's default registry left at `https://registry.npmjs.org/`, goes to Verdaccio (`Publishing to http://probe-verdaccio:4873/`). Without it, a host whose `~/.npmrc` loses its scope line would publish to the public npm registry.

### Access rules on Verdaccio

With `packages: '@enardo/*': { access: $authenticated, publish: enrico, unpublish: enrico }` and two users, `enrico` and `reader`:

- `enrico` publishes the 20 tarballs with `npm publish <tarball>` (npm 11, from `node:24-bookworm`).
- `reader` gets `403` (`user reader is not allowed to publish package @enardo/errors`) on publish, and `E403` on unpublish. It reads metadata (`200`).
- Without a token, reading is `401`.

### The token in a container

- **pnpm 11 ignores a token in the repo's `.npmrc` when it comes from a variable.** With `//npm.enriconardo.com/:_authToken=${ENARDO_NPM_TOKEN}` in the project's `.npmrc`, pnpm warns `Ignored project-level auth setting … environment variables are not expanded in repository-controlled registry credentials`, and installs get `401`.
- **pnpm sends a token from user-level config.** Against a server that logs the `Authorization` header, pnpm sent `Bearer <token>` from each of: `~/.npmrc`, `~/.npmrc` with `${VAR}`, a file named by `NPM_CONFIG_USERCONFIG`, and an environment variable named `npm_config_//<host>/:_authToken`.
- **Compose passes that variable through.** A service with `npm_config_//probe-verdaccio:4873/:_authToken: ${ENARDO_NPM_TOKEN:-}` under `environment`, started with `ENARDO_NPM_TOKEN` set to `reader`'s token, has the variable in its environment. `pnpm install` there installs `@enardo/*` from the registry. The same install with the variable empty fails with `ERR_PNPM_TARBALL_HTTP_STATUS` (`401`).

### A consumer outside the workspace

A package in that container, with `@enardo:registry=` the throwaway registry in its `.npmrc`. It depends on `@enardo/errors ^1.0.0`, `@enardo/uow-repository-mongo ^0.1.0` and `mongodb`, with devDependencies `@enardo/typescript-config ^1.0.0`, `@enardo/eslint-config ^1.0.0`, `eslint`, `typescript` and `@types/node`.

- It installs all four `@enardo/*` packages from the registry.
- Its `tsconfig.json` extends `@enardo/typescript-config/library.json` from `node_modules`. `tsc --noEmit` passes on a file that extends `BaseError` and imports `@enardo/uow-repository-mongo`'s types. `--showConfig` shows `strict`, `verbatimModuleSyntax` and `noUncheckedIndexedAccess` set.
- **Not probed**: `eslint` with `@enardo/eslint-config` from the registry. The full Cambusa run under *Verification* covers it.

## Plan

### 1. Here, on this branch: publish preparation

On the 20 `@enardo/*` packages:

- remove `"private": true`;
- add `"license": "UNLICENSED"` and `"publishConfig": { "registry": "https://npm.enriconardo.com/" }`;
- change dependencies on other `@enardo/*` packages from `workspace:*` to `workspace:^`.

Then `pnpm install` updates the lockfile, and `pnpm verify` runs. Versions stay as they are: 1.0.0, and 0.1.0 (`transaction-manager-mongo`, `uow-repository`, `uow-repository-mongo`), and 1.1.0 (`entities`, `events`). The Cambusa packages keep `private` and `workspace:*`.

### 2. `~/Projects/enardo-packages`

A copy of the tracked files of this branch, minus `projects/`, then:

- **Root.**
  - `package.json`: name `enardo-packages`, without the `cambusa:*` scripts.
  - `pnpm-workspace.yaml`: `packages/*` only.
  - The lockfile, regenerated.
  - `turbo.json` unchanged.
  - `verify` filters on `...[main]`.
- **Dev environment.**
  - Compose `name: enardo-packages`, without `cambusa-mongodb`, its volume and its ports.
  - The mount and paths become `/workspaces/enardo-packages`.
  - `dev.sh` keeps its commands, with no project.
  - `docker/playwright/` unchanged.
- **Agents and hooks.** `.claude/` and `.githooks/` copied. `core.hooksPath` is set in the new clone.
- **`CLAUDE.md`.**
  - Without what only Cambusa concerns: the project packages section, how to run Cambusa, `cambusa-mongodb`, and the `projects/` layout.
  - `master` becomes `main`.
  - The rest stays as it is. The user plans a thorough revision of every agent file later.
- **`docs/`.** The ADRs, the specs whose branch scope is not `cambusa/…`, and the backlog items about `@enardo/*` packages or this repo's tooling.
- **Publishing.** A short section in `CLAUDE.md`:
  - `pnpm pack` runs in the dev container;
  - `npm publish <tarball>` runs on the host, with the user's own login;
  - no publish credential ever enters a container.

### 3. Publishing to Verdaccio

This step is outward-facing, so it waits for the user's go-ahead at the moment it runs. The user first:

- **Logs in on the host:** `npm login --registry https://npm.enriconardo.com`.
- **Creates the read-only user** on the server.
- **Restricts publishing.** Sets `publish` and `unpublish` of `@enardo/*` to their own account, as in *Access rules on Verdaccio*.
- **Stores the reader's token** on the host in `~/.config/enardo/npm.enriconardo.com-read-token`, mode 600, outside every repo.

Then the 20 tarballs, packed in `enardo-packages`'s dev container, are published from the host with `npm publish <tarball>`.

### 4. `~/Projects/cambusa`

A copy of `projects/cambusa/` at the root (`apps/`, `packages/`), plus the root files of this repo, then:

- **Root.**
  - `package.json`: name `cambusa`, scripts `verify`, `dev` and `build` (from `cambusa:dev` and `cambusa:build`), with `turbo` and the same `packageManager`.
  - `pnpm-workspace.yaml`: `apps/*` and `packages/*`. It has a catalog of its own, with the entries Cambusa uses: `@types/node`, `eslint`, `prettier`, `tsdown`, `typescript`, `vitest`. It has no `playwright` and no `@vitest/browser-playwright`: no Cambusa package has browser tests. It keeps the `allowBuilds` Cambusa needs.
  - `.npmrc`: `@enardo:registry=https://npm.enriconardo.com/`, with no credential.
  - `turbo.json`: without the Playwright Dockerfile in `globalDependencies`, and without `PLAYWRIGHT_WS_ENDPOINT`.
  - `verify` filters on `...[main]`, without `lint:playwright`.
- **Dependencies.**
  - Every `@enardo/*` dependency goes from `workspace:*` or `workspace:^` to `^<published version>`.
  - The tsconfig and eslint presets come from the registry.
  - The lockfile is regenerated.
- **Dev environment.**
  - Compose `name: cambusa`, with `dev` and `cambusa-mongodb`. No `playwright` service.
  - The mount and paths become `/workspaces/cambusa`.
  - `dev` gets `npm_config_//npm.enriconardo.com/:_authToken: ${ENARDO_NPM_TOKEN:-}`.
- **`dev.sh`.**
  - It exports `ENARDO_NPM_TOKEN` from `${XDG_CONFIG_HOME:-$HOME/.config}/enardo/npm.enriconardo.com-read-token` when the file exists. `up` warns when it does not, since installs then fail with `401`.
  - Its texts no longer mention the browsers.
  - The `cambusa` project keeps its profile and its Mongo service.
- **Agents and hooks.** `.claude/` and `.githooks/` copied. In `arch-review`, the scope rules name only `@cambusa/*`.
- **`CLAUDE.md`.**
  - Without the parts about shared packages, browser tests, Playwright and publishing.
  - The *Nothing sensitive* rule names its one exception: the registry's read-only token.
  - A changed preset arrives as a new version, not through the workspace.
- **`docs/`.** The specs whose branch scope is `cambusa/…`, the backlog items about Cambusa, and an empty `docs/adr/` with its README.
- **Data.** The new stack starts with an empty `cambusa_cambusa-mongo-data` volume. The old `en-monorepo_cambusa-mongo-data` stays until the user removes it.
- **Ports.** Ports 3010, 5183 and 27017 are those of `en-monorepo`'s stack: `./dev.sh down` in `en-monorepo` first.

### 5. Items that span both repos

Each goes to the repo where its work starts, with a line about the other:

- `refactor/repo/split-contracts-from-adapters` goes to `enardo-packages`; Cambusa then moves to the new packages.
- The `pnpm audit` item is split by repo.
- *A production install of the api-server* goes to `cambusa`.

### 6. Integration

1. This branch: the spec is marked done and merged into `en-monorepo`'s `master`. A root `README.md` there says that the repo is archived, and where its parts went.
2. The two new repos:
   - `git init -b main`, with their first commit made after checkpoint 2.
   - Each carries a copy of this spec in `docs/specs/`.
   - The user adds the remotes and pushes.
3. Claude's memories for this project are copied to the memory folders of the two new paths, with paths and repo names updated.

## Amendments during implementation

- **The packages' READMEs.** Eight told a consumer to add the package through `workspace:*`, to build it from the monorepo root, or that it is "private to this monorepo": `entities`, `eslint-config`, `typescript-config`, `transaction-manager-mongo`, `uow-repository`, `uow-repository-mongo`, `email-nodemailer`, and the intro of `errors`, `http-status` and `transaction-manager`. In `enardo-packages`, each now installs from the `@enardo` registry (`pnpm add …`, with the driver beside an adapter), and the two quick starts lose their build step. `uow-repository` and `uow-repository-mongo` open pull requests against `main`. Here, they stay as they are: Cambusa still uses `workspace:*` until the merge.
- **Two package `CLAUDE.md` files relied on Cambusa being in the repo.**
  - `http-client`'s said that `pnpm verify` re-checks `@cambusa/web`, which has the DOM. In `enardo-packages` nothing does: `tsconfig.browser.json` and `tsconfig.node.json` are the only checks of what a consumer sees.
  - `errors`'s said that a change to `BaseError` migrates every subclass in the same commit. The projects' subclasses are out of reach now: a change that breaks them is a new major version.
- **The root `CLAUDE.md` here** says that `@enardo/*` packages depend on each other through `workspace:^`.
- **`arch-review` in `enardo-packages`** says that the projects consuming a package are in other repos, so an export is not judged unused because nothing in the repo imports it.
- **`enardo-packages`'s `allowBuilds`** drops `esbuild` and `protobufjs`: its lockfile has neither. `esbuild` came from Cambusa; `protobufjs` was in no lockfile, `en-monorepo`'s included (**corrected after review**). Its root `package.json` is `private`, so the root itself can never be published, and `UNLICENSED`.
- **Cambusa's `docs/adr/README.md`** has an empty index: the three ADRs are about the shared packages and their presets, and stay in `enardo-packages`.
- **Cambusa's `.env`**, ignored by git, is copied to the new repo with the tracked files.
- **Publishing goes through pnpm, not npm.** The user logged in with `pnpm login`, which keeps the token in `~/.config/pnpm/auth.ini`: npm does not see it (`npm whoami` gives `ENEEDAUTH`), and `pnpm whoami --registry https://npm.enriconardo.com` answers `enardo`. `pnpm publish <tarball> --dry-run`, run from the home folder, gives `→ https://npm.enriconardo.com/` for all 20, and still does with `--registry https://registry.npmjs.org/` or `--config.@enardo:registry=https://registry.npmjs.org/`: `publishConfig` wins. `enardo-packages`'s `CLAUDE.md` says so, and makes `pnpm whoami` and `pnpm publish <tarball>` from outside the repo the one exception to "never run `pnpm` on the host".
- **The token reaches pnpm through user-level config, not through `npm_config_//npm.enriconardo.com/:_authToken`.** The probe under *The token in a container* ran in a package with no `packageManager`, where corepack picked pnpm 12.11.2. The repo's pnpm 11.1.3 ignores that variable: the first install in `cambusa` failed with `ERR_PNPM_FETCH_401`, `No authorization header was set`. Re-probed with pnpm 11.1.3 against a server that logs `Authorization`:
  - **Sends nothing:** `npm_config_//<host>/:_authToken`, lower and upper case.
  - **Sends the token:** `~/.npmrc`, literal or `${VAR}`; `~/.config/pnpm/auth.ini` with `${VAR}`; a file named by `NPM_CONFIG_USERCONFIG` or `npm_config_userconfig`.
  - **When the variable is not set:**
    - empty, every command works, and installs of `@enardo/*` get `401`;
    - unset, pnpm also warns `Failed to replace env in config`.
  - **No default syntax:** `${VAR:-}`, `${VAR?}` and `${VAR-}` are not supported. They warn even when the variable is set, and send no token.

  So Cambusa's dev image writes `/home/node/.npmrc` with `//npm.enriconardo.com/:_authToken=${ENARDO_NPM_TOKEN}`, a reference and not the token. Compose sets `ENARDO_NPM_TOKEN` (empty without the file), and `turbo.json` passes it through to every task (`globalPassThroughEnv`), because turbo's strict mode unsets it and every task's pnpm warned. In the container the variable is 300 characters long, like the file.
- **Cambusa's lockfile is seeded from `en-monorepo`'s.** A lockfile generated from scratch moved 96 third-party packages to newer versions (`turbo` 2.11.8, `@types/node` 26.6.5, `typescript-eslint` 8.71.2, …). Starting from `en-monorepo`'s lockfile instead keeps every resolved version:
  - the `projects/cambusa/` importers are renamed, and the `packages/*` ones dropped;
  - pnpm then resolves only `@enardo/*` afresh;
  - 480 packages, none at a version `en-monorepo` did not have.
  `enardo-packages`'s lockfile comes from pruning `en-monorepo`'s, with the same effect.
- **`allowBuilds`.** Cambusa's keeps `bcrypt`, `esbuild` and `mongodb-memory-server`. Neither lockfile has `protobufjs`.
- **Verdaccio after publishing.**
  - With the reader's token, `@enardo/errors`, `uow-repository-mongo` and `typescript-config` answer `200`; without a token, `401`.
  - A `PUT` of `@enardo/errors` 1.0.0 with the reader's token answers `403`, `user enardo-reader is not allowed to publish package @enardo/errors`, and the package keeps its one version. `npm publish` could not show this, because it stops on the existing version before sending anything.
- **Review follow-ups** (first review, 2026-10-16):
  - **Paths in the agent files.** `reviewer.md` and `arch-review`'s `SKILL.md`, in both repos, gave probes the path `/workspaces/en-monorepo`. Each now gives its own repo's mount.
  - **`http-status`'s `CLAUDE.md`.** In `enardo-packages`, it said that renaming or removing an export migrates every consumer in the same commit. This is the mechanism already fixed in `errors`'s `CLAUDE.md`. Now the projects' consumers are out of reach, and such a change is a new major. `git grep` for *same commit* and *every dependent* in the package `CLAUDE.md` files finds no third.
  - **0.x versions.** `enardo-packages`'s `CLAUDE.md` says that below 1.0.0 a breaking change is a new minor, since `^0.1.0` takes patches only.
  - **`arch-review` in Cambusa** no longer names `packages/errors/CLAUDE.md` as a model, since no package there has a `CLAUDE.md`.
  - **Backlogs.**
    - Cambusa's *production install* item says that its adapters now come from the registry, with their drivers beside them.
    - Both *Dockerfile* items say `[main]`.
    - Cambusa has a new item for the work `enardo-packages` hands over.
  - **ADR 0004** records the publishing decisions of step 1 and of *Decisions* (registry, licence, `workspace:^`, `publishConfig`, the read-only user). ADR 0001's status says that its `workspace:*` is superseded. Both are in `enardo-packages` too.
  - **The `workspace:` rule.** Both `CLAUDE.md` files say that project packages use `workspace:*` or `workspace:^`, as the api-server's manifest already did.
  - **`minimumReleaseAgeExclude`.**
    - The first install in Cambusa added the 20 `@enardo/*@<version>` to it ("loose mode allowed these immature versions"), and every release less than a day old would add another line.
    - One `'@enardo/*'` line replaces them. The review probed it: the install resolved, and nothing was added.
  - **`enardo-packages`'s `dev.sh` help and compose comment** no longer mention apps.
- **Second review follow-ups** (2026-10-16):
  - **The publish guarantee holds for pnpm only.** The review probed `npm publish --dry-run` (11.12.1 and 11.19.0) on a tarball with `publishConfig.registry`. npm goes to `--registry`, to `--@enardo:registry=`, and to a scope line in `~/.npmrc`; only a bare `registry=` leaves `publishConfig` in charge. pnpm 11.1.3 kept `publishConfig` in every case. ADR 0004 and `enardo-packages`'s `CLAUDE.md` now name `pnpm publish`, and say never to publish with npm.
  - **`arch-review` looked up history the new repos do not have.** On `en-monorepo`, the former-name lookup prints `packages/http` for `http-client`, and `projects/cambusa/packages/core` for `catalog` and `identity`; in a repo of one commit, it prints nothing. Without it, `/arch-review @enardo/http-client` misses three specs of the `http/` scope. The skill now runs the history lookups in the archived `en-monorepo` too, on the package's old folder.
  - Cambusa's hand-over item counts four items (the presets' `lib` too) and lists all eight specs that live in `enardo-packages`. Its production-install note covers the third point and all five adapters.
  - **Probes the review left open.**
    - After `./dev.sh clean`, `pnpm install --frozen-lockfile` and `verify:all --force` pass in Cambusa (51/51, no `Failed to replace env`), so the green state does not depend on the orphans of the first install.
    - `./dev.sh up -d` with another token file (`XDG_CONFIG_HOME` pointed elsewhere) recreated the container, and the variable in it went from 300 characters to 11. A second `up -d` with the real file recreated it again, at 300.

## Verification

There are no vitest tests: nothing here changes code. Checks:

- **`en-monorepo`.** `pnpm verify` on this branch after step 1.
- **`enardo-packages`.** `pnpm install --frozen-lockfile` and `pnpm verify:all` pass in its dev container, browser tests included. Each of the 20 packs with the expected `license`, `publishConfig` and caret ranges.
- **The registry.** After step 3, with the reader's token, `@enardo/errors` answers `200`. Without a token it answers `401`, and a publish with the reader's token answers `403`.
- **`cambusa`.**
  - `pnpm install --frozen-lockfile` from the registry and `pnpm verify:all` pass in its dev container, so lint runs with `@enardo/eslint-config` from the registry.
  - `pnpm dev` starts the api-server and the web app on 3010 and 5183. `POST /auth/authenticate` with an unknown user answers `401` against `cambusa-mongodb`.
  - No `@enardo/*` package resolves to a folder outside `node_modules`: `pnpm why` or the lockfile shows registry versions only.
- The `reviewer` reviews this branch, then the two new working trees, before checkpoint 2.

## Out of scope

- Changesets, versioning rules, a release process, and the check of what a package ships (decision of `chore/repo/package-files`).
- `repository` fields: the GitHub URL does not exist yet.
- Removing `en-monorepo`'s containers, images and volumes.
- The revision of the agent files (`CLAUDE.md`, `.claude/`), beyond what the split makes false.
