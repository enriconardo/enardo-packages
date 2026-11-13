# Task journal

branch: chore/repo/upgrade-typescript-6
tier: L
phase: close/review
base: 4ce8080
started: 2026-11-13T15:42:10Z
review_rounds: 0
verify_red_streak: 0
escalations: 0

spec: .workflow/specs/2026-11-13-upgrade-typescript-6.md

spec_review_rounds: 2

step_review_rounds: 5

## Intent

### Intent: upgrade TypeScript to 6.0.3

#### Problem
The human asked to upgrade everything to the latest TypeScript (7.0.2). Probes (2026-11-13) found TS 7 has no JS compiler API: typescript-eslint 8.72.2 (peer `typescript >=4.8.4 <6.1.0`) refuses to load with it, and tsdown 0.19's dts build fails without `isolatedDeclarations`. The only TS 7 path is aliasing `typescript` to `@typescript/typescript6` beside TS 7 for `tsc`, which every consuming project of `@enardo/eslint-config` would have to copy. The human chose to wait for typescript-eslint's TS 7 support, and to move to TS 6 now ("procedi come consigli con TS 6").

#### Goal
Every package builds, typechecks, lints and tests on TypeScript 6.0.3 (latest 6.x), so that TS 7 later is mostly a catalog bump.

#### Facts from the trial on a throwaway clone (TS 6.0.3)
- Only failure cause: `types` no longer defaults to every `@types/*`; library.json and node-app.json set none, so @types/node is not loaded (TS2591/TS2304 in 9 packages, and the lint `no-unsafe-*` that follow).
- `"types": ["node"]` in library.json and node-app.json fixes them; then `database` and `id-generator`, which lack @types/node, fail with TS2688.
- No TS 6 deprecation in any preset option. Tests: 25/25 green, browser included.
- tsdown 0.19.0 with TS 6 gives byte-identical dist but an unmet peer (`^5.0.0`); tsdown 0.23.7 accepts TS 6 and changes dist content (d.mts with inline `export declare`, no `//#region` markers), file names unchanged.

#### Decisions of the human
1. Catalog `typescript` to `^6.0.3`.
2. `types: ["node"]` in `@enardo/typescript-config`'s library.json and node-app.json; this is consumer-visible, so a **new major** of `@enardo/typescript-config`, and its README's "TypeScript 5.5+" updated to the TS 6 requirement.
3. `database` and `id-generator` get `@types/node` as a devDependency (`catalog:`), not a `types: []` override (not yet tried in the probe).
4. tsdown to the latest 0.23.x, in a commit of its own.
5. typescript-eslint catalog floor to `^8.72.2`.
6. TypeScript 7 is deferred until typescript-eslint supports it (issue typescript-eslint#10940).

#### Constraints
- Shared tooling versions only through the catalog.
- After changing the lockfile, turbo's key holds it, but run `pnpm verify:all` for the final check.
- Publishing is out of scope (the `publish` skill, approved by the human).

## Open findings

## Lesson candidates

## Backlog candidates

- TypeScript 7 (7.0.2 on 2026-11-13), waiting for typescript-eslint's support (typescript-eslint#10940): with TS 7, typescript-eslint 8.72.2 refuses to load and the JS API is gone; tsdown ≥ 0.23 accepts ^7. From the probes of this branch.
- `pnpm verify:all` builds only the packages others depend on: the 9 leaf packages (cqrs, database-mongo, email-nodemailer, env, http-client, id-generator-mongo, logger, password-hasher, uow-repository-mongo) are never built by it, so a leaf whose build breaks stays green. From chunk 3.

## Log

- 2026-11-13T15:42:10Z opened on 4ce8080 of main
- 2026-11-13T15:42:27Z map: /tmp/claude-1000/-workspaces-enardo-packages/fae55ffe-8d42-4056-b689-98a37b61f6ee/scratchpad/map.md
- 2026-11-13T15:43:06Z human: TS 7 deferred until typescript-eslint supports it; go TS 6 as recommended: @types/node in database/id-generator, typescript-config major, tsdown 0.23 in own commit, typescript-eslint ^8.72.2
- 2026-11-13T16:06:33Z human: spec approved; typescript-eslint 8.72.2 confirmed; last published @enardo/eslint-config is 1.1.0 (repo 3.0.0 unpublished)
- 2026-11-13T16:11:24Z human: last published @enardo/typescript-config is 1.1.0: no version bumps, chunk 5 dropped
- 2026-11-13T16:19:59Z step review chunk 1 round 1: 1 findings
- 2026-11-13T16:22:56Z step review chunk 1 round 2: 0 findings
- 2026-11-13T16:26:26Z chunk 2: react-app.json typechecked under TS 6.0.3 in a probe outside the repo (vite installed there), exit 0
- 2026-11-13T16:27:17Z step review chunk 2 round 1: 0 findings
- 2026-11-13T16:37:35Z step review chunk 3 round 1: 0 findings; note: tsdown 0.23.7 .mjs also differs beyond the spec's shape (inlined constants, /* @__PURE__ */, class field declarations for parameter properties, as tsc emits for es2022; no affected class extends a base)
- 2026-11-13T16:41:53Z chunk 4: implementer's report empty; main agent ran the cases: peers check clean, verify:all --force 86/86 uncached, no lint finding
- 2026-11-13T16:44:36Z step review chunk 4 round 1: 0 findings
