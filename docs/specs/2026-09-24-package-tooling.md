---
status: done
type: chore
packages: [repo]
branch: chore/repo/package-tooling
---

# Shared package tooling

## Goal

One TypeScript, ESLint and build configuration for every package in the monorepo, defined once, versioned like code, and stricter than today where the cost is known and bounded.

## Problem

Issue 10 of the `@enardo/http-status` review (spec `2026-09-24-harden-http-status`), measured across all 30 workspace packages:

1. **Every package carries its own copy of every config, and the copies have drifted.**
   - `tsconfig.json`: 9 variants. 5 packages set `rootDir: "./src"` and `include: ["src/**/*"]`, the others include `__tests__`; `env` has no `~/*` alias; `http` adds DOM libs; `identity` includes `../config/src/config.ts`, a leftover of a "wip" commit (typecheck passes without it).
   - `eslint.config.js`: 5 variants. 12 packages pass `project: "./tsconfig.json"` to a config that uses no type information, which only slows lint; the others pass a `tsconfigRootDir` that has no effect.
   - `vitest.config.ts`: 3 variants, all with `globals: true` (no test relies on it: every test file imports from `vitest`) and `__dirname`, which Vite flags as unsupported by its native config loader.
2. **TypeScript versions differ**: 14 packages on `~5.8.3`, 16 on `^5.9.3`.
3. **ESLint is not type-aware**, so a whole class of bugs goes unchecked. Enabling `recommendedTypeChecked` + `stylisticTypeChecked` reports about 185 findings, among them 15 `no-floating-promises` and 10 `no-misused-promises` in `api-server` and `web`: unhandled rejections in React effects, event handlers and process signal handlers.
4. **The compiler is less strict than it could be at no cost.** Extra flags, measured per package:

   | Flag | Errors | Nature |
   | --- | --- | --- |
   | `isolatedModules` | 0 | required by tsdown/Vite semantics anyway |
   | `noImplicitOverride` | 0 | |
   | `noFallthroughCasesInSwitch` | 0 | |
   | `verbatimModuleSyntax` | ~205 | missing `import type`, which the root CLAUDE.md already requires; autofixable |
   | `noUncheckedIndexedAccess` | 32 | each one a potential `undefined` read |
   | `exactOptionalPropertyTypes` | ~81 | invasive, low value per error |
   | `noPropertyAccessFromIndexSignature` | 48 | style only |

5. **`build` scripts run `npm run clean`** in 28 packages. `tsdown` already cleans its output directory by default, and the monorepo's package manager is pnpm.
6. **No package declares `sideEffects`**, so bundlers cannot drop unused modules of workspace libraries from the web bundle with certainty.

## Design

### Configs as workspace packages

Two new packages hold the shared configuration:

- **`@enardo/typescript-config`** (`packages/typescript-config`): JSON only.
  - `base.json`: the compiler options every package shares.
  - `library.json`: extends `base.json`; for packages built with tsdown (`~/*` alias, `src` + `__tests__`).
  - `node-app.json` and `react-app.json`: for `api-server` (built with `tsc`) and `web` (Vite, JSX, DOM).
- **`@enardo/eslint-config`** (`packages/eslint-config`): exports `library` and `react` flat-config arrays, built on `recommendedTypeChecked` + `stylisticTypeChecked` with `projectService`.

Each package `extends` / imports them and depends on them with `workspace:*`.

**Why packages rather than files at the repo root:** turbo only knows what a package depends on. A root `tsconfig.base.json` changes nothing in the dependency graph, so `pnpm verify` (`--filter=...[master]`) would not re-check any package when the base changes. As a dependency, a change to the shared config re-runs `lint` and `typecheck` on every package that uses it. This is also the layout turbo documents for shared configs.

The config packages have no `src/index.ts`, no `dist` and no build: they are consumed as source. The root CLAUDE.md gets this exception.

### Local overrides

The shared configs are defaults, not a cage:

- A package may override an option or a rule in its own file, with a comment saying why (for example `http` adding the DOM libs).
- An override that appears in two or more packages moves into a preset of the config package.
- When the shared config gets stricter (a new rule, a typescript-eslint major), a package may keep the old behavior through a temporary override, so an upgrade never has to fix all 30 packages at once.

The READMEs of the two config packages and the root CLAUDE.md state this rule.

