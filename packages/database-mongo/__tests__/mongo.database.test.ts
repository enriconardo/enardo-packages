import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  Collection,
  MongoServerError,
  type Db,
  type IndexDescriptionInfo,
  type MongoClient,
} from "mongodb";
import { DatabaseError } from "@enardo/database";
import MongoDatabase from "~/mongo.database";
import type {
  IMongoDatabaseOptions,
  IMongoSchema,
} from "~/mongo.database.types";
import { connect, mongoUri, uniqueDbName } from "./support/fixtures";

// ─── Helpers ─────────────────────────────────────────────────────────

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn(),
};
logger.child.mockReturnValue(logger);

/** The log methods: `child` is left out, since the constructor calls it. */
const logMethods = {
  debug: logger.debug,
  info: logger.info,
  warn: logger.warn,
  error: logger.error,
};

function expectNoLogsBut(...allowed: (keyof typeof logMethods)[]): void {
  for (const [name, spy] of Object.entries(logMethods)) {
    if (!allowed.includes(name as keyof typeof logMethods)) {
      expect(spy, `logger.${name}`).not.toHaveBeenCalled();
    }
  }
}

/** A validation that accepts every document. */
const anyDocument = { $jsonSchema: {} };

const testSchema: IMongoSchema = {
  collectionName: "users",
  validation: {
    $jsonSchema: {
      bsonType: "object",
      required: ["_id", "email"],
      properties: {
        _id: { bsonType: "string" },
        email: { bsonType: "string" },
      },
    },
  },
  indexes: [
    { name: "email_unique", key: { email: 1 }, unique: true },
    { name: "createdAt_idx", key: { createdAt: -1 } },
  ],
};

/** The indexes the server lists; the cursor of `listIndexes` is typed `any`. */
async function listIndexes(
  db: Db,
  collection: string,
): Promise<IndexDescriptionInfo[]> {
  return (await db
    .collection(collection)
    .listIndexes()
    .toArray()) as IndexDescriptionInfo[];
}

async function indexNames(db: Db, collection: string): Promise<unknown[]> {
  return (await listIndexes(db, collection)).map((index) => index.name);
}

/** The validator the server holds for a collection. */
async function validatorOf(db: Db, collection: string): Promise<unknown> {
  const [info] = (await db.listCollections({ name: collection }).toArray()) as {
    options?: { validator?: unknown };
  }[];
  return info?.options?.validator;
}

async function indexNamed(
  db: Db,
  collection: string,
  name: string,
): Promise<IndexDescriptionInfo | undefined> {
  return (await listIndexes(db, collection)).find(
    (index) => index.name === name,
  );
}

/**
 * Asserts that `connect()` rejects with a conflict: a native `Error`, not the
 * server's, naming the collection and the index, whose `cause` is the
 * server's error with `code`. Then, that the instance is left disconnected
 * and nothing was logged. Returns the error, for further assertions.
 */
async function expectConflict(
  database: MongoDatabase,
  expected: { collection: string; index: string; code: number },
): Promise<Error> {
  let rejection: unknown;
  try {
    await database.connect();
  } catch (error) {
    rejection = error;
  }

  expect(rejection, "connect() rejection").toBeInstanceOf(Error);
  const error = rejection as Error;
  expect(error.name, "the rejection's name").toBe("Error");
  expect(error).not.toBeInstanceOf(MongoServerError);
  expect(error.message).toContain(`'${expected.collection}'`);
  expect(error.message).toContain(`'${expected.index}'`);
  expect(error.cause).toBeInstanceOf(MongoServerError);
  expect(error.cause).toMatchObject({
    name: "MongoServerError",
    code: expected.code,
  });

  expect(database.isConnected()).toBe(false);
  expect(() => database.getDb()).toThrow(DatabaseError);
  expectNoLogsBut();

  return error;
}

// ─── Tests ───────────────────────────────────────────────────────────

let client: MongoClient;
let dbName: string;
let setupDb: Db;
let databases: MongoDatabase[];

/** A `MongoDatabase` on the test's database, disconnected after the test. */
function createDatabase(
  overrides?: Partial<IMongoDatabaseOptions>,
): MongoDatabase {
  const database = new MongoDatabase({
    dbUri: mongoUri(),
    dbName,
    logger: logger,
    ...overrides,
  });
  databases.push(database);
  return database;
}

beforeEach(async () => {
  vi.clearAllMocks();
  logger.child.mockReturnValue(logger);
  databases = [];
  dbName = uniqueDbName();
  client = await connect();
  setupDb = client.db(dbName);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(databases.map((database) => database.disconnect()));
  await client.close();
});

