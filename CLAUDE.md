# enardo-packages

Personal TypeScript monorepo of reusable infrastructure packages (`@enardo/*`), published to a private registry. The projects built on them (currently `cambusa`) live in repos of their own and install them from there. Solo developer.

## Layout

```
packages/<name>             @enardo/<name>, shared, project-agnostic libraries
packages/typescript-config  tsconfig presets (library, node-app, react-app)
packages/eslint-config      ESLint presets (node, react)
docker/                     dev container, test browsers, compose stack (./dev.sh; docker/README.md)
scripts/                    workflow scripts
docs/specs/                 task specs
docs/adr/                   architecture decision records
docs/backlog.md             work queued or to evaluate, in order
```

Workspaces are declared in `pnpm-workspace.yaml`; internal dependencies use `workspace:^`. Shared dev tooling takes its version from the `catalog:` there: a package references `"catalog:"`, never a range of its own.

## Development environment

Every command that touches `node_modules` runs in the `dev` container. The host runs the rest (the editor, git, Claude Code), and package commands go through `./dev.sh exec` (`./dev.sh exec pnpm --filter @enardo/uow-repository test`).

```
./dev.sh up [-d]             # start the dev container and test browsers; no -d: a shell
./dev.sh shell [service]     # a shell in a service (default: dev)
./dev.sh exec <command>      # run one command in the dev container
./dev.sh logs [service...]   # follow logs (default: every service)
./dev.sh down [service]      # everything, or one service: 'down dev'
./dev.sh clean               # remove every node_modules and dist
```

- **Never run `pnpm` on the host.** `bcrypt` and `mongodb-memory-server` are native modules: installs from two environments into one `node_modules` break them. Recovery: `./dev.sh clean`, then `./dev.sh exec pnpm install`. The one exception is publishing (the `publish` skill).
- **A probe that needs a package outside the lockfile** runs in a throwaway container, never in the dev container, where an `npm i` can move files of `node_modules`. It mounts the repo read-only, to read built `dist/` files:
  ```
  docker run --rm -v "$PWD":/workspaces/enardo-packages:ro -v en-probe:/probe -w /probe node:24-bookworm \
    sh -c 'npm init -y && npm i <packages>'    # more runs: same mounts
  docker volume rm en-probe                   # when done
  ```
- Mongo-backed tests start their own in-memory replica set. Browser tests run in the `playwright` service: see [docker/README.md](docker/README.md), which also says what the containers never mount.
- The repo is mounted at `/workspaces/enardo-packages` in the container. The pnpm store, `.pnpm-store/`, sits beside `node_modules` so that packages are hard-linked: deleting it means redownloading everything.

## Tooling & commands

- Every package has the scripts `build`, `dev`, `lint`, `lint:fix`, `format`, `format:check`, `typecheck`, `test` (where tests exist): turbo skips a package without one, silently. The config packages have at most lint and format.
- Every `tsconfig.json` and `eslint.config.js` uses a preset of `@enardo/typescript-config` or `@enardo/eslint-config`. A package may override an option or a rule, with a comment saying why; an override two packages need moves into the preset.
- The compiler is strict (`noUncheckedIndexedAccess` included) and ESLint type-aware, so `lint` depends on the upstream builds. Fix findings, don't suppress them; in production code an unchecked index gets a real check, not `!`.
- Packages are consumed through their `dist/`: after changing one, build it and its consumers' dependencies (`pnpm exec turbo run build --filter=<consumer>...`) before checking the consumers.
- `pnpm verify` runs shellcheck, the playwright version check and the context-size check, then `format:check`, `lint`, `typecheck` and `test` on the packages changed against `main` and their dependents (`verify:all`: every package). It runs at the steps that name it (the S path, the `implement` skill), and `integrate.sh` runs it before the merge.
- **A cached result is only as fresh as turbo's key.** A task whose outcome depends on something outside it (a running container, a passed-through variable, a file no `inputs` or `globalDependencies` names) gets an uncached check of its own, or a rule saying what to re-run.

## Publishing

Packages go to the private registry `https://npm.enriconardo.com` (`publishConfig.registry`) through the `publish` skill, never with npm, each publish approved by the user. A published version never changes: a breaking change is a new major (a new minor below 1.0.0).

## Architecture conventions

- **Ports & adapters**: a contract package defines interfaces and technology-agnostic logic (`uow-repository`, `email`); a `<name>-<technology>` package implements it (`email-nodemailer`).
- A contract package never depends on a technology. A driver (`mongodb`, `bcrypt`, `nodemailer`) is a peer and a dev dependency of its adapter. A project's app lists the driver of every adapter it runs in its own `dependencies`, since pnpm reports nothing when one is missing; any other package lists a driver only when its own code runs it.
- `@enardo/*` packages never depend on a project's packages.
- One entry point, `src/index.ts` → `dist/index.mjs` + `.d.mts`; the config packages ship their files as they are.
- Errors extend `BaseError` from `@enardo/errors`: a concrete class declares its `name` as a field and passes a `code` ([its README](packages/errors/README.md)).

## Code conventions

