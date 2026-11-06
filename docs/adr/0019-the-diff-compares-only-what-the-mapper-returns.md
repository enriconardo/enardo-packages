# 0019. The diff compares only the fields the mapper returns, with the values the store read

- Status: proposed
- Date: 2026-11-06
- Spec: docs/specs/2026-11-06-unmapped-fields-kept.md

## Context

`TrackingRepository` of `@enardo/uow-repository` plans the writes of a loaded aggregate by diffing a snapshot taken at load with `toRecords(entity)` on commit. The snapshot held the records as the store returned them, so a field the store holds and the mapper never returns was unset on the first commit after a load, even a read-only one: a store-managed `createdAt` went silently, and the `_id` of a Mongo document under a custom `idField` failed the commit with code 66 (probed on 2026-11-06). The README made the round trip a rule of the mapper, and nothing enforced it.

The mapper is written by hand and declares no fields, so the repository learns what it owns only from what `toRecords` returns. Data-mapper ORMs compare the mapped state only: Hibernate and Doctrine never touch a column or a field they do not map.

## Decision

1. **The snapshot holds, of each stored record, only the top-level fields that `toRecords(toDomain(records))` returns for the record with the same key, with the values the store returned.** The field set is taken at load, before any edit.
2. **A field the mapper never returns is never written** by a diff, in a data store that applies `set` and `unset` as the contract asks. A store never writes an update's `record` whole: it lacks those fields.
3. **A field the mapper returns is compared with what the store holds**, so a default, a normalization or a lossy conversion in the mapper is written, as before.
4. **Records are matched as before.** A stored record whose key the mapper does not return stays in the snapshot whole, so it is deleted; a key the mapper changes is a delete plus an insert. Only fields are restricted.

## Consequences

- A store-managed field needs no place in the entity, and a read-only use case writes nothing unless the mapper changes a field it owns.
- A data store returns whole documents, and its updates name only owned fields: it never filters a field for the mapper's sake.
- Loading must not fail where it did not before: a `toRecords` that throws at load, or stored records the diff would refuse, leave the snapshot as the store returned it, and the commit reports them.
- Nested values are still compared whole, so a nested field the mapper drops is lost on the first commit after a load.
- An app can no longer remove a stored field by leaving it out of `toRecords`: it migrates the stored documents.
- Each load maps the entity back once more.

## Alternatives considered

- **The snapshot as `toRecords(toDomain(records))`.** It never writes an unmapped field either, but it also stops writing a default or a normalization, which apps use as a lazy migration, and a lossy mapper would no longer show.
- **The data store hides its bookkeeping fields**, such as Mongo leaving `_id` out of what it reads under a custom `idField`. It covers one field per store, and breaks the mappers that read it.
- **Leaving alone a stored record the mapper does not return**, as for a field. A key the mapper returns in another form than the store's, which the core's own tests did, would then be inserted beside the stored record instead of replacing it.
- **Keeping the round trip as a rule of the mapper.** The loss is silent, and every app must list the store's fields in its entities.
