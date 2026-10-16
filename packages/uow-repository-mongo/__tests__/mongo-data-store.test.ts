import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { Decimal128, ObjectId, type Db, type MongoClient } from "mongodb";
import { BaseError } from "@enardo/errors";
import {
  MongoTransactionManager,
  type IMongoTransaction,
} from "@enardo/transaction-manager-mongo";
import {
  ConcurrencyConflictError,
  type AggregateWrite,
  type ChangeSet,
  type CollectionChanges,
  type RecordSet,
} from "@enardo/uow-repository";
import {
  InvalidDataStoreOptionsError,
  MissingCollectionChangesError,
} from "~/errors";
import { MongoDataStore } from "~/mongo-data-store";
import {
  connect,
  createDatabase,
  createGroupStore,
  createProductStore,
  type GroupRecord,
  type GroupRecords,
  type MemberRecord,
  type ProductRecord,
  type ProductRecords,
} from "./support/fixtures";

describe("MongoDataStore", () => {
  let client: MongoClient;
  let db: Db;
  let transactionManager: MongoTransactionManager;

  beforeAll(async () => {
    client = await connect();
    transactionManager = new MongoTransactionManager(client);
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    db = await createDatabase(client);
  });

  afterEach(async () => {
    await db.dropDatabase();
  });

  function inTransaction(
    work: (transaction: IMongoTransaction) => Promise<void>,
  ): Promise<void> {
    return transactionManager.runInTransaction(work);
  }

  /** Stores documents directly, bypassing the data store under test. */
  async function seed(name: string, ...documents: object[]): Promise<void> {
    await db.collection(name).insertMany(documents.map((d) => ({ ...d })));
  }

  async function documentsOf(name: string): Promise<object[]> {
    return db.collection(name).find().sort({ _id: 1 }).toArray();
  }

  describe("options", () => {
    it("rejects collections that name no root", () => {
      expect(
        () =>
          new MongoDataStore<GroupRecords, ObjectId>({
            client,
            collections: {
              groups: {
                collection: db.collection("groups"),
                aggregateIdField: "_id",
              },
              members: {
                collection: db.collection("members"),
                aggregateIdField: "groupId",
              },
            },
          }),
      ).toThrow(InvalidDataStoreOptionsError);
    });

    it("rejects collections that name more than one root", () => {
      expect(
        () =>
          new MongoDataStore<GroupRecords, ObjectId>({
            client,
            collections: {
              groups: { collection: db.collection("groups"), root: true },
              members: { collection: db.collection("members"), root: true },
            },
          }),
      ).toThrow(InvalidDataStoreOptionsError);
    });

    it("keys every record by its id field, giving equal ObjectIds one key", () => {
      const store = createGroupStore(client, db);
      const hex = new ObjectId().toHexString();
      const record = member(new ObjectId(), "member");

      expect(Object.keys(store.recordKeys)).toEqual(["groups", "members"]);
      expect(
        store.recordKeys.members({ ...record, _id: new ObjectId(hex) }),
      ).toBe(store.recordKeys.members({ ...record, _id: new ObjectId(hex) }));
      expect(store.recordKeys.members(record)).not.toBe(
        store.recordKeys.members({ ...record, _id: new ObjectId() }),
      );
    });
  });

  describe("findById", () => {
    it("returns null when the root document does not exist", async () => {
      const store = createGroupStore(client, db);

      expect(await store.findById(new ObjectId())).toBeNull();
    });

    it("returns the records without the version, and the version beside them", async () => {
      const store = createProductStore(client, db);
      const record = product();
      await seed("products", { ...record, _version: 3 });

      const found = await store.findById(record._id);

      expect(found).toEqual({ records: { products: [record] }, version: 3 });
      expect(found!.records.products[0]).not.toHaveProperty("_version");
    });

    it("keeps BSON values as BSON types", async () => {
      const store = createProductStore(client, db);
      const record = product();
      await seed("products", { ...record, _version: 1 });

      const [found] = (await store.findById(record._id))!.records.products;

      expect(found._id).toBeInstanceOf(ObjectId);
      expect(found.price).toBeInstanceOf(Decimal128);
      expect(found.listedAt).toBeInstanceOf(Date);
    });

    it("reads a document stored without a version as version 0", async () => {
      const store = createProductStore(client, db);
      const record = product();
      await seed("products", record);

      expect((await store.findById(record._id))!.version).toBe(0);
    });

    it("reads every collection, holding only the records of the requested aggregate", async () => {
      const store = createGroupStore(client, db);
      const climbers = group("Climbers");
      const hikers = group("Hikers");
      const empty = group("Empty");
      const owner = member(climbers._id, "owner");
      const joined = member(climbers._id, "member");
      await seed(
        "groups",
        { ...climbers, _version: 1 },
        { ...hikers, _version: 1 },
        { ...empty, _version: 1 },
      );
      await seed("members", owner, joined, member(hikers._id, "owner"));

      const found = await store.findById(climbers._id);
      const withoutMembers = await store.findById(empty._id);

      expect(found!.records.groups).toEqual([climbers]);
      expect(sortById(found!.records.members)).toEqual(
        sortById([owner, joined]),
      );
      expect(withoutMembers!.records).toEqual({ groups: [empty], members: [] });
    });

    it("reads the version from the configured field", async () => {
      const store = createProductStore(client, db, "revision");
      const record = product();
      await seed("products", { ...record, revision: 4 });

      expect(await store.findById(record._id)).toEqual({
        records: { products: [record] },
        version: 4,
      });
    });
  });

  describe("findAll", () => {
    it("returns every aggregate with its own children, ignoring orphaned children", async () => {
      const store = createGroupStore(client, db);
      const climbers = group("Climbers");
      const hikers = group("Hikers");
      const owner = member(climbers._id, "owner");
      const joined = member(climbers._id, "member");
      await seed("groups", { ...climbers, _version: 2 }, hikers);
      await seed("members", owner, joined, member(new ObjectId(), "member"));

      const found = await store.findAll();

      expect(
        [...found].sort((a, b) =>
          a.records.groups[0].name.localeCompare(b.records.groups[0].name),
        ),
      ).toEqual([
        {
          records: { groups: [climbers], members: [owner, joined] },
          version: 2,
        },
        { records: { groups: [hikers], members: [] }, version: 0 },
      ]);
    });
  });

  describe("findOne", () => {
    it("reads the aggregate whose root matches a filter, with its children and without the version", async () => {
      const store = createGroupStore(client, db);
      const climbers = group("Climbers");
      const hikers = group("Hikers");
      const owner = member(climbers._id, "owner");
      await seed("groups", { ...climbers, _version: 2 }, hikers);
      await seed("members", owner, member(hikers._id, "owner"));

      expect(await store.findOne({ name: "Climbers" })).toEqual({
        records: { groups: [climbers], members: [owner] },
        version: 2,
      });
    });

    it("returns null when no root matches", async () => {
      const store = createGroupStore(client, db);
      await seed("groups", group("Climbers"));

      expect(await store.findOne({ name: "Hikers" })).toBeNull();
    });
  });

  describe("findMany", () => {
    it("sorts and pages the roots, loading the children of the roots found", async () => {
      const store = createGroupStore(client, db);
      const alpine = group("Alpine");
      const boulder = group("Boulder");
      const coastal = group("Coastal");
      const alpineOwner = member(alpine._id, "owner");
      const coastalOwner = member(coastal._id, "owner");
      await seed("groups", { ...coastal, _version: 3 }, alpine, {
        ...boulder,
        _version: 1,
      });
      await seed("members", alpineOwner, coastalOwner);

      const page = await store.findMany(
        {},
        { sort: { name: -1 }, skip: 1, limit: 1 },
      );
      const matching = await store.findMany(
        { name: { $in: ["Alpine", "Coastal"] } },
        { sort: { name: 1 } },
      );

      expect(page).toEqual([
        { records: { groups: [boulder], members: [] }, version: 1 },
      ]);
      expect(matching).toEqual([
        { records: { groups: [alpine], members: [alpineOwner] }, version: 0 },
        {
          records: { groups: [coastal], members: [coastalOwner] },
          version: 3,
        },
      ]);
    });

    it("returns every matching aggregate held in one collection, without the version", async () => {
      const store = createProductStore(client, db);
      const keyboard = product({ name: "Keyboard" });
      const mouse = product({ name: "Mouse" });
      await seed("products", { ...mouse, _version: 2 }, keyboard);

      expect(await store.findMany({}, { sort: { name: 1 } })).toEqual([
        { records: { products: [keyboard] }, version: 0 },
        { records: { products: [mouse] }, version: 2 },
      ]);
    });
  });

  describe("count", () => {
    it("counts the root documents that match a filter", async () => {
      const store = createGroupStore(client, db);
      await seed("groups", group("Alpine"), group("Boulder"), group("Coastal"));

      expect(await store.count({ name: { $in: ["Alpine", "Coastal"] } })).toBe(
        2,
      );
      expect(await store.count()).toBe(3);
    });
  });

  describe("apply", () => {
    it("inserts a new aggregate: the root at version 1, then its children", async () => {
      const store = createGroupStore(client, db);
      const climbers = group("Climbers");
      const owner = member(climbers._id, "owner");

      await inTransaction((transaction) =>
        store.apply(
          write<GroupRecords>(climbers._id, undefined, {
            groups: changes({ inserted: [climbers] }),
            members: changes({ inserted: [owner] }),
          }),
          transaction,
        ),
      );

      expect(await documentsOf("groups")).toEqual([
        { ...climbers, _version: 1 },
      ]);
      expect(await documentsOf("members")).toEqual([owner]);
    });

    it("sets and unsets only the listed root fields, and advances the version", async () => {
      const store = createProductStore(client, db);
      const record = product();
      await seed("products", { ...record, notes: "Mechanical", _version: 1 });

      await inTransaction((transaction) =>
        store.apply(
          write<ProductRecords>(record._id, 1, {
            products: changes({
              updated: [
                {
                  record: { ...record, name: "Mouse" },
                  set: { name: "Mouse" },
                  unset: ["notes"],
                },
              ],
            }),
          }),
          transaction,
        ),
      );

      expect(await documentsOf("products")).toEqual([
        { ...record, name: "Mouse", _version: 2 },
      ]);
    });

    it("advances the version even when only children change", async () => {
      const store = createGroupStore(client, db);
      const climbers = group("Climbers");
      const promoted = member(climbers._id, "member");
      const leaving = member(climbers._id, "member");
      const joining = member(climbers._id, "member");
      await seed("groups", { ...climbers, _version: 1 });
      await seed("members", promoted, leaving);

      await inTransaction((transaction) =>
        store.apply(
          write<GroupRecords>(climbers._id, 1, {
            groups: changes(),
            members: changes({
              inserted: [joining],
              updated: [
                {
                  record: { ...promoted, role: "owner" },
                  set: { role: "owner" },
                  unset: [],
                },
              ],
              deleted: [leaving],
            }),
          }),
          transaction,
        ),
      );

      expect(await documentsOf("groups")).toEqual([
        { ...climbers, _version: 2 },
      ]);
      expect(await documentsOf("members")).toEqual(
        sortById([{ ...promoted, role: "owner" }, joining]),
      );
    });

    it("confines the writes to children of the aggregate being written", async () => {
      const store = createGroupStore(client, db);
      const climbers = group("Climbers");
      const hikers = group("Hikers");
      const stranger = member(hikers._id, "member");
      await seed("groups", { ...climbers, _version: 1 });
      await seed("members", stranger);

      await inTransaction((transaction) =>
        store.apply(
          write<GroupRecords>(climbers._id, 1, {
            groups: changes(),
            members: changes({
              updated: [
                {
                  record: { ...stranger, role: "owner" },
                  set: { role: "owner" },
                  unset: [],
                },
              ],
              deleted: [stranger],
            }),
          }),
          transaction,
        ),
      );

      expect(await documentsOf("members")).toEqual([stranger]);
    });

    it("fails with ConcurrencyConflictError, writing nothing, when the stored version moved on", async () => {
      const store = createGroupStore(client, db);
      const climbers = group("Climbers");
      await seed("groups", { ...climbers, _version: 2 });

      await expect(
        inTransaction((transaction) =>
          store.apply(
            write<GroupRecords>(climbers._id, 1, {
              groups: changes({
                updated: [
                  {
                    record: { ...climbers, name: "Boulderers" },
                    set: { name: "Boulderers" },
                    unset: [],
                  },
                ],
              }),
              members: changes({
                inserted: [member(climbers._id, "member")],
              }),
            }),
            transaction,
          ),
        ),
      ).rejects.toBeInstanceOf(ConcurrencyConflictError);

      expect(await documentsOf("groups")).toEqual([
        { ...climbers, _version: 2 },
      ]);
      expect(await documentsOf("members")).toEqual([]);
    });

    it("accepts version 0 for a document stored without a version, and sets it to 1", async () => {
      const store = createProductStore(client, db);
      const record = product();
      await seed("products", record);

      await inTransaction((transaction) =>
        store.apply(
          write<ProductRecords>(record._id, 0, {
            products: changes({
              updated: [
                {
                  record: { ...record, name: "Mouse" },
                  set: { name: "Mouse" },
                  unset: [],
                },
              ],
            }),
          }),
          transaction,
        ),
      );

      expect(await documentsOf("products")).toEqual([
        { ...record, name: "Mouse", _version: 1 },
      ]);
    });

    it("rejects version 0 for a document stored with a version", async () => {
      const store = createProductStore(client, db);
      const record = product();
      await seed("products", { ...record, _version: 1 });

      await expect(
        inTransaction((transaction) =>
          store.apply(
            write<ProductRecords>(record._id, 0, {
              products: changes({
                updated: [
                  {
                    record: { ...record, name: "Mouse" },
                    set: { name: "Mouse" },
                    unset: [],
                  },
                ],
              }),
            }),
            transaction,
          ),
        ),
      ).rejects.toBeInstanceOf(ConcurrencyConflictError);
    });

    it("writes the version to the configured field", async () => {
      const store = createProductStore(client, db, "revision");
      const record = product();

      await inTransaction((transaction) =>
        store.apply(
          write<ProductRecords>(record._id, undefined, {
            products: changes({ inserted: [record] }),
          }),
          transaction,
        ),
      );

      expect(await documentsOf("products")).toEqual([
        { ...record, revision: 1 },
      ]);
    });

    it("writes nothing when the transaction aborts", async () => {
      const store = createProductStore(client, db);
      const record = product();
      const failure = new Error("later write failed");

      await expect(
        inTransaction(async (transaction) => {
          await store.apply(
            write<ProductRecords>(record._id, undefined, {
              products: changes({ inserted: [record] }),
            }),
            transaction,
          );
          throw failure;
        }),
      ).rejects.toBe(failure);

      expect(await documentsOf("products")).toEqual([]);
    });

    it("fails with MissingCollectionChangesError when the change set has no entry for a child collection", async () => {
      const store = createGroupStore(client, db);
      const climbers = group("Climbers");
      await seed("groups", { ...climbers, _version: 1 });

      const rejection = inTransaction((transaction) =>
        store.apply(
          write<GroupRecords>(climbers._id, 1, {
            groups: changes(),
          } as ChangeSet<GroupRecords>),
          transaction,
        ),
      );

      await expect(rejection).rejects.toBeInstanceOf(
        MissingCollectionChangesError,
      );
      await expect(rejection).rejects.toMatchObject({
        code: "MISSING_COLLECTION_CHANGES",
        details: { collection: "members" },
      });
    });

    it("fails with MissingCollectionChangesError when the change set has no entry for the root collection", async () => {
      const store = createGroupStore(client, db);
      const climbers = group("Climbers");

      const rejection = inTransaction((transaction) =>
        store.apply(
          write<GroupRecords>(climbers._id, undefined, {
            members: changes({ inserted: [member(climbers._id, "owner")] }),
          } as ChangeSet<GroupRecords>),
          transaction,
        ),
      );

      await expect(rejection).rejects.toBeInstanceOf(
        MissingCollectionChangesError,
      );
      await expect(rejection).rejects.toMatchObject({
        code: "MISSING_COLLECTION_CHANGES",
        details: { collection: "groups" },
      });
    });

    it("writes nothing when a change set without an entry for a collection is rejected", async () => {
      const store = createGroupStore(client, db);
      const climbers = group("Climbers");

      await expect(
        inTransaction((transaction) =>
          store.apply(
            write<GroupRecords>(climbers._id, undefined, {
              groups: changes({ inserted: [climbers] }),
            } as ChangeSet<GroupRecords>),
            transaction,
          ),
        ),
      ).rejects.toBeInstanceOf(MissingCollectionChangesError);

      expect(await documentsOf("groups")).toEqual([]);
      expect(await documentsOf("members")).toEqual([]);
    });

    it("rejects a change set without an entry with a BaseError named MissingCollectionChangesError", async () => {
      const store = createProductStore(client, db);
      const record = product();

      const error = await rejectionOf(
        inTransaction((transaction) =>
          store.apply(
            write<ProductRecords>(
              record._id,
              undefined,
              {} as ChangeSet<ProductRecords>,
            ),
            transaction,
          ),
        ),
      );

      expect(error).toBeInstanceOf(MissingCollectionChangesError);
      expect(error).toBeInstanceOf(BaseError);
      expect(error).toMatchObject({
        name: "MissingCollectionChangesError",
        code: "MISSING_COLLECTION_CHANGES",
        details: { collection: "products" },
      });
    });
  });

  describe("delete", () => {
    it("deletes the root and every child when the version matches", async () => {
      const store = createGroupStore(client, db);
      const climbers = group("Climbers");
      const hikers = group("Hikers");
      const stayer = member(hikers._id, "owner");
      await seed("groups", { ...climbers, _version: 3 }, { ...hikers });
      await seed("members", member(climbers._id, "owner"), stayer);

      await inTransaction((transaction) =>
        store.delete(climbers._id, 3, transaction),
      );

      expect(await documentsOf("groups")).toEqual([hikers]);
      expect(await documentsOf("members")).toEqual([stayer]);
    });

    it("fails with ConcurrencyConflictError, deleting nothing, when the version moved on", async () => {
      const store = createGroupStore(client, db);
      const climbers = group("Climbers");
      const owner = member(climbers._id, "owner");
      await seed("groups", { ...climbers, _version: 4 });
      await seed("members", owner);

      await expect(
        inTransaction((transaction) =>
          store.delete(climbers._id, 3, transaction),
        ),
      ).rejects.toBeInstanceOf(ConcurrencyConflictError);

      expect(await documentsOf("groups")).toEqual([
        { ...climbers, _version: 4 },
      ]);
      expect(await documentsOf("members")).toEqual([owner]);
    });

    it("deletes whatever the version when no version is expected", async () => {
      const store = createGroupStore(client, db);
      const climbers = group("Climbers");
      await seed("groups", { ...climbers, _version: 5 });
      await seed("members", member(climbers._id, "owner"));

      await inTransaction((transaction) =>
        store.delete(climbers._id, undefined, transaction),
      );

      expect(await documentsOf("groups")).toEqual([]);
      expect(await documentsOf("members")).toEqual([]);
    });

    it("succeeds when no version is expected and the aggregate does not exist", async () => {
      const store = createGroupStore(client, db);

      await expect(
        inTransaction((transaction) =>
          store.delete(new ObjectId(), undefined, transaction),
        ),
      ).resolves.toBeUndefined();
    });
  });
});

