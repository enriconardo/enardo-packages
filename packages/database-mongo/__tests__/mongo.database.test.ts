import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  Collection,
  MongoClient,
  MongoServerError,
  type Db,
  type IndexDescriptionInfo,
} from "mongodb";
import MongoDatabase from "~/mongo.database";
import type {
  IMongoDatabaseOptions,
  IMongoSchema,
} from "~/mongo.database.types";
import { connect, mongoUri, uniqueDbName } from "./support/fixtures";

// ─── Helpers ─────────────────────────────────────────────────────────

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
 * Asserts that `error` is the not-connected error of `method`: a native
 * `Error`, named `"Error"`, with no own `code`, whose message names
 * `connect()` and `<method>()`.
 */
function expectNotConnectedError(error: unknown, method: string): void {
  expect(error, `${method}() error`).toBeInstanceOf(Error);
  const native = error as Error;
  expect(native.name, "the error's name").toBe("Error");
  expect(Object.hasOwn(native, "code"), "an own code").toBe(false);
  expect(native.message).toContain("connect()");
  expect(native.message).toContain(`${method}()`);
}

/** Asserts that a call throws the not-connected error of `method`. */
function expectThrowsNotConnected(call: () => unknown, method: string): void {
  let thrown: unknown;
  try {
    call();
  } catch (error) {
    thrown = error;
  }

  expectNotConnectedError(thrown, method);
}

/**
 * Asserts that a call rejects, without throwing synchronously, with the
 * not-connected error of `method`.
 */
async function expectNotConnected(
  call: () => Promise<unknown>,
  method: string,
): Promise<void> {
  let promise: Promise<unknown> | undefined;
  expect(() => {
    promise = call();
  }, `${method}() throws synchronously`).not.toThrow();

  let rejection: unknown;
  try {
    await promise;
  } catch (error) {
    rejection = error;
  }

  expectNotConnectedError(rejection, method);
}

/**
 * Asserts that `syncSchema(schemas)` rejects with a conflict: a native
 * `Error`, not the server's, naming the collection, the index and
 * `syncSchema()`, whose `cause` is the server's error with `code`. Then, that
 * the instance is left connected. Returns the error, for further assertions.
 */
async function expectConflict(
  database: MongoDatabase,
  schemas: readonly IMongoSchema[],
  expected: { collection: string; index: string; code: number },
): Promise<Error> {
  let rejection: unknown;
  try {
    await database.syncSchema(schemas);
  } catch (error) {
    rejection = error;
  }

  expect(rejection, "syncSchema() rejection").toBeInstanceOf(Error);
  const error = rejection as Error;
  expect(error.name, "the rejection's name").toBe("Error");
  expect(error).not.toBeInstanceOf(MongoServerError);
  expect(error.message).toContain(`'${expected.collection}'`);
  expect(error.message).toContain(`'${expected.index}'`);
  expect(error.message).toContain("syncSchema()");
  expect(error.cause).toBeInstanceOf(MongoServerError);
  expect(error.cause).toMatchObject({
    name: "MongoServerError",
    code: expected.code,
  });

  expect(database.isConnected()).toBe(true);

  return error;
}

/**
 * Asserts that a call rejects with a native `Error`, not the server's, and
 * returns it, for assertions on its message.
 */
async function expectNativeError(call: () => Promise<unknown>): Promise<Error> {
  let rejection: unknown;
  try {
    await call();
  } catch (error) {
    rejection = error;
  }

  expect(rejection).toBeInstanceOf(Error);
  const error = rejection as Error;
  expect(error.name, "the rejection's name").toBe("Error");
  expect(error).not.toBeInstanceOf(MongoServerError);
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
    ...overrides,
  });
  databases.push(database);
  return database;
}

/** A `MongoDatabase` on the test's database, connected. */
async function createConnectedDatabase(): Promise<MongoDatabase> {
  const database = createDatabase();
  await database.connect();
  return database;
}

