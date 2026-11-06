---
status: draft
type: fix
tier: L
implementer: sonnet/medium
packages: ["@enardo/uow-repository", "@enardo/uow-repository-mongo"]
branch: fix/uow-repository/unmapped-fields-kept
---

# Compare only the fields the mapper returns, with the values the store read

## Why

`TrackingRepository` snapshots the records the store returns as they are (`toSnapshot(records)` in `#track`, `packages/uow-repository/src/repository.ts:270`), and diffs them on commit against `toRecords(entity)`. A field the store holds and `toRecords` never returns is therefore unset on the first commit after a load, even in a use case that only reads, and the version goes up:

- a store-managed field (`createdAt`, `__v`, a field another service writes) goes silently;
- `_id` under a custom `idField` of `@enardo/uow-repository-mongo` fails the commit instead, with code 66, so that README asks the mapper to carry it.

The core's README makes the round trip a rule of the mapper (*Mapper rules*, *Round-trip*), so the loss is documented, but nothing stops it. From the backlog item that the evaluation of 2026-11-06 rewrote (`docs/repo/raw-snapshot-backlog-item`); the option and the decisions below come from the discussion with the user at intake.

## Probes

- A read-only use case on a Mongo root holding a `createdAt` the mapper ignores, on `main`, replica set → the document lost `createdAt` and went from `_version: 1` to `2`.
- The core on `main`, with a fake store and a group of two collections, one commit per case after a `findById` and no edit:
  - a root field the mapper ignores → `unset: ["createdAt"]`;
  - a field missing from the store that `toDomain` defaults → `set: { currency: "EUR" }`;
  - a name `toDomain` trims → `set: { name: "N" }`;
  - a child `toDomain` filters out → `deleted: [that child]`;
  - a child whose key `toDomain` changes → `deleted` the old key, `inserted` the new one;
  - a `toRecords` that throws → `findById` resolves, the commit rejects with the mapper's error.
- B applied provisionally in `#track` (restricted as *Changes* says), both suites → two tests fail, every other passes (115 in the core, 49 in the adapter):
  - core, `repository.test.ts:469`, "fails the unit of work … two records with one key, even if nothing changed": its fixture stores the duplicate under `_id: "g-1:u-2"`, while `memberRecord` (`:1097`) keys it `["g-1","u-2"]`. Under B the stored duplicates match no record the mapper returns, so they leave the snapshot, and the error names the `next` side instead of `previous`;
  - adapter, `custom-id-field.test.ts:229`, "fails every commit … when the mapper leaves `_id` out": the commit succeeds.
- The diff, the key functions and the duplicate check to reuse → `packages/uow-repository/src/record-set.ts` (`diffRecordSets`, `recordsOf`, `indexByKey`).
- `pnpm view` on the registry → `@enardo/uow-repository` and `@enardo/uow-repository-mongo` are published at `0.1.0` only: `0.2.0` of both is unpublished and takes the change as it is, with no new version.
- `git grep '"@enardo/uow-repository"' -- 'packages/*/package.json'` → the adapter is the only dependent.

## Decisions

1. **Snapshot: the stored values of the fields the mapper returns (B).** At load, `toRecords(toDomain(records))` gives, for each record key, the set of top-level fields the mapper owns. The snapshot keeps, of each stored record, only those fields, with the values the store returned. The user's choice.
   - Kept: a field the mapper never returns is never written; a field it returns is compared with what the store holds, so defaults, normalizations and lossy conversions are written as today, and the README's round-trip test still catches them.
   - Not taken, A: the snapshot is `toRecords(toDomain(records))` itself. It also stops writing a default or a normalization, which an app may rely on as a lazy migration, and the round-trip test would always pass.
   - Not taken: the Mongo store keeping `_id` out of what it reads. It covers `_id` only, and breaks the mappers that keep `_id`, as that README asks today.
2. **A stored record the mapper does not return is left alone.** It leaves the snapshot, so it is never deleted by a diff. A record the mapper returns and the store did not hold is inserted on the first commit, as today. The user's choice; see *Open questions*.
3. **The field set is taken at load**, from the entity `toDomain` just built, before any edit. Taken at commit from the edited entity, an optional field the domain cleared would leave the snapshot and never be unset.
4. **Fields are matched per record key, at the top level**, the level the diff compares. Stored records that share a key all take the fields of the mapper's records with that key, so the duplicate check still fires on the `previous` side.
5. **No new version.** Both packages are at an unpublished `0.2.0`; their `Upgrading from 0.1` sections gain the change.
6. **An ADR**, `docs/adr/0019-the-diff-compares-only-what-the-mapper-returns.md`, `proposed` in this commit: the rule outlives the task, and a future data store relies on it.

## Open questions

1. **Decision 2 against a key the mapper changes.** The core's probe above shows how easily a mapper returns a key in another form than the store's: the test fixture does it. Under decision 2, such a record leaves the snapshot, so the first commit inserts the mapper's record beside the stored one instead of replacing it (today: delete and insert). On Mongo that is a second child document, and the next load fails with the duplicate check, or two entities hold one member. The same holds for an `ObjectId` read back as a string. My view: keep today's behavior at the record level (a stored record the mapper does not return stays in the snapshot whole, and is deleted), and restrict only the fields of the records the mapper returns. The README's *Stable* rule already describes a key change as a delete plus an insert; a child that `toDomain` filters out stays deleted, which the README would say. If the user keeps decision 2, test case 9 pins the insert, and the README warns of it under *Stable*.

## Changes

### `@enardo/uow-repository`

