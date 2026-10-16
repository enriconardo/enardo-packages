import { describe, expect, it, vi } from "vitest";
import type {
  ITransaction,
  ITransactionManager,
} from "@enardo/transaction-manager";
import { ConcurrencyConflictError, DuplicateRecordKeyError } from "~/errors";
import { Repository } from "~/repository";
import { UnitOfWork } from "~/unit-of-work";
import type { DataStore, VersionedRecords } from "~/data-store";
import type { Mapper } from "~/mapper";
import type { RecordKeys, RecordSet } from "~/record-set";

interface Product {
  id: string;
  name: string;
}

interface ProductRecord {
  productId: string;
  productName: string;
}

interface ProductRecords {
  products: [ProductRecord];
}

interface OrderId {
  accountId: string;
  orderNumber: string;
}

interface Order {
  identity: OrderId;
  description: string;
}

interface OrderRecord {
  accountId: string;
  orderNumber: string;
  description: string;
}

interface OrderRecords {
  orders: [OrderRecord];
}

interface Tagged {
  id: string;
  tags: string[];
}

interface TaggedRecord {
  id: string;
  tags: string[];
}

interface TaggedRecords {
  tagged: [TaggedRecord];
}

interface Draft {
  id: string;
  nickname: string | undefined;
}

interface DraftRecord {
  id: string;
  nickname?: string | undefined;
}

interface DraftRecords {
  drafts: [DraftRecord];
}

interface GroupMember {
  userId: string;
  role: "owner" | "member";
}

interface Group {
  id: string;
  name: string;
  members: GroupMember[];
}

interface GroupRecord {
  _id: string;
  name: string;
}

interface MemberRecord {
  _id: string;
  groupId: string;
  userId: string;
  role: "owner" | "member";
}

/** A group stored across two collections: one record for the group, one per member. */
interface GroupRecords {
  groups: [GroupRecord];
  members: MemberRecord[];
}

/** Stands for a driver value type, such as MongoDB's ObjectId: a class instance with methods. */
class Identifier {
  constructor(readonly hex: string) {}

  toHexString(): string {
    return this.hex;
  }
}

interface Ticket {
  id: string;
  assignee: string;
}

interface TicketRecord {
  _id: Identifier;
  assignee: Identifier;
}

interface TicketRecords {
  tickets: [TicketRecord];
}

type GroupStore = DataStore<GroupRecords, string, ITransaction>;
type ProductStore = DataStore<ProductRecords, string, ITransaction>;
type OrderStore = DataStore<OrderRecords, OrderId, ITransaction>;
type TicketStore = DataStore<TicketRecords, string, ITransaction>;

