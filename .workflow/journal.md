# Task journal

branch: chore/eslint-config/forbid-relative-import-extensions
tier: S
phase: close/review
base: 4fd7970
started: 2026-11-13T13:12:10Z
review_rounds: 2
verify_red_streak: 0
escalations: 0

## Intent

### Intent: an ESLint rule that forbids extensions on relative imports

Problem: the repo's style is extensionless relative imports (moduleResolution bundler, tsdown bundles everything), restored by refactor/repo/drop-js-import-extensions; nothing enforces it, an import with `.js` still compiles.

Goal: a rule in the presets of @enardo/eslint-config (createConfig, so node, react and runtimeNeutral) that refuses a JS/TS extension (`.js .mjs .cjs .ts .mts .cts .jsx .tsx`) on imports starting with `./`, `../` or `~/`. Other extensions (`.json`, `.css`) and role suffixes (`./product.entity`) stay allowed.

Constraints:
- Native `no-restricted-imports` with `regex` (ESLint 10), no new library.
- runtimeNeutral sets `no-restricted-imports` whole: it must restate the pattern through a shared constant.
- Misses dynamic `import()`: documented.

Decisions of the human:
- Version: 3.0.0 (major), since a new error rule can break consumers' lint.
- Include the `~/` alias: yes.
- No ADR: only a row in the README's "Rule choices" (also noting the rule assumes bundled code; code Node runs unbundled would need extensions).

## Open findings

## Lesson candidates

## Backlog candidates

## Log

- 2026-11-13T13:12:10Z opened on 4fd7970 of main
- 2026-11-13T13:12:14Z decisions: 3.0.0 major; include ~/ alias; README row only, no ADR
- 2026-11-13T13:12:20Z decisions: 3.0.0 major, include the ~/ alias, README row only, no ADR
- 2026-11-13T13:17:33Z review round 1 on 99f72c3: 0 blocking
- 2026-11-13T13:19:24Z checkpoint: apply suggestions 2 (typeof import miss) and 3 (http-client CLAUDE.md), not 1; no backlog item; then merge
- 2026-11-13T13:22:34Z review round 2 on e1a9074: 0 blocking; fixing the ~/ wording of suggestion 3