### Compiler options

`base.json` keeps today's options (`strict`, ES2022, `moduleResolution: bundler`, ESM) and adds `isolatedModules`, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `noImplicitOverride` and `noFallthroughCasesInSwitch`.

Left out, deliberately: `exactOptionalPropertyTypes` (81 errors spread across domain types, where the distinction between missing and `undefined` rarely matters here) and `noPropertyAccessFromIndexSignature` (style).

### Lint rules

`recommendedTypeChecked` + `stylisticTypeChecked`, plus `@typescript-eslint/consistent-type-imports` (the autofix for `verbatimModuleSyntax`). In `__tests__/**`, `@typescript-eslint/require-await` is off: 79 of its 89 findings are `async` mocks implementing Promise-returning interfaces, which is the idiomatic way to write them.

Findings are fixed, not suppressed. For a floating promise:

- if the async function already handles its own errors, mark it with `void`;
- otherwise add the missing handling.

The commit body lists which was done where.

### Versions

A pnpm **catalog** in `pnpm-workspace.yaml` holds the version of every shared dev dependency: `typescript`, `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-config-prettier`, `globals`, `prettier`, `vitest`, `tsdown`, `@types/node`. Packages reference them as `catalog:`. TypeScript is aligned on 5.9.

### Remaining fixes

- `build`: `tsdown …` without `npm run clean &&`; the `clean` script stays for manual use.
- `vitest.config.ts` and `vite.config.ts`: drop `globals: true`, use `import.meta.dirname`. They stay per package: 13 lines in two variants (plain, in-memory Mongo) do not justify a third shared package.
- `sideEffects: false` on every library package (not on the two apps), after checking that none runs code at module load beyond pure declarations.
- `identity`: drop the `../config/src/config.ts` include.

### Decisions (to confirm at checkpoint 1)

1. **Two config packages under `packages/`**, named `@enardo/typescript-config` and `@enardo/eslint-config`, rather than root-level files. The trade-off: 30 `package.json` files gain a dev dependency, in exchange for a correct `pnpm verify`. Rigidity is bounded by the *Local overrides* rule.
2. **Stricter compiler**: the five flags above, including `noUncheckedIndexedAccess` (32 manual fixes); `exactOptionalPropertyTypes` stays off.
3. **Type-aware lint** with `recommendedTypeChecked` + `stylisticTypeChecked`, `require-await` off in tests only.
4. **pnpm catalog** for shared dev dependencies.
5. **Vitest configs stay local**, only cleaned up.

## Scope

1. `pnpm-workspace.yaml`: catalog; every `package.json`: `catalog:` for the dev dependencies above.
2. `packages/typescript-config`, `packages/eslint-config`: new, each with `package.json`, a short README and the config files.
3. Every package: `tsconfig.json` extends a shared config and keeps only what is its own (`outDir`, paths, extra includes); `eslint.config.js` re-exports a shared config; scripts per *Remaining fixes*; `sideEffects` where applicable.
4. Source changes forced by the new flags and rules: `import type` (autofix), `noUncheckedIndexedAccess` fixes, type-aware lint fixes.
5. Root CLAUDE.md: the config packages in *Layout*, their exception to the `src/index.ts` → `dist` rule, the local-override rule and the catalog rule for dev dependencies.

## Out of scope

- `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`.
- A shared vitest config, a shared prettier config (prettier runs with defaults everywhere, consistently).
- Upgrading any dependency beyond aligning TypeScript.
- Behavior changes other than the error handling that floating-promise fixes add.

## Test plan

This is tooling: no new unit tests. Behavior is checked by what already exists, plus build-output comparison:

1. `pnpm verify:all` green at the end of every step (not `verify`: until packages depend on the config packages, the affected-package filter does not see config changes).
2. **Build output unchanged**: before the first step, build every package and keep a copy of each `dist/`. After the last step, rebuild and diff. Expected differences: none in `.d.mts`; in `.mjs`, only what the source fixes of steps 6–8 intentionally changed.
3. **The graph works**: on the final branch, a whitespace change in `packages/typescript-config/base.json` makes `turbo run typecheck --filter=...[HEAD]` select every package (dry run).
4. `pnpm cambusa:build` succeeds, and `pnpm cambusa:dev` starts API and web.
5. Existing tests are only touched where lint fixes require it (type assertions, unbound methods), without changing what they assert.

