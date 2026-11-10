# Task journal

branch: feature/uow-repository/collect-domain-events
tier: L
phase: close/write
base: 8756612
started: 2026-11-10T14:18:21Z
review_rounds: 5
verify_red_streak: 0
escalations: 2

spec: docs/specs/2026-11-10-collect-domain-events.md

spec_review_rounds: 1

## Intent

### Intent: collect the aggregates' domain events at commit (@enardo/uow-repository)

#### Problem
The backlog item `feature/uow-repository/commit-change-set` asked the unit of work to expose a
record-level change set (created/updated/deleted per entity, with the fields changed) at commit,
to replace the `<model>.created/updated/deleted` events removed from `@enardo/entities` 3.0.0.
At brainstorm the human reframed it: the tool is meant for a DDD architecture, not an ORM.
- CRUD change notifications are not a domain concern: in DDD the aggregate decides its events
  (`AggregateRoot.raise` / `pullEvents()` of `@enardo/entities` 3.0.0 already exist). When CRUD
  notifications are needed (projections, cache, search), they come from the domain events or from
  the store's CDC (Mongo change streams), not from the unit of work. No consumer asks for them today.
- What is missing is the persistence side of domain events: collecting the events the tracked
  aggregates raised, at commit, so they can be written atomically with the aggregate (transactional
  outbox).

#### Goal
- Each `TrackingRepository` takes an option that pulls the domain events from an aggregate
  (e.g. `pullEvents: (aggregate) => TEvent[]`), so `@enardo/uow-repository` depends on neither
  `@enardo/entities` nor `@enardo/events`.
- At commit, `TransactionalUnitOfWork` hands the collected events to a hook that runs INSIDE the
  transaction, with the transaction context (`ctx`), after the flush units: there the app writes
  them to an outbox (or, its own choice, dispatches them synchronously).
- `@enardo/uow-repository` never publishes to a bus. Relay and bus stay the app's.

#### Constraints and decisions (the human's)
- DDD, not an ORM: "Ti ricordo che non stiamo costruendo un ORM. Questo strumento nasce con
  l'intenzione di essere inserito in un'architettura DDD".
- Dispatching to an event bus inside the transaction is not the default: the hook inside the
  transaction is for the outbox (effects before commit, transaction retries re-running handlers,
  several aggregates in one transaction, coupling of the use case to secondary handlers).
- The hook runs inside the transaction (this supersedes an earlier "after commit" answer).
  A transaction retry re-runs it: events must be stable across retries (collected before the
  transaction, like the diffs, which are computed at plan time).
- Extending the public `UnitOfWorkParticipant` / `FlushUnit` contract is accepted: new minor
  0.3.0 (breaking below 1.0.0). `uow-repository-mongo` peers on `^0.2.0`.
- The CRUD change set of the backlog item goes to *Dropped* in docs/backlog.md, with the reason:
  not a domain concern; when needed for projections/cache, domain events or the store's change
  streams provide it; to reopen at the first concrete consumer.
- No dependency on `@enardo/events` or `@enardo/entities`; the README names neither.
- Open for the spec: what happens to events when the commit fails (pulled from the aggregate
  but not persisted); events of an aggregate with no state change (no flush unit) — must they
  still be collected?; events of a removed aggregate; ordering across repositories; whether the
  hook is called when there are events but no units; the hook's error (inside the transaction it
  rolls back the commit).

## Open findings

