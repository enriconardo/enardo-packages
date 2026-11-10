---
status: approved
branch: feature/uow-repository/collect-domain-events
---

# The unit of work collects the domain events of its aggregates and hands them over inside the transaction

## Why

The backlog item `feature/uow-repository/commit-change-set` asked the unit of work to expose, at commit, a record-level change set (which entities are new, changed and removed, and which fields change) to replace the `<model>.created/updated/deleted` events that `@enardo/entities` 3.0.0 removed; ADR 0020 point 3 records that plan.

At the brainstorm the user set the frame: "non stiamo costruendo un ORM. Questo strumento nasce con l'intenzione di essere inserito in un'architettura DDD". Seen from there:

- A created/updated/deleted notification carries no intent: a handler of `user.updated` has to work out what changed and why. In DDD the aggregate decides its events, and `AggregateRoot` of `@enardo/entities` 3.0.0 already queues them (`raise`, `pullEvents`, `packages/entities/README.md:141-210`). Where change notifications are needed (projections, a search index, a cache), they come from the domain events or from the store's change data capture (Mongo change streams, which the replica set the transactions need already provides), not from the unit of work. No consumer asks for them: ADR 0020 records that `cambusa` reads no lifecycle event (2026-11-10), and the item came from the analysis of `@enardo/entities`, not from a project's need. A record-level change set would also carry the storage schema across the aggregate's boundary.
- What is missing is the persistence side of the domain events. The need is anticipated from the DDD frame, not observed: no app calls `pullEvents()` yet (ADR 0020, *Consequences*: `cambusa` calls neither `pullEvents` nor `addEvent`). Today nothing in `@enardo/uow-repository` reads an aggregate's events: `TransactionalUnitOfWork.#commit` (`src/unit-of-work.ts:67-78`) runs the flush units and nothing else, and an app has to call `pullEvents()` in every handler, outside the transaction, so it cannot write them atomically with the aggregate (a transactional outbox). Publishing them after the commit without an outbox loses them when the process dies between the commit and the publish.

Dispatching them to an event bus inside the transaction is not the default either: handlers' side effects (an email, an HTTP call) happen before the commit and survive its rollback; `MongoTransactionManager` re-runs the transaction after a transient error (`packages/transaction-manager-mongo/src/mongo-transaction-manager.ts:23`), so they would run twice; handlers that change other aggregates on the same session make one transaction write many aggregates; and a secondary handler's failure rolls back the use case. Inside the transaction the events are written to an outbox; a relay publishes them after the commit. The hook this spec adds leaves that choice to the app.

## What

### `TrackingRepository`

```ts
new TrackingRepository(dataStore, mapper, options?)

interface TrackingRepositoryOptions<TDomain, TId, TEvent> {
  /** Derives a stable change-tracker key for composite identities. */
  identityKey?: (id: TId) => string;
  /** Takes the domain events an aggregate raised, emptying its queue. */
  pullEvents?: (aggregate: TDomain) => readonly TEvent[];
}
```

- The third argument becomes an options object (breaking: `identityKey` was positional). The class gains a last type parameter `TEvent = never`, inferred from `pullEvents`.
- Without `pullEvents`, the repository collects no event, as today.
- `TrackingRepository` implements a new optional member of `UnitOfWorkParticipant`, `pullEvents(): readonly TEvent[]`, which calls the option on the aggregates it tracks:
  - new, clean (changed or not) and removed aggregates: every tracked instance, whether or not it produces a flush unit. An aggregate may raise an event with no change of persisted state;
  - a replaced identity (`remove`, then `add`): the events of the removed instance, then those of the added one. `TrackingRepository.add`, before it calls `changeTracker.add`, pulls the events of the instance it replaces (`changeTracker.get(key)?.state === "removed"`), since that instance leaves tracking there, and keeps them in a private map by identity key, emptied by `clear()`. A repeated replacement (remove, add, remove, add) appends to that list. `ChangeTracker` and `TrackedEntity` do not change;
  - an aggregate added and then removed: no event, since it never reached the store. Its queue is left as it is;
  - order: tracking order (the order identities were first tracked, as for the writes), and within an aggregate the order of its queue.
- An error thrown by the app's `pullEvents` propagates from the commit's planning: no transaction opens, and `execute` rethrows it, as for a mapper that fails at planning.
- A subclass with custom finders (`README.md:338`, `extends TrackingRepository<User, UserRecords, string, Transaction>`) that wants events writes every type argument up to `TEvent`, `TVersion` and `TStoredId` included. The README shows the form.

### `TransactionalUnitOfWork`

```ts
new TransactionalUnitOfWork(transactionManager, options?)

interface TransactionalUnitOfWorkOptions<TContext, TEvent> {
  /**
   * Receives the events collected at commit, inside the transaction, after
   * the writes. Called once per attempt of the transaction.
   */
  onEvents?: (events: readonly TEvent[], context: TContext) => void | Promise<void>;
}
```

