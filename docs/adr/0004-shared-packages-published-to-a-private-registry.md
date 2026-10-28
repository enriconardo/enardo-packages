# 0004. The shared packages are published to a private registry, and depend on each other through `workspace:^`

- Status: accepted
- Date: 2026-10-16
- Spec: `git show c337d77:docs/specs/2026-10-15-split-repos.md` (removed from the tree)

## Context

The shared packages moved to a repo of their own, `enardo-packages`, and each project built on them to its own. A project can no longer link the `@enardo/*` packages through the workspace: it installs them from the user's Verdaccio registry, `https://npm.enriconardo.com`, which needs a token to read and to publish.

[ADR 0001](0001-shared-configs-as-workspace-packages.md) has every package depend on the presets with `workspace:*`. `pnpm pack` turns `workspace:*` into the exact version (`1.0.0`), and `workspace:^` into a caret range on it (`^1.0.0`). With exact versions, a consumer that installs two packages built on different patch releases of a third gets two copies of it.

## Decision

1. **Every `@enardo/*` package is published** to the registry, `"license": "UNLICENSED"`, with `publishConfig.registry` set to it. With `pnpm publish`, that setting wins over `--registry` and over the scope's registry, so a publish never reaches the public npm registry. `npm publish` lets `--registry` and the scope's registry override it, so packages are never published with npm.
2. **Between `@enardo/*` packages, dependencies use `workspace:^`**, presets included, so a published manifest asks for a caret range. This replaces the `workspace:*` of ADR 0001's first decision. Its other decisions stand.
3. **A published version never changes.** A change ships under a new `version`. A breaking change is a new major, or a new minor below 1.0.0, because `^0.1.0` takes patches only.
4. **Only the user's account publishes or unpublishes `@enardo/*`.** A project installs with the token of a read-only user.

## Consequences

- `pnpm verify` in `enardo-packages` no longer sees the projects. A change that breaks them passes there, and reaches them only through a new version that they install.
- A project takes a preset change when it updates the preset's version, not when the preset's source changes.
- Publishing is a step of its own: `pnpm pack` in the dev container, then `pnpm publish <tarball>` on the host with the user's login. The publish token never enters a container.

## Alternatives considered

- **Keep `workspace:*`**: published manifests would pin exact versions.
- **Git dependencies**: `dist/` is not committed, so the consumer would have to build each package at install.
- **The public npm registry**: the code is all rights reserved.