## Plan

One commit per step, each green:

1. Spec.
2. Catalog, TypeScript aligned on 5.9, `pnpm install`.
3. `@enardo/typescript-config` with today's options; every tsconfig migrated; the identity include removed. No behavior change.
4. Add the zero-cost flags: `isolatedModules`, `noImplicitOverride`, `noFallthroughCasesInSwitch`.
5. `@enardo/eslint-config` with today's rules; every eslint config migrated.
6. `consistent-type-imports` + `verbatimModuleSyntax`, autofixed.
7. `noUncheckedIndexedAccess`, fixed by hand.
8. Type-aware lint: shared packages first, then `api-server` and `web` (the floating/misused promises) in their own commit.
9. Scripts, vitest/vite configs, `sideEffects`.
10. Docs: root CLAUDE.md, READMEs of the two config packages.
11. Build-output diff, review, checkpoint 2.

## Risks

| Risk | Mitigation |
| --- | --- |
| Type-aware lint is slower | turbo caches `lint` per package; measure lint time before and after and report it |
| A floating-promise fix changes UI behavior | fixes that add handling (not `void`) are listed in the commit body and checked by starting the app |
| `sideEffects: false` drops a module that does have side effects | per-package check before adding it; the web build and a start of the app |
| `verbatimModuleSyntax` changes emitted JS | the build-output diff (test plan 2) catches any import that stops being elided |
| A large diff hides a real change | mechanical steps (autofix, migrations) are separate commits from hand-written fixes |

## Implementation notes

Decided during implementation, after the spec was approved:

1. **The ESLint presets are `node` and `react`**, not `library` and `react`: the split is by runtime (globals, JSX), and `api-server` uses the Node one too.
2. **`require-await` is off everywhere**, not only in tests. Its production findings were all methods implementing Promise-returning interfaces with nothing to await; removing `async` would turn their errors from rejections into synchronous throws.
3. **More rule settings than planned**, each commented in the preset: `prefer-nullish-coalescing` ignores strings (every finding was a `value.trim() || undefined` where `??` would be a bug), and tests turn off `no-unsafe-assignment` and `unbound-method` (asymmetric matchers are `any`; `expect(mock.method)` is unbound by design).
4. **`no-unnecessary-type-assertion`'s autofix breaks the build** where a cast steers generic inference: it removed `{ … } as XAttributes` from 19 `rehydrate`/`create` calls and a cast on `Object.entries`, and 13 files stopped typechecking. Those casts became explicit type arguments. The root cause is in `@enardo/entities`: `rehydrate`/`create` infer the attributes from the literal instead of from the class. Fixing the signature is a public API change of that package, left to a follow-up.
5. **turbo's `lint` depends on `^build`.** Type-aware lint reads upstream declarations; without the dependency it raced a rebuild and reported unresolved types.
6. **One behavior change in `web`**: `request()` turns the `NetworkError` thrown when the server is unreachable into an `ApiFailure` with status 0. Before, the rejection escaped every form handler and forms stayed stuck in their submitting state while offline.
7. **`@enardo/http`: `RequestOptions.query` is `Record<string, QueryValue>`** instead of `Record<string, unknown>`, so an object can no longer be stringified to `[object Object]`. Its only caller already passed primitives.
8. **`noUncheckedIndexedAccess`**: production code (4 reads, all in `MongoDataStore`) got real checks, including a `MISSING_COLLECTION_CHANGES` error for a change set that breaks its contract; tests take `!` at the index, the idiom they already used.
9. **The catalog holds the tooling only** (`typescript`, `eslint`, `prettier`, `vitest`, `tsdown`, …); runtime and test dependencies shared by a few packages (`mongodb-memory-server`, `@types/bcrypt`) are not in it yet.
10. **Lint cost**: a full lint without cache goes from 18 s to 61 s; `pnpm verify` lints only affected packages, with turbo's cache.

Found along the way, not fixed here:

- **`api-server`'s `build` output does not run.** It is compiled by `tsc`, which rewrites neither the `~/` alias nor extensionless relative imports: `node dist/main.js` fails with `ERR_MODULE_NOT_FOUND`. Only `dev` (tsx) works today.
- **`@cambusa/culinary` warns that tsdown could not emit its declarations** (`dts.eager`); the warning predates this branch.
