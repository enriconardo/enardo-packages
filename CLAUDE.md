# enardo-packages

Personal TypeScript monorepo of reusable infrastructure packages (`@enardo/*`), published to a private registry. The projects built on them live in repos of their own and install them from there. Solo developer.

## Layout

```
packages/<name>             @enardo/<name>, shared, project-agnostic libraries
packages/typescript-config  tsconfig presets (library, node-app, react-app, runtime-browser, runtime-node)
packages/eslint-config      ESLint presets (node, react, runtimeNeutral)
packages/vitest-config      vitest presets (the browser test project, the Mongo replica set)
docker/                     dev container, test browsers, compose stack (docker/README.md)
scripts/                    workflow scripts, and clean.sh
docs/adr/                   architecture decision records
.workflow/backlog.md        work queued or to evaluate, in order
.workflow/specs/            task specs
```

Workspaces are declared in `pnpm-workspace.yaml`; internal dependencies use `workspace:^`. Shared dev tooling takes its version from the `catalog:` there: a package references `"catalog:"`, never a range of its own.

## Development environment

All the work happens in the `dev` container, which VS Code creates from `.devcontainer/devcontainer.json` with the repo in a Docker volume (*Dev Containers: Clone Repository in Container Volume*; [docker/README.md](docker/README.md) has the setup). node, pnpm, turbo, git and Claude Code run in its terminal, with no wrapper: `pnpm --filter @enardo/logger test`.

