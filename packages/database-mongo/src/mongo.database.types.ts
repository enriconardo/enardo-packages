import type { IndexDescription, IndexDescriptionInfo } from "mongodb";
import type { IDatabase } from "@enardo/database";

/**
 * What {@link IMongoDatabase.syncSchema} did.
 *
 * @property createdCollections - The collections it created, in the order of
 * the schemas.
 */
export interface SchemaSyncResult {
  createdCollections: string[];
}

/**
 * What {@link IMongoDatabase.dropStaleIndexes} did.
 *
 * @property droppedIndexes - Each index dropped, with the definition the
 * server listed, in the order of the schemas, then of the list.
 */
export interface StaleIndexDropResult {
  droppedIndexes: { collection: string; index: IndexDescriptionInfo }[];
}

/**
 * MongoDB-specific database interface: {@link IDatabase} plus the two steps
 * that bring the database to the schemas. Both reject when not connected.
 */
export interface IMongoDatabase extends IDatabase {
  /**
   * Create the collections, validators and missing indexes of the schemas,
   * the expand step of a deploy. It drops nothing.
   *
   * @returns The collections it created.
   */
  syncSchema(schemas: readonly IMongoSchema[]): Promise<SchemaSyncResult>;

  /**
   * Drop the indexes the schemas do not name, the contract step of a deploy.
   * It drops nothing while a schema's collection or index is missing.
   *
   * @returns The indexes it dropped.
   */
  dropStaleIndexes(
    schemas: readonly IMongoSchema[],
  ): Promise<StaleIndexDropResult>;
}

/**
 * MongoDB index definition with a required `name` field.
 *
 * Extends the native MongoDB {@link IndexDescription} to enforce
 * explicit naming for all indexes, enabling deterministic
 * index synchronization: the name is how the sync matches an index
 * of the schema with one of the database.
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
 * apply JSON Schema validation, and manage indexes, through
 * {@link IMongoDatabase.syncSchema} and {@link IMongoDatabase.dropStaleIndexes}.
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
 */
export interface IMongoDatabaseOptions {
  readonly dbUri: string;
  readonly dbName: string;
}
