import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
} from "vitest";
import {
  MongoError,
  ObjectId,
  type CommandStartedEvent,
  type Db,
  type MongoClient,
} from "mongodb";
import type { ITransactionManager } from "@enardo/transaction-manager";
import {
  MongoTransactionManager,
  type IMongoTransaction,
} from "~/mongo-transaction-manager";
import { connect, createDatabase } from "./support/fixtures";

describe("MongoTransactionManager", () => {
  let client: MongoClient;
  let db: Db;

  beforeAll(async () => {
    client = await connect();
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

  it("implements the transaction manager contract with a Mongo transaction as context", () => {
    expectTypeOf<MongoTransactionManager>().toExtend<
      ITransactionManager<IMongoTransaction>
    >();
  });

  it("runs work with an id and a session in an active transaction, and returns its result", async () => {
    const manager = new MongoTransactionManager(client);

    const result = await manager.runInTransaction(async ({ id, session }) => {
      expect(id).toEqual(expect.any(String));
      expect(session.inTransaction()).toBe(true);
      return "done";
    });

    expect(result).toBe("done");
  });

  it("commits the writes made with its session once work resolves", async () => {
    const manager = new MongoTransactionManager(client);
    const records = db.collection("records");
    const _id = new ObjectId();

    await manager.runInTransaction(async ({ session }) => {
      await records.insertOne({ _id, name: "Climbers" }, { session });
      // Outside the transaction, the write is not visible yet.
      expect(await records.countDocuments({ _id })).toBe(0);
    });

    expect(await records.countDocuments({ _id })).toBe(1);
  });

  it("rolls back and rethrows the original error when work rejects", async () => {
    const manager = new MongoTransactionManager(client);
    const records = db.collection("records");
    const failure = new Error("work failed");

    await expect(
      manager.runInTransaction(async ({ session }) => {
        await records.insertOne({ name: "Climbers" }, { session });
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(await records.countDocuments()).toBe(0);
  });

  it("keeps one id when the driver runs work again after a transient error", async () => {
    const manager = new MongoTransactionManager(client);
    const ids: string[] = [];

    await manager.runInTransaction(async ({ id }) => {
      ids.push(id);
      if (ids.length === 1) {
        const transient = new MongoError("transient failure");
        transient.addErrorLabel("TransientTransactionError");
        throw transient;
      }
    });

    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0]);
  });

  it("starts every transaction with the transaction options it was given", async () => {
    const monitored = await connect({ monitorCommands: true });
    const started: CommandStartedEvent[] = [];
    monitored.on("commandStarted", (event) => started.push(event));
    const manager = new MongoTransactionManager(monitored, {
      transactionOptions: { readConcern: { level: "snapshot" } },
    });

    try {
      await manager.runInTransaction(({ session }) =>
        monitored
          .db(db.databaseName)
          .collection("records")
          .findOne({}, { session }),
      );
    } finally {
      await monitored.close();
    }

    const find = started.find(({ commandName }) => commandName === "find");
    expect(find?.command.readConcern).toMatchObject({ level: "snapshot" });
  });
});
