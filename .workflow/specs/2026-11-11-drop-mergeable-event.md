---
status: done
branch: feature/events/drop-mergeable-event
---

# `MergeableEvent` and `isMergeableEvent` leave `@enardo/events` (2.0.0)

## Why

The only use of `MergeableEvent` was the merge per key of the `<model>.updated` events of `@enardo/entities` 2.0.0, in its public `addEvent`. `feature/entities/lean-aggregate-core` (merged at `8756612`) removed that merge, and `@enardo/entities` 3.0.0 no longer depends on `@enardo/events` (ADR 0020, point 1 and *Consequences*). Seen with `git grep -i mergeable` on `main`: besides the records (ADR 0020 and this item of `.workflow/backlog.md`), the only hits are `packages/events/src/mergeable-event.ts`, its re-export in `packages/events/src/index.ts` and its own test, `packages/events/__tests__/mergeable-domain-event.test.ts`. No package of this monorepo depends on `@enardo/events`.

Domain events are facts, and a fact is never merged: an exported merge contract invites a use the architecture rules out.

## What

- `@enardo/events` 2.0.0 exports `Event`, `EventHandler`, `EventBus`, `EventContext` (types) and `SyncEventBus`, unchanged.
- `MergeableEvent` and `isMergeableEvent` are no longer exported, and `src/mergeable-event.ts` is gone. An import of either fails to compile (the type) or to resolve (the function).
- `package.json`'s `version` goes from 1.1.0 to 2.0.0. Nothing else in the manifest changes, nor `pnpm-lock.yaml`: its `packages/events` importer holds no version, and no package depends on `@enardo/events`.
- Out of scope: the dispatch itself (the backlog item *Three doubts on the dispatch of `@enardo/events`*), and publishing 2.0.0, which the human leaves for later.

## Decisions

- **Remove, not deprecate.** A `@deprecated` tag in a 1.2.0 would keep a contract with no user for a release, and no consumer needs a transition: nothing in this monorepo imports it. Doing nothing keeps an export that contradicts ADR 0020. A consumer outside the monorepo stays on 1.x until it upgrades; the major says it breaks.
- **A new major, 2.0.0**, since removing an export is a breaking change (root `CLAUDE.md`, *Publishing*).
- **The test file is deleted with the code.** `mergeable-domain-event.test.ts` tests only the removed symbols; `sync-domain-event-bus.test.ts` stays unchanged.
- **No test-first.** The change adds no behavior: it removes one. A test that asserts the absence of an export would test the compiler, not the package; the proof is that the remaining suite, `typecheck` and `lint` of `@enardo/events` stay green, and `git grep -i mergeable -- packages` finds nothing.
- **ADR 0020 stays as it is.** It already records that `MergeableEvent` can leave `@enardo/events` on this branch; an ADR records a decision, and the package's current state is in its code. No new ADR: the decision is ADR 0020's.
- **No README.** The package has none, and this change gives no reason to write one.

## Test cases

- The existing `sync-domain-event-bus.test.ts` passes unchanged.
- `pnpm --filter @enardo/events typecheck`, `lint` and `build` pass; `dist/index.d.mts` declares no `MergeableEvent` and `dist/index.mjs` exports no `isMergeableEvent`.
- `git grep -n -i mergeable -- packages` returns nothing.

## Chunks

- [x] 1. Remove `MergeableEvent` and `isMergeableEvent` (no test-first): delete `packages/events/src/mergeable-event.ts` and `packages/events/__tests__/mergeable-domain-event.test.ts`, drop the two re-exports from `packages/events/src/index.ts`, set `packages/events/package.json` `version` to 2.0.0; covers all the test cases above.
- [x] 2. Remove this branch's item from the backlog (no test-first, docs): `.workflow/backlog.md` loses the queued item `feature/events/drop-mergeable-event`, in a commit of its own (`.workflow/backlog.md`, *Removing items*); the item *Three doubts on the dispatch of `@enardo/events`* stays.