- The class gains a type parameter `TEvent = never`; `register` takes a `UnitOfWorkParticipant<TContext, TEvent>`, so a repository whose events are not part of the unit of work's `TEvent` does not compile. TypeScript infers no type argument once one is given, so an app that passes `TContext` explicitly (the Mongo form, `TransactionalUnitOfWork<MongoTransaction>`) passes `TEvent` too: `new TransactionalUnitOfWork<MongoTransaction>(tm, { onEvents })` keeps `TEvent = never`, and the `register` of a repository with events then fails to compile. The README shows both type arguments.
- At commit, `#plan` collects the flush units and then the events of every participant, in registration order, before the transaction starts: a retried transaction runs the same writes and hands over the same events.
- The transaction opens when there is at least one write or one event. Inside it the writes run, then `onEvents(events, ctx)` when there is at least one event.
- An error of `onEvents` rejects the transaction's callback: the transaction rolls back and `execute` rethrows it, as for a failed write.
- Events collected with no `onEvents` throw a native `Error` before the transaction starts (a misconfiguration; the types do not prevent it, since the options and the hook are optional): nothing is written, and the events are not lost silently.
- `hasPendingChanges()` keeps reporting only the store writes the repositories plan: reading an aggregate's queue empties it. Its JSDoc (`src/unit-of-work.ts:29`, `:81`) says so, and that events are not counted, though a commit with events and no write opens a transaction.
- The `UnitOfWork` interface, which application code holds, does not change.

### Out of scope

- A record-level or entity-level change set at commit (the backlog item): dropped, with the reason in *Decisions*.
- An outbox, a relay, an event bus: the app's. `@enardo/uow-repository` depends on neither `@enardo/events` nor `@enardo/entities`, and its README names neither.
- The three doubts on the dispatch of `@enardo/events` (backlog): a separate item.

### Versions

`@enardo/uow-repository` 0.3.0 (breaking below 1.0.0: the constructor of `TrackingRepository`). `@enardo/uow-repository-mongo` follows with 0.3.0: its peer `workspace:^` resolves to `^0.3.0` at publish, and its README and tests pass `identityKey` positionally. Its `src/` does not change.

### Documents

- `packages/uow-repository/README.md`: *Configuration and usage* (`:202-209`) and the composite-identity examples (`:379`, `:391`) take the options object; a section on domain events and `onEvents` (the outbox, the retry, the type arguments, the subclass form); the missing-hook `Error` in *Errors* (`:483-494`); *Upgrading from 0.2*; *Contents*.
- `packages/uow-repository-mongo/README.md`: `:108`, `:230`, `:247` take the options object; the upgrade note (`:311`) names `^0.3.0`; the outbox example, with the session in `onEvents`.
- `docs/adr/0020-…`: status `accepted; point 3 superseded by 0021`; `docs/adr/README.md`: 0020's row, and a row for 0021.
- `docs/backlog.md`: the `commit-change-set` item moves to *Dropped*, with the reason of Decision 1 (approved by the user at the brainstorm).

## Decisions

1. **The unit of work collects the aggregates' domain events, instead of producing a change set.** Alternatives: the change set of the backlog item (CRUD notifications carry no intent, duplicate the store's change streams and the domain events, expose the record schema, and have no consumer); a reduced notification `{ name, id, change, version }` (the same objections but the schema, and a `name` the package does not have); doing nothing (every handler pulls the events by hand, outside the transaction, so no atomic outbox). Supersedes ADR 0020 point 3: ADR 0021.
2. **The events reach a hook inside the transaction, not a bus, nor a callback after the commit.** After the commit the outbox is not atomic; a bus inside the transaction has the problems in *Why*. A hook with the transaction context serves the outbox, and lets an app that wants Bogard's synchronous in-transaction dispatch do it knowingly. Earlier in the brainstorm "after the commit" was proposed and accepted, before the outbox was weighed; the user then approved the hook inside.
3. **`pullEvents` is an option of the repository, not a member of `Mapper`.** The mapper converts between an aggregate and its records; the events are not records. One repository per aggregate type is where the app already says how that type is persisted. A fixed call to `aggregate.pullEvents()` would tie the package to `@enardo/entities`.
4. **The third constructor argument becomes an options object.** A fourth positional argument would make `new TrackingRepository(store, mapper, undefined, { pullEvents })` the common form. The options object is the only breaking change of the release (the optional participant member and the `never`-defaulted type parameters are additive); below 1.0.0 the release is a new minor, which `^0.2.0` does not take, whatever it holds, so the cost of the change is the rewrite of the positional calls.
5. **Events are pulled before the transaction, with the writes.** A retried transaction must hand over the same events; `pullEvents` empties the queue, so it can be called once. On a failure the aggregates are discarded with the unit of work, and a retry (`retryOnConflict`) runs the use case again on fresh aggregates.
6. **`pullEvents` is an optional member of `UnitOfWorkParticipant`.** A participant with no events implements nothing new. Required, it would break every participant for no gain.
7. **Events with no `onEvents` throw.** Silently dropping a domain event is the failure an outbox exists to prevent. Requiring the hook in the types (a conditional options type on `TEvent`) was weighed: it breaks down where it matters most, since the Mongo form gives the type arguments by hand and a forgotten `TEvent` is `never`; the runtime check covers every form.
8. **A replaced identity keeps the removed instance's events.** The tracker drops that instance on `add`, so without pulling them there they would be lost silently; a removed aggregate's events (`archived`, `closed`) are facts the outbox needs. The repository pulls them, not the public `ChangeTracker`, which knows nothing of the option.
10. **`onEvents` may be synchronous.** An in-memory dispatch or a test hook returns `void`; the unit of work awaits the result either way.
9. **An aggregate added and removed in the same unit of work gives no event, and its queue is untouched.** It never reached the store, so its events never happened there.

