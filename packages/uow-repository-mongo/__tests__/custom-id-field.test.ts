import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { ObjectId, type Db, type MongoClient } from "mongodb";
import {
  MongoTransactionManager,
  type MongoTransaction,
} from "@enardo/transaction-manager-mongo";
import {
  TrackingRepository,
  TransactionalUnitOfWork,
  type Mapper,
} from "@enardo/uow-repository";
import { MongoDataStore } from "~/mongo-data-store";
import { connect, createDatabase } from "./support/fixtures";
import { expectNativeError, reasonOf } from "./support/native-errors";

interface Item {
  documentId: ObjectId;
  sku: string;
  label: string;
}

interface Order {
  documentId: ObjectId;
  ref: string;
  note: string;
  items: Item[];
}

/** An order is found by `ref`, and an item by `sku`: no `_id` guards either. */
interface OrderRecords {
  orders: [{ _id: ObjectId; ref: string; note: string }];
  items: { _id: ObjectId; sku: string; orderRef: string; label: string }[];
}

const orderMapper: Mapper<Order, OrderRecords, string> = {
  toDomain: ({ orders: [order], items }) => ({
    documentId: order._id,
    ref: order.ref,
    note: order.note,
    items: items.map((item) => ({
      documentId: item._id,
      sku: item.sku,
      label: item.label,
    })),
  }),
  toRecords: (order) => ({
    orders: [{ _id: order.documentId, ref: order.ref, note: order.note }],
    items: order.items.map((item) => ({
      _id: item.documentId,
      sku: item.sku,
      orderRef: order.ref,
      label: item.label,
    })),
  }),
  identity: (order) => order.ref,
};

function order(ref: string, note: string, skus: string[] = []): Order {
  return {
    documentId: new ObjectId(),
    ref,
    note,
    items: skus.map((sku) => ({
      documentId: new ObjectId(),
      sku,
      label: `${sku} of ${note}`,
    })),
  };
}