- `src/record-set.ts`: an internal function, not exported from `src/index.ts`, that takes the stored record set, the mapped one and the record keys, and returns the stored records restricted to the fields of the mapped record with the same key (decision 4), leaving out a stored record whose key the mapper does not return (decision 2). It reads collections through `recordsOf`, so a missing collection throws the `TypeError` it throws today, and copies nothing itself: it runs on snapshots.
- `src/repository.ts`, `#track`: the snapshot is that function applied to `toSnapshot(records)` and `#recordsOf(entity)`. `findById`, `findAll` and `findOneBy` all go through it. The doc comments of the snapshot and of `#findUnsavedChanges` say what is compared.
- A `toRecords` that throws now rejects the read that loaded the entity, instead of its commit. A read through the repository is meant for a unit of work, which mapped every loaded entity on commit already, so no use case that succeeded today fails now.
- `README.md`:
  - *Mapper rules*, *Round-trip*: the fields `toRecords` returns must reproduce what the store holds for them; a field it never returns is never written, so store-managed fields need no place in the entity. Defaults, trimming and lossy conversions still show as a write on every commit until they are stored.
  - *Records and record keys*, *Stable*: what a key change does under decision 2 (or under the open question's answer); a record the mapper does not return is left alone.
  - *What gets written*, *Change detection*: what the snapshot holds.
  - *Upgrading from 0.1*: a paragraph on the change. An app that removed a field by leaving it out of `toRecords` now keeps it in the store: it removes it with a migration of the stored documents, since a field `toRecords` returns as `undefined` is absent from both sides of the diff.

### `@enardo/uow-repository-mongo`

- `README.md`: *A custom `idField`* loses *The mapper keeps `_id`*, and says the store leaves the document's `_id` alone when the mapper leaves it out; the summary line under the collections table (`:179`) asks for the unique index only. The layout line of `custom-id-field.test.ts`. *Upgrading from 0.1*: a line pointing to the core's.
- No change to `src/`.

### Repo

- `docs/backlog.md`: the item leaves *To evaluate*, in a commit of its own.
- `docs/adr/0019-…` and its row in `docs/adr/README.md`; `accepted` at the merge.

## Test cases

Core cases run with the fake store of `repository.test.ts`; the store returns, the mapper reads and the commit runs in `unitOfWork.execute`. "No write" means `apply` is not called.

1. A root record with a field the mapper ignores (`createdAt`), loaded with `findById` and not edited → no write.
2. The same, with `name` edited → one `apply`, `set: { name }`, `unset: []`.
3. A child record with a field the mapper ignores, not edited → no write.
4. An optional field the mapper returns, present at load, cleared in the entity → `unset` holds it (decision 3).
5. A field missing from the store that `toDomain` defaults → `set` holds it on the first commit; a second unit of work over the stored result writes nothing.
6. A name `toDomain` trims → `set` holds the trimmed value (decision 1, against A).
7. `findAll` and `findOneBy` (through a subclass) on case 1's record → no write.
8. The existing duplicate test (`repository.test.ts:469`), with its duplicates stored under the key the mapper returns (`memberRecord`) → the `previous`-side message, with that key; `apply` not called. Its expected message changes with the key, and the comment on the quotes goes.
9. A child `toDomain` filters out, not edited → no write (decision 2). A child whose key `toDomain` changes → `inserted` the new key, nothing `deleted` (decision 2; if the open question goes the other way, `deleted` the old key and `inserted` the new one, and the filtered child is `deleted`).
10. A `toRecords` that throws → `findById` rejects with that error, and the unit of work rejects with it, `apply` not called.
11. The restricting function, directly: stored records with extra fields and a mapped record set with fewer → the stored values of the mapped fields only, and a stored record whose key the mapped side lacks left out; a collection missing from the stored side → a `TypeError` naming that collection.

Adapter cases run on the replica set, through `TrackingRepository` and `TransactionalUnitOfWork`.

12. `custom-id-field.test.ts:229`, rewritten: with a custom root `idField` and a mapper without `_id`, a read-only use case commits and the document keeps its `_id` and `_version: 1`; a use case that edits `note` commits, and the document keeps its `_id` and gets `_version: 2`.
13. A child collection with a custom `idField` and a mapper without the child's `_id`: an edit of a child's label commits, and the child document keeps its `_id`.
14. A root with a `createdAt` the mapper ignores: a read-only use case leaves the document unchanged, `_version: 1`; an edit keeps `createdAt` and writes `_version: 2`.

## Risks

`medium`: data correctness. Under decision 1, the writes are a subset of today's: only the `unset` of a field the mapper never returns goes. Decision 2 also drops the delete of a stored record the mapper does not return, and turns a key change into an insert (*Open questions*). What shows a mistake: cases 4 to 6 for a snapshot built like A or at commit, case 8 for duplicates that leave the check, case 1 against a fix of `_id` alone.

## Out of scope

- A query filter for the children the Mongo store reads (a soft-delete filter in the store rather than in `toDomain`).
- Nested fields: they are compared and written whole, as today. A nested field `toDomain` drops is lost when its top-level field is next written.
- Removing the round-trip test from the README: under decision 1 it still catches lossy mappers.

## Plan

1. This spec and ADR 0019 (`proposed`), the first commit.
2. Test-first: the `test-author` writes cases 1 to 14 from this spec; they fail on the current code for the expected reason (cases 8 and 12 change existing tests, as this spec says).
3. The restricting function and `#track`, with the doc comments: the core and the adapter suites green.
4. The two READMEs.
5. The backlog item removed; at the merge, ADR 0019 `accepted` and this spec `done`.
