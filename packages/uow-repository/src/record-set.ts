import { isDeepStrictEqual } from "node:util";
import { DuplicateRecordKeyError, InvalidRecordSetError } from "./errors";

/**
 * Constrains `TRecords` to hold every record an aggregate owns, grouped by
 * collection.
 *
 * Records keep the shape the store gives them: the grouping is the only
 * structure added. An aggregate stored as a single record is a record set with
 * one collection holding one record.
 */
export type RecordSet<TRecords> = { [C in keyof TRecords]: readonly object[] };

/** The type of the records that collection `C` holds. */
export type RecordOf<
  TRecords,
  C extends keyof TRecords,
> = TRecords[C] extends readonly (infer TRecord)[] ? TRecord : never;

/**
 * Reads, for every collection, the key that identifies a record within it.
 *
 * Types are erased at runtime, so this is how a diff learns which collections
 * a record set has and how to match records across two versions of it.
 */
export type RecordKeys<TRecords extends RecordSet<TRecords>> = {
  readonly [C in keyof TRecords]: (record: RecordOf<TRecords, C>) => string;
};

/** A record that both sides hold, with the top-level fields that differ. */
export interface RecordUpdate<TRecord> {
  /** The record as `next` holds it, to read its identity from or to write whole. */
  readonly record: TRecord;
  /** Top-level fields whose value was added or changed, with the new value. */
  readonly set: Partial<TRecord>;
  /** Top-level fields whose value was removed. */
  readonly unset: readonly (keyof TRecord & string)[];
}

/** The writes that bring one collection from its previous records to its next ones. */
export interface CollectionChanges<TRecord> {
  readonly inserted: readonly TRecord[];
  readonly updated: readonly RecordUpdate<TRecord>[];
  readonly deleted: readonly TRecord[];
}

/** The writes of every described collection, including those that need none. */
export type ChangeSet<TRecords extends RecordSet<TRecords>> = {
  readonly [C in keyof TRecords]: CollectionChanges<RecordOf<TRecords, C>>;
};

type Side = "previous" | "next";
type AnyRecord = Record<string, unknown>;
type KeyFunction = (record: AnyRecord) => string;

/**
 * Lists the writes that turn `previous` into `next`, at two levels.
 *
 * - Records are matched by key within each collection. A key only `next` holds
 *   is inserted and a key only `previous` holds is deleted, so a record whose
 *   key changed is both. Reordering records is not a change.
 * - Fields of a record both sides hold are compared at the top level. Nested
 *   values are compared structurally and written whole: a position in an array
 *   is not an identity, so elements that have one belong in a collection.
 *
 * An undefined `previous` holds no records, so every record of `next` is
 * inserted, as for a new aggregate.
 *
 * Both sides must be snapshots (see toSnapshot): a field holding undefined
 * would count as a value. The result shares references with both sides.
 *
 * Changes follow record order: the order of `next` for inserted and updated
 * records, the order of `previous` for deleted ones.
 *
 * @throws {InvalidRecordSetError} A side lacks a collection a key function
 *   describes. The error names the collection and the side at fault, which
 *   iterating the missing collection would not.
 * @throws {DuplicateRecordKeyError} Two records of one collection share a key.
 */
export function diffRecordSets<TRecords extends RecordSet<TRecords>>(
  previous: TRecords | undefined,
  next: TRecords,
  recordKeys: RecordKeys<TRecords>,
): ChangeSet<TRecords> {
  const keyFunctions = recordKeys as unknown as Record<string, KeyFunction>;
  const changes: Record<string, CollectionChanges<AnyRecord>> = {};

  for (const [collection, keyOf] of Object.entries(keyFunctions)) {
    changes[collection] = diffCollection(
      collection,
      recordsOf(previous, collection, "previous"),
      recordsOf(next, collection, "next"),
      keyOf,
    );
  }

  return changes as unknown as ChangeSet<TRecords>;
}

/** Reports whether a change set holds no write at all. */
export function isEmptyChangeSet<TRecords extends RecordSet<TRecords>>(
  changes: ChangeSet<TRecords>,
): boolean {
  return Object.values(
    changes as unknown as Record<string, CollectionChanges<unknown>>,
  ).every(
    ({ inserted, updated, deleted }) =>
      inserted.length === 0 && updated.length === 0 && deleted.length === 0,
  );
}

/** Reads a described collection; an undefined record set holds no records. */
function recordsOf(
  recordSet: object | undefined,
  collection: string,
  side: Side,
): readonly AnyRecord[] {
  if (recordSet === undefined) return [];

  const records = (recordSet as AnyRecord)[collection];

  if (!Array.isArray(records)) {
    throw new InvalidRecordSetError(collection, side);
  }

  return records as readonly AnyRecord[];
}

function diffCollection(
  collection: string,
  previous: readonly AnyRecord[],
  next: readonly AnyRecord[],
  keyOf: KeyFunction,
): CollectionChanges<AnyRecord> {
  const previousByKey = indexByKey(collection, previous, keyOf, "previous");
  const nextByKey = indexByKey(collection, next, keyOf, "next");
  const inserted: AnyRecord[] = [];
  const updated: RecordUpdate<AnyRecord>[] = [];
  const deleted: AnyRecord[] = [];

  for (const [key, record] of nextByKey) {
    const previousRecord = previousByKey.get(key);

    if (previousRecord === undefined) {
      inserted.push(record);
      continue;
    }

    const update = diffRecord(previousRecord, record);

    if (update !== undefined) {
      updated.push(update);
    }
  }

  for (const [key, record] of previousByKey) {
    if (!nextByKey.has(key)) {
      deleted.push(record);
    }
  }

  return { inserted, updated, deleted };
}

/** Indexes records by key, keeping their order. */
function indexByKey(
  collection: string,
  records: readonly AnyRecord[],
  keyOf: KeyFunction,
  side: Side,
): Map<string, AnyRecord> {
  const byKey = new Map<string, AnyRecord>();

  for (const record of records) {
    const key = keyOf(record);

    // Keeping either record would silently drop the writes of the other.
    if (byKey.has(key)) {
      throw new DuplicateRecordKeyError(collection, key, side);
    }

    byKey.set(key, record);
  }

  return byKey;
}

/**
 * Lists the top-level fields that differ between two versions of one record.
 *
 * Fields are looked up as own properties: a record lacking a field named like
 * an Object.prototype member, such as `constructor`, must not seem to hold it.
 */
function diffRecord(
  previous: AnyRecord,
  next: AnyRecord,
): RecordUpdate<AnyRecord> | undefined {
  const set: AnyRecord = {};

  for (const [field, value] of Object.entries(next)) {
    if (
      !Object.hasOwn(previous, field) ||
      !isDeepStrictEqual(previous[field], value)
    ) {
      set[field] = value;
    }
  }

  const unset = Object.keys(previous).filter(
    (field) => !Object.hasOwn(next, field),
  );

  if (unset.length === 0 && Object.keys(set).length === 0) return undefined;

  return { record: next, set, unset };
}
