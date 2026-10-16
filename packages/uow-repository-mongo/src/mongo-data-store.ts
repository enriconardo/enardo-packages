import {
  BSON,
  type AnyBulkWriteOperation,
  type ClientSession,
  type Collection,
  type Document,
  type Filter,
  type MongoClient,
  type Sort,
  type UpdateFilter,
} from "mongodb";
import type { IMongoTransaction } from "@enardo/transaction-manager-mongo";
import {
  ConcurrencyConflictError,
  type AggregateWrite,
  type CollectionChanges,
  type DataStore,
  type RecordKeys,
  type RecordOf,
  type RecordSet,
  type RecordUpdate,
  type VersionedRecords,
} from "@enardo/uow-repository";
import {
  InvalidDataStoreOptionsError,
  MissingCollectionChangesError,
} from "./errors";

/** A top-level field of a record. */
type FieldOf<TRecord> = keyof TRecord & string;

interface CollectionMappingBase<TRecord> {
  /** The collection that stores the records, one document per record. */
  readonly collection: Collection<Document>;
  /** The field that identifies a record within its collection. Defaults to `_id`. */
  readonly idField?: FieldOf<TRecord> | undefined;
}

/**
 * The collection holding the one record that identifies the aggregate, by its
 * id field, and carries its version.
 */
export interface RootCollectionMapping<
  TRecord,
> extends CollectionMappingBase<TRecord> {
  readonly root: true;
}

/** A collection holding any number of records of each aggregate. */
export interface ChildCollectionMapping<
  TRecord,
> extends CollectionMappingBase<TRecord> {
  readonly root?: false | undefined;
  /** The field holding the identity of the aggregate the record belongs to. */
  readonly aggregateIdField: FieldOf<TRecord>;
}

export type MongoCollectionMapping<TRecord> =
  RootCollectionMapping<TRecord> | ChildCollectionMapping<TRecord>;

export interface MongoDataStoreOptions<TRecords extends RecordSet<TRecords>> {
  /** Opens the snapshot sessions that read several collections from one state. */
  readonly client: MongoClient;
  /**
   * How each collection of the record set is stored. The mapped type makes the
   * compiler require every collection: one left out would never be written.
   */
  readonly collections: {
    readonly [C in keyof TRecords]: MongoCollectionMapping<
      RecordOf<TRecords, C>
    >;
  };
  /**
   * The field of the root document that holds the version. Defaults to
   * `_version`: the underscore marks it as bookkeeping, like `_id`, so it
   * doesn't collide with the fields of a record.
   */
  readonly versionField?: string | undefined;
}

/** How findMany sorts and pages the root documents. */
export interface MongoFindManyOptions {
  readonly sort?: Sort | undefined;
  readonly skip?: number | undefined;
  readonly limit?: number | undefined;
}

interface StoredCollection {
  readonly name: string;
  readonly collection: Collection<Document>;
  readonly idField: string;
}

interface StoredChildCollection extends StoredCollection {
  readonly aggregateIdField: string;
}

type AnyChanges = CollectionChanges<Document>;

/** @throws {MissingCollectionChangesError} The change set breaks its contract. */
function changesOf(
  changeSet: Readonly<Record<string, AnyChanges>>,
  collection: string,
): AnyChanges {
  const collectionChanges = changeSet[collection];
  if (collectionChanges === undefined) {
    throw new MissingCollectionChangesError(collection);
  }
  return collectionChanges;
}

/**
 * Stores an aggregate as one root document, which carries the version, and
 * any number of child documents in other collections, each naming its
 * aggregate in a field.
 *
 * Versions are numbers, kept in the `_version` field of the root document by
 * default: an insert starts at 1 and every write checks the version read and
 * increments it. A root document without a version, such as one written
 * before this store was used, reads as version 0, so existing data needs no
 * migration.
 */
export class MongoDataStore<
  TRecords extends RecordSet<TRecords>,
  TId,
