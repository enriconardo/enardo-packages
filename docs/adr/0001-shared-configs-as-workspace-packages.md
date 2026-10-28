# 0001. Shared TypeScript and ESLint configs live in workspace packages

- Status: accepted; its first decision's `workspace:*` superseded by 0004; *A third package for vitest configs* overturned by 0010; point 2's moving into a preset of an override two packages need superseded by 0011
- Date: 2026-09-24
- Spec: `git show c337d77:docs/specs/2026-09-24-package-tooling.md` (removed from the tree)

## Context

Every package carried its own `tsconfig.json`, `eslint.config.js` and tooling versions. Across 30 packages they had drifted into 9 tsconfig variants and 5 ESLint variants, and TypeScript itself was split between 5.8 and 5.9. Almost none of the differences were intended: 5 packages left their tests out of typecheck, one had no path alias, one included another package's source. A change of policy (a stricter flag, a new rule) meant editing 30 files by hand.

The quality gate is `pnpm verify`, which runs checks only on packages turbo considers affected: those changed against `master` and their dependents.

## Decision

1. **Presets are workspace packages**: `@enardo/typescript-config` (`base`, `library`, `node-app`, `react-app`) and `@enardo/eslint-config` (`node`, `react`). Every package extends or calls one, and depends on it with `workspace:*`.
2. **Presets are defaults, not a cage.** A package may override an option or a rule in its own file, with a comment saying why. An override needed by two or more packages moves into a preset. When a preset gets stricter, a package may keep the old behavior through a temporary override, so an upgrade never has to fix every package at once.
3. **Shared dev tooling takes its version from the pnpm catalog** in `pnpm-workspace.yaml`; packages reference `catalog:`, never a range of their own.
4. Presets carry per-package paths through TypeScript's `${configDir}`, so a package's tsconfig is usually a single `extends` line.

## Consequences

- A preset change is a dependency change: turbo re-checks every package that uses it, so `pnpm verify` stays correct without special cases.
- Differences between packages are visible and explained, instead of accidental.
- Every package gains one or two dev dependencies on config packages; the config packages are an exception to "one `src/index.ts` built to `dist/`": they ship their JSON/JS as they are.
- Tightening a rule touches every package at once by default; the temporary-override rule is the release valve.

## Alternatives considered

- **Root-level base files** (`tsconfig.base.json`, a root `eslint.config.js`): same reuse, but turbo does not see a root file as a dependency of any package, so changing it would not make `pnpm verify` re-check anything. Rejected for that reason alone.
- **Keep per-package copies**: the status quo that produced the drift.
- **A third package for vitest configs**: 13 lines in two variants did not justify it; vitest configs stay local.
