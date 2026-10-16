import type { Db, IndexDescriptionInfo } from "mongodb";
import { MongoClient } from "mongodb";
import { DatabaseError } from "@enardo/database";
import type {
  IMongoDatabase,
  IMongoDatabaseOptions,
  IMongoSchema,
} from "./mongo.database.types";
import { createNoopLogger, type Logger, withLoggerContext } from "./logger";

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
 *   debug: true,
 *   debugNamespace: "enardo:database-mongo",
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
  private readonly debug: boolean;
  private readonly logger: Logger;

  private client: MongoClient | undefined;
  private conn: Db | undefined;

  constructor(options: IMongoDatabaseOptions) {
    const { schemas, dbUri, dbName, debug, debugNamespace, logger } = options;
    this.logger = withLoggerContext(
      logger ?? createNoopLogger(),
      debugNamespace ?? "MongoDatabase",
      {
        dbName,
      },
    );
    this.debug = debug ?? false;
    this.schemas = schemas ?? [];
    this.dbUri = dbUri;
    this.dbName = dbName;
  }

  /**
   * Establish a connection to MongoDB.
   *
   * Creates a new {@link MongoClient}, connects to the server,
   * and initializes all configured collections and indexes.
   *
   * @throws {DatabaseError} If the connection or initialization fails.
   */
  public async connect(): Promise<void> {
    if (this.debug) {
      this.logger.debug("Connecting to MongoDB.");
    }
    const client = new MongoClient(this.dbUri);

    try {
      await client.connect();
      this.client = client;
      this.conn = client.db(this.dbName);
      await this.initCollections();
      if (this.debug) {
        this.logger.debug("MongoDB connection established.");
      }
    } catch (error) {
      this.logger.error("Failed to connect to MongoDB.", {
        error,
      });
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

    if (this.debug) {
      this.logger.debug("Disconnecting from MongoDB.");
    }

    await this.client.close();
    this.client = undefined;
    this.conn = undefined;
    if (this.debug) {
      this.logger.debug("MongoDB disconnected.");
    }
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
   * Initialize collections, validators, and indexes based on configured schemas.
   *
   * For each schema:
   * - Creates the collection with its validator if it doesn't exist.
   * - Updates the validator if the collection already exists.
   * - Creates/updates indexes (idempotent).
   * - Removes indexes that are no longer present in the schema.
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
        if (this.debug) {
          this.logger.debug(`Collection '${name}' created with validator.`);
        }
      } else {
        await this.conn.command({
          collMod: name,
          validator: schema.validation,
        });
        if (this.debug) {
          this.logger.debug(`Collection '${name}' updated with new validator.`);
        }
      }

      // Always update/create indexes (idempotent)
      const indexes = schema.indexes ?? [];
      if (indexes.length > 0) {
        await this.conn.collection(name).createIndexes(indexes);
        if (this.debug) {
          this.logger.debug(
            `Indexes for collection '${name}' ensured/updated.`,
          );
        }
      }

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

        await collection.dropIndex(idx.name);
        if (this.debug) {
          this.logger.debug(
            `Index '${idx.name}' dropped from collection '${name}'.`,
          );
        }
      }
    }
  }
}