> implements DataStore<TRecords, TId, IMongoTransaction, number> {
  readonly recordKeys: RecordKeys<TRecords>;
  readonly #client: MongoClient;
  readonly #versionField: string;
  readonly #root: StoredCollection;
  readonly #children: readonly StoredChildCollection[];

  /**
   * @throws {InvalidDataStoreOptionsError} The collections name no root, or
   *   more than one.
   */
  constructor(options: MongoDataStoreOptions<TRecords>) {
    const mappings = Object.entries<MongoCollectionMapping<Document>>(
      options.collections,
    );
    const roots = mappings.filter(([, mapping]) => mapping.root === true);

    const [root, ...otherRoots] = roots;
    if (root === undefined || otherRoots.length > 0) {
      throw new InvalidDataStoreOptionsError(roots.map(([name]) => name));
    }

    const [rootName, rootMapping] = root;
    this.#client = options.client;
    this.#versionField = options.versionField ?? "_version";
    this.#root = {
      name: rootName,
      collection: rootMapping.collection,
      idField: rootMapping.idField ?? "_id",
    };
    this.#children = mappings.flatMap(([name, mapping]) =>
      mapping.root === true
        ? []
        : [
            {
              name,
              collection: mapping.collection,
              idField: mapping.idField ?? "_id",
              aggregateIdField: mapping.aggregateIdField,
            },
          ],
    );
    this.recordKeys = Object.fromEntries(
      mappings.map(([name, { idField = "_id" }]) => [
        name,
        (record: Document) => keyOf(record[idField]),
      ]),
    ) as unknown as RecordKeys<TRecords>;
  }

  async findById(id: TId): Promise<VersionedRecords<TRecords, number> | null> {
    return this.findOne(this.#rootFilter(id));
  }

  async findAll(): Promise<readonly VersionedRecords<TRecords, number>[]> {
    return this.findMany();
  }

  /**
   * Reads the first aggregate whose root document matches `filter`, with the
   * records of every child collection, as findById does.
   *
   * Pass it to the protected findOneBy of Repository, so that the aggregate
   * is tracked: `this.findOneBy(() => store.findOne({ email }))`.
   */
  async findOne(
    filter: Filter<Document>,
  ): Promise<VersionedRecords<TRecords, number> | null> {
    const [found] = await this.findMany(filter, { limit: 1 });
    return found ?? null;
  }

  /**
   * Reads every aggregate whose root document matches `filter`, with the
   * records of every child collection. Sorting and paging apply to the root
   * documents, and only the children of the roots found are read.
   */
  async findMany(
    filter: Filter<Document> = {},
    { sort, skip, limit }: MongoFindManyOptions = {},
  ): Promise<readonly VersionedRecords<TRecords, number>[]> {
    return this.#read(async (session) => {
      const cursor = this.#root.collection.find(filter, { session });

      if (sort !== undefined) cursor.sort(sort);
      if (skip !== undefined) cursor.skip(skip);
      if (limit !== undefined) cursor.limit(limit);

      const roots = await cursor.toArray();
      const rootIds = roots.map((root): unknown => root[this.#root.idField]);
      const childrenByAggregate = new Map<string, Map<string, Document[]>>();

      // One at a time: a session must not run operations concurrently.
      for (const child of rootIds.length === 0 ? [] : this.#children) {
        const documents = await child.collection
          .find({ [child.aggregateIdField]: { $in: rootIds } }, { session })
          .toArray();

        for (const document of documents) {
          const aggregateKey = keyOf(document[child.aggregateIdField]);
          const children =
            childrenByAggregate.get(aggregateKey) ??
            new Map<string, Document[]>();
          childrenByAggregate.set(aggregateKey, children);
          children.set(child.name, [
            ...(children.get(child.name) ?? []),
            document,
          ]);
        }
      }

      return roots.map((root) =>
        this.#toVersionedRecords(
          root,
          childrenByAggregate.get(keyOf(root[this.#root.idField])) ?? new Map(),
        ),
      );
    });
  }

  /** Counts the root documents that match `filter`: one per aggregate. */
  async count(filter: Filter<Document> = {}): Promise<number> {
    return this.#root.collection.countDocuments(filter);
  }

  /**
   * Checks and advances the version on the root document first, so that a
   * conflict is found before anything else is written. Then writes each child
   * collection in one ordered bulk write: deletes before inserts, so that a
   * record whose key changed doesn't collide with itself on a unique index.
   *
   * The root record must keep its id: only its field changes are written.
   */
  async apply(
    { id, expectedVersion, changes }: AggregateWrite<TRecords, TId, number>,
    { session }: IMongoTransaction,
  ): Promise<void> {
    const changeSet = changes as unknown as Record<string, AnyChanges>;
    const rootChanges = changesOf(changeSet, this.#root.name);

    if (expectedVersion === undefined) {
      for (const record of rootChanges.inserted) {
        await this.#root.collection.insertOne(
          { ...record, [this.#versionField]: 1 },
          { session },
        );
      }
    } else {
      await this.#updateRoot(
        id,
        expectedVersion,
        rootChanges.updated[0],
        session,
      );
    }

    for (const child of this.#children) {
      await this.#writeChildren(
        child,
        id,
        changesOf(changeSet, child.name),
        session,
      );
    }
  }

  async delete(
    id: TId,
    expectedVersion: number | undefined,
    { session }: IMongoTransaction,
  ): Promise<void> {
    const filter =
      expectedVersion === undefined
        ? this.#rootFilter(id)
        : { ...this.#rootFilter(id), ...this.#versionFilter(expectedVersion) };
    const { deletedCount } = await this.#root.collection.deleteOne(filter, {
      session,
    });

    if (expectedVersion !== undefined && deletedCount === 0) {
      throw new ConcurrencyConflictError(id, expectedVersion);
    }

    for (const child of this.#children) {
      await child.collection.deleteMany(
        { [child.aggregateIdField]: id },
        { session },
      );
    }
  }

  /**
   * Reads an aggregate held in one collection with no session. One held in
   * several collections is read in a snapshot session, so that every
   * collection is read from the same point in time and a mix of two versions
   * can't be written back.
   */
  async #read<T>(
    work: (session: ClientSession | undefined) => Promise<T>,
  ): Promise<T> {
    if (this.#children.length === 0) {
      return work(undefined);
    }

    return this.#client.withSession({ snapshot: true }, work);
  }

  /** Separates the version from the root record: the mapper must never see it. */
  #toVersionedRecords(
    root: Document,
    children: ReadonlyMap<string, Document[]>,
  ): VersionedRecords<TRecords, number> {
    const { [this.#versionField]: version, ...record } = root;
    const records: Record<string, Document[]> = {
      [this.#root.name]: [record],
    };

    for (const child of this.#children) {
      records[child.name] = children.get(child.name) ?? [];
    }

    return {
      records: records as unknown as TRecords,
      version: (version as number | null | undefined) ?? 0,
    };
  }

  /** Writes the root's field changes only if its version is still the one read. */
  async #updateRoot(
    id: TId,
    expectedVersion: number,
    update: RecordUpdate<Document> | undefined,
    session: ClientSession,
  ): Promise<void> {
    const { matchedCount } = await this.#root.collection.updateOne(
      { ...this.#rootFilter(id), ...this.#versionFilter(expectedVersion) },
      {
        ...fieldChanges(update),
        $inc: { [this.#versionField]: 1 },
      },
      { session },
    );

    if (matchedCount === 0) {
      throw new ConcurrencyConflictError(id, expectedVersion);
    }
  }

  async #writeChildren(
    child: StoredChildCollection,
    id: TId,
    { inserted, updated, deleted }: AnyChanges,
    session: ClientSession,
  ): Promise<void> {
    // Scoped to the aggregate, so a record of another aggregate is never touched.
    const filterOf = (record: Document): Filter<Document> => ({
      [child.idField]: record[child.idField] as unknown,
      [child.aggregateIdField]: id,
    });
    const operations: AnyBulkWriteOperation<Document>[] = [
      ...deleted.map((record) => ({
        deleteOne: { filter: filterOf(record) },
      })),
      ...inserted.map((record) => ({ insertOne: { document: record } })),
      ...updated.map((update) => ({
        updateOne: {
          filter: filterOf(update.record),
          update: fieldChanges(update),
        },
      })),
    ];

    if (operations.length === 0) {
      return;
    }

    await child.collection.bulkWrite(operations, { ordered: true, session });
  }

  #rootFilter(id: TId): Filter<Document> {
    return { [this.#root.idField]: id };
  }

  /**
   * Matches the expected version. Version 0 also matches a document without a
   * version, which is how such a document reads.
   */
  #versionFilter(expectedVersion: number): Filter<Document> {
    return {
      [this.#versionField]:
        expectedVersion === 0 ? { $in: [0, null] } : expectedVersion,
    };
  }
}

/**
 * Keys a value for matching, in extended JSON: equal ObjectIds, which are
 * distinct instances, and embedded documents get the same key.
 */
function keyOf(value: unknown): string {
  return BSON.EJSON.stringify(value);
}

/** Turns a record update into `$set` and `$unset`, leaving out the empty one. */
function fieldChanges(
  update: RecordUpdate<Document> | undefined,
): UpdateFilter<Document> {
  const changes: UpdateFilter<Document> = {};

  if (update === undefined) {
    return changes;
  }

  if (Object.keys(update.set).length > 0) {
    changes.$set = update.set;
  }

  if (update.unset.length > 0) {
    changes.$unset = Object.fromEntries(
      update.unset.map((field) => [field, ""]),
    );
  }

  return changes;
}