describe("Repository", () => {
  it("tracks an entity without an id property through a custom composite identity key", async () => {
    const findById = vi.fn(async () => versioned(storedOrder()));
    const { unitOfWork, repository } = createSetup(
      orderMapper,
      orderKeys,
      { findById },
      (identity) => `${identity.accountId}:${identity.orderNumber}`,
    );

    await unitOfWork.execute(async () => {
      const firstOrder = await repository.findById({
        accountId: "account-1",
        orderNumber: "order-1",
      });
      const secondOrder = await repository.findById({
        accountId: "account-1",
        orderNumber: "order-1",
      });

      expect(secondOrder).toBe(firstOrder);
    });

    expect(findById).toHaveBeenCalledOnce();
  });

  it("removes a supplied entity without loading it from the data store", async () => {
    const findById = vi.fn(async () => null);
    const deleteRecords = vi.fn(async () => undefined);
    const toRecords = vi.fn(productMapper.toRecords);
    const { unitOfWork, repository, transaction } = createSetup(
      { ...productMapper, toRecords },
      productKeys,
      { findById, delete: deleteRecords },
    );
    const product = { id: "p-1", name: "Keyboard" };

    await repository.remove(product);

    await unitOfWork.execute(async () => undefined);

    expect(findById).not.toHaveBeenCalled();
    // Nothing was read, so there is no version to check.
    expect(deleteRecords).toHaveBeenCalledWith("p-1", undefined, transaction);
    // A delete needs the identity alone, never the mapped records.
    expect(toRecords).not.toHaveBeenCalled();
  });

  it("plans no write when an entity added in the same unit of work is removed again", async () => {
    const apply = vi.fn(async () => undefined);
    const deleteRecords = vi.fn(async () => undefined);
    const { unitOfWork, repository } = createSetup(productMapper, productKeys, {
      apply,
      delete: deleteRecords,
    });
    const product = { id: "p-1", name: "Keyboard" };

    await unitOfWork.execute(async () => {
      await repository.add(product);
      await repository.remove(product);
    });

    // The records never reached the store, so there is nothing to delete either.
    expect(apply).not.toHaveBeenCalled();
    expect(deleteRecords).not.toHaveBeenCalled();
  });

  it("deletes an entity loaded earlier in the same unit of work", async () => {
    const deleteRecords = vi.fn(async () => undefined);
    const apply = vi.fn(async () => undefined);
    const { unitOfWork, repository, transaction } = createSetup(
      productMapper,
      productKeys,
      {
        findById: async () =>
          versioned(
            { products: [{ productId: "p-1", productName: "Keyboard" }] },
            4,
          ),
        apply,
        delete: deleteRecords,
      },
    );

    await unitOfWork.execute(async () => {
      const product = await repository.findById("p-1");
      product!.name = "Mouse";
      await repository.remove(product!);
    });

    expect(deleteRecords).toHaveBeenCalledWith("p-1", 4, transaction);
    // Removal wins over the pending edit: no update is planned alongside it.
    expect(apply).not.toHaveBeenCalled();
  });

  it("detects an edit to a nested value the mapper shares with the stored records", async () => {
    const apply = vi.fn(async () => undefined);
    const { unitOfWork, repository, transaction } = createSetup(
      taggedMapper,
      taggedKeys,
      {
        findById: async () =>
          versioned({ tagged: [{ id: "t-1", tags: ["a"] }] }),
        apply,
      },
    );

    await unitOfWork.execute(async () => {
      const tagged = await repository.findById("t-1");
      // The snapshot is a deep copy, so this push cannot reach it.
      tagged!.tags.push("b");
    });

    expect(apply).toHaveBeenCalledWith(
      {
        id: "t-1",
        expectedVersion: 1,
        changes: {
          tagged: {
            inserted: [],
            updated: [
              {
                record: { id: "t-1", tags: ["a", "b"] },
                set: { tags: ["a", "b"] },
                unset: [],
              },
            ],
            deleted: [],
          },
        },
      },
      transaction,
    );
  });

  it("forgets every tracked entity once its unit of work ends", async () => {
    const findById = vi.fn(async () =>
      versioned<ProductRecords>({
        products: [{ productId: "p-1", productName: "Keyboard" }],
      }),
    );
    const apply = vi.fn(async () => undefined);
    const { unitOfWork, repository, transactionManager } = createSetup(
      productMapper,
      productKeys,
      { findById, apply },
    );

    const product = await unitOfWork.execute(() => repository.findById("p-1"));

    expect(repository.changeTracker.entries().next().done).toBe(true);

    // The returned instance is detached: a later unit of work doesn't see its edits.
    product!.name = "Mouse";
    const nextUnitOfWork = new UnitOfWork(transactionManager);
    nextUnitOfWork.register(repository);
    const reloaded = await nextUnitOfWork.execute(() =>
      repository.findById("p-1"),
    );

    expect(reloaded).not.toBe(product);
    expect(findById).toHaveBeenCalledTimes(2);
    expect(apply).not.toHaveBeenCalled();
  });

  it("plans no write when the mapper emits undefined for a field the store omits", async () => {
    const apply = vi.fn(async () => undefined);
    const { unitOfWork, repository } = createSetup(draftMapper, draftKeys, {
      findById: async () => versioned({ drafts: [{ id: "d-1" }] }),
      apply,
    });

    await unitOfWork.execute(async () => {
      await repository.findById("d-1");
    });

    expect(apply).not.toHaveBeenCalled();
  });

  describe("entities stored across collections", () => {
    it("inserts every record of a new entity", async () => {
      const { unitOfWork, repository, apply, transaction } = createGroupSetup();

      await unitOfWork.execute(async () => {
        await repository.add({
          id: "g-2",
          name: "Hikers",
          members: [{ userId: "u-9", role: "owner" }],
        });
      });

      expect(apply).toHaveBeenCalledWith(
        {
          id: "g-2",
          expectedVersion: undefined,
          changes: {
            groups: {
              inserted: [{ _id: "g-2", name: "Hikers" }],
              updated: [],
              deleted: [],
            },
            members: {
              inserted: [memberRecord("g-2", "u-9", "owner")],
              updated: [],
              deleted: [],
            },
          },
        },
        transaction,
      );
    });

    it("writes only the records and fields that changed", async () => {
      const { unitOfWork, repository, apply, transaction } = createGroupSetup();

      await unitOfWork.execute(async () => {
        const group = await repository.findById("g-1");
        group!.name = "Boulderers";
        group!.members = group!.members.filter(
          ({ userId }) => userId !== "u-2",
        );
        group!.members.push({ userId: "u-3", role: "member" });
      });

      expect(apply).toHaveBeenCalledOnce();
      expect(apply).toHaveBeenCalledWith(
        {
          id: "g-1",
          expectedVersion: 1,
          changes: {
            groups: {
              inserted: [],
              updated: [
                {
                  record: { _id: "g-1", name: "Boulderers" },
                  set: { name: "Boulderers" },
                  unset: [],
                },
              ],
              deleted: [],
            },
            members: {
              inserted: [memberRecord("g-1", "u-3", "member")],
              updated: [],
              deleted: [memberRecord("g-1", "u-2", "member")],
            },
          },
        },
        transaction,
      );
    });

    it("sees no change when only the order of child records differs", async () => {
      const { repository } = createGroupSetup();

      const group = await repository.findById("g-1");
      group!.members.reverse();

      // Both ignore record order, so they keep agreeing.
      expect(repository.hasPendingChanges()).toBe(false);
      expect(repository.planFlush()).toEqual([]);
    });

    it("replaces an entity by deleting it, then inserting all of its records, in one unit", async () => {
      const { unitOfWork, repository, apply, deleteRecords, transaction } =
        createGroupSetup();
      const calls: string[] = [];
      deleteRecords.mockImplementation(async () => {
        calls.push("delete");
      });
      apply.mockImplementation(async () => {
        calls.push("apply");
      });

      await unitOfWork.execute(async () => {
        const group = await repository.findById("g-1");
        await repository.remove(group!);
        await repository.add({
          id: "g-1",
          name: "Climbers",
          members: [{ userId: "u-3", role: "owner" }],
        });

        expect(repository.planFlush().map(({ kind }) => kind)).toEqual([
          "replace",
        ]);
      });

      expect(calls).toEqual(["delete", "apply"]);
      // The delete checks the version that was read; the insert has none to check.
      expect(deleteRecords).toHaveBeenCalledWith("g-1", 1, transaction);
      expect(apply).toHaveBeenCalledWith(
        {
          id: "g-1",
          expectedVersion: undefined,
          changes: {
            groups: {
              inserted: [{ _id: "g-1", name: "Climbers" }],
              updated: [],
              deleted: [],
            },
            members: {
              inserted: [memberRecord("g-1", "u-3", "owner")],
              updated: [],
              deleted: [],
            },
          },
        },
        transaction,
      );
    });

    it("hands the store its own copy of the changes on every run, so a retried unit writes them unchanged", async () => {
      const { repository, apply, transaction } = createGroupSetup();
      const received: MemberRecord[][] = [];
      // Some drivers write into the documents they insert, e.g. to add a generated _id.
      apply.mockImplementation(async ({ changes }) => {
        received.push(structuredClone([...changes.members.inserted]));
        for (const member of changes.members.inserted) {
          Object.assign(member, { insertedAt: new Date(0) });
        }
      });

      const group = await repository.findById("g-1");
      group!.members.push({ userId: "u-3", role: "member" });
      const unit = repository.planFlush()[0]!;
      // A transaction manager may run the same units again after a transient error.
      await unit.run(transaction);
      await unit.run(transaction);

      expect(received).toEqual([
        [memberRecord("g-1", "u-3", "member")],
        [memberRecord("g-1", "u-3", "member")],
      ]);
    });

    it("fails the unit of work when the store returns two records with one key, even if nothing changed", async () => {
      const stored = storedGroup();
      stored.members.push(memberRecord("g-1", "u-2", "member"));
      const { unitOfWork, repository, apply } = createGroupSetup(stored);

      await expect(
        unitOfWork.execute(async () => {
          await repository.findById("g-1");
        }),
      ).rejects.toThrow(DuplicateRecordKeyError);
      expect(apply).not.toHaveBeenCalled();
    });
  });

  describe("versions", () => {
    it("writes an edit against the version read when the entity was loaded", async () => {
      const { unitOfWork, repository, apply } = createProductSetup([
        { productId: "p-1", productName: "Keyboard" },
      ]);
      apply.mockImplementation(async () => undefined);

      await unitOfWork.execute(async () => {
        const product = await repository.findById("p-1");
        product!.name = "Mouse";
      });

      expect(apply).toHaveBeenCalledWith(
        expect.objectContaining({ id: "p-1", expectedVersion: 7 }),
        expect.anything(),
      );
    });

    it("keeps the version of the first read when findAll later returns a newer one", async () => {
      const apply = vi.fn<ProductStore["apply"]>(async () => undefined);
      const record = { productId: "p-1", productName: "Keyboard" };
      const { unitOfWork, repository } = createSetup(
        productMapper,
        productKeys,
        {
          findById: async () => versioned({ products: [record] }, 1),
          findAll: async () => [versioned({ products: [record] }, 2)],
          apply,
        },
      );

      await unitOfWork.execute(async () => {
        const product = await repository.findById("p-1");
        await repository.findAll();
        product!.name = "Mouse";
      });

      // The edit is based on the first read, so it must be checked against it.
      expect(apply).toHaveBeenCalledWith(
        expect.objectContaining({ expectedVersion: 1 }),
        expect.anything(),
      );
    });

    it("passes the identity through to the store without copying it", async () => {
      const apply = vi.fn<OrderStore["apply"]>(async () => undefined);
      const { unitOfWork, repository } = createSetup(
        orderMapper,
        orderKeys,
        { findById: async () => versioned(storedOrder()), apply },
        (identity) =>
          JSON.stringify([identity.accountId, identity.orderNumber]),
      );
      let order: Order | null = null;

      await unitOfWork.execute(async () => {
        order = await repository.findById({
          accountId: "account-1",
          orderNumber: "order-1",
        });
        order!.description = "Mouse";
      });

      // A copy would strip the prototype of a class-based id, such as an ObjectId.
      expect(apply.mock.calls[0]![0].id).toBe(order!.identity);
    });

    it("fails the unit of work with the store's conflict, writing and keeping nothing", async () => {
      const conflict = new ConcurrencyConflictError("p-1", 7);
      const { unitOfWork, repository, apply } = createProductSetup([
        { productId: "p-1", productName: "Keyboard" },
      ]);
      apply.mockRejectedValue(conflict);

      await expect(
        unitOfWork.execute(async () => {
          const product = await repository.findById("p-1");
          product!.name = "Mouse";
        }),
      ).rejects.toBe(conflict);

      expect(repository.changeTracker.entries().next().done).toBe(true);
    });
  });

  describe("class instances in records", () => {
    it("hands the store class instances, such as a driver's ObjectId, with their prototype", async () => {
      const apply = vi.fn<TicketStore["apply"]>(async () => undefined);
      const { unitOfWork, repository } = createSetup(ticketMapper, ticketKeys, {
        findById: async () => versioned(storedTicket("t-1", "u-1")),
        apply,
      });

      await unitOfWork.execute(async () => {
        const ticket = await repository.findById("t-1");
        ticket!.assignee = "u-2";
        await repository.add({ id: "t-2", assignee: "u-3" });
      });

      // A plain-object copy would reach a driver as a sub-document.
      const [update] = apply.mock.calls[0]!;
      const [insert] = apply.mock.calls[1]!;
      expect(update.changes.tickets.updated[0]!.set.assignee).toBeInstanceOf(
        Identifier,
      );
      expect(update.changes.tickets.updated[0]!.record._id).toBeInstanceOf(
        Identifier,
      );
      expect(insert.changes.tickets.inserted[0]!._id).toBeInstanceOf(
        Identifier,
      );
    });

    it("sees no change when the mapper builds new instances equal to the stored ones", async () => {
      const { repository } = createSetup(ticketMapper, ticketKeys, {
        findById: async () => versioned(storedTicket("t-1", "u-1")),
      });

      await repository.findById("t-1");

      expect(repository.hasPendingChanges()).toBe(false);
      expect(repository.planFlush()).toEqual([]);
    });
  });

  describe("stored identities", () => {
    /** Stores products under a prefixed id, as a store with ids of its own would. */
    const storedProductMapper: Mapper<Product, ProductRecords, string> = {
      ...productMapper,
      toStoredId: (id) => `stored:${id}`,
    };

    function storedProduct(id: string, version = 1) {
      return versioned<ProductRecords>(
        { products: [{ productId: id, productName: "Keyboard" }] },
        version,
      );
    }

    it("reads the stored form of an identity, and tracks the entity under its domain identity", async () => {
      const findById = vi.fn<ProductStore["findById"]>(async (id) =>
        id === "stored:p-1" ? storedProduct("p-1") : null,
      );
      const { repository } = createSetup(storedProductMapper, productKeys, {
        findById,
      });

      const first = await repository.findById("p-1");
      const second = await repository.findById("p-1");

      expect(first).not.toBeNull();
      expect(second).toBe(first);
      expect(findById).toHaveBeenCalledExactlyOnceWith("stored:p-1");
    });

    it("hands updates, inserts and deletes the stored form of the identity", async () => {
      const apply = vi.fn<ProductStore["apply"]>(async () => undefined);
      const deleteRecords = vi.fn<ProductStore["delete"]>(
        async () => undefined,
      );
      const { unitOfWork, repository, transaction } = createSetup(
        storedProductMapper,
        productKeys,
        {
          findById: async (id) => storedProduct(id.replace("stored:", ""), 3),
          apply,
          delete: deleteRecords,
        },
      );

      await unitOfWork.execute(async () => {
        const edited = await repository.findById("p-1");
        edited!.name = "Mouse";
        await repository.add({ id: "p-2", name: "Monitor" });
        const removed = await repository.findById("p-3");
        await repository.remove(removed!);
        await repository.remove({ id: "p-4", name: "Cable" });
      });

      expect(apply.mock.calls.map(([write]) => write.id)).toEqual([
        "stored:p-1",
        "stored:p-2",
      ]);
      expect(deleteRecords.mock.calls).toEqual([
        ["stored:p-3", 3, transaction],
        ["stored:p-4", undefined, transaction],
      ]);
    });

    it("hands both writes of a replace the stored form of the identity", async () => {
      const calls: string[] = [];
      const { unitOfWork, repository } = createSetup(
        storedProductMapper,
        productKeys,
        {
          findById: async () => storedProduct("p-1"),
          apply: async ({ id }) => {
            calls.push(`apply ${String(id)}`);
          },
          delete: async (id) => {
            calls.push(`delete ${String(id)}`);
          },
        },
      );

      await unitOfWork.execute(async () => {
        const product = await repository.findById("p-1");
        await repository.remove(product!);
        await repository.add({ id: "p-1", name: "Mouse" });
      });

      expect(calls).toEqual(["delete stored:p-1", "apply stored:p-1"]);
    });

    it("converts identities while planning, so a failing conversion opens no transaction", async () => {
      const failure = new Error("cannot store p-1");
      const { unitOfWork, repository, transactionManager } = createSetup(
        {
          ...productMapper,
          toStoredId: () => {
            throw failure;
          },
        },
        productKeys,
      );
      const runInTransaction = vi.spyOn(transactionManager, "runInTransaction");

      await repository.remove({ id: "p-1", name: "Keyboard" });

      await expect(unitOfWork.execute(async () => undefined)).rejects.toBe(
        failure,
      );
      expect(runInTransaction).not.toHaveBeenCalled();
    });
  });

  describe("custom finders", () => {
    it("tracks an aggregate a custom query finds, and writes its edits against the version read", async () => {
      const { unitOfWork, repository, apply, transaction } = createFinderSetup([
        { productId: "p-1", productName: "Keyboard" },
      ]);

      await unitOfWork.execute(async () => {
        const product = await repository.findByName("Keyboard");
        product!.name = "Mouse";
      });

      expect(apply).toHaveBeenCalledWith(
        {
          id: "p-1",
          expectedVersion: 7,
          changes: {
            products: {
              inserted: [],
              updated: [
                {
                  record: { productId: "p-1", productName: "Mouse" },
                  set: { productName: "Mouse" },
                  unset: [],
                },
              ],
              deleted: [],
            },
          },
        },
        transaction,
      );
    });

    it("returns the tracked instance, with its edits, when a custom query finds an identity already loaded", async () => {
      const { repository } = createFinderSetup([
        { productId: "p-1", productName: "Keyboard" },
      ]);

      const loaded = await repository.findById("p-1");
      loaded!.name = "Mouse";
      const found = await repository.findByName("Keyboard");

      expect(found).toBe(loaded);
      expect(found!.name).toBe("Mouse");
    });

    it("returns null when a custom query finds an entity removed in this unit of work", async () => {
      const { repository } = createFinderSetup([
        { productId: "p-1", productName: "Keyboard" },
      ]);

      const loaded = await repository.findById("p-1");
      await repository.remove(loaded!);

      expect(await repository.findByName("Keyboard")).toBeNull();
    });

    it("returns null when a custom query finds nothing", async () => {
      const { repository } = createFinderSetup();

      expect(await repository.findByName("Keyboard")).toBeNull();
    });
  });

  describe("hasPendingChanges", () => {
    it("is false when nothing is tracked", () => {
      const { repository } = createProductSetup();

      expect(repository.hasPendingChanges()).toBe(false);
    });

    it("is false for entities that were only read", async () => {
      const { repository } = createProductSetup([
        { productId: "p-1", productName: "Keyboard" },
        { productId: "p-2", productName: "Mouse" },
      ]);

      await repository.findAll();

      // Tracking two entities is not the same as having changed them.
      expect(repository.hasPendingChanges()).toBe(false);
    });

    it("is true once a loaded entity is edited", async () => {
      const { repository } = createProductSetup([
        { productId: "p-1", productName: "Keyboard" },
      ]);

      const product = await repository.findById("p-1");
      product!.name = "Mouse";

      expect(repository.hasPendingChanges()).toBe(true);
    });

    it("is true after an add", async () => {
      const { repository } = createProductSetup();

      await repository.add({ id: "p-1", name: "Keyboard" });

      expect(repository.hasPendingChanges()).toBe(true);
    });

    it("is true after a remove", async () => {
      const { repository } = createProductSetup();

      await repository.remove({ id: "p-1", name: "Keyboard" });

      expect(repository.hasPendingChanges()).toBe(true);
    });

    it("is false once its unit of work has committed", async () => {
      const { unitOfWork, repository } = createProductSetup();

      await unitOfWork.execute(async () => {
        await repository.add({ id: "p-1", name: "Keyboard" });
        expect(repository.hasPendingChanges()).toBe(true);
      });

      expect(repository.hasPendingChanges()).toBe(false);
    });

    it("agrees with planFlush", async () => {
      const { repository } = createProductSetup([
        { productId: "p-1", productName: "Keyboard" },
      ]);

      const product = await repository.findById("p-1");
      expect(repository.hasPendingChanges()).toBe(
        repository.planFlush().length > 0,
      );

      product!.name = "Mouse";
      expect(repository.hasPendingChanges()).toBe(
        repository.planFlush().length > 0,
      );
    });
  });
});

