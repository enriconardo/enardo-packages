import type { IndexDescription, IndexDescriptionInfo } from "mongodb";

/**
 * What {@link MongoDatabase.syncSchema} did.
 *
 * @property createdCollections - The collections it created, in the order of
 * the schemas.
 */
export interface SchemaSyncResult {
  createdCollections: string[];
}

/**
 * What {@link MongoDatabase.dropStaleIndexes} did.
 *
 * @property droppedIndexes - Each index dropped, with the definition the
 * server listed, in the order of the schemas, then of the list.
 */
export interface StaleIndexDropResult {
  droppedIndexes: { collection: string; index: IndexDescriptionInfo }[];
}

/**
 * MongoDB index definition with a required `name` field.
 *
 * Extends the native MongoDB {@link IndexDescription} to enforce
 * explicit naming for all indexes, enabling deterministic
 * index synchronization: the name is how the sync matches an index
 * of the schema with one of the database.
 */
export interface MongoIndex extends IndexDescription {
  name: string;
}

/**
 * MongoDB JSON Schema validation structure.
 *
 * Used as the `validator` when creating or updating a MongoDB collection.
 */
export interface MongoValidation {
  $jsonSchema: Record<string, unknown>;
}

/**
 * Schema definition for a MongoDB collection.
 *
 * Used by {@link MongoDatabase} to create/update collections,
 * apply JSON Schema validation, and manage indexes, through
 * {@link MongoDatabase.syncSchema} and {@link MongoDatabase.dropStaleIndexes}.
 */
export interface MongoSchema {
  readonly collectionName: string;
  readonly validation: MongoValidation;
  readonly indexes?: MongoIndex[];
}

/**
 * Configuration options for {@link MongoDatabase}.
 *
 * @property dbUri - MongoDB connection URI.
 * @property dbName - Name of the database to connect to.
 */
export interface MongoDatabaseOptions {
  readonly dbUri: string;
  readonly dbName: string;
}
