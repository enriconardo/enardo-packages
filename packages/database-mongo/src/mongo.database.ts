import type { Db, IndexDescriptionInfo } from "mongodb";
import { MongoClient, MongoServerError } from "mongodb";
import type {
  IMongoDatabase,
  IMongoDatabaseOptions,
  IMongoIndex,
  IMongoSchema,
  SchemaSyncResult,
  StaleIndexDropResult,
} from "./mongo.database.types";

/** `IndexOptionsConflict` and `IndexKeySpecsConflict`: the index exists with another definition. */
const INDEX_CONFLICT_CODES = [85, 86];

/** `NamespaceNotFound`: the collection does not exist. */
const NAMESPACE_NOT_FOUND_CODE = 26;

function isNamespaceNotFound(error: unknown): error is MongoServerError {
  return (
    error instanceof MongoServerError && error.code === NAMESPACE_NOT_FOUND_CODE
  );
}

/** Misuse of the lifecycle, so a native `Error` (ADR 0012 point 6), with no `code`. */
function notConnected(method: string): Error {
  return new Error(
    `MongoDatabase is not connected: await connect() before ${method}().`,
  );
}

function isIndexConflict(error: unknown): error is MongoServerError {
  return (
    error instanceof MongoServerError &&
    typeof error.code === "number" &&
    INDEX_CONFLICT_CODES.includes(error.code)
  );
}

/**
 * MongoDB implementation of the {@link IMongoDatabase} interface.
 *
 * Manages the connection lifecycle to a MongoDB instance. The schemas'
 * collections, validators and indexes are synced on request, as a step of
 * a deploy outside the instances: {@link MongoDatabase.syncSchema} creates
 * and updates, {@link MongoDatabase.dropStaleIndexes} removes. Running one
 * at a time is the caller's job; no race is tolerated.
 *
 * @example
 * ```ts
 * const db = new MongoDatabase({
 *   dbUri: "mongodb://localhost:27017",
 *   dbName: "myapp",
 * });
 *
 * await db.connect();
 * await db.syncSchema([UserSchema, OrderSchema]);
 * // ... after every instance runs the new code:
 * await db.dropStaleIndexes([UserSchema, OrderSchema]);
 * const mongoDb = db.getDb();
 * // ... use mongoDb
 * await db.disconnect();
 * ```
 */
export default class MongoDatabase implements IMongoDatabase {
  private readonly dbUri: string;
  private readonly dbName: string;

  private client: MongoClient | undefined;
  private conn: Db | undefined;
  private connecting: Promise<void> | undefined;

  constructor(options: IMongoDatabaseOptions) {
    const { dbUri, dbName } = options;
    this.dbUri = dbUri;
    this.dbName = dbName;
  }