/**
 * Registers a repository on a unit of work whose transactions all run with one
 * context, over a store that finds nothing and writes nowhere unless `store`
 * says otherwise.
 */
function createSetup<TDomain, TRecords extends RecordSet<TRecords>, TId>(
  mapper: Mapper<TDomain, TRecords, TId>,
  recordKeys: RecordKeys<TRecords>,
  store: Partial<
    Omit<DataStore<TRecords, TId, ITransaction>, "recordKeys">
  > = {},
  identityKey?: (id: TId) => string,
) {
  const transaction: ITransaction = { id: "transaction-1" };
  const transactionManager: ITransactionManager = {
    async runInTransaction(work) {
      return work(transaction);
    },
  };
  const dataStore: DataStore<TRecords, TId, ITransaction> = {
    recordKeys,
    findById: async () => null,
    findAll: async () => [],
    apply: async () => undefined,
    delete: async () => undefined,
    ...store,
  };
  const unitOfWork = new UnitOfWork(transactionManager);
  const repository = new Repository(dataStore, mapper, identityKey);
  unitOfWork.register(repository);

  return { unitOfWork, repository, transaction, transactionManager };
}

/** Wires a product repository over an in-memory record list. */
function createProductSetup(records: readonly ProductRecord[] = []) {
  const apply = vi.fn<ProductStore["apply"]>(async () => undefined);
  const setup = createSetup(productMapper, productKeys, {
    findById: async (id) => {
      const record = records.find(({ productId }) => productId === id);
      return record === undefined
        ? null
        : versioned<ProductRecords>({ products: [record] }, 7);
    },
    findAll: async () =>
      records.map((record) =>
        versioned<ProductRecords>({ products: [record] }, 7),
      ),
    apply,
  });

  return { ...setup, apply };
}

