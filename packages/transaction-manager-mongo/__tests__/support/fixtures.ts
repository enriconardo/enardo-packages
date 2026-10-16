import { randomUUID } from "node:crypto";
import { MongoClient, type Db, type MongoClientOptions } from "mongodb";
import { inject } from "vitest";

/** Connects to the replica set the global setup started. */
export async function connect(
  options?: MongoClientOptions,
): Promise<MongoClient> {
  return new MongoClient(inject("mongoUri"), options).connect();
}

/**
 * Creates a database for one test, so tests never see each other's documents.
 * Its `records` collection is created up front, outside any transaction.
 */
export async function createDatabase(client: MongoClient): Promise<Db> {
  const db = client.db(`test_${randomUUID().replaceAll("-", "")}`);
  await db.createCollection("records");
  return db;
}
