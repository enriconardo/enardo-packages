import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";
import { inject } from "vitest";

declare module "vitest" {
  export interface ProvidedContext {
    mongoUri: string;
  }
}

/** The URI of the replica set the global setup started. */
export function mongoUri(): string {
  return inject("mongoUri");
}

/** Connects a client to the replica set, for the setup and the assertions of a test. */
export async function connect(): Promise<MongoClient> {
  return new MongoClient(mongoUri()).connect();
}

/** The name of a database for one test, so tests never see each other's collections. */
export function uniqueDbName(): string {
  return `test_${randomUUID().replaceAll("-", "")}`;
}
