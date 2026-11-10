# Task journal

branch: feature/entities/lean-aggregate-core
tier: L
phase: l/chunk-3/commit
base: 3a9eb21
started: 2026-11-10T11:07:11Z
review_rounds: 0
verify_red_streak: 0
escalations: 0

spec: docs/specs/2026-11-10-lean-aggregate-core.md

spec_review_rounds: 2

## Intent

### Intent: a lean core for @enardo/entities 3.0.0

Source: docs/backlog.md, Queued, first item `feature/entities/lean-aggregate-core` (removed from the backlog by this branch).

#### Problem
@enardo/entities 2.0.0 binds the domain model to the store and carries more than a core:
one `EntityId` type for every aggregate (a UserId passes where a ProductId is expected);
attributes documented as the "persisted/normalized" shape; generic `<model>.created/updated/deleted`
events and their merge (change notifications, not domain events); createdAt/updatedAt bumped on
every mutation; markForRemoval; public addEvent and create*Event; a dependency on @enardo/events.
Bugs found by a probe on 2.0.0 (2026-11-10): `create` compiles with required attributes missing;
`_attributes`, `_events`, `_isMarkedForRemoval` are public and writable; deepFreeze leaves Map, Set
and Date mutable; onBeforeAttributeMutation runs on a no-op, against its JSDoc.

#### Goal
A new major, 3.0.0, with a lean core:
- `Entity` compared by identity; the aggregate collects its own events and hands them over with
  `pullEvents`; state as an immutable snapshot; a protected `setAttribute` (and `setAttributes`).
- Attributes in the domain's shape; the mapper of uow-repository converts between the two.
- AggregateRoot takes the event's type: `raise(event)` protected, `pullEvents()` typed on it;
  `clearEvents` stays. The dependency on @enardo/events goes: the app picks the type (a union of
  the aggregate's events), extending `Event` if it publishes them.
- Out: generic lifecycle events and their merge, createdAt/updatedAt, markForRemoval (and
  isMarkedForRemoval, assertMutable, onMarkedForRemoval), public addEvent, create*Event, modelName,
  hasCreatedEventQueued, the *LifecycleEvent types, the private isMergeableEvent copy,
  AggregateRootCommonAttributes, EntityCommonAttributes. The ENTITY_* row of ADR 0018 and the
  README's *Errors* section go with markForRemoval.
- README gains an *Upgrading from 2.x* section; the uow-repository-mongo README example that uses
  `EntityId` moves to a generic id.

#### Decisions taken by the human (brainstorm, 2026-11-10)
1. Id type: `Entity` accepts any `TId` with an `equals`, so each subclass can bring its own value
   object; the package offers `Id<B extends string>` (brand in the type) as a ready implementation.
   `EntityId` as a name goes. `INVALID_ENTITY_ID` stays (backlog, Dropped, 2026-11-05) with the
   ready id class.
2. The id lives outside the attributes: `constructor(id: TId, attributes: TAttrs)`. No `id` key
   is required in TAttrs; no setter for the id.
3. Immutability: deepFreeze goes rather than being fixed. Attributes are exposed as shallow
   `Readonly<T>`, with private state ("readonly types and private state, rather than a promise
   the runtime breaks").
4. No static factories (`create`, `rehydrate`) in the base: the base constructor is `protected`;
   the subclass makes it public or exposes its own `restore(id, attrs)` for the mapper, and
   writes its domain factories (`User.register(...)` raising its own event). The "create compiles
   with missing attributes" bug goes with them.
5. The mutation hooks (onBeforeAttributeMutation, onAttributeMutation) are removed: an invariant
   goes in the domain method, or a subclass overrides the protected `setAttribute` and calls
   super. setAttribute still leaves the snapshot untouched when every value is unchanged
   (Object.is per key).

#### Constraints
- No package in the monorepo depends on @enardo/entities in code; external `cambusa` is on
  ^1.1.0 and migrates when it takes the major.
- Tier L, confirmed by the human. Test-first on the public API.
- Does not wait for `feature/uow-repository/commit-change-set`; `feature/events/drop-mergeable-event`
  comes after this branch.

## Open findings

## Lesson candidates

## Backlog candidates

## Log

- 2026-11-10T11:07:11Z opened on 3a9eb21 of chore/repo/overload-trial
- 2026-11-10T11:07:36Z map: /tmp/claude-1000/-home-enardo-Projects-enardo-packages/f37e45e8-bd79-4373-88a5-69cb2433acb3/scratchpad/map.md
- 2026-11-10T11:07:36Z human decisions (brainstorm): id any TId with equals + ready Id<B>, EntityId name goes; id outside attributes; no deepFreeze, Readonly<T> + private state; no static factories, protected constructor; mutation hooks removed; tier L confirmed
- 2026-11-10T11:14:59Z probe done (prober, 2026-11-10): all shapes confirmed; #attributes not reachable from AggregateRoot, so setAttribute/setAttributes move to Entity (spec decision 10, to flag at checkpoint)
- 2026-11-10T11:23:13Z spec review round 1: accepted B1 (brand lost in d.ts; probe 5 -> unique symbol brand), B2 (cases 12 and 19 dropped), m1-m8 and gaps; cambusa checked at 9cc4f5f: reads createdAt/updatedAt, modelName, _attributes; no lifecycle events
- 2026-11-10T11:23:22Z lesson candidate: type cases compiled against src (~/* alias) miss what declaration emit loses (a private brand's type); a nominal-type claim needs a probe against dist/index.d.mts
- 2026-11-10T11:29:53Z spec review round 2: holds, minors only; all fixed (create/rehydrate cost on cambusa, eslint-config README example, TS2314, TS4113 wording, ADR 0003 as analogy, regression case of create via TS2578); dist type test kept out, open question for checkpoint
- 2026-11-10T11:41:42Z checkpoint 1, human: 'cambusa NON rappresenta un rischio. è un progetto pilota che verrà ricostruito da zero'; dist type test: 'faccio come proponi tu' (left out); approval pending their clarification questions
- 2026-11-10T11:47:24Z checkpoint 1: human approved the spec ('approvo')
- 2026-11-10T12:00:35Z chunk 2: red check valid; 2 type-only tests pass already (to step reviewer). Case 20 'create' line is a read, not a call (lint no-unsafe-call); spec wording of case 20 and decision 4 aligned, behavior unchanged
- 2026-11-10T12:00:35Z tooling gap: red-check passes deleted recorded test files to the runner (junit: not in report); workaround: record the deletion as a separate suite after a valid red check, no new red check (it adds no test)
- 2026-11-10T12:00:35Z lesson candidate (workflow): red-check.sh/junit.py should skip recorded files whose last record deletes them
- 2026-11-10T12:04:34Z chunk 2 step review round 1: code ok; test finding on case 11 (checks the test's own constructor, not Entity's); spec agrees with reviewer -> back to test-author
- 2026-11-10T12:05:29Z chunk 2: suite 4 (case 11 fixed); red check's only problem is the deleted deep-freeze.test.ts (tooling gap); all else passes with the code in place; case 11 proven by the reviewer's Partial mutant -> step review round 2
- 2026-11-10T12:07:24Z chunk 3: suite 5 (index.test); red check: index test red on AssertionError; only problem the deleted deep-freeze.test.ts (tooling gap) -> taken as valid red
