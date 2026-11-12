# Task journal

branch: refactor/repo/drop-js-import-extensions
tier: S
phase: s/implement
base: 04c78c8
started: 2026-11-12T08:58:25Z
review_rounds: 0
verify_red_streak: 0
escalations: 0

## Intent

### Intent

Problem: backlog item "packages/events/src/index.ts imports without the .js extension" says events' index.ts differs from the rest of its src/, which uses `.js`. Analysis: the repo's preset uses `moduleResolution: bundler` and tsdown bundles to one dist/index.mjs, so extensions are not needed; ~60 files across every package import without an extension. The exceptions are the `.js` imports: packages/events/src/{event-bus,event-handler,sync.event-bus}.ts and packages/entities/src/errors/index.ts.

Goal: one style across the repo, extensionless relative imports. Drop `.js` from those 4 files. No behavior change (bundle identical in meaning). Close the backlog item.

Decision of the human: "Togliere .js" in events and entities (recommended option), tier S.

Constraints: refactor, tests unchanged; one commit per package; backlog update a separate commit.

## Open findings

## Lesson candidates

## Backlog candidates

## Log

- 2026-11-12T08:58:25Z opened on 04c78c8 of main