- **The container is the only place that runs pnpm.** `mongodb-memory-server` is a native module: an install from two environments into one `node_modules` breaks it. Recovery: `bash scripts/clean.sh` (it removes every `node_modules` and `dist`; not a pnpm script, since it removes pnpm's own `node_modules`), then `pnpm install`. The registry is the one exception: a throwaway container started from WSL, not pnpm in WSL (the `publish` skill).
- **A firewall denies outbound traffic** except to an allow list (GitHub, the npm registry, Claude's and VS Code's hosts, the Mongo download). A host that is refused is added in `docker/dev/init-firewall.sh`; `sudo /usr/local/bin/init-firewall.sh` refreshes the addresses ([docker/README.md](docker/README.md)).
- **Never `npm i` in the dev container**, which can move files of `node_modules`: a probe that needs a package outside the lockfile runs in a temporary folder outside the repo (`probe_env`).
- **The repo's volume is the only copy of what is not pushed**: push a branch, work in progress included, before anything removes the volume.
- **After a change to `docker/`**, the human runs *Rebuild Container*, which rebuilds both services; then `pnpm verify:all --force`, since turbo's key holds neither the image nor the compose file.
- Browser tests run in the `playwright` service ([docker/README.md](docker/README.md)).

## Tooling & commands

- Every package has the scripts `build`, `dev`, `lint`, `lint:fix`, `format`, `format:check`, `typecheck`, `test` (where tests exist): turbo skips a package without one, silently. The config packages have at most lint and format.
- Every `tsconfig.json` and `eslint.config.js` uses a preset of `@enardo/typescript-config` or `@enardo/eslint-config`. A package may override an option or a rule, with a comment saying why. A list, an object or several options that a second package needs move into a preset; a scalar is repeated with its comment, unless it fits every package on a preset (ADR 0011).
- The compiler is strict (`noUncheckedIndexedAccess` included) and ESLint type-aware, so `lint` depends on the upstream builds. Fix findings, don't suppress them; in production code an unchecked index gets a real check, not `!`.
- Packages are consumed through their `dist/`: after changing one, build it and its consumers' dependencies (`pnpm exec turbo run build --filter=<consumer>...`) before checking the consumers.
- `pnpm verify` runs shellcheck, the playwright version check and the context-size check, then `format:check`, `lint`, `typecheck` and `test` on the packages changed against `main` and their dependents (`verify:all`: every package). It is the config's `verify`.
- **A cached result is only as fresh as turbo's key.** A task whose outcome depends on something outside it (a running container, a passed-through variable, a file no `inputs` or `globalDependencies` names) gets an uncached check of its own, or a rule saying what to re-run.

## Publishing

Packages are published through the `publish` skill, each publish approved by the user. The container packs; the registry token never enters it, so the human runs the publish commands from WSL, which the skill gives filled in. A published version never changes: a breaking change is a new major (a new minor below 1.0.0).

## Architecture conventions

- **Ports & adapters**, where the app picks the technology or provides its driver: a contract package defines interfaces and technology-agnostic logic (`email`), with no technology; a `<name>-<technology>` package implements it (`email-nodemailer`). Otherwise one package, named for its role, hides the technology (`logger`) until a second implementation, or a driver the app must provide, calls for a split.
- A driver (`mongodb`, `nodemailer`) and the contract an adapter implements are peer and dev dependencies of the adapter. An app lists both for every adapter it runs in its own `dependencies`, since pnpm never reports a missing one; another package, only when its own code runs it. Every package of an app takes a contract on one specifier, a catalog entry in a workspace (ADR 0013).
- `@enardo/*` packages never depend on a project's packages.
- A package logs only what its caller cannot see, at `debug` or `warn`, and takes no `logger` without a log point (ADR 0014).
- One entry point, `src/index.ts` → `dist/index.mjs` + `.d.mts`; the config packages ship their files as they are.
- An error a caller may handle by `code` extends `BaseError` from `@enardo/errors`; misuse and misconfiguration throw native errors. A concrete class declares its `name` as a field and its codes with `declare readonly code`; a code belongs to one concrete class across packages. Recognize an error with `isBaseErrorLike` and its `code`, never `instanceof BaseError`; `instanceof` with a specific class only as ADR 0012 point 3 and ADR 0013 say ([its README](packages/errors/README.md)).

## Code conventions

- Files in kebab-case with a role suffix: `product.entity.ts`, `create-product.handler.ts`, `*.node.test.ts`.
- `~/*` is aliased to `src/*` in each package.
- `import type` for type-only imports, as a separate statement next to a default import: `import x, { type T }` compiles to `import x, {}`.
- Library packages declare `"sideEffects": false` (nothing runs at load beyond declarations) and `"files": ["dist"]`.
- Each folder re-exports its public surface through an `index.ts`. JSDoc on the public API; comments explain *why*.
- A README names only packages its package depends on: a contract's README describes its implementations without naming them.
- A type guard narrows only to what its runtime check proves ([ADR 0003](docs/adr/0003-type-guards-claim-only-what-they-check.md)).
- Find every use of a symbol with `git grep`, not `grep --include`, which skips the extensions you didn't list. A glob in its pathspec matches the whole path: `'packages/*/src'` matches nothing, with no error; a folder is `'packages/*/src/*'`.
- Match the surrounding code; no new libraries without asking.

## Testing

- Tests live in `<package>/__tests__/`, mirroring `src/`, as `*.test.ts`. Adapters are tested against an in-memory Mongo replica set that the tests start (`mongoReplicaSet()` of `@enardo/vitest-config`, one database per test).
- A package whose `src/` runs in browsers runs its tests there too; the presets (`@enardo/vitest-config`, the runtime programs of `typescript-config`, `eslint-config`'s `runtimeNeutral`) hold those checks; `@enardo/http-client` is the example ([its CLAUDE.md](packages/http-client/CLAUDE.md), *Checks*). A test that needs Node goes in a `*.node.test.ts` beside its `*.test.ts`.
- Refactors keep the existing tests green without changing them, unless the spec says so.

**Test-first**, unless the spec says otherwise, with a reason:

- A bug fix starts with a test that reproduces the bug and fails with its symptom.
- The public API of `@enardo/*` and domain logic are test-first. Wiring may be tested after.
- A test written first fails for the expected reason, and asserts what identifies it (the class, `code`, `details`): `rejects.toThrow(undefined)` accepts any error.

## Workflow

Every task runs through Workflow Overload: `/overload <request>`, with the project's settings in `.workflow/config`.

**Records.** Specs are frozen after merge, and read only when the user, the current spec or a backlog item points to one: the current truth is in READMEs and `CLAUDE.md` files. `docs/adr/` holds decisions beyond one task.

### Branches and commits

- **Branch:** `<type>/<scope>/<description>`, with `<ticket-id>-` before the description for a ticket (`fix/uow-repository/EN-209-snapshot-diff`). Types: `feature` (new packages too), `fix`, `hotfix`, `refactor` (no behavior change), `test`, `docs`, `chore` (dependencies, config, tooling). Scope: a package's name without `@enardo/`, an alias when too long (`ds-components`), or `repo`. Description: kebab-case, a few words, never just a package name.
- **Commit:** `[<scope>] <type>: <summary>`, or `[<scope>][<ticket-id>] <type>: <summary>`, the scope being the full package name or `repo`. Types: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `ci`, `chore`. Summary imperative, lowercase, no trailing period, ideally ≤ 50 characters; a body wrapped at 72 when the *why* is not obvious. One logical change per commit, never a red state.
- The `commit-msg` hook (`.githooks/`) refuses a subject over 72 characters, on commit and merge: never `--no-verify` past it.
