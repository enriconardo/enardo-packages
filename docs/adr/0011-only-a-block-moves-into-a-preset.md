# 0011. Only a block of configuration that a second package needs moves into a preset

- Status: proposed
- Date: 2026-10-22
- Spec: docs/specs/2026-10-22-narrow-preset-rule.md

## Context

ADR 0001 (point 2) says that an override needed by two or more packages moves into a preset. The rule produced the runtime presets: `runtime-browser.json` and `runtime-node.json` of `@enardo/typescript-config`, `runtimeNeutral` of `@enardo/eslint-config`, and `browserProject()` of `@enardo/vitest-config` (ADR 0010). Each holds a block that would drift if copied: lists of globals and a hand list to recheck when Node changes, the dev container's endpoint and browsers, the libs and types that define what each runtime sees.

`@enardo/env` 2.0 takes `isolatedDeclarations`, a local override of `@enardo/http-client`'s `tsconfig.json`, so the rule asks for a preset. No preset is a home for one flag: the runtime overlays are extended only by the check programs, not by the `tsconfig.json` the build reads, and `library.json` would put it on every library package (6 errors in 5 packages). A one-line flag with its comment costs almost nothing to repeat, while a preset costs a file, a name and one more `extends` to follow; counting packages produces presets of one option.

## Decision

1. **An override of more than one option (a block, a list) that a second package needs moves into a preset.** The count is of options in the override, so the check needs no judgment.
2. **A single option is repeated in each package that needs it, with its comment.** Whether a single option belongs on every package of a preset is a question of its own, judged on the option's merits.
3. This supersedes the sentence of ADR 0001's point 2 on an override needed by two or more packages; the rest of point 2 stands. ADR 0010's point 3, on parts of a vitest config, stands: such a part is a block.

## Consequences

- `isolatedDeclarations` stays a local override in `@enardo/http-client` and `@enardo/env`, and in any other package that takes it.
- The presets stay for what drifts when copied; a single option shows up in several packages, each with its reason.
- A comment repeated in several packages can itself drift: each copy states the reason on its own.

## Alternatives considered

- **Drop the promotion rule**, and find shared patterns in a review of the configurations, on request. The rule produced the four runtime presets, all blocks, and nothing would trigger such a review.
- **Keep the rule as it is**: a preset of one flag, or the flag on every package on `library.json`, decided by a count.
- **Amend ADR 0001 in place** instead of superseding a sentence of it: an amended ADR keeps a *Context* written for the old decision, and references from other records go stale without notice.
