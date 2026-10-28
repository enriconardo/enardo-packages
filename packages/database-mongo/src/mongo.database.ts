import type { Db, IndexDescriptionInfo } from "mongodb";
import { MongoClient, MongoServerError } from "mongodb";
import { DatabaseError } from "@enardo/database";
import type {
  IMongoDatabase,
  IMongoDatabaseOptions,
  IMongoIndex,
  IMongoSchema,
} from "./mongo.database.types";
import { createNoopLogger, type Logger, withLoggerContext } from "./logger";

/** `IndexOptionsConflict` and `IndexKeySpecsConflict`: the index exists with another definition. */
const INDEX_CONFLICT_CODES = [85, 86];

/** `IndexNotFound`: the index to drop is already gone. */
const INDEX_NOT_FOUND_CODE = 27;

function isIndexNotFound(error: unknown): error is MongoServerError {
  return (
    error instanceof MongoServerError && error.code === INDEX_NOT_FOUND_CODE
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
 * Manages the connection lifecycle to a MongoDB instance and
 * automatically initializes collections, validators, and indexes
 * based on the provided schemas.
 *
 * @example
 * ```ts
 * const db = new MongoDatabase({
 *   dbUri: "mongodb://localhost:27017",
 *   dbName: "myapp",
 *   schemas: [UserSchema, OrderSchema],
 * });
 *
 * await db.connect();
 * const mongoDb = db.getDb();
 * // ... use mongoDb
 * await db.disconnect();
 * ```
 */
export default class MongoDatabase implements IMongoDatabase {
  private readonly dbUri: string;
  private readonly dbName: string;
  private readonly schemas: IMongoSchema[];
  private readonly logger: Logger;

  private client: MongoClient | undefined;
  private conn: Db | undefined;

  constructor(options: IMongoDatabaseOptions) {
    const { schemas, dbUri, dbName, logger } = options;
    this.logger = withLoggerContext(
      logger ?? createNoopLogger(),
      "MongoDatabase",
      {
        dbName,
      },
    );
    this.schemas = schemas ?? [];
    this.dbUri = dbUri;
    this.dbName = dbName;
  }

  /**
   * Establish a connection to MongoDB.
   *
   * Creates a new {@link MongoClient}, connects to the server,
   * and initializes all configured collections and indexes. Indexes are
   * created when missing and an existing one is never changed: when a schema
   * names one with another definition, `connect()` rejects with an `Error`
   * naming the index and the collection, whose `cause` is the server's error,
   * and drops no index of that collection. Drop the index by hand and
   * `connect()` creates the schema's definition.
   *
   * `hidden` applies when an index is created: on an existing index it is
   * neither applied nor checked, and changes through `collMod`.
   *
   * It drops the indexes the schema no longer names; one that another
   * instance dropped first does not reject `connect()`.
   *
   * @throws {DatabaseError} If the connection or initialization fails.
   */
  public async connect(): Promise<void> {
    const client = new MongoClient(this.dbUri);

    try {
      await client.connect();
      this.client = client;
      this.conn = client.db(this.dbName);
      await this.initCollections();
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
   * @throws {DatabaseError} If the database is not connected.
   */
  public getDb(): Db {
    if (!this.conn) {
      throw new DatabaseError("Database not connected", {
        code: "NOT_CONNECTED",
      });
    }
    return this.conn;
  }

  /**
   * Get the underlying {@link MongoClient} instance.
   *
   * Useful for operations that require the client directly,
   * such as transaction management.
   *
   * @returns The active MongoDB client.
   * @throws {DatabaseError} If the database is not connected.
   */
  public getClient(): MongoClient {
    if (!this.client) {
      throw new DatabaseError("Database not connected", {
        code: "NOT_CONNECTED",
      });
    }
    return this.client;
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
          `Index '${index.name}' of collection '${collectionName}' conflicts with an existing index: ${error.errmsg}. MongoDatabase never changes an existing index: drop it, and connect() creates the schema's definition.`,
          { cause: error },
        );
      }
    }
  }

  /**
   * Initialize collections, validators, and indexes based on configured schemas.
   *
   * For each schema:
   * - Creates the collection with its validator if it doesn't exist.
   * - Replaces the validator if the collection already exists.
   * - Creates the indexes that are missing. An existing index is never
   *   changed: when the schema names one with another definition, the sync
   *   rejects, naming it, and drops no index of that collection. `hidden` applies
   *   at creation only, and changes through `collMod`.
   * - Removes indexes that are no longer present in the schema. One that
   *   another instance dropped first is skipped, and only the drops this
   *   instance made are logged.
   */
  private async initCollections(): Promise<void> {
    if (!this.conn) {
      throw new DatabaseError("Database not initialized", {
        code: "NOT_CONNECTED",
      });
    }

    for (const schema of this.schemas) {
      const name = schema.collectionName;

      const exists =
        (await this.conn.listCollections({ name }).toArray()).length > 0;

      if (!exists) {
        await this.conn.createCollection(name, {
          validator: schema.validation,
        });
        this.logger.debug(`Collection '${name}' created.`);
      } else {
        await this.conn.command({
          collMod: name,
          validator: schema.validation,
        });
      }

      const indexes = schema.indexes ?? [];
      await this.createIndexes(name, indexes);

      // Remove indexes that are no longer present in the schema
      const collection = this.conn.collection(name);
      // listIndexes' cursor is typed `any`; this is the shape the command returns.
      const existingIndexes = (await collection
        .listIndexes()
        .toArray()) as IndexDescriptionInfo[];
      const schemaIndexNames = indexes.map((idx) => idx.name).filter(Boolean);

      for (const idx of existingIndexes) {
        if (idx.name === undefined || idx.name === "_id_") continue;
        if (schemaIndexNames.includes(idx.name)) continue;

        try {
          await collection.dropIndex(idx.name);
        } catch (error) {
          // Dropped elsewhere between the list and the drop: the index is
          // gone, and a MongoDatabase that dropped it logged its own drop.
          if (isIndexNotFound(error)) continue;
          throw error;
        }
        this.logger.warn(
          `Index '${idx.name}' dropped from collection '${name}'.`,
          { index: idx },
        );
      }
    }
  }
}
