import type { IndexDescription } from "mongodb";
import type { IDatabase } from "@enardo/database";
import type { Logger } from "./logger";

/**
 * MongoDB-specific database interface.
 *
 * Currently identical to {@link IDatabase}. Extend this interface
 * to add MongoDB-specific methods if needed in the future.
 */
export type IMongoDatabase = IDatabase;

/**
 * MongoDB index definition with a required `name` field.
 *
 * Extends the native MongoDB {@link IndexDescription} to enforce
 * explicit naming for all indexes, enabling deterministic
 * index synchronization.
 */
export interface IMongoIndex extends IndexDescription {
  name: string;
}

/**
 * MongoDB JSON Schema validation structure.
 *
 * Used as the `validator` when creating or updating a MongoDB collection.
 */
export interface IMongoValidation {
  $jsonSchema: Record<string, unknown>;
}

/**
 * Schema definition for a MongoDB collection.
 *
 * Used by {@link MongoDatabase} to create/update collections,
 * apply JSON Schema validation, and manage indexes on connection.
 */
export interface IMongoSchema {
  readonly collectionName: string;
  readonly validation: IMongoValidation;
  readonly indexes?: IMongoIndex[];
}

/**
 * Configuration options for {@link MongoDatabase}.
 *
 * @property dbUri - MongoDB connection URI.
 * @property dbName - Name of the database to connect to.
 * @property schemas - Optional array of collection schemas to initialize on connect.
 * @property logger - Optional logger instance to use for diagnostics.
 * @property debug - When `true`, emit debug-level messages during initialization.
 * @property debugNamespace - Optional context label used for child logger namespace.
 */
export interface IMongoDatabaseOptions {
  readonly dbUri: string;
  readonly dbName: string;
  readonly schemas?: IMongoSchema[];
  readonly logger?: Logger;
  readonly debug?: boolean;
  readonly debugNamespace?: string;
}