- chunk 1 red check skipped (escalation 1, user's choice): 22 new tests fail with TypeError (old positional constructor, missing pullEvents), not on an assertion or NotImplemented; a signature change cannot be stubbed by appending. Goes in chunk 1's commit body.
- chunk 3 red check skipped (escalation 2, user's choice): the 3 tests of case 19 pass already, the chunk has no src change. Goes in chunk 3's commit body.
- RESOLVED at checkpoint 2 (user: remove the replace, chunk 5): code-reviewer (round 1), needs judgment: remove, add, remove of one identity hands over the second instance's events, though it was added then removed (Decision 9 says no event); case 6 (remove/add/remove/add -> three instances' events) hands them over too. The spec points both ways; the code follows case 6.

## Lesson candidates

- DROPPED by the user (too heavy; the final review caught it): (critic: revise, accepted) CLAUDE.md Code conventions, after the README bullet: "A README example that a commit adds or changes is compiled against the built `dist` before it lands: `tsc --noEmit` in the dev container on a scratch file in the package, with the app's names declared as stubs, and the file removed afterwards." Evidence: 58a205f, 778e1d3.

## Backlog candidates

- DROPPED by the user (too heavy for its gain): lesson-critic: a check that compiles the READMEs' ts examples against dist (needs a convention to declare the app-side names); sources 58a205f, 778e1d3.

- DROPPED (moot without the replace): code-reviewer: an error of the app's pullEvents on a replaced identity throws from TrackingRepository.add (it pulls there), not from the commit's planning as the spec says; execute still rejects and no transaction opens. Document it in the README's Failures bullet, or defer the call.

- workflow: the split marked chunk 3 test-first though it changes no src/ (its behavior comes from earlier chunks), so no red was possible; such a chunk should be marked tests-after.

- workflow: red check rejects tests of a breaking signature change of an existing constructor (TypeError), which no appended stub can turn into NotImplemented; an exception or a stub step for that case.

## Log

- 2026-11-10T14:18:21Z opened on 8756612 of chore/repo/overload-trial
- 2026-11-10T14:18:37Z map: /tmp/claude-1000/-home-enardo-Projects-enardo-packages/0b60b770-6a99-4334-921e-93a9270bb187/scratchpad/map.md
- 2026-11-10T14:20:38Z decisions: DDD frame, not an ORM; collect domain events via repository pullEvents option; hook onEvents inside the transaction (outbox), no bus; CRUD change-set item to Dropped; 0.3.0 accepted
- 2026-11-10T14:23:49Z spec review 1: holds, 7 minor objections accepted and fixed (hook not required by types: claim dropped, runtime check kept; replace pulled in TrackingRepository.add with private map, appended; decision 4 restated; need anticipated; hasPendingChanges JSDoc; subclass cost; docs, pullEvents error, sync hook, mongo outbox e2e test added)
- 2026-11-10T14:23:56Z backlog candidate: the EventContext.session doubt of @enardo/events links to ADR 0021 (inside the transaction = outbox)
- 2026-11-10T14:27:46Z checkpoint 1: user approved the spec and ADR 0021 ('approvo 1) e 2)'), and the backlog link of the EventContext.session doubt to ADR 0021
- 2026-11-10T14:32:00Z chunk 1 red check round 1: not a valid red (22 tests fail with TypeError, no stubs for the new surface); back to the test-author
- 2026-11-10T14:34:13Z escalation 1 (chunk 1 red check): user chose skip, red accepted as is; noted for the commit body and as a backlog candidate
- 2026-11-10T14:35:58Z chunk 1: implementer reported repository.test.ts 'passes the identity through to the store without copying it' still passes identityKey positionally; spec case 14 disagrees with the test, back to the test-author
- 2026-11-10T14:37:50Z chunk 1 red check on suite 2: run with src stashed (the code was already in the tree), same TypeError red as suite 1 plus the fixed test; covered by the skip of escalation 1
- 2026-11-10T14:39:40Z chunk 1 step review 1: no code finding; test finding: 'forgets the events of a replaced instance on clear' passes without clearing the map (spec line 38 agrees with the finding), back to the test-author
- 2026-11-10T14:41:06Z chunk 1 red check on suite 3 (src stashed): same 23 TypeError failures, covered by the skip of escalation 1
- 2026-11-10T14:42:28Z chunk 1 step review 2: ok
- 2026-11-10T14:48:13Z chunk 2 red check on suite 4: valid red; 7 new tests pass already (type-level, case 13, public-api), for the step reviewer
- 2026-11-10T14:51:19Z chunk 2 step review 1: ok (mutations confirm the 7 tests green at the red check)
- 2026-11-10T14:53:38Z chunk 3 red check: not valid, the 3 tests of case 19 pass already (the chunk has no src change; chunks 1-2 provide the behavior); escalation 2
- 2026-11-10T14:56:38Z escalation 2 (chunk 3 red check): user chose skip, green tests accepted; no implementer; step reviewer mutation-checks the 3 tests
- 2026-11-10T14:59:21Z chunk 3 step review 1: ok (mutations confirm the 3 outbox tests)
- 2026-11-10T15:06:35Z chunk 4 step review 1: ok
- 2026-11-10T15:06:47Z all 4 chunks committed; branch verify green
- 2026-11-10T15:08:36Z review round 1 on afd8845: 1 blocking (README Domain events example does not compile: TEvent not inferred from an unannotated onEvents)
- 2026-11-10T15:10:14Z review round 2 on 58a205f: 0 blocking
- 2026-11-10T15:11:24Z lessons: 1 proposed, critic revise (widened to every README example a commit changes, compiled in the dev container), accepted
- 2026-11-10T15:44:57Z checkpoint 2: user accepted onEvents inside the transaction (documented); asked to remove the replace ('il replace stia complicando le cose inutilmente... vorrei toglierlo'): chunk 5; backlog 1 dropped (moot), 2 dropped (too heavy), workflow defects 3-4 go to workflow-overload, 5 already committed; lesson dropped (too heavy)
- 2026-11-10T15:47:29Z checkpoint 2: user approved the spec amendment (chunk 5, Decision 11, cases 20-21): 'procedi'
- 2026-11-10T15:50:48Z chunk 5 red check round 1: not valid, 6 tests fail on reasonOf's plain Error, not an assertion; back to the test-author
- 2026-11-10T15:55:05Z chunk 5: suite.sh latest() kept the support files mapped to record 7 after they were reverted to HEAD; user chose to delete record 7 only (was d31ceddd40d1c5029e0c6001b57adeb2fb080799)
- 2026-11-10T15:55:31Z chunk 5 red check on suite 8: valid red
- 2026-11-10T15:58:12Z chunk 5 step review 1: ok
- 2026-11-10T15:59:20Z review round on c2fd751: 2 blocking (README replace leftovers: core What gets written table :411-412; mongo :224 'repair with remove and then add'); mongo one judged single-answer: drop the alternative (two units of work are not atomic)
- 2026-11-10T16:00:33Z review round on 54f8174: 0 blocking; suggestion: rejectionOf duplicated in two test files
- 2026-11-10T16:03:41Z checkpoint 3: user gave the go ('via'); no lessons, no backlog items (rejectionOf candidate not kept)