describe("MongoDatabase", () => {
  describe("constructor", () => {
    it("should accept options and set defaults", () => {
      const db = createDatabase();
      expect(db.isConnected()).toBe(false);
    });

    it("should default schemas to empty array", async () => {
      const db = createDatabase();
      await db.connect();

      expect(await setupDb.listCollections().toArray()).toEqual([]);
    });
  });

  describe("connect", () => {
    it("should establish a connection", async () => {
      const db = createDatabase();
      await db.connect();
      expect(db.isConnected()).toBe(true);
      await expect(db.getDb().command({ ping: 1 })).resolves.toMatchObject({
        ok: 1,
      });
    });

    it("should create a missing collection with its validator and indexes", async () => {
      const db = createDatabase({ schemas: [testSchema] });
      await db.connect();

      expect(await validatorOf(setupDb, "users")).toEqual(
        testSchema.validation,
      );

      const indexes = await listIndexes(setupDb, "users");
      expect(indexes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "email_unique",
            key: { email: 1 },
            unique: true,
          }),
          expect.objectContaining({
            name: "createdAt_idx",
            key: { createdAt: -1 },
          }),
        ]),
      );
      expect(
        indexes.find((index) => index.name === "createdAt_idx")?.unique,
      ).toBeUndefined();
    });

    it("should replace the validator of an existing collection", async () => {
      await setupDb.createCollection("users", {
        validator: { $jsonSchema: { bsonType: "object", required: ["old"] } },
      });
      const db = createDatabase({ schemas: [testSchema] });
      await db.connect();

      expect(await validatorOf(setupDb, "users")).toEqual(
        testSchema.validation,
      );
    });

    it("should leave the indexes unchanged when another instance connects with the same schema", async () => {
      const first = createDatabase({ schemas: [testSchema] });
      await first.connect();
      await first.disconnect();
      const before = await listIndexes(setupDb, "users");
      vi.clearAllMocks();
      logger.child.mockReturnValue(logger);

      const second = createDatabase({ schemas: [testSchema] });
      await expect(second.connect()).resolves.toBeUndefined();

      const after = await listIndexes(setupDb, "users");
      expect(after).toEqual(before);
      expectNoLogsBut();
    });

    it("should drop an index the schema does not name, and log it", async () => {
      await setupDb.createCollection("users");
      await setupDb
        .collection("users")
        .createIndexes([{ name: "old_idx", key: { legacy: 1 }, unique: true }]);
      const [listed] = (await listIndexes(setupDb, "users")).filter(
        (index) => index.name === "old_idx",
      );
      const db = createDatabase({ schemas: [testSchema] });
      await db.connect();

      const names = await indexNames(setupDb, "users");
      expect(names).not.toContain("old_idx");
      expect(logger.warn).toHaveBeenCalledOnce();
      expect(logger.warn).toHaveBeenCalledWith(
        "Index 'old_idx' dropped from collection 'users'.",
        { index: listed },
      );
      expectNoLogsBut("warn");
    });

    it("should keep only _id_ for a schema without indexes", async () => {
      await setupDb.createCollection("logs");
      await setupDb
        .collection("logs")
        .createIndexes([{ name: "old_idx", key: { legacy: 1 } }]);
      const db = createDatabase({
        schemas: [{ collectionName: "logs", validation: anyDocument }],
      });
      await db.connect();

      const names = await indexNames(setupDb, "logs");
      expect(names).toEqual(["_id_"]);
    });

    it("should create the schema's index and drop the one it replaced by name", async () => {
      await setupDb.createCollection("users");
      await setupDb
        .collection("users")
        .createIndexes([{ name: "a_1", key: { a: 1 } }]);
      const db = createDatabase({
        schemas: [
          {
            collectionName: "users",
            validation: anyDocument,
            indexes: [{ name: "b_1", key: { b: 1 } }],
          },
        ],
      });
      await db.connect();

      const names = await indexNames(setupDb, "users");
      expect(names).toContain("b_1");
      expect(names).not.toContain("a_1");
    });

    it("should reject with the server's error when a unique index meets duplicates", async () => {
      await setupDb.collection("users").insertMany([{ a: 1 }, { a: 1 }]);
      const db = createDatabase({
        schemas: [
          {
            collectionName: "users",
            validation: anyDocument,
            indexes: [{ name: "a_unique", key: { a: 1 }, unique: true }],
          },
        ],
      });

      await expect(db.connect()).rejects.toMatchObject({
        name: "MongoServerError",
        code: 11000,
      });
      expect(db.isConnected()).toBe(false);
      expect(() => db.getDb()).toThrow(DatabaseError);
      expectNoLogsBut();
    });

    describe("an index the schema changed", () => {
      it("should reject an index renamed onto another key, dropping nothing", async () => {
        await setupDb.createCollection("users");
        await setupDb.collection("users").createIndexes([
          { name: "i", key: { a: 1 } },
          { name: "old", key: { old: 1 } },
        ]);
        const db = createDatabase({
          schemas: [
            {
              collectionName: "users",
              validation: anyDocument,
              indexes: [{ name: "i", key: { b: 1 } }],
            },
          ],
        });

        await expectConflict(db, { collection: "users", index: "i", code: 86 });

        expect((await indexNamed(setupDb, "users", "i"))?.key).toEqual({
          a: 1,
        });
        expect(await indexNames(setupDb, "users")).toContain("old");
      });

      it("should reject a key given another name", async () => {
        await setupDb.createCollection("users");
        await setupDb
          .collection("users")
          .createIndexes([{ name: "i", key: { a: 1 } }]);
        const db = createDatabase({
          schemas: [
            {
              collectionName: "users",
              validation: anyDocument,
              indexes: [{ name: "j", key: { a: 1 } }],
            },
          ],
        });

        await expectConflict(db, { collection: "users", index: "j", code: 85 });

        const names = await indexNames(setupDb, "users");
        expect(names).toContain("i");
        expect(names).not.toContain("j");
      });

      it("should reject an index made unique", async () => {
        await setupDb.createCollection("users");
        await setupDb
          .collection("users")
          .createIndexes([{ name: "i", key: { a: 1 } }]);
        const db = createDatabase({
          schemas: [
            {
              collectionName: "users",
              validation: anyDocument,
              indexes: [{ name: "i", key: { a: 1 }, unique: true }],
            },
          ],
        });

        await expectConflict(db, { collection: "users", index: "i", code: 86 });

        const index = await indexNamed(setupDb, "users", "i");
        expect(index).toBeDefined();
        expect(index?.unique).not.toBe(true);
      });

      it("should reject a changed expireAfterSeconds", async () => {
        await setupDb.createCollection("users");
        await setupDb
          .collection("users")
          .createIndexes([
            { name: "i", key: { a: 1 }, expireAfterSeconds: 10 },
          ]);
        const db = createDatabase({
          schemas: [
            {
              collectionName: "users",
              validation: anyDocument,
              indexes: [{ name: "i", key: { a: 1 }, expireAfterSeconds: 20 }],
            },
          ],
        });

        await expectConflict(db, { collection: "users", index: "i", code: 85 });
      });

      it("should name the conflicting index, not the one before it, and keep that one", async () => {
        await setupDb.createCollection("users");
        await setupDb
          .collection("users")
          .createIndexes([{ name: "i", key: { a: 1 } }]);
        const db = createDatabase({
          schemas: [
            {
              collectionName: "users",
              validation: anyDocument,
              indexes: [
                { name: "z", key: { z: 1 } },
                { name: "i", key: { b: 1 } },
              ],
            },
          ],
        });

        const error = await expectConflict(db, {
          collection: "users",
          index: "i",
          code: 86,
        });

        expect(error.message).not.toContain("'z'");
        expect(await indexNames(setupDb, "users")).toContain("z");
      });
    });

    it("should create an index hidden when the schema says so", async () => {
      const db = createDatabase({
        schemas: [
          {
            collectionName: "users",
            validation: anyDocument,
            indexes: [{ name: "a_1", key: { a: 1 }, hidden: true }],
          },
        ],
      });
      await db.connect();

      const indexes = await listIndexes(setupDb, "users");
      expect(indexes).toContainEqual(
        expect.objectContaining({ name: "a_1", hidden: true }),
      );
    });

    it("should leave an existing index hidden when the schema does not say so", async () => {
      await setupDb.createCollection("users");
      await setupDb
        .collection("users")
        .createIndexes([{ name: "i", key: { a: 1 } }]);
      await setupDb.command({
        collMod: "users",
        index: { name: "i", hidden: true },
      });
      const db = createDatabase({
        schemas: [
          {
            collectionName: "users",
            validation: anyDocument,
            indexes: [{ name: "i", key: { a: 1 } }],
          },
        ],
      });

      await expect(db.connect()).resolves.toBeUndefined();

      const indexes = await listIndexes(setupDb, "users");
      expect(indexes).toContainEqual(
        expect.objectContaining({ name: "i", hidden: true }),
      );
    });

    it("should reject with a failed drop of a stale index, logging nothing", async () => {
      await setupDb.createCollection("users");
      await setupDb
        .collection("users")
        .createIndexes([{ name: "old_idx", key: { legacy: 1 } }]);
      const error = new Error("drop failed");
      vi.spyOn(Collection.prototype, "dropIndex").mockRejectedValue(error);
      const db = createDatabase({ schemas: [testSchema] });

      await expect(db.connect()).rejects.toBe(error);

      expectNoLogsBut();
    });

    it("should clean up and rethrow an unreachable server without logging", async () => {
      const db = createDatabase({
        dbUri: "mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=200",
      });

      await expect(db.connect()).rejects.toMatchObject({
        name: "MongoServerSelectionError",
      });
      expect(db.isConnected()).toBe(false);
      expectNoLogsBut();
    });

    it("should log a created collection at debug, and nothing else", async () => {
      const db = createDatabase({ schemas: [testSchema] });
      await db.connect();

      expect(logger.debug).toHaveBeenCalledOnce();
      expect(logger.debug).toHaveBeenCalledWith("Collection 'users' created.");
      expectNoLogsBut("debug");
    });
  });

  describe("disconnect", () => {
    it("should close the connection", async () => {
      const db = createDatabase();
      await db.connect();
      const connected = db.getClient();
      await db.disconnect();

      expect(db.isConnected()).toBe(false);
      await expect(connected.db("x").command({ ping: 1 })).rejects.toThrow();
    });

    it("should be a no-op when not connected", async () => {
      const db = createDatabase();
      await expect(db.disconnect()).resolves.toBeUndefined();
    });
  });

  describe("isConnected", () => {
    it("should return false before connect", () => {
      const db = createDatabase();
      expect(db.isConnected()).toBe(false);
    });

    it("should return true after connect", async () => {
      const db = createDatabase();
      await db.connect();
      expect(db.isConnected()).toBe(true);
    });

    it("should return false after disconnect", async () => {
      const db = createDatabase();
      await db.connect();
      await db.disconnect();
      expect(db.isConnected()).toBe(false);
    });
  });

  describe("getDb", () => {
    it("should return the Db instance when connected", async () => {
      const db = createDatabase();
      await db.connect();
      expect(db.getDb().databaseName).toBe(dbName);
    });

    it("should throw DatabaseError when not connected", () => {
      const db = createDatabase();
      expect(() => db.getDb()).toThrow(DatabaseError);
      expect(() => db.getDb()).toThrow("Database not connected");
    });

    it("should throw with code NOT_CONNECTED", () => {
      const db = createDatabase();
      expect.assertions(2);
      try {
        db.getDb();
      } catch (error) {
        expect(error).toBeInstanceOf(DatabaseError);
        expect((error as DatabaseError).code).toBe("NOT_CONNECTED");
      }
    });
  });

  describe("getClient", () => {
    it("should return the MongoClient when connected", async () => {
      const db = createDatabase();
      await db.connect();
      await expect(
        db.getClient().db(dbName).command({ ping: 1 }),
      ).resolves.toMatchObject({ ok: 1 });
    });

    it("should throw DatabaseError when not connected", () => {
      const db = createDatabase();
      expect(() => db.getClient()).toThrow(DatabaseError);
      expect(() => db.getClient()).toThrow("Database not connected");
    });

    it("should throw with code NOT_CONNECTED", () => {
      const db = createDatabase();
      expect.assertions(2);
      try {
        db.getClient();
      } catch (error) {
        expect(error).toBeInstanceOf(DatabaseError);
        expect((error as DatabaseError).code).toBe("NOT_CONNECTED");
      }
    });
  });

  describe("logging", () => {
    it("should log nothing on connect without schemas and disconnect", async () => {
      const db = createDatabase();
      await db.connect();
      await db.disconnect();

      expectNoLogsBut();
    });

    it("should create a child logger with a fixed context and the dbName", () => {
      createDatabase();

      expect(logger.child).toHaveBeenCalledOnce();
      expect(logger.child).toHaveBeenCalledWith({
        context: "MongoDatabase",
        metadata: { dbName },
      });
    });

    it("should connect without a logger option", async () => {
      const db = createDatabase({ schemas: [testSchema], logger: undefined });

      await expect(db.connect()).resolves.toBeUndefined();
    });
  });
});