function product(overrides: Partial<ProductRecord> = {}): ProductRecord {
  return {
    _id: new ObjectId(),
    name: "Keyboard",
    price: Decimal128.fromString("49.90"),
    listedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function group(name: string): GroupRecord {
  return { _id: new ObjectId(), name };
}

function member(groupId: ObjectId, role: MemberRecord["role"]): MemberRecord {
  return { _id: new ObjectId(), groupId, userId: new ObjectId(), role };
}

function changes<TRecord>(
  writes: Partial<CollectionChanges<TRecord>> = {},
): CollectionChanges<TRecord> {
  return { inserted: [], updated: [], deleted: [], ...writes };
}

function write<TRecords extends RecordSet<TRecords>>(
  id: ObjectId,
  expectedVersion: number | undefined,
  changeSet: ChangeSet<TRecords>,
): AggregateWrite<TRecords, ObjectId, number> {
  return { id, expectedVersion, changes: changeSet };
}

/** Returns what a promise rejects with, failing the test if it resolves. */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the promise to reject, but it resolved");
}

function sortById<TRecord extends { _id: ObjectId }>(
  records: readonly TRecord[],
): TRecord[] {
  return [...records].sort((a, b) =>
    a._id.toHexString().localeCompare(b._id.toHexString()),
  );
}