  /**
   * Establish a connection to MongoDB.
   *
   * Creates a {@link MongoClient} and connects to the server; it touches no
   * collection. See {@link MongoDatabase.syncSchema}.
   *
   * Idempotent: once connected it resolves without a new client, and
   * concurrent calls share one attempt; after a rejection the next call tries
   * again.
   *
   * @throws The driver's error, as it is, if the connection fails.
   */
  public connect(): Promise<void> {
    if (this.isConnected()) return Promise.resolve();
    this.connecting ??= this.openConnection().finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  private async openConnection(): Promise<void> {
    const client = new MongoClient(this.dbUri);

    try {
      await client.connect();
      this.client = client;
      this.conn = client.db(this.dbName);
    } catch (error) {
      await client.close().catch(() => undefined);
      this.client = undefined;
      this.conn = undefined;
      throw error;
    }
  }

  /**
   * Gracefully close the MongoDB connection and release resources.
   */
  public async disconnect(): Promise<void> {
    if (!this.client) return;

    await this.client.close();
    this.client = undefined;
    this.conn = undefined;
  }

  /**
   * Check whether the database is currently connected.
   *
   * @returns `true` if both client and database connection are available.
   */
  public isConnected(): boolean {
    return this.client !== undefined && this.conn !== undefined;
  }

  /**
   * Get the underlying MongoDB {@link Db} instance.
   *
   * @returns The active database connection.
   * @throws {Error} When not connected: await {@link MongoDatabase.connect}
   * first.
   */
  public getDb(): Db {
    return this.requireDb("getDb");
  }

  /**
   * Get the underlying {@link MongoClient} instance.
   *
   * Useful for operations that require the client directly,
   * such as transaction management.
   *
   * @returns The active MongoDB client.
   * @throws {Error} When not connected: await {@link MongoDatabase.connect}
   * first.
   */
  public getClient(): MongoClient {
    if (!this.client) throw notConnected("getClient");
    return this.client;
  }

  /** The `Db`, or the not-connected error naming the `method` that needed it. */
  private requireDb(method: string): Db {
    if (!this.conn) throw notConnected(method);
    return this.conn;
  }

  /**
   * Create the indexes of a collection that don't exist yet.
   *
   * One `createIndexes` for all of them. When the server rejects it because an
   * index exists with another definition, each index goes to its own call to
   * find the one at fault: the server judges whether two definitions differ,
   * since it normalizes what it stores and compares.
   */
  private async createIndexes(
    collectionName: string,
    indexes: IMongoIndex[],
  ): Promise<void> {
    if (indexes.length === 0) return;
    const collection = this.getDb().collection(collectionName);

    try {
      await collection.createIndexes(indexes);
      return;
    } catch (error) {
      if (!isIndexConflict(error)) throw error;
    }

    // The batch is all or nothing, so this pass starts from the same state.
    for (const index of indexes) {
      try {
        await collection.createIndexes([index]);
      } catch (error) {
        if (!isIndexConflict(error)) throw error;
        throw new Error(
          `Index '${index.name}' of collection '${collectionName}' conflicts with an existing index: ${error.errmsg}. MongoDatabase never changes an existing index: drop it, and syncSchema() creates the schema's definition.`,
          { cause: error },
        );
      }
    }
  }

  /**
   * Sync the collections, validators and indexes of the schemas: the expand
   * step of a deploy. It drops nothing.
   *
   * For each schema, in order:
   * - Creates the collection with its validator if it doesn't exist.
   * - Creates the indexes that are missing. An existing index is never
   *   changed: when the schema names one with another definition, it rejects
   *   with an `Error` naming the index and the collection, whose `cause` is
   *   the server's error, before the validator is replaced. Drop the index by
   *   hand and `syncSchema()` creates the schema's definition.
   * - Replaces the validator of a collection that existed. The indexes come
   *   first because a build outlives its client: a run killed mid-build and
   *   run again waits on the identical `createIndexes`, where a `collMod`
   *   first would reject until the build ends.
   *
   * `hidden` applies when an index is created: on an existing index it is
   * neither applied nor checked, and changes through `collMod`.
   *
   * Run it once per deploy, before the rollout; a failed run is run again.
   * The instance stays connected on a rejection.
   *
   * @returns The collections it created, in the order of the schemas. A call
   * that rejects reports none of its changes.
   * @throws {Error} Rejects when not connected, before any call to the server.
   */
  public async syncSchema(
    schemas: readonly IMongoSchema[],
  ): Promise<SchemaSyncResult> {
    const db = this.requireDb("syncSchema");
    const createdCollections: string[] = [];

    for (const schema of schemas) {
      const name = schema.collectionName;

      const exists = (await db.listCollections({ name }).toArray()).length > 0;

      if (!exists) {
        await db.createCollection(name, { validator: schema.validation });
        createdCollections.push(name);
      }

      await this.createIndexes(name, schema.indexes ?? []);

      if (exists) {
        await db.command({ collMod: name, validator: schema.validation });
      }
    }

    return { createdCollections };
  }

  /**
   * Drop the indexes the schemas do not name (`_id_` is kept): the contract
   * step of a deploy, run after every instance runs the new code.
   *
   * It drops nothing while a schema's collection or index is missing: it
   * lists every collection first and rejects with an `Error` naming each
   * collection that is missing, or lacks indexes its schema names (an index
   * still building counts as missing). `syncSchema()` was not run or not
   * finished. Other server errors, a drop of an index gone elsewhere
   * included, are rethrown. The instance stays connected on a rejection.
   *
   * @returns Each index dropped, with the definition the server listed, in the
   * order of the schemas, then of the list. A call that rejects reports none of
   * its drops: a job that needs the definitions lists the indexes first.
   * @throws {Error} Rejects when not connected, before any call to the server.
   */
  public async dropStaleIndexes(
    schemas: readonly IMongoSchema[],
  ): Promise<StaleIndexDropResult> {
    const db = this.requireDb("dropStaleIndexes");
    const listed: { name: string; existing: IndexDescriptionInfo[] }[] = [];
    const problems: string[] = [];

    for (const schema of schemas) {
      const name = schema.collectionName;
      let existing: IndexDescriptionInfo[];
      try {
        // listIndexes' cursor is typed `any`; this is the shape it returns.
        existing = (await db
          .collection(name)
          .listIndexes()
          .toArray()) as IndexDescriptionInfo[];
      } catch (error) {
        if (!isNamespaceNotFound(error)) throw error;
        problems.push(`collection '${name}' is missing`);
        continue;
      }

      const listedNames = existing.map((idx) => idx.name);
      const missing = (schema.indexes ?? [])
        .map((idx) => idx.name)
        .filter((idxName) => !listedNames.includes(idxName));
      if (missing.length > 0) {
        problems.push(
          `collection '${name}' lacks ${missing.map((m) => `'${m}'`).join(", ")}`,
        );
      }
      listed.push({ name, existing });
    }

    if (problems.length > 0) {
      throw new Error(
        `Stale indexes not dropped: ${problems.join("; ")}. Run syncSchema() to completion first.`,
      );
    }

    const droppedIndexes: StaleIndexDropResult["droppedIndexes"] = [];

    for (const [i, { name, existing }] of listed.entries()) {
      const schemaIndexNames = (schemas[i]?.indexes ?? []).map(
        (idx) => idx.name,
      );

      for (const idx of existing) {
        if (idx.name === undefined || idx.name === "_id_") continue;
        if (schemaIndexNames.includes(idx.name)) continue;

        await db.collection(name).dropIndex(idx.name);
        droppedIndexes.push({ collection: name, index: idx });
      }
    }

    return { droppedIndexes };
  }
}