/** Finds products by name with a query of its own, as an adapter's repository would. */
class ProductsByName extends Repository<
  Product,
  ProductRecords,
  string,
  ITransaction
> {
  constructor(
    dataStore: ProductStore,
    private readonly records: readonly ProductRecord[],
  ) {
    super(dataStore, productMapper);
  }

  findByName(name: string): Promise<Product | null> {
    return this.findOneBy(async () => {
      const record = this.records.find(
        ({ productName }) => productName === name,
      );
      return record === undefined
        ? null
        : versioned<ProductRecords>({ products: [structuredClone(record)] }, 7);
    });
  }
}

/** Wires a repository with a custom finder over an in-memory record list. */
function createFinderSetup(records: readonly ProductRecord[] = []) {
  const apply = vi.fn<ProductStore["apply"]>(async () => undefined);
  const transaction: ITransaction = { id: "transaction-1" };
  const dataStore: ProductStore = {
    recordKeys: productKeys,
    findById: async (id) => {
      const record = records.find(({ productId }) => productId === id);
      return record === undefined
        ? null
        : versioned<ProductRecords>({ products: [structuredClone(record)] }, 7);
    },
    findAll: async () => [],
    apply,
    delete: async () => undefined,
  };
  const unitOfWork = new UnitOfWork({
    async runInTransaction(work) {
      return work(transaction);
    },
  });
  const repository = new ProductsByName(dataStore, records);
  unitOfWork.register(repository);

  return { unitOfWork, repository, apply, transaction };
}

