# 0010. The browser test project lives in a vitest preset package

- Status: accepted
- Date: 2026-10-22
- Spec: docs/specs/2026-10-22-runtime-neutral-presets.md

## Context

ADR 0001 kept vitest configs local: "13 lines in two variants did not justify" a third config package. Since `chore/repo/browser-tests`, a package whose `src/` runs in browsers runs its tests there too, through a `browser` project of about 30 lines: the `playwright` service's endpoint, three browser instances, the exclusion of `*.node.test.ts`, and the options that make a library's run work in the container (`exposeNetwork`, no screenshots). Its spec left the project in `@enardo/http-client` until a second package needed it, and the place of the preset to that package. `@enardo/env` 2.0 is that package.

## Decision

1. **`@enardo/vitest-config` holds the `browser` project**, as a function a package's `vitest.config.ts` calls (`browserProject()`). It ships its JavaScript as it is, like `@enardo/eslint-config`, and carries `@vitest/browser-playwright` and `playwright`, with `vitest` as a peer.
2. **The rest of a vitest config stays local**, as ADR 0001 decided: the `~` alias and the `node` project are a few lines that every package writes the same way, and no package has needed more.
3. **A part of a vitest config that a second package needs moves into this package**, as an override of the other presets does.

This overturns ADR 0001's *A third package for vitest configs*, for the browser project only.

## Consequences

- A package opts in to browser tests with one devDependency and one call; the endpoint, the browsers and the container's options change in one place.
- A change to the preset re-runs the tests of every package that uses it: a config package with no `build` script still changes the task hashes of the packages that depend on it (probed in the spec).
- The `playwright` version stays the catalog's through the preset's own `catalog:` dependency, and `docker/playwright/check-version.sh` keeps comparing it with the image's.
- One more package to publish, for a consumer that runs its tests in this repo's containers.

## Alternatives considered

- **A root file** (`vitest.browser.ts`): a package judged as if published alone could not import it. Turbo would see it only through `globalDependencies`, which re-checks every package on each change.
- **Keeping a copy in each package**: the drift ADR 0001 was written against, and the rule of the spec of `chore/repo/browser-tests` against the second copy.