describe("a custom idField", () => {
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
    await db.createCollection("orders");
    await db.createCollection("items");
  });

  afterEach(async () => {
    await db.dropDatabase();
  });

  function createStore(): MongoDataStore<OrderRecords, string> {
    return new MongoDataStore<OrderRecords, string>({
      client,
      collections: {
        orders: {
          collection: db.collection("orders"),
          root: true,
          idField: "ref",
        },
        items: {
          collection: db.collection("items"),
          aggregateIdField: "orderRef",
          idField: "sku",
        },
      },
    });
  }

  /** Runs one use case, in a unit of work and a repository of its own. */
  async function useCase<T>(
    run: (
      orders: TrackingRepository<Order, OrderRecords, string, MongoTransaction>,
    ) => Promise<T>,
  ): Promise<T> {
    const orders = new TrackingRepository(createStore(), orderMapper);
    const unitOfWork = new TransactionalUnitOfWork<MongoTransaction>(
      transactionManager,
    );
    unitOfWork.register(orders);
    return unitOfWork.execute(() => run(orders));
  }

  const notes = async (): Promise<string[]> =>
    (
      await db
        .collection<{ note: string }>("orders")
        .find()
        .sort({ note: 1 })
        .toArray()
    ).map((document) => document.note);

  describe("of a root", () => {
    it("rejects the second add of one key with a unique index on the field", async () => {
      await db.collection("orders").createIndex({ ref: 1 }, { unique: true });
      await useCase((orders) => orders.add(order("A-1", "first")));

      await expect(
        useCase((orders) => orders.add(order("A-1", "second"))),
      ).rejects.toMatchObject({ code: 11000 });

      expect(await notes()).toEqual(["first"]);
    });

    it("writes the second add of one key without a unique index, and reads silently find one", async () => {
      await useCase((orders) => orders.add(order("A-1", "first")));
      await useCase((orders) => orders.add(order("A-1", "second")));

      expect(await notes()).toEqual(["first", "second"]);

      const loaded = await useCase((orders) => orders.findById("A-1"));
      expect(["first", "second"]).toContain(loaded?.note);
      expect(await createStore().count({ ref: "A-1" })).toBe(2);
    });

    it("updates only one of the duplicates without a unique index", async () => {
      await useCase((orders) => orders.add(order("A-1", "first")));
      await useCase((orders) => orders.add(order("A-1", "second")));

      await useCase(async (orders) => {
        const loaded = await orders.findById("A-1");
        if (loaded) loaded.note = "changed";
      });

      const after = await notes();
      expect(after).toHaveLength(2);
      expect(after.filter((note) => note === "changed")).toHaveLength(1);
    });

    it("fails every later commit on the aggregate when its duplicates share a child key", async () => {
      await useCase((orders) => orders.add(order("A-1", "first", ["s"])));
      await useCase((orders) => orders.add(order("A-1", "second", ["s"])));

      // A use case that only reads fails too: the commit diffs what it loaded.
      expectNativeError(
        await reasonOf(useCase((orders) => orders.findById("A-1"))),
        Error,
        'Collection "items" of the previous record set holds more than one record with key ""s"".',
      );
    });
  });

  describe("of a child", () => {
    it("rejects a key another aggregate holds with a unique index on the field, and rolls back the root", async () => {
      await db.collection("items").createIndex({ sku: 1 }, { unique: true });
      await useCase((orders) => orders.add(order("A-1", "first", ["s"])));

      await expect(
        useCase((orders) => orders.add(order("A-2", "second", ["s"]))),
      ).rejects.toMatchObject({ code: 11000 });

      expect(await notes()).toEqual(["first"]);
      expect(await db.collection("items").countDocuments()).toBe(1);
    });

    it("keeps each aggregate's writes on its own records when two aggregates share a key without an index", async () => {
      await useCase((orders) => orders.add(order("A-1", "first", ["s"])));
      await useCase((orders) => orders.add(order("A-2", "second", ["s"])));

      await useCase(async (orders) => {
        const loaded = await orders.findById("A-1");
        const item = loaded?.items[0];
        if (item) item.label = "changed";
      });

      const items = await db
        .collection<{ label: string }>("items")
        .find()
        .sort({ orderRef: 1 })
        .toArray();
      expect(items.map((item) => item.label)).toEqual([
        "changed",
        "s of second",
      ]);
    });

    it("leaves a child's `_id` alone when the mapper leaves it out, and writes the edit", async () => {
      interface BareItemRecords {
        orders: [{ _id: ObjectId; ref: string; note: string }];
        items: { sku: string; orderRef: string; label: string }[];
      }

      const bareItemMapper: Mapper<Order, BareItemRecords, string> = {
        toDomain: ({ orders: [record], items }) => ({
          documentId: record._id,
          ref: record.ref,
          note: record.note,
          // The entity needs no item `_id`: the mapper never returns it.
          items: items.map((item) => ({
            documentId: new ObjectId(),
            sku: item.sku,
            label: item.label,
          })),
        }),
        toRecords: (order) => ({
          orders: [{ _id: order.documentId, ref: order.ref, note: order.note }],
          items: order.items.map((item) => ({
            sku: item.sku,
            orderRef: order.ref,
            label: item.label,
          })),
        }),
        identity: (order) => order.ref,
      };
      const store = new MongoDataStore<BareItemRecords, string>({
        client,
        collections: {
          orders: {
            collection: db.collection("orders"),
            root: true,
            idField: "ref",
          },
          items: {
            collection: db.collection("items"),
            aggregateIdField: "orderRef",
            idField: "sku",
          },
        },
      });
      const bareUseCase = async (
        run: (
          orders: TrackingRepository<
            Order,
            BareItemRecords,
            string,
            MongoTransaction
          >,
        ) => Promise<unknown>,
      ): Promise<unknown> => {
        const orders = new TrackingRepository(store, bareItemMapper);
        const unitOfWork = new TransactionalUnitOfWork<MongoTransaction>(
          transactionManager,
        );
        unitOfWork.register(orders);
        return unitOfWork.execute(() => run(orders));
      };
      await bareUseCase((orders) => orders.add(order("A-1", "first", ["s"])));
      const { _id } = (await db.collection("items").findOne({ sku: "s" }))!;

      await bareUseCase(async (orders) => {
        const loaded = await orders.findById("A-1");
        loaded!.items[0]!.label = "changed";
      });

      expect(await db.collection("items").find().toArray()).toEqual([
        { _id, sku: "s", orderRef: "A-1", label: "changed" },
      ]);
    });
  });

  it("leaves the root's `_id` alone when the mapper leaves it out, reading and editing alike", async () => {
    interface BareRecords {
      orders: [{ ref: string; note: string }];
    }

    const bareMapper: Mapper<
      Pick<Order, "ref" | "note">,
      BareRecords,
      string
    > = {
      toDomain: ({ orders: [{ ref, note }] }) => ({ ref, note }),
      toRecords: ({ ref, note }) => ({ orders: [{ ref, note }] }),
      identity: ({ ref }) => ref,
    };
    const store = new MongoDataStore<BareRecords, string>({
      client,
      collections: {
        orders: {
          collection: db.collection("orders"),
          root: true,
          idField: "ref",
        },
      },
    });
    const bareUseCase = async (
      run: (
        orders: TrackingRepository<
          Pick<Order, "ref" | "note">,
          BareRecords,
          string,
          MongoTransaction
        >,
      ) => Promise<unknown>,
    ): Promise<unknown> => {
      const orders = new TrackingRepository(store, bareMapper);
      const unitOfWork = new TransactionalUnitOfWork<MongoTransaction>(
        transactionManager,
      );
      unitOfWork.register(orders);
      return unitOfWork.execute(() => run(orders));
    };
    await bareUseCase((orders) => orders.add({ ref: "A-1", note: "first" }));
    const { _id } = (await db.collection("orders").findOne({ ref: "A-1" }))!;

    await bareUseCase((orders) => orders.findById("A-1"));

    expect(await db.collection("orders").find().toArray()).toEqual([
      { _id, ref: "A-1", note: "first", _version: 1 },
    ]);

    await bareUseCase(async (orders) => {
      const loaded = await orders.findById("A-1");
      loaded!.note = "changed";
    });

    expect(await db.collection("orders").find().toArray()).toEqual([
      { _id, ref: "A-1", note: "changed", _version: 2 },
    ]);
  });
});