/** Wires a group repository over a store holding the given group records. */
function createGroupSetup(stored: GroupRecords = storedGroup()) {
  const apply = vi.fn<GroupStore["apply"]>(async () => undefined);
  const deleteRecords = vi.fn<GroupStore["delete"]>(async () => undefined);
  const setup = createSetup(groupMapper, groupKeys, {
    findById: async (id) =>
      id === stored.groups[0]._id ? versioned(structuredClone(stored)) : null,
    findAll: async () => [versioned(structuredClone(stored))],
    apply,
    delete: deleteRecords,
  });

  return { ...setup, apply, deleteRecords };
}

/** Group g-1, owned by u-1, with u-2 as a member. */
/** Pairs records with the version a store read them at. */
function versioned<TRecords>(
  records: TRecords,
  version = 1,
): VersionedRecords<TRecords, number> {
  return { records, version };
}

/** Order order-1 of account-1. */
function storedOrder(): OrderRecords {
  return {
    orders: [
      {
        accountId: "account-1",
        orderNumber: "order-1",
        description: "Keyboard",
      },
    ],
  };
}

function storedGroup(): GroupRecords {
  return {
    groups: [{ _id: "g-1", name: "Climbers" }],
    members: [
      memberRecord("g-1", "u-1", "owner"),
      memberRecord("g-1", "u-2", "member"),
    ],
  };
}

