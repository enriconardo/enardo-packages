---
status: draft
type: docs
tier: L
implementer: sonnet/medium
packages: ["@enardo/typescript-config", "@enardo/eslint-config", "@enardo/http-client"]
branch: docs/repo/narrow-preset-rule
---

# Only a block of configuration that a second package needs moves into a preset

## Why

`feature/env/readers-only` gives `@enardo/env` a local `isolatedDeclarations`, as `@enardo/http-client` has: the rule that an override two packages need moves into a preset then asks for a preset of one flag, which no existing preset can host (ADR 0011, *Context*). The user questioned the rule (2026-10-22): counting packages produces presets that serve two or three packages. The rule did produce the four runtime presets, which hold blocks that would drift if copied; a single option does not drift the way a block does. Decided with the user after a `critic` run on a proposal to drop the rule: narrow it to blocks.

L by the tier table: the docs of three packages and a decision that outlives the task (ADR 0011).

## Probes

- `git grep -n -i -E "second package|two packages need|moves? (it )?into (a|the) preset|until a second"`, over the repo but `docs/specs` → the rule is stated or applied in:
  - `CLAUDE.md:41`;
  - `docs/adr/0001-shared-configs-as-workspace-packages.md:16` (point 2);
  - `docs/adr/0010-a-vitest-preset-package.md:15` (point 3, for parts of a vitest config);
  - `packages/typescript-config/README.md:73`;
  - `packages/eslint-config/README.md:58`;
  - `packages/http-client/CLAUDE.md:86` ("a local override until a second package needs it");
  - `docs/backlog.md:32` ("the second package that needs it moves it into a preset").
- `docs/specs/2026-10-22-runtime-neutral-presets.md:20` and `docs/specs/2026-10-07-browser-tests.md:289` → the rule is what moved the runtime overlays, `runtimeNeutral` and `browserProject()` into presets.
- `packages/typescript-config/README.md:57` and the comment in `packages/http-client/tsconfig.json:5-9` → both give `isolatedDeclarations`'s reason in the DOM direction only. An inferred `setTimeout` comes out as `NodeJS.Timeout`, a name of Node's types only (an in-memory declaration emit on `packages/env/tsconfig.json`, by the `critic`'s first run on the env spec).
- `wc -c CLAUDE.md` → 11 072 bytes, of 12 000.

## Decisions

Taken with the user (2026-10-22):

- **The rule, narrowed**: "An override of more than one option (a block, a list) that a second package needs moves into a preset; a single option is repeated, with its comment." The four runtime presets are blocks, and stay.
- **ADRs keep their method**: ADR 0011 supersedes the sentence of ADR 0001's point 2; ADR 0001 changes only in its status line. Not taken: amending ADRs in place, which leaves a *Context* written for the old decision and references that go stale without notice.
- Not taken: dropping the rule, with shared patterns found by a review on request (nothing triggers the review); dropping "with a comment saying why" from the root `CLAUDE.md` (no other root rule asks an override for a comment).

## Open questions

None.

## Changes

- **`docs/adr/0011-only-a-block-moves-into-a-preset.md`** (new, `proposed` until checkpoint 1, then `accepted`); **`docs/adr/0001-…md`**, status line: "…; point 2's moving into a preset of an override two packages need superseded by 0011"; **`docs/adr/README.md`**: a row for 0011, and 0001's row follows its status line.
- **`CLAUDE.md:41`**: "… uses a preset of `@enardo/typescript-config` or `@enardo/eslint-config`. A package may override an option or a rule, with a comment saying why; an override of more than one option (a block, a list) that a second package needs moves into a preset, and a single option is repeated, with its comment."
- **`packages/typescript-config/README.md`**:
  - `:73`: "An override of more than one option (a block, a list) that a second package needs moves into a preset; a single option is repeated in each package, with its comment."
  - `:57`: "… so that the build emits them from the source text and not through a program with the types of both runtimes: an inferred type would come out with a name only one runtime declares (`BodyInit` of the DOM, `NodeJS.Timeout` of Node)."
- **`packages/eslint-config/README.md:58`**: "A package may extend the preset array with its own entries, with a comment saying why. An override of more than one rule or option that a second package needs moves into the preset, and a single one is repeated, with its comment; when the preset gets stricter, a package may keep the old behavior through a temporary override."
- **`packages/http-client/CLAUDE.md:86`**: "(a local override until a second package needs it)" becomes "(a single option: each package repeats it, with its comment)".
- **`packages/http-client/tsconfig.json`**, the comment on `isolatedDeclarations`: the reason in both directions, as in `typescript-config`'s README.
- **`docs/backlog.md:32`**: "The move left is `isolatedDeclarations`, … moves it into a preset." becomes "`isolatedDeclarations` is a single option: each package repeats it in its own `tsconfig.json`, with its comment (ADR 0011)."
- No version bump: no preset changes; the READMEs reach the registry with each package's next release.
- ADR 0010 stays: its point 3 is about parts of a vitest config, which are blocks.

## Test cases

None: documentation only. `pnpm verify` checks the format of the changed files and the size of the root `CLAUDE.md`; `typecheck` of `@enardo/http-client` re-reads its `tsconfig.json`.

## Out of scope

- `isolatedDeclarations` in `library.json` for every library (a *To evaluate* item of `feature/env/readers-only`).
- `@enardo/env`'s own `tsconfig.json` (`feature/env/readers-only`).

## Plan

1. ADR 0011 `accepted`, ADR 0001's status, the index; the rule narrowed in the root `CLAUDE.md`, the two READMEs, `http-client`'s `CLAUDE.md` and the backlog; `isolatedDeclarations`'s reason in both directions. One commit: the rule and its applications change together.
2. `pnpm verify`, the diff to the user, integrate.
