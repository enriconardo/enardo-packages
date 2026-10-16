import { randomUUID } from "node:crypto";
import {
  MongoClient,
  type Db,
  type Decimal128,
  type MongoClientOptions,
  type ObjectId,
} from "mongodb";
import { inject } from "vitest";
import { MongoDataStore } from "~/mongo-data-store";

/** A product is stored as one document. */
export interface ProductRecord {
  _id: ObjectId;
  name: string;
  price: Decimal128;
  listedAt: Date;
  notes?: string;
}

export interface ProductRecords {
  products: [ProductRecord];
}

export interface GroupRecord {
  _id: ObjectId;
  name: string;
}

export interface MemberRecord {
  _id: ObjectId;
  groupId: ObjectId;
  userId: ObjectId;
  role: "owner" | "member";
}

/** A group is stored across two collections: one document for the group, one per member. */
export interface GroupRecords {
  groups: [GroupRecord];
  members: MemberRecord[];
}

/** Connects to the replica set the global setup started. */
export async function connect(
  options?: MongoClientOptions,
): Promise<MongoClient> {
  return new MongoClient(inject("mongoUri"), options).connect();
}

/**
 * Creates a database for one test, so tests never see each other's documents.
 *
 * Collections are created up front: a snapshot read fails on a collection
 * created after its snapshot was taken.
 */
export async function createDatabase(client: MongoClient): Promise<Db> {
  const db = client.db(`test_${randomUUID().replaceAll("-", "")}`);

  for (const name of ["products", "groups", "members"]) {
    await db.createCollection(name);
  }

  return db;
}

export function createProductStore(
  client: MongoClient,
  db: Db,
  versionField?: string,
): MongoDataStore<ProductRecords, ObjectId> {
  return new MongoDataStore<ProductRecords, ObjectId>({
    client,
    versionField,
    collections: {
      products: { collection: db.collection("products"), root: true },
    },
  });
}

export function createGroupStore(
  client: MongoClient,
  db: Db,
): MongoDataStore<GroupRecords, ObjectId> {
  return new MongoDataStore<GroupRecords, ObjectId>({
    client,
    collections: {
      groups: { collection: db.collection("groups"), root: true },
      members: {
        collection: db.collection("members"),
        aggregateIdField: "groupId",
      },
    },
  });
}