function memberRecord(
  groupId: string,
  userId: string,
  role: MemberRecord["role"],
): MemberRecord {
  return { _id: JSON.stringify([groupId, userId]), groupId, userId, role };
}

const productMapper: Mapper<Product, ProductRecords, string> = {
  toDomain({ products: [record] }) {
    return { id: record.productId, name: record.productName };
  },
  toRecords(product) {
    return {
      products: [{ productId: product.id, productName: product.name }],
    };
  },
  identity(product) {
    return product.id;
  },
};

const productKeys: RecordKeys<ProductRecords> = {
  products: (record) => record.productId,
};

const orderMapper: Mapper<Order, OrderRecords, OrderId> = {
  toDomain({ orders: [record] }) {
    return {
      identity: {
        accountId: record.accountId,
        orderNumber: record.orderNumber,
      },
      description: record.description,
    };
  },
  toRecords(order) {
    return {
      orders: [
        {
          accountId: order.identity.accountId,
          orderNumber: order.identity.orderNumber,
          description: order.description,
        },
      ],
    };
  },
  identity(order) {
    return order.identity;
  },
};

const orderKeys: RecordKeys<OrderRecords> = {
  orders: (record) => JSON.stringify([record.accountId, record.orderNumber]),
};

/** Shares the nested array with the entity, as a mapper naturally would. */
const taggedMapper: Mapper<Tagged, TaggedRecords, string> = {
  toDomain({ tagged: [record] }) {
    return { id: record.id, tags: record.tags };
  },
  toRecords(tagged) {
    return { tagged: [{ id: tagged.id, tags: tagged.tags }] };
  },
  identity(tagged) {
    return tagged.id;
  },
};