beforeEach(async () => {
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

    it("should not accept schemas or logger as options", () => {
      const withSchemas = new MongoDatabase({
        dbUri: mongoUri(),
        dbName,
        // @ts-expect-error -- the schemas are an argument of the sync methods
        schemas: [testSchema],
      });
      const withLogger = new MongoDatabase({
        dbUri: mongoUri(),
        dbName,
        // @ts-expect-error -- the package logs nothing
        logger: { debug: () => undefined, warn: () => undefined },
      });

      expect(withSchemas.isConnected()).toBe(false);
      expect(withLogger.isConnected()).toBe(false);
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

    it("should clean up and rethrow an unreachable server", async () => {
      const db = createDatabase({
        dbUri: "mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=200",
      });

      await expect(db.connect()).rejects.toMatchObject({
        name: "MongoServerSelectionError",
      });
      expect(db.isConnected()).toBe(false);
    });

    it("should reject an unparseable URI with the driver's error", async () => {
      const db = createDatabase({ dbUri: "not-a-uri" });

      let connecting: Promise<void> | undefined;
      expect(() => {
        connecting = db.connect();
      }, "connect() throws synchronously").not.toThrow();

      await expect(connecting).rejects.toMatchObject({
        name: "MongoParseError",
      });
      expect(db.isConnected()).toBe(false);
    });

    describe("a repeated connect", () => {
      it("should keep one client when called again once connected", async () => {
        const connectSpy = vi.spyOn(MongoClient.prototype, "connect");
        const db = createDatabase();
        await db.connect();
        const first = db.getClient();

        await db.connect();

        expect(connectSpy).toHaveBeenCalledOnce();
        expect(db.getClient()).toBe(first);
        await db.disconnect();
        await expect(first.db("x").command({ ping: 1 })).rejects.toThrow();
      });

      it("should share one client between concurrent calls", async () => {
        const connectSpy = vi.spyOn(MongoClient.prototype, "connect");
        const db = createDatabase();

        const outcomes = await Promise.allSettled([db.connect(), db.connect()]);

        expect(outcomes.map((outcome) => outcome.status)).toEqual([
          "fulfilled",
          "fulfilled",
        ]);
        expect(connectSpy).toHaveBeenCalledOnce();
        await db.disconnect();
        expect(db.isConnected()).toBe(false);
      });

      it("should try again after a rejected connect", async () => {
        const connectSpy = vi.spyOn(MongoClient.prototype, "connect");
        const db = createDatabase({
          dbUri: "mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=200",
        });

        await expect(db.connect()).rejects.toMatchObject({
          name: "MongoServerSelectionError",
        });
        await expect(db.connect()).rejects.toMatchObject({
          name: "MongoServerSelectionError",
        });

        expect(connectSpy).toHaveBeenCalledTimes(2);
      });

      it("should connect again after disconnect", async () => {
        const db = createDatabase();
        await db.connect();
        await db.disconnect();

        await db.connect();

        expect(db.isConnected()).toBe(true);
        await expect(
          db.getClient().db(dbName).command({ ping: 1 }),
        ).resolves.toMatchObject({ ok: 1 });
      });
    });
  });

  describe("syncSchema", () => {
    it("should reject with the not-connected error on a new instance, creating nothing", async () => {
      const db = createDatabase();

      await expectNotConnected(() => db.syncSchema([testSchema]), "syncSchema");

      expect(await setupDb.listCollections().toArray()).toEqual([]);
    });

    it("should create a missing collection with its validator and indexes", async () => {
      const db = await createConnectedDatabase();

      await expect(db.syncSchema([testSchema])).resolves.toEqual({
        createdCollections: ["users"],
      });

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
      const db = await createConnectedDatabase();

      await expect(db.syncSchema([testSchema])).resolves.toEqual({
        createdCollections: [],
      });

      expect(await validatorOf(setupDb, "users")).toEqual(
        testSchema.validation,
      );
    });

    it("should leave the indexes unchanged when run again with the same schema", async () => {
      const db = await createConnectedDatabase();
      await db.syncSchema([testSchema]);
      const before = await listIndexes(setupDb, "users");

      await expect(db.syncSchema([testSchema])).resolves.toEqual({
        createdCollections: [],
      });

      const after = await listIndexes(setupDb, "users");
      expect(after).toEqual(before);
    });

    it("should reject with the server's error when a unique index meets duplicates", async () => {
      await setupDb.collection("users").insertMany([{ a: 1 }, { a: 1 }]);
      const db = await createConnectedDatabase();

      await expect(
        db.syncSchema([
          {
            collectionName: "users",
            validation: anyDocument,
            indexes: [{ name: "a_unique", key: { a: 1 }, unique: true }],
          },
        ]),
      ).rejects.toMatchObject({
        name: "MongoServerError",
        code: 11000,
      });
      expect(db.isConnected()).toBe(true);
    });

    it("should report the collections it created, in the order of the schemas", async () => {
      await setupDb.createCollection("orders");
      const db = await createConnectedDatabase();

      await expect(
        db.syncSchema([
          testSchema,
          { collectionName: "orders", validation: anyDocument },
          { collectionName: "logs", validation: anyDocument },
        ]),
      ).resolves.toEqual({ createdCollections: ["users", "logs"] });
    });

    it("should create nothing for an empty list", async () => {
      const db = await createConnectedDatabase();

      await expect(db.syncSchema([])).resolves.toEqual({
        createdCollections: [],
      });

      expect(await setupDb.listCollections().toArray()).toEqual([]);
    });

    it("should drop no index the schema does not name", async () => {
      await setupDb.createCollection("users");
      await setupDb
        .collection("users")
        .createIndexes([{ name: "old_idx", key: { legacy: 1 } }]);
      const db = await createConnectedDatabase();

      await db.syncSchema([testSchema]);

      const names = await indexNames(setupDb, "users");
      expect(names).toContain("old_idx");
      expect(names).toContain("email_unique");
      expect(names).toContain("createdAt_idx");
    });

    it("should leave the validator as it was when an index conflicts", async () => {
      const oldValidator = {
        $jsonSchema: { bsonType: "object", required: ["old"] },
      };
      await setupDb.createCollection("users", { validator: oldValidator });
      await setupDb
        .collection("users")
        .createIndexes([{ name: "i", key: { a: 1 } }]);
      const db = await createConnectedDatabase();

      await expectConflict(
        db,
        [
          {
            collectionName: "users",
            validation: testSchema.validation,
            indexes: [{ name: "i", key: { b: 1 } }],
          },
        ],
        { collection: "users", index: "i", code: 86 },
      );

      expect(await validatorOf(setupDb, "users")).toEqual(oldValidator);
    });

    describe("an index the schema changed", () => {
      it("should reject an index renamed onto another key, dropping nothing", async () => {
        await setupDb.createCollection("users");
        await setupDb.collection("users").createIndexes([
          { name: "i", key: { a: 1 } },
          { name: "old", key: { old: 1 } },
        ]);
        const db = await createConnectedDatabase();

        await expectConflict(
          db,
          [
            {
              collectionName: "users",
              validation: anyDocument,
              indexes: [{ name: "i", key: { b: 1 } }],
            },
          ],
          { collection: "users", index: "i", code: 86 },
        );

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
        const db = await createConnectedDatabase();

        await expectConflict(
          db,
          [
            {
              collectionName: "users",
              validation: anyDocument,
              indexes: [{ name: "j", key: { a: 1 } }],
            },
          ],
          { collection: "users", index: "j", code: 85 },
        );

        const names = await indexNames(setupDb, "users");
        expect(names).toContain("i");
        expect(names).not.toContain("j");
      });

      it("should reject an index made unique", async () => {
        await setupDb.createCollection("users");
        await setupDb
          .collection("users")
          .createIndexes([{ name: "i", key: { a: 1 } }]);
        const db = await createConnectedDatabase();

        await expectConflict(
          db,
          [
            {
              collectionName: "users",
              validation: anyDocument,
              indexes: [{ name: "i", key: { a: 1 }, unique: true }],
            },
          ],
          { collection: "users", index: "i", code: 86 },
        );

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
        const db = await createConnectedDatabase();

        await expectConflict(
          db,
          [
            {
              collectionName: "users",
              validation: anyDocument,
              indexes: [{ name: "i", key: { a: 1 }, expireAfterSeconds: 20 }],
            },
          ],
          { collection: "users", index: "i", code: 85 },
        );
      });

      it("should name the conflicting index, not the one before it, and keep that one", async () => {
        await setupDb.createCollection("users");
        await setupDb
          .collection("users")
          .createIndexes([{ name: "i", key: { a: 1 } }]);
        const db = await createConnectedDatabase();

        const error = await expectConflict(
          db,
          [
            {
              collectionName: "users",
              validation: anyDocument,
              indexes: [
                { name: "z", key: { z: 1 } },
                { name: "i", key: { b: 1 } },
              ],
            },
          ],
          { collection: "users", index: "i", code: 86 },
        );

        expect(error.message).not.toContain("'z'");
        expect(await indexNames(setupDb, "users")).toContain("z");
      });
    });

    it("should create an index hidden when the schema says so", async () => {
      const db = await createConnectedDatabase();

      await db.syncSchema([
        {
          collectionName: "users",
          validation: anyDocument,
          indexes: [{ name: "a_1", key: { a: 1 }, hidden: true }],
        },
      ]);

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
      const db = await createConnectedDatabase();

      await db.syncSchema([
        {
          collectionName: "users",
          validation: anyDocument,
          indexes: [{ name: "i", key: { a: 1 } }],
        },
      ]);

      const indexes = await listIndexes(setupDb, "users");
      expect(indexes).toContainEqual(
        expect.objectContaining({ name: "i", hidden: true }),
      );
    });
  });

  describe("dropStaleIndexes", () => {
    it("should reject with the not-connected error on a new instance", async () => {
      const db = createDatabase();

      await expectNotConnected(
        () => db.dropStaleIndexes([testSchema]),
        "dropStaleIndexes",
      );
    });

    it("should drop an index the schema does not name, and report it", async () => {
      await setupDb.createCollection("users");
      await setupDb
        .collection("users")
        .createIndexes([{ name: "old_idx", key: { legacy: 1 }, unique: true }]);
      const listed = await indexNamed(setupDb, "users", "old_idx");
      expect(listed).toBeDefined();
      const db = await createConnectedDatabase();
      await db.syncSchema([testSchema]);

      await expect(db.dropStaleIndexes([testSchema])).resolves.toEqual({
        droppedIndexes: [{ collection: "users", index: listed }],
      });

      expect(await indexNames(setupDb, "users")).not.toContain("old_idx");
    });

    it("should keep only _id_ for a schema without indexes", async () => {
      await setupDb.createCollection("logs");
      await setupDb
        .collection("logs")
        .createIndexes([{ name: "old_idx", key: { legacy: 1 } }]);
      const db = await createConnectedDatabase();

      await db.dropStaleIndexes([
        { collectionName: "logs", validation: anyDocument },
      ]);

      expect(await indexNames(setupDb, "logs")).toEqual(["_id_"]);
    });

    it("should drop the index the schema's index replaced by name", async () => {
      await setupDb.createCollection("users");
      await setupDb
        .collection("users")
        .createIndexes([{ name: "a_1", key: { a: 1 } }]);
      const schemas: IMongoSchema[] = [
        {
          collectionName: "users",
          validation: anyDocument,
          indexes: [{ name: "b_1", key: { b: 1 } }],
        },
      ];
      const db = await createConnectedDatabase();

      await db.syncSchema(schemas);
      await db.dropStaleIndexes(schemas);

      const names = await indexNames(setupDb, "users");
      expect(names).toContain("b_1");
      expect(names).not.toContain("a_1");
    });

    it("should reject with a failed drop of a stale index", async () => {
      await setupDb.createCollection("users");
      await setupDb
        .collection("users")
        .createIndexes([{ name: "old_idx", key: { legacy: 1 } }]);
      const db = await createConnectedDatabase();
      await db.syncSchema([testSchema]);
      const error = new Error("drop failed");
      vi.spyOn(Collection.prototype, "dropIndex").mockRejectedValue(error);

      await expect(db.dropStaleIndexes([testSchema])).rejects.toBe(error);
      expect(db.isConnected()).toBe(true);
    });

    it("should report every drop with its collection, in order", async () => {
      await setupDb.createCollection("users");
      await setupDb
        .collection("users")
        .createIndexes([{ name: "old_a", key: { a: 1 } }]);
      await setupDb.createCollection("logs");
      await setupDb
        .collection("logs")
        .createIndexes([{ name: "old_b", key: { b: 1 } }]);
      const oldA = await indexNamed(setupDb, "users", "old_a");
      const oldB = await indexNamed(setupDb, "logs", "old_b");
      expect(oldA).toBeDefined();
      expect(oldB).toBeDefined();
      const schemas: IMongoSchema[] = [
        testSchema,
        { collectionName: "logs", validation: anyDocument },
      ];
      const db = await createConnectedDatabase();
      await db.syncSchema(schemas);

      await expect(db.dropStaleIndexes(schemas)).resolves.toEqual({
        droppedIndexes: [
          { collection: "users", index: oldA },
          { collection: "logs", index: oldB },
        ],
      });
    });

    it("should report nothing when nothing is stale", async () => {
      const db = await createConnectedDatabase();
      await db.syncSchema([testSchema]);
      const before = await listIndexes(setupDb, "users");

      await expect(db.dropStaleIndexes([testSchema])).resolves.toEqual({
        droppedIndexes: [],
      });

      expect(await listIndexes(setupDb, "users")).toEqual(before);
    });

    it("should drop nothing in any collection while a schema index is missing", async () => {
      await setupDb.createCollection("users");
      await setupDb
        .collection("users")
        .createIndexes([{ name: "old_idx", key: { legacy: 1 } }]);
      await setupDb.createCollection("logs");
      const db = await createConnectedDatabase();
      await db.syncSchema([testSchema]);

      const error = await expectNativeError(() =>
        db.dropStaleIndexes([
          testSchema,
          {
            collectionName: "logs",
            validation: anyDocument,
            indexes: [{ name: "a_1", key: { a: 1 } }],
          },
        ]),
      );

      expect(error.message).toContain("'logs'");
      expect(error.message).toContain("'a_1'");
      expect(await indexNames(setupDb, "users")).toContain("old_idx");
    });

    it("should report a missing collection together with the other misses", async () => {
      await setupDb.createCollection("users");
      await setupDb.collection("users").createIndexes([
        { name: "createdAt_idx", key: { createdAt: -1 } },
        { name: "old_idx", key: { legacy: 1 } },
      ]);
      const db = await createConnectedDatabase();

      const error = await expectNativeError(() =>
        db.dropStaleIndexes([
          { collectionName: "orders", validation: anyDocument },
          testSchema,
        ]),
      );

      expect(error.message).toContain("'orders'");
      expect(error.message).toContain("'users'");
      expect(error.message).toContain("'email_unique'");
      expect(await indexNames(setupDb, "users")).toContain("old_idx");
    });

    it("should reject when a stale index was dropped by someone else", async () => {
      await setupDb.createCollection("users");
      await setupDb
        .collection("users")
        .createIndexes([{ name: "old_idx", key: { legacy: 1 } }]);
      const db = await createConnectedDatabase();
      await db.syncSchema([testSchema]);

      // The index is dropped through `setupDb` first, as another run would,
      // then the original `dropIndex` runs.
      const original = Collection.prototype.dropIndex;
      const dropped: string[] = [];
      vi.spyOn(Collection.prototype, "dropIndex").mockImplementationOnce(
        async function (this: Collection, indexName, options) {
          dropped.push(indexName);
          await setupDb.command({
            dropIndexes: this.collectionName,
            index: indexName,
          });
          return original.call(this, indexName, options);
        },
      );

      let rejection: unknown;
      try {
        await db.dropStaleIndexes([testSchema]);
      } catch (error) {
        rejection = error;
      }

      expect(dropped).toEqual(["old_idx"]);
      expect(rejection).toBeInstanceOf(MongoServerError);
      expect(rejection).toMatchObject({ code: 27 });
    });

    it("should leave the collections of no schema untouched", async () => {
      await setupDb.createCollection("other");
      await setupDb
        .collection("other")
        .createIndexes([{ name: "x_1", key: { x: 1 } }]);
      const db = await createConnectedDatabase();
      await db.syncSchema([testSchema]);

      await db.dropStaleIndexes([testSchema]);

      expect(await indexNames(setupDb, "other")).toContain("x_1");
    });

    it("should leave the validator alone", async () => {
      const db = await createConnectedDatabase();
      await db.syncSchema([testSchema]);
      const replaced = {
        $jsonSchema: { bsonType: "object", required: ["replaced"] },
      };
      await setupDb.command({ collMod: "users", validator: replaced });

      await db.dropStaleIndexes([testSchema]);

      expect(await validatorOf(setupDb, "users")).toEqual(replaced);
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

    it("should throw the not-connected error on a new instance", () => {
      const db = createDatabase();
      expectThrowsNotConnected(() => db.getDb(), "getDb");
    });

    it("should throw the not-connected error after disconnect", async () => {
      const db = createDatabase();
      await db.connect();
      await db.disconnect();

      expectThrowsNotConnected(() => db.getDb(), "getDb");
    });

    it("should throw the not-connected error while connect is in progress", async () => {
      const db = createDatabase();
      const connecting = db.connect();

      expectThrowsNotConnected(() => db.getDb(), "getDb");
      await expect(connecting).resolves.toBeUndefined();
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

    it("should throw the not-connected error on a new instance", () => {
      const db = createDatabase();
      expectThrowsNotConnected(() => db.getClient(), "getClient");
    });
  });

  describe("the order of the calls", () => {
    it("should end connected when connect is called during disconnect", async () => {
      const db = await createConnectedDatabase();
      const before = db.getClient();

      const disconnecting = db.disconnect();
      await db.connect();
      await disconnecting;

      expect(db.isConnected()).toBe(true);
      await expect(db.getDb().command({ ping: 1 })).resolves.toMatchObject({
        ok: 1,
      });
      expect(db.getClient() === before, "the client held before").toBe(true);
    });

    it("should let a disconnect called during connect wait for it, then close", async () => {
      const connectSpy = vi.spyOn(MongoClient.prototype, "connect");
      const db = createDatabase();
      const settled: string[] = [];

      const connecting = db.connect().then(() => settled.push("connect"));
      const disconnecting = db
        .disconnect()
        .then(() => settled.push("disconnect"));
      await Promise.all([connecting, disconnecting]);

      expect(settled).toEqual(["connect", "disconnect"]);
      expect(db.isConnected()).toBe(false);
      expectThrowsNotConnected(() => db.getDb(), "getDb");
      const opened = connectSpy.mock.contexts[0] as MongoClient | undefined;
      expect(opened).toBeInstanceOf(MongoClient);
      await expect(opened?.db(dbName).command({ ping: 1 })).rejects.toThrow();
    });

    it("should let a disconnect called during a failing connect resolve after it", async () => {
      const db = createDatabase({
        dbUri: "mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=200",
      });
      const settled: string[] = [];

      const connecting = db.connect().then(
        () => settled.push("connect resolved"),
        (error: unknown) => {
          settled.push("connect rejected");
          throw error;
        },
      );
      const disconnecting = db
        .disconnect()
        .then(() => settled.push("disconnect"));

      await expect(connecting).rejects.toMatchObject({
        name: "MongoServerSelectionError",
      });
      await expect(disconnecting).resolves.toBeDefined();
      expect(settled).toEqual(["connect rejected", "disconnect"]);
      expect(db.isConnected()).toBe(false);
    });

    it("should end connected on one client after connect, disconnect, connect", async () => {
      const connectSpy = vi.spyOn(MongoClient.prototype, "connect");
      const db = createDatabase();

      await Promise.all([db.connect(), db.disconnect(), db.connect()]);

      expect(db.isConnected()).toBe(true);
      await expect(db.getDb().command({ ping: 1 })).resolves.toMatchObject({
        ok: 1,
      });
      const held = db.getClient();
      expect(connectSpy.mock.contexts.length).toBeGreaterThan(0);
      for (const context of connectSpy.mock.contexts) {
        expect(context === held, "connect() called on the held client").toBe(
          true,
        );
      }
    });

    it("should end disconnected after disconnect, connect, disconnect", async () => {
      const db = await createConnectedDatabase();
      const held = db.getClient();

      await Promise.all([db.disconnect(), db.connect(), db.disconnect()]);

      expect(db.isConnected()).toBe(false);
      expectThrowsNotConnected(() => db.getDb(), "getDb");
      await expect(held.db(dbName).command({ ping: 1 })).rejects.toThrow();
    });

    it("should share one attempt between two connects to an unreachable server", async () => {
      const connectSpy = vi.spyOn(MongoClient.prototype, "connect");
      const db = createDatabase({
        dbUri: "mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=200",
      });

      const outcomes = await Promise.allSettled([db.connect(), db.connect()]);

      for (const outcome of outcomes) {
        expect(outcome.status).toBe("rejected");
        expect(
          outcome.status === "rejected" ? outcome.reason : undefined,
        ).toMatchObject({ name: "MongoServerSelectionError" });
      }
      expect(connectSpy).toHaveBeenCalledOnce();
    });

    it("should share one close between two disconnects", async () => {
      const db = await createConnectedDatabase();
      const closeSpy = vi.spyOn(MongoClient.prototype, "close");

      const outcomes = await Promise.allSettled([
        db.disconnect(),
        db.disconnect(),
      ]);

      expect(outcomes.map((outcome) => outcome.status)).toEqual([
        "fulfilled",
        "fulfilled",
      ]);
      expect(closeSpy).toHaveBeenCalledOnce();
      expect(db.isConnected()).toBe(false);
    });
  });

  describe("one client", () => {
    it("should reopen the same client, and what was built on it, after a reconnect", async () => {
      const db = await createConnectedDatabase();
      const held = db.getClient();
      const heldDb = db.getDb();

      await db.disconnect();

      await expect(held.db(dbName).command({ ping: 1 })).rejects.toMatchObject({
        name: "MongoNotConnectedError",
      });

      await db.connect();

      expect(db.getClient() === held, "the client held before").toBe(true);
      await expect(held.db(dbName).command({ ping: 1 })).resolves.toMatchObject(
        { ok: 1 },
      );
      await expect(
        heldDb.collection("users").insertOne({ email: "a@example.com" }),
      ).resolves.toMatchObject({ acknowledged: true });
    });

    it("should try again after an unparseable URI, having created no client", async () => {
      const db = createDatabase({ dbUri: "not-a-uri" });

      await expect(db.connect()).rejects.toMatchObject({
        name: "MongoParseError",
      });
      await expect(db.connect()).rejects.toMatchObject({
        name: "MongoParseError",
      });
    });
  });

  describe("a client closed by hand", () => {
    it("should count the instance as not connected", async () => {
      const db = await createConnectedDatabase();

      await db.getClient().close();

      expect(db.isConnected()).toBe(false);
      expectThrowsNotConnected(() => db.getDb(), "getDb");
    });

    it("should reopen the same client on the next connect", async () => {
      const db = await createConnectedDatabase();
      const held = db.getClient();
      await held.close();

      await db.connect();

      expect(db.isConnected()).toBe(true);
      expect(db.getClient() === held, "the client held before").toBe(true);
      await expect(db.getDb().command({ ping: 1 })).resolves.toMatchObject({
        ok: 1,
      });
    });

    it("should not close it again on disconnect", async () => {
      const db = await createConnectedDatabase();
      await db.getClient().close();
      const closeSpy = vi.spyOn(MongoClient.prototype, "close");

      await expect(db.disconnect()).resolves.toBeUndefined();

      expect(closeSpy).not.toHaveBeenCalled();
    });
  });
});
