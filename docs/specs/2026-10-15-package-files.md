---
status: done
type: chore
packages: ["@enardo/*", "@cambusa/*"]
branch: chore/repo/package-files
---

# Ship only `dist/` from the library packages

## Why

The item *The library packages would ship their whole folder* of `docs/backlog.md`, from the second review of `chore/repo/arch-review-skill` (2026-10-14). The user takes it first on the way to moving the shared packages into a repo of their own, `en-packages`, published to a Verdaccio registry and consumed from there by each project's own repo (2026-10-15).

- Of the 30 library packages (20 shared, 10 of cambusa), only the two config packages have a `files` field. The other 28 pack their whole folder: `src/`, configs, `.turbo/` logs, `__tests__/`.
- Six of them have a `.gitignore` of their own that lists `dist/`, and pack no `dist/` at all. Five of those six keep a `pnpm deploy` of the api-server from starting (*A production install of the api-server*). The sixth, `http-client`, is a dependency of `@cambusa/web` only: no other manifest names it.

## Probes

They ran on `master` (`3fcc1e3`).

- **Setup.** A throwaway clone in the `en-probe-files` volume, in containers of the dev image (`en-monorepo-dev`: Node 24.21.0, pnpm 11.1.3), installed with `pnpm install --frozen-lockfile`. The registry consumer ran in `node:24-bookworm` (npm 11.19.0).
- **Builds.** `pnpm exec turbo run build --force` in the clone: every package, 30 tasks, none cached.
- **The change under probe.** In the clone, `"files": ["dist"]` inserted before `"exports"` in the 28 manifests, as the two config packages place theirs. No other line changes.

### What each package packs

`pnpm --filter <package> pack --dry-run --json`, files at the top level of the tarball:

| | Before | After |
| --- | --- | --- |
| `cqrs`, `api-contracts`, `config`, `error-codes` | `.turbo`, `dist`, `eslint.config.js`, `package.json`, `src`, `tsconfig.json` | `dist`, `package.json` |
| `events`, `id-generator`, `logger`, `password-hasher` | the same, plus `__tests__`, `vitest.config.ts` | `dist`, `package.json` |
| `database`, `database-mongo`, `env` | **no `dist`**; `.turbo`, `__tests__`, configs, `src` | `dist`, `package.json` |
| `errors`, `http-status`, `http-client` | **no `dist`**; `.turbo`, `CLAUDE.md`, `README.md`, `__tests__`, configs, `src` | `README.md`, `dist`, `package.json` |
| `email-nodemailer` | `dist`, `CLAUDE.md`, `README.md`, `.turbo`, `__tests__`, configs, `src` | `README.md`, `dist`, `package.json` |
| the other 13 with a README | `dist`, `README.md`, `.turbo`, configs, `src`, and `__tests__` except in `shared` | `README.md`, `dist`, `package.json` |

- **Sizes.** Before, from 9 files (`error-codes`) to 83 (`identity`). After, from 3 to 9: `config` packs 8 files under `dist/`, its three entry points and their chunks.
- **Every `exports` target is packed**, in all 28: 2 targets for a single entry point, 4 for `public` and `internal`, 6 for `config`.
- **`CLAUDE.md` no longer ships** from `errors`, `http-status`, `http-client` and `email-nodemailer`. It instructs agents working in the repo; a consumer has no use for it. pnpm adds the `README.md` by itself.
- **No source maps.** tsdown emits none: `dist/` holds `.mjs` and `.d.mts` files only, so nothing in a tarball points at the `src/` it leaves out.

### A registry consumer

The 18 shared packages packed in the clone (`pnpm --filter <package> pack`), and installed together with npm into an empty package, with `mongodb@^7.6.0`, `bcrypt@^5.1.1`, `nodemailer@^10.1.0`, `typescript@^5.9.3` and `@types/node@^26.4.0`.

- Each installed package holds `dist/` and `package.json` only, plus its README when it has one. pnpm's pack turns `workspace:*` into the exact version, and npm satisfies it with the tarball installed beside it.
- A file that imports all 18 typechecks with `skipLibCheck: false`, under `nodenext` and under `bundler`, so their declarations resolve one another from the installed packages.
- `import()` of each of the 18 loads. **Amended after review**: the first version said that npm 11.19.0 did not run `bcrypt`'s install script. It warns (`install-scripts … not yet covered by allowScripts`) and runs it anyway: the consumer has `bcrypt/lib/binding/napi-v3`, and `@enardo/password-hasher`'s `BcryptPasswordHasher` hashes (`$2b$…`) and compares (`true`) through it.