const taggedKeys: RecordKeys<TaggedRecords> = {
  tagged: (record) => record.id,
};

/** Emits the optional field as undefined even when the store omitted it. */
const draftMapper: Mapper<Draft, DraftRecords, string> = {
  toDomain({ drafts: [record] }) {
    return { id: record.id, nickname: record.nickname };
  },
  toRecords(draft) {
    return { drafts: [{ id: draft.id, nickname: draft.nickname }] };
  },
  identity(draft) {
    return draft.id;
  },
};

const draftKeys: RecordKeys<DraftRecords> = {
  drafts: (record) => record.id,
};

const groupMapper: Mapper<Group, GroupRecords, string> = {
  toDomain({ groups: [group], members }) {
    return {
      id: group._id,
      name: group.name,
      members: members.map(({ userId, role }) => ({ userId, role })),
    };
  },
  toRecords(group) {
    return {
      groups: [{ _id: group.id, name: group.name }],
      members: group.members.map(({ userId, role }) =>
        memberRecord(group.id, userId, role),
      ),
    };
  },
  identity(group) {
    return group.id;
  },
};

const groupKeys: RecordKeys<GroupRecords> = {
  groups: (group) => group._id,
  members: (member) => member._id,
};

/** Ticket `id`, assigned to `assignee`, with both identities stored as class instances. */
function storedTicket(id: string, assignee: string): TicketRecords {
  return {
    tickets: [{ _id: new Identifier(id), assignee: new Identifier(assignee) }],
  };
}

/** Builds new instances on every call, as a mapper naturally would. */
const ticketMapper: Mapper<Ticket, TicketRecords, string> = {
  toDomain({ tickets: [record] }) {
    return { id: record._id.hex, assignee: record.assignee.hex };
  },
  toRecords(ticket) {
    return storedTicket(ticket.id, ticket.assignee);
  },
  identity(ticket) {
    return ticket.id;
  },
};

const ticketKeys: RecordKeys<TicketRecords> = {
  tickets: (record) => record._id.toHexString(),
};