- Files in kebab-case with a role suffix: `product.entity.ts`, `create-product.handler.ts`, `*.node.test.ts`.
- `~/*` is aliased to `src/*` in each package.
- `import type` for type-only imports, as a separate statement next to a default import: `import x, { type T }` compiles to `import x, {}`.
- Library packages declare `"sideEffects": false` (nothing runs at load beyond declarations) and `"files": ["dist"]`.
- Each folder re-exports its public surface through an `index.ts`. JSDoc on the public API; comments explain *why*.
- A README names only packages its package depends on: a contract's README describes its implementations without naming them.
- A type guard narrows only to what its runtime check proves ([ADR 0003](docs/adr/0003-type-guards-claim-only-what-they-check.md)).
- Find every use of a symbol with `git grep`, not `grep --include`, which skips the extensions you didn't list.
- Match the surrounding code; no new libraries without asking.

## Testing

- Tests live in `<package>/__tests__/`, mirroring `src/`, as `*.test.ts`. Adapters are tested against the in-memory Mongo replica set (`__tests__/setup/replica-set.ts`, one database per test).
- A package whose `src/` runs in browsers runs its tests there too (`errors` and `http-status` not yet: backlog); `@enardo/http-client` is the reference ([its CLAUDE.md](packages/http-client/CLAUDE.md), *Checks*). A test that needs Node goes in a `*.node.test.ts` beside its `*.test.ts`.
- Refactors keep the existing tests green without changing them, unless the spec says so.

**Test-first**, unless the spec says otherwise, with a reason:

- A bug fix starts with a test that reproduces the bug and fails with its symptom.
- The public API of `@enardo/*` and domain logic are test-first. In M and L the `test-author` writes the initial suite from the spec, and records it. The main agent changes one of its tests only where it is wrong, saying why in the commit body, and writes the tests of review follow-ups, seeing each fail first. Wiring may be tested after.
- A test written first fails for the expected reason, and asserts what identifies it (the class, `code`, `details`): `rejects.toThrow(undefined)` accepts any error.
- A wrong implementation is tried on a copy of the package outside the repo, never by editing the working tree and reverting it: `git checkout` and `git stash` take uncommitted work with them.

## Workflow

At intake the main agent, on Opus, gives the `spec` skill's brief and proposes a tier; the user confirms or changes it. A question or discussion is no task until it leads to a change. A task that turns out bigger changes tier, and the user is told.

The table is the floor: a `high` among the brief's four ratings makes the task L.

| Tier | What | Steps |
| --- | --- | --- |
| S | nothing a consumer sees changes (public API, documented behavior, dependency ranges), or docs, config, tooling only; one package or area | branch → change → verify → ⏸ 2 → integrate. No spec (the intent goes in the commit body), no subagent |
| M | what a consumer sees changes | branch → spec → ⏸ 1 → model, `/clear`, `/implement` → ⏸ 2 → integrate |
| L | a new package, a change across packages, the dev environment or the workflow; a `high` rating | as M, with an ADR for a decision that outlives the task |

1. **Branch**: `scripts/task-start.sh <branch>`, from an up-to-date `main`.
2. **Spec**: with the `spec` skill, as the branch's first commit; then the `critic`, on an L spec or an M spec whose *Why* says it or a decision comes from a discussion with the user, and again after the user changes a decision it judged.
3. **⏸ Checkpoint 1**: the user approves the spec before any production code, then sets the model and effort of its `implementer`, `/clear`, and `/implement <spec>`.
4. **Implement, review, ⏸ checkpoint 2**: the `implement` skill, in that fresh session. An S task: verify, then the summary and the diff, and wait for the go-ahead.
5. **Integrate**, when verify is green (dependents included) and the README follows the public API: the spec `done`, then `scripts/integrate.sh` (verify, `merge --no-ff`, branch deleted). No PRs. Publishing and follow-ups go in a session of their own, on the user's model.
6. **Learn**, at checkpoints 1 and 2, for a problem that could recur and costs more than its rule costs to read: propose it, on the task's branch. Prefer a check, script, hook or lint rule; else the agent, skill or package `CLAUDE.md` it applies to; this file only for what every task needs. The rule, not its story. `scripts/check-context-size.sh` caps this file at 12 000 bytes and each agent at 6 000: a new rule merges with or replaces an old one.

Roles: the main agent holds the intent; the `critic` starts from the spec alone, the `test-author` from the spec and the `reviewer` from the spec and the diff, in fresh contexts, so they don't share the author's blind spots; `pnpm verify` cannot talk itself into accepting a failure.

**Records.** Specs are frozen after merge, and read only when the user, the current spec or a backlog item points to one: the current truth is in READMEs and `CLAUDE.md` files. `docs/adr/` holds decisions beyond one task.

### Branches and commits

- **Branch:** `<type>/<scope>/<description>`, with `<ticket-id>-` before the description for a ticket (`fix/uow-repository/EN-209-snapshot-diff`). Types: `feature` (new packages too), `fix`, `hotfix`, `refactor` (no behavior change), `test`, `docs`, `chore` (dependencies, config, tooling). Scope: a package's name without `@enardo/`, an alias when too long (`ds-components`), or `repo`. Description: kebab-case, a few words, never just a package name.
- **Commit:** `[<scope>] <type>: <summary>`, or `[<scope>][<ticket-id>] <type>: <summary>`, the scope being the full package name or `repo`. Types: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `ci`, `chore`. Summary imperative, lowercase, no trailing period, ideally ≤ 50 characters; a body wrapped at 72 when the *why* is not obvious. One logical change per commit, never a red state.
- The `commit-msg` hook (`.githooks/`) refuses a subject over 72 characters, on commit and merge; enable it once per clone, on the host: `git config core.hooksPath .githooks`. Never `--no-verify` past it.
