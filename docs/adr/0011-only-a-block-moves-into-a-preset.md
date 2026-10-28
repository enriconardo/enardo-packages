# 0011. Only a block of configuration that a second package needs moves into a preset

- Status: accepted
- Date: 2026-10-22
- Spec: `git show c337d77:docs/specs/2026-10-22-narrow-preset-rule.md` (removed from the tree)

## Context

ADR 0001 (point 2) says that an override needed by two or more packages moves into a preset. The rule produced the runtime presets: `runtime-browser.json` and `runtime-node.json` of `@enardo/typescript-config`, `runtimeNeutral` of `@enardo/eslint-config`, and `browserProject()` of `@enardo/vitest-config` (ADR 0010). Each holds a block that would drift if copied: lists of globals and a hand list to recheck when Node changes, the dev container's endpoint and browsers, the libs and types that define what each runtime sees.

The rule counts packages, whatever the override holds. A scalar (a flag, a number, a string) with its comment costs almost nothing to repeat and has nothing in it that can drift; a preset costs a file, a name and one more `extends` to follow. Counted by packages, one flag shared by two packages makes a preset of one option. The question came up with `isolatedDeclarations`, which `@enardo/env` 2.0 shares with `@enardo/http-client`; it ends up in the runtime overlays, because it fits every package on them, not because two packages repeat it.

## Decision

1. **An override whose value is a list or an object, or that sets several options, moves into a preset when a second package needs it.**
2. **A scalar override (a flag, a number, a string) is repeated in each package that needs it, with its comment.** It moves into a preset only when it fits every package on that preset, judged on its merits.
3. This supersedes the sentence of ADR 0001's point 2 on an override needed by two or more packages; the rest of point 2 stands. ADR 0010's point 3, on parts of a vitest config, follows the same split: a block moves, a scalar is repeated.

## Consequences

- The presets stay for what drifts when copied; a scalar may show up in several packages, each with its reason.
- A comment repeated in several packages can itself drift: each copy states the reason on its own.
- Point 2's "fits every package" is a judgment, where point 1 is not.

## Alternatives considered

- **Drop the promotion rule**, and find shared patterns in a review of the configurations, on request. The rule produced the four runtime presets, all blocks, and nothing would trigger such a review.
- **Keep the rule as it is**: a preset of one flag at the second package that repeats it.
- **Count the options of an override** instead of reading its value: a list is one option, so a lone list of restricted globals, the case that drifts, would be repeated.
- **Amend ADR 0001 in place** instead of superseding a sentence of it: an amended ADR keeps a *Context* written for the old decision, and references from other records go stale without notice.