### A deploy of the api-server

`pnpm --filter @cambusa/api-server deploy --legacy --prod <dir>` in the clone, then `node dist/main.mjs` against a `mongo:8.0` replica set on a throwaway network, with `MONGO_DB_URI`, `API_HOST`, `API_PORT` and `NODE_ENV=development`.

- **Before**: the deploy succeeds, and `@enardo/errors` holds `CLAUDE.md`, `README.md`, `__tests__`, `eslint.config.js`, `package.json`, `src`, `tsconfig.json` and `vitest.config.ts`, with no `dist`. The server stops at start, with `ERR_MODULE_NOT_FOUND` on `@enardo/http-status/dist/index.mjs`, imported through `@cambusa/api-contracts`.
- **After**: no `src/` or `__tests__/` folder under the deployed `@enardo/*` and `@cambusa/*` packages (30 before). The server logs `Server listening.`; `POST /auth/authenticate` with an unknown user answers `401`, an unknown path `404`, and the replica set gains a `cambusa` database. This closes what the backlog left unprobed: that the deploy listens against a running replica set.
- Both deploys warn about an unmet peer: `@ts-rest/express` 3.52.1 wants `express ^4.0.0`, and the api-server has 5.2.1. That is the backlog's ts-rest item, unchanged here.

### The workspace

A consumer in the workspace links to the package's own folder, so `files` does not change what the workspace resolves: consumers still read `dist/` through `exports`. Run in the repo by `pnpm verify`, which re-checks every package, since all 28 manifests change.

### The six per-package `.gitignore` files

**Added at Checkpoint 1**, when the user asked to remove them. `database`, `database-mongo`, `env`, `errors`, `http-client` and `http-status` each have one, listing `dist/`, `node_modules/` and `.eslintcache`.

- The root `.gitignore` lists `dist/` and `node_modules/`. It does not list `.eslintcache`, which only `eslint --cache` writes: `git grep` finds `--cache` in no script, and the repo holds no `.eslintcache` outside `node_modules`.
- In the clone, with `files` applied and every package built, removing the six leaves `git status --porcelain --ignored` the same, line for line (93 ignored or untracked entries), apart from the six deletions, and the pack list of every package the same.

## Changes

1. `"files": ["dist"]` in the `package.json` of the 28 library packages, before `"exports"`. The two config packages keep theirs.
2. The six per-package `.gitignore` files are removed.
3. Root `CLAUDE.md`, *Code conventions*: library packages, shared and project-specific, declare `"files": ["dist"]`, next to the `sideEffects` rule, and the config packages list their own files.
4. **Added after review.** `.claude/skills/arch-review/SKILL.md` said that a package's own `.gitignore` changes what `pnpm pack` ships. Under `files` it does not: the review added a `.gitignore` listing `dist/`, `*.d.mts` and `README.md` to `@enardo/errors`, then an `.npmignore` listing `*.d.mts`, and its pack list stayed the same. The skill now says it matters only without a `files` field.
5. At integration, the backlog item *The library packages would ship their whole folder* leaves `docs/backlog.md`, and *A production install of the api-server* says that a deploy now starts and serves (the repo still has no production install of its own).

### Out of scope

- **Everything publishing needs beyond the file list**: `private`, versions, `workspace:^`, `publishConfig`, a registry. They belong to the move to `en-packages`.

## Test cases

None in vitest: the change is to manifests, which no test reads. The check is the probe above, run again on the branch at the end:

- `pack --dry-run --json` of each of the 28 lists `package.json`, `dist/` and, where the package has one, `README.md`, and nothing else;
- every `exports` target is in that list;
- `pnpm deploy --legacy --prod` of the api-server starts and answers `401` on `POST /auth/authenticate` against a replica set.

A package added later without the field would go unnoticed until it is packed. At Checkpoint 1 the user chose not to add a check of the field to `pnpm verify` for now: the release process of `en-packages` is where a check of what a package ships belongs.
