---
status: done
type: docs
tier: L
implementer: sonnet/medium
packages: ["@enardo/typescript-config", "@enardo/eslint-config"]
branch: docs/repo/narrow-preset-rule
---

# Only a block of configuration that a second package needs moves into a preset

## Why

The rule that an override two packages need moves into a preset (ADR 0001, root `CLAUDE.md`, the presets' READMEs) counts packages, whatever the override holds. The user judged it rigid (2026-10-22): a scalar shared by two packages would make a preset of one option. The rule did produce the four runtime presets, which hold blocks that would drift if copied; a scalar does not drift the way a block does. Decided with the user, after two `critic` runs: narrow the rule to blocks, by the value of the override.

The question came up with `isolatedDeclarations`, shared by `@enardo/http-client` and `@enardo/env` 2.0. `feature/env/readers-only` moves it into the runtime overlays, where it fits every package; this task does not depend on it.

L by the tier table: the READMEs of two packages and a decision that outlives the task (ADR 0011).

## Probes

- `git grep -n -i -E "second package|two packages need|moves? (it )?into (a|the) preset|until a second"`, over the repo but `docs/specs` → the rule is stated in `CLAUDE.md:41`, `docs/adr/0001-shared-configs-as-workspace-packages.md:16` (point 2), `docs/adr/0010-a-vitest-preset-package.md:15` (point 3, for parts of a vitest config), `packages/typescript-config/README.md:73`, `packages/eslint-config/README.md:58`; it is applied to `isolatedDeclarations` in `packages/http-client/CLAUDE.md:86` and `docs/backlog.md:32`, which `feature/env/readers-only` rewrites.
- `docs/specs/2026-10-22-runtime-neutral-presets.md:20` and `docs/specs/2026-10-07-browser-tests.md:289` → the rule is what moved the runtime overlays, `runtimeNeutral` and `browserProject()` into presets.
- The `critic`'s run on the first version of this spec → the `test` block of `vitest.config.ts` (`globalSetup`, `include`, `hookTimeout`, `testTimeout`) is identical in `@enardo/transaction-manager-mongo` and `@enardo/uow-repository-mongo` since `2099677`: a block the rule, old or narrowed, sends to `@enardo/vitest-config`, and nobody moved.
- `wc -c CLAUDE.md` → 11 072 bytes, of 12 000.

## Decisions

Taken with the user (2026-10-22):

- **The rule, by the value of the override**: a list, an object, or several options that a second package needs move into a preset; a scalar is repeated, with its comment, and moves into a preset only when it fits every package on it. The wording by value comes from the `critic`: counting options would repeat a lone list, the case that drifts.
- **ADRs keep their method**: ADR 0011 supersedes the sentence of ADR 0001's point 2; ADR 0001 changes only in its status line.
- Not taken: dropping the rule, with shared patterns found by a review on request (nothing triggers the review); dropping "with a comment saying why" from the root `CLAUDE.md` (no other root rule asks an override for a comment); amending ADRs in place.

## Open questions

None.

## Changes

- **`docs/adr/0011-only-a-block-moves-into-a-preset.md`** (new, `proposed` until checkpoint 1, then `accepted`); **`docs/adr/0001-…md`**, status line: "…; point 2's moving into a preset of an override two packages need superseded by 0011"; **`docs/adr/README.md`**: a row for 0011, and 0001's row follows its status line.
- **`CLAUDE.md:41`**: "… uses a preset of `@enardo/typescript-config` or `@enardo/eslint-config`. A package may override an option or a rule, with a comment saying why. A list, an object or several options that a second package needs move into a preset; a scalar is repeated with its comment, unless it fits every package on a preset (ADR 0011)."
- **`packages/typescript-config/README.md:73`**: "An override whose value is a list or an object, or that sets several options, moves into a preset when a second package needs it; a scalar is repeated in each package, with its comment, unless it fits every package on a preset."
- **`packages/eslint-config/README.md:58`**: "A package may extend the preset array with its own entries, with a comment saying why. Entries that a second package needs move into the preset, unless they set a single scalar option, which is repeated with its comment; when the preset gets stricter, a package may keep the old behavior through a temporary override."
- **`docs/backlog.md`**, *To evaluate*: **The vitest `test` block of the Mongo adapters**, identical in `@enardo/transaction-manager-mongo` and `@enardo/uow-repository-mongo`: under ADR 0010 and ADR 0011 it moves into `@enardo/vitest-config`. From the `critic`'s run on the spec of `docs/repo/narrow-preset-rule`.
- No version bump: no preset changes; the READMEs reach the registry with each package's next release.

## Test cases

None: documentation only. `pnpm verify` checks the format of the changed files and the size of the root `CLAUDE.md`.

## Out of scope

- `isolatedDeclarations` (`feature/env/readers-only`).
- Moving the Mongo adapters' vitest block (the backlog item above).

## Plan

1. ADR 0011 `accepted`, ADR 0001's status, the index; the rule in the root `CLAUDE.md` and the two READMEs. One commit: the rule changes everywhere at once.
2. The backlog item, in a commit of its own.
3. `pnpm verify`, the diff to the user, integrate.
