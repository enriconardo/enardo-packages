import type { ChangeSet, RecordKeys, RecordSet } from "./record-set";

/**
 * Every record of one aggregate, with the version the store holds for it.
 *
 * The version travels beside the records rather than inside them, so neither
 * the domain entity nor the mapper has to carry it.
 */
export interface VersionedRecords<TRecords, TVersion> {
  readonly records: TRecords;
  readonly version: TVersion;
}

/** The writes for one aggregate, with the version they were planned against. */
export interface AggregateWrite<
  TRecords extends RecordSet<TRecords>,
  TId,
  TVersion,
> {
  readonly id: TId;
  /**
   * The version read when the aggregate was loaded, or undefined for an
   * insert, where nothing was read.
   */
  readonly expectedVersion: TVersion | undefined;
  readonly changes: ChangeSet<TRecords>;
}

/**
 * Defines persistence operations without exposing storage details to domain code.
 *
 * The store owns the version format: the library only hands back the version
 * it read, never computes the next one. `TVersion` excludes null and undefined
 * because undefined marks a write with no version to check.
 *
 * `TId` is the identity in the form the store holds it: the repository has
 * already converted it with the mapper's toStoredId.
 */
export interface DataStore<
  TRecords extends RecordSet<TRecords>,
  TId,
  TContext,
  TVersion extends NonNullable<unknown> = number,
> {
  /** Identifies each record within its collection, so changes are found record by record. */
  readonly recordKeys: RecordKeys<TRecords>;
  /** Reads every record of one aggregate, with every collection present, and its version. */
  findById(id: TId): Promise<VersionedRecords<TRecords, TVersion> | null>;
  findAll(): Promise<readonly VersionedRecords<TRecords, TVersion>[]>;
  /**
   * Writes the inserts, field updates and deletes a change set lists.
   *
   * When `expectedVersion` is set, first checks that the stored version still
   * equals it and advances the version, in one atomic operation within
   * `context`, even if the record holding the version has no change of its
   * own. On a mismatch, throws ConcurrencyConflictError without writing.
   */
  apply(
    write: AggregateWrite<TRecords, TId, TVersion>,
    context: TContext,
  ): Promise<void>;
  /**
   * Deletes every record of one aggregate, in every collection.
   *
   * Checks `expectedVersion` like apply when it is set. It is undefined when
   * the entity was removed without being loaded, and the delete is then
   * unconditional.
   */
  delete(
    id: TId,
    expectedVersion: TVersion | undefined,
    context: TContext,
  ): Promise<void>;
}