## Test cases

`packages/uow-repository/__tests__/`, with an in-memory data store and a transaction manager that records the calls.

1. A new aggregate with two queued events → `onEvents` receives them in queue order, with the transaction's context, once.
2. `onEvents` runs inside the transaction, after the writes → a recording transaction manager sees the insert, then `onEvents`, then the commit.
3. A loaded aggregate, changed, with an event → update written, event handed over.
4. A loaded aggregate with an event and no change of state → a transaction opens, no write, `onEvents` receives the event.
5. A loaded and removed aggregate with an event → delete written, event handed over.
6. `remove` then `add` of the same identity, each instance with an event → the removed instance's event, then the added one's; remove, add, remove, add → the three instances' events, in that order.
7. `add` then `remove` of an aggregate with an event → no transaction, `onEvents` not called, the aggregate's queue still holds the event.
8. Two repositories, each with aggregates with events → events in registration order of the repositories, then tracking order, then queue order.
9. A transaction manager that calls its callback twice (a retry) → `onEvents` receives the same events both times, and `pullEvents` was called once per aggregate.
10. `onEvents` rejects → `execute` rejects with that error, the transaction's callback rejected (rollback), the repositories are cleared.
11. Events collected and no `onEvents` → `execute` rejects with a native `Error` naming the missing option, no transaction opened.
12. Writes and no event (repositories with or without `pullEvents`) → `onEvents` not called; the writes as today.
13. `hasPendingChanges()` on a loaded, unchanged aggregate with a queued event → `false`, and the queue still holds the event.
14. `identityKey` through the options object → composite identities tracked as before (the existing tests, moved to the options form).
15. Type level (`expectTypeOf` or `@ts-expect-error`): registering a repository with events on a unit of work whose `TEvent` does not include them fails to compile; `TEvent` is inferred from `pullEvents`.
16. `public-api.test.ts`: the new types `TrackingRepositoryOptions` and `TransactionalUnitOfWorkOptions` are exported.
17. The app's `pullEvents` throws → `execute` rejects with that error, no transaction opened, nothing written.
18. A synchronous `onEvents` (returning `void`) → called, and the commit completes.
19. `packages/uow-repository-mongo/__tests__/`, on the in-memory replica set: `onEvents` inserts the events into an outbox collection with the session; a commit leaves the aggregate and the outbox documents; an `onEvents` that inserts and then throws leaves neither the aggregate's write nor the outbox documents.

## Chunks

- [ ] 1. `TrackingRepository` options object and `pullEvents` (test-first): `packages/uow-repository/src/repository.ts`, `src/unit-of-work.ts` (the optional `pullEvents` member of `UnitOfWorkParticipant` only), `src/index.ts` (export `TrackingRepositoryOptions`), `__tests__/repository.test.ts`, `__tests__/identity-key.test.ts`, the tests of `packages/uow-repository-mongo/__tests__/` that pass `identityKey` positionally (moved to the options form). Cases 3, 4, 5, 6, 7, 13, 14, 17, asserted on the participant's `pullEvents()` (the hand-over to `onEvents` comes with chunk 2).
- [ ] 2. `TransactionalUnitOfWork` collects the events and calls `onEvents` (test-first): `packages/uow-repository/src/unit-of-work.ts` (options, `TEvent`, `#plan`, `#commit`, the JSDoc of `hasPendingChanges` at `:29` and `:81`), `src/index.ts` (export `TransactionalUnitOfWorkOptions`), `__tests__/unit-of-work.test.ts`, `__tests__/public-api.test.ts`. Cases 1, 2, 8, 9, 10, 11, 12, 15, 16, 18.
- [ ] 3. Outbox through `onEvents` on the Mongo replica set (test-first): a new test file in `packages/uow-repository-mongo/__tests__/`, no `src/` change. Case 19.
- [ ] 4. Docs, ADR statuses, backlog and the 0.3.0 versions (no test-first): `packages/uow-repository/README.md`, `packages/uow-repository-mongo/README.md`, both `package.json` versions, the status of `docs/adr/0020-…`, `docs/adr/README.md` (rows of 0020 and 0021), `docs/backlog.md`. ADR 0021 itself is committed with the spec.
