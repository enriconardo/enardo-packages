import { describe, expect, it, vi } from "vitest";
import type {
  Transaction,
  TransactionManager,
} from "@enardo/transaction-manager";
import { ConcurrencyConflictError } from "~/errors";
import { TrackingRepository } from "~/repository";
import type { TrackingRepositoryOptions } from "~/index";
import { TransactionalUnitOfWork } from "~/unit-of-work";
import type { DataStore, VersionedRecords } from "~/data-store";
import type { Mapper } from "~/mapper";
import type { RecordKeys, RecordSet } from "~/record-set";
import { expectNativeError, reasonOf } from "./support/native-errors";

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

type GroupStore = DataStore<GroupRecords, string, Transaction>;
type ProductStore = DataStore<ProductRecords, string, Transaction>;
type OrderStore = DataStore<OrderRecords, OrderId, Transaction>;
type TicketStore = DataStore<TicketRecords, string, Transaction>;

describe("TrackingRepository", () => {
  it("tracks an entity without an id property through a custom composite identity key", async () => {
    const findById = vi.fn(async () => versioned(storedOrder()));
    const { unitOfWork, repository } = createSetup(
      orderMapper,
      orderKeys,
      { findById },
      {
        identityKey: (identity) =>
          `${identity.accountId}:${identity.orderNumber}`,
      },
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
    const nextUnitOfWork = new TransactionalUnitOfWork(transactionManager);
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

    it("fails the unit of work with a native Error when the store returns two records with one key, even if nothing changed", async () => {
      const stored = storedGroup();
      // A key without quotes, so the message holds it in one form only.
      const duplicate = {
        ...memberRecord("g-1", "u-2", "member"),
        _id: "g-1:u-2",
      };
      stored.members.push(duplicate, { ...duplicate });
      const { unitOfWork, repository, apply } = createGroupSetup(stored);

      const error = await reasonOf(
        unitOfWork.execute(async () => {
          await repository.findById("g-1");
        }),
      );

      expectNativeError(
        error,
        Error,
        'Collection "members" of the previous record set holds more than one record with key "g-1:u-2".',
      );
      expect(apply).not.toHaveBeenCalled();
    });
  });

  describe("identities tracked twice", () => {
    it("rejects adding an identity already added with a native Error, keeping the first entity", async () => {
      const apply = vi.fn<ProductStore["apply"]>(async () => undefined);
      const { unitOfWork, repository, transaction } = createSetup(
        productMapper,
        productKeys,
        { apply },
      );
      const first = { id: "p-1", name: "Keyboard" };
      let error: unknown;
      let tracked: Product | null = null;

      await unitOfWork.execute(async () => {
        await repository.add(first);
        error = await reasonOf(repository.add({ id: "p-1", name: "Mouse" }));
        tracked = await repository.findById("p-1");
      });

      expectNativeError(
        error,
        Error,
        'An entity with identity "string:p-1" is already tracked.',
      );
      expect(tracked).toBe(first);
      expect(apply).toHaveBeenCalledExactlyOnceWith(
        {
          id: "p-1",
          expectedVersion: undefined,
          changes: {
            products: {
              inserted: [{ productId: "p-1", productName: "Keyboard" }],
              updated: [],
              deleted: [],
            },
          },
        },
        transaction,
      );
    });

    it("rejects adding an identity already loaded with a native Error, writing nothing for it", async () => {
      const apply = vi.fn<ProductStore["apply"]>(async () => undefined);
      const deleteRecords = vi.fn<ProductStore["delete"]>(
        async () => undefined,
      );
      const { unitOfWork, repository } = createSetup(
        productMapper,
        productKeys,
        {
          findById: async () =>
            versioned<ProductRecords>({
              products: [{ productId: "p-1", productName: "Keyboard" }],
            }),
          apply,
          delete: deleteRecords,
        },
      );
      let error: unknown;

      await unitOfWork.execute(async () => {
        await repository.findById("p-1");
        error = await reasonOf(repository.add({ id: "p-1", name: "Mouse" }));
      });

      expectNativeError(
        error,
        Error,
        'An entity with identity "string:p-1" is already tracked.',
      );
      expect(apply).not.toHaveBeenCalled();
      expect(deleteRecords).not.toHaveBeenCalled();
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
        {
          identityKey: (identity) =>
            JSON.stringify([identity.accountId, identity.orderNumber]),
        },
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

  describe("fields the mapper does not return", () => {
    it("writes nothing for a root field the mapper ignores when nothing was edited", async () => {
      const { unitOfWork, repository, apply } = createStampedSetup(
        stampedGroup({ createdAt: new Date(0) }),
      );

      await unitOfWork.execute(async () => {
        await repository.findById("g-1");
      });

      expect(apply).not.toHaveBeenCalled();
    });

    it("writes only the edited field, never unsetting a root field the mapper ignores", async () => {
      const { unitOfWork, repository, apply, transaction } = createStampedSetup(
        stampedGroup({ createdAt: new Date(0) }),
      );

      await unitOfWork.execute(async () => {
        const group = await repository.findById("g-1");
        group!.name = "Boulderers";
      });

      expect(apply).toHaveBeenCalledExactlyOnceWith(
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
            members: { inserted: [], updated: [], deleted: [] },
          },
        },
        transaction,
      );
    });

    it("writes nothing for a child field the mapper ignores when nothing was edited", async () => {
      const stored = stampedGroup();
      stored.members[1] = {
        ...memberRecord("g-1", "u-2", "member"),
        joinedAt: new Date(0),
      };
      const { unitOfWork, repository, apply } = createStampedSetup(stored);

      await unitOfWork.execute(async () => {
        await repository.findById("g-1");
      });

      expect(apply).not.toHaveBeenCalled();
    });

    it("unsets an optional field the mapper returns at load and the domain then clears", async () => {
      const apply = vi.fn<
        DataStore<DraftRecords, string, Transaction>["apply"]
      >(async () => undefined);
      const { unitOfWork, repository, transaction } = createSetup(
        omittingDraftMapper,
        draftKeys,
        {
          findById: async () =>
            versioned<DraftRecords>({
              drafts: [{ id: "d-1", nickname: "Nick" }],
            }),
          apply,
        },
      );

      await unitOfWork.execute(async () => {
        const draft = await repository.findById("d-1");
        draft!.nickname = undefined;
      });

      expect(apply).toHaveBeenCalledExactlyOnceWith(
        {
          id: "d-1",
          expectedVersion: 1,
          changes: {
            drafts: {
              inserted: [],
              updated: [
                { record: { id: "d-1" }, set: {}, unset: ["nickname"] },
              ],
              deleted: [],
            },
          },
        },
        transaction,
      );
    });

    it("writes a default toDomain fills in for a field the store lacks, then nothing once it is stored", async () => {
      let stored: PricedRecord = { id: "x-1" };
      const apply = vi.fn<
        DataStore<PricedRecords, string, Transaction>["apply"]
      >(async ({ changes }) => {
        // The case writes only `set`: the store keeps what it sets.
        for (const { set } of changes.priced.updated) {
          stored = { ...stored, ...set };
        }
      });
      const { unitOfWork, repository, transaction, transactionManager } =
        createSetup(pricedMapper, pricedKeys, {
          findById: async () =>
            versioned<PricedRecords>({ priced: [structuredClone(stored)] }),
          apply,
        });

      await unitOfWork.execute(async () => {
        await repository.findById("x-1");
      });

      expect(apply).toHaveBeenCalledExactlyOnceWith(
        {
          id: "x-1",
          expectedVersion: 1,
          changes: {
            priced: {
              inserted: [],
              updated: [
                {
                  record: { id: "x-1", currency: "EUR" },
                  set: { currency: "EUR" },
                  unset: [],
                },
              ],
              deleted: [],
            },
          },
        },
        transaction,
      );

      apply.mockClear();
      const nextUnitOfWork = new TransactionalUnitOfWork(transactionManager);
      nextUnitOfWork.register(repository);
      await nextUnitOfWork.execute(async () => {
        await repository.findById("x-1");
      });

      expect(apply).not.toHaveBeenCalled();
    });

    it("writes the value toDomain normalizes, compared with the stored one", async () => {
      const apply = vi.fn<ProductStore["apply"]>(async () => undefined);
      const { unitOfWork, repository, transaction } = createSetup(
        trimmingProductMapper,
        productKeys,
        {
          findById: async () =>
            versioned<ProductRecords>({
              products: [{ productId: "p-1", productName: "  N  " }],
            }),
          apply,
        },
      );

      await unitOfWork.execute(async () => {
        await repository.findById("p-1");
      });

      expect(apply).toHaveBeenCalledExactlyOnceWith(
        {
          id: "p-1",
          expectedVersion: 1,
          changes: {
            products: {
              inserted: [],
              updated: [
                {
                  record: { productId: "p-1", productName: "N" },
                  set: { productName: "N" },
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

    it("writes nothing for a field the mapper ignores on an aggregate findAll loaded", async () => {
      const { unitOfWork, repository, apply } = createStampedSetup(
        stampedGroup({ createdAt: new Date(0) }),
      );

      await unitOfWork.execute(async () => {
        expect(await repository.findAll()).toHaveLength(1);
      });

      expect(apply).not.toHaveBeenCalled();
    });

    it("writes nothing for a field the mapper ignores on an aggregate a custom query loaded", async () => {
      const apply = vi.fn<StampedGroupStore["apply"]>(async () => undefined);
      const transaction: Transaction = { id: "transaction-1" };
      const stored = stampedGroup({ createdAt: new Date(0) });
      const repository = new StampedGroupsByName(
        {
          recordKeys: stampedGroupKeys,
          findById: async () => null,
          findAll: async () => [],
          apply,
          delete: async () => undefined,
        },
        stored,
      );
      const unitOfWork = new TransactionalUnitOfWork({
        async runInTransaction(work) {
          return work(transaction);
        },
      });
      unitOfWork.register(repository);

      await unitOfWork.execute(async () => {
        expect(await repository.findByName("Climbers")).not.toBeNull();
      });

      expect(apply).not.toHaveBeenCalled();
    });

    it("still fails the unit of work on two stored children under a key the mapper returns, each with a field it ignores", async () => {
      const stored = stampedGroup();
      stored.members = [
        memberRecord("g-1", "u-1", "owner"),
        { ...memberRecord("g-1", "u-2", "member"), joinedAt: new Date(0) },
        { ...memberRecord("g-1", "u-2", "member"), joinedAt: new Date(1) },
      ];
      const { unitOfWork, repository, apply } = createStampedSetup(stored);

      const error = await reasonOf(
        unitOfWork.execute(async () => {
          await repository.findById("g-1");
        }),
      );

      expectNativeError(
        error,
        Error,
        'Collection "members" of the previous record set holds more than one record with key "["g-1","u-2"]".',
      );
      expect(apply).not.toHaveBeenCalled();
    });

    it("deletes a stored child toDomain filters out, handing over the whole record", async () => {
      const left = {
        ...memberRecord("g-1", "u-2", "member"),
        leftAt: new Date(0),
      };
      const stored = stampedGroup();
      stored.members[1] = left;
      const { unitOfWork, repository, apply, transaction } = createStampedSetup(
        stored,
        softDeletingGroupMapper,
      );

      await unitOfWork.execute(async () => {
        await repository.findById("g-1");
      });

      expect(apply).toHaveBeenCalledExactlyOnceWith(
        {
          id: "g-1",
          expectedVersion: 1,
          changes: {
            groups: { inserted: [], updated: [], deleted: [] },
            members: { inserted: [], updated: [], deleted: [left] },
          },
        },
        transaction,
      );
    });

    it("deletes a stored child under its old key and inserts it under the key the mapper returns", async () => {
      const stale = { ...memberRecord("g-1", "u-2", "member"), _id: "g-1:u-2" };
      const stored = stampedGroup();
      stored.members[1] = stale;
      const { unitOfWork, repository, apply, transaction } =
        createStampedSetup(stored);

      await unitOfWork.execute(async () => {
        await repository.findById("g-1");
      });

      expect(apply).toHaveBeenCalledExactlyOnceWith(
        {
          id: "g-1",
          expectedVersion: 1,
          changes: {
            groups: { inserted: [], updated: [], deleted: [] },
            members: {
              inserted: [memberRecord("g-1", "u-2", "member")],
              updated: [],
              deleted: [stale],
            },
          },
        },
        transaction,
      );
    });

    describe("a toRecords that throws on the loaded entity", () => {
      const failure = new Error("cannot map an unnamed group");
      const unmappable = () =>
        stampedGroup({ name: "", legacy: "from version 1" });

      it("lets the entity be removed, deleting it against the version read", async () => {
        const { unitOfWork, repository, apply, deleteRecords, transaction } =
          createStampedSetup(unmappable(), strictGroupMapper(failure), 3);

        await unitOfWork.execute(async () => {
          const group = await repository.findById("g-1");
          await repository.remove(group!);
        });

        expect(deleteRecords).toHaveBeenCalledExactlyOnceWith(
          "g-1",
          3,
          transaction,
        );
        expect(apply).not.toHaveBeenCalled();
      });

      it("fails the unit of work with the mapper's error when the entity is left alone", async () => {
        const { unitOfWork, repository, apply } = createStampedSetup(
          unmappable(),
          strictGroupMapper(failure),
        );
        let loaded: Group | null = null;

        await expect(
          unitOfWork.execute(async () => {
            loaded = await repository.findById("g-1");
          }),
        ).rejects.toBe(failure);

        expect(loaded).not.toBeNull();
        expect(apply).not.toHaveBeenCalled();
      });

      it("unsets a stored field the mapper ignores once the entity is repaired", async () => {
        const { unitOfWork, repository, apply, transaction } =
          createStampedSetup(unmappable(), strictGroupMapper(failure));

        await unitOfWork.execute(async () => {
          const group = await repository.findById("g-1");
          group!.name = "Climbers";
        });

        expect(apply).toHaveBeenCalledExactlyOnceWith(
          {
            id: "g-1",
            expectedVersion: 1,
            changes: {
              groups: {
                inserted: [],
                updated: [
                  {
                    record: { _id: "g-1", name: "Climbers" },
                    set: { name: "Climbers" },
                    unset: ["legacy"],
                  },
                ],
                deleted: [],
              },
              members: { inserted: [], updated: [], deleted: [] },
            },
          },
          transaction,
        );
      });
    });

    it("lets an aggregate whose stored children share a key be loaded and removed", async () => {
      const stored = stampedGroup();
      stored.members.push(memberRecord("g-1", "u-2", "member"));
      const { unitOfWork, repository, apply, deleteRecords, transaction } =
        createStampedSetup(stored, stampedGroupMapper, 3);

      await unitOfWork.execute(async () => {
        const group = await repository.findById("g-1");
        await repository.remove(group!);
      });

      expect(deleteRecords).toHaveBeenCalledExactlyOnceWith(
        "g-1",
        3,
        transaction,
      );
      expect(apply).not.toHaveBeenCalled();
    });

    it("loads and removes an aggregate whose stored record the key function cannot read", async () => {
      const stored = stampedGroup();
      // A stored child the mapper filters out, and whose key cannot be read.
      stored.members.push({
        _id: "legacy",
        groupId: "g-1",
        leftAt: new Date(0),
      } as unknown as StampedMemberRecord);
      const deleteRecords = vi.fn<StampedGroupStore["delete"]>(
        async () => undefined,
      );
      const { unitOfWork, repository, transaction } = createSetup(
        softDeletingGroupMapper,
        {
          groups: (group) => group._id,
          members: (member) => member.userId.toUpperCase(),
        },
        {
          findById: async () => versioned(structuredClone(stored), 3),
          delete: deleteRecords,
        },
      );

      await unitOfWork.execute(async () => {
        const group = await repository.findById("g-1");
        await repository.remove(group!);
      });

      expect(deleteRecords).toHaveBeenCalledExactlyOnceWith(
        "g-1",
        3,
        transaction,
      );
    });

    it("loads a record set missing a collection, and fails the commit with the native TypeError of the previous side", async () => {
      const stored = {
        groups: stampedGroup().groups,
      } as unknown as StampedGroupRecords;
      const { unitOfWork, repository, apply } = createStampedSetup(
        stored,
        lenientGroupMapper,
      );
      let loaded: Group | null = null;

      const error = await reasonOf(
        unitOfWork.execute(async () => {
          loaded = await repository.findById("g-1");
        }),
      );

      expect(loaded).not.toBeNull();
      expectNativeError(
        error,
        TypeError,
        'Collection "members" of the previous record set is not an array of records.',
      );
      expect(apply).not.toHaveBeenCalled();
    });

    it("never maps back the fresh records findAll returns for an identity already tracked", async () => {
      const failure = new Error("cannot map an unnamed group");
      const toRecords = vi.fn(strictGroupMapper(failure).toRecords);
      const { repository } = createSetup(
        { ...strictGroupMapper(failure), toRecords },
        stampedGroupKeys,
        {
          findById: async () => versioned(stampedGroup()),
          findAll: async () => [versioned(stampedGroup({ name: "" }), 2)],
        },
      );

      const tracked = await repository.findById("g-1");
      const found = await repository.findAll();

      expect(found).toHaveLength(1);
      expect(found[0]).toBe(tracked);
      for (const [group] of toRecords.mock.calls) {
        expect(group).toBe(tracked);
      }
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
    Omit<DataStore<TRecords, TId, Transaction>, "recordKeys">
  > = {},
  options?: TrackingRepositoryOptions<TDomain, TId, never>,
) {
  const transaction: Transaction = { id: "transaction-1" };
  const transactionManager: TransactionManager = {
    async runInTransaction(work) {
      return work(transaction);
    },
  };
  const dataStore: DataStore<TRecords, TId, Transaction> = {
    recordKeys,
    findById: async () => null,
    findAll: async () => [],
    apply: async () => undefined,
    delete: async () => undefined,
    ...store,
  };
  const unitOfWork = new TransactionalUnitOfWork(transactionManager);
  const repository = new TrackingRepository(dataStore, mapper, options);
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
class ProductsByName extends TrackingRepository<
  Product,
  ProductRecords,
  string,
  Transaction
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
  const transaction: Transaction = { id: "transaction-1" };
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
  const unitOfWork = new TransactionalUnitOfWork({
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

/** A group record as a store holds it, with fields the mapper never returns. */
interface StampedGroupRecord extends GroupRecord {
  createdAt?: Date;
  legacy?: string;
}

/** A member record as a store holds it, with fields the mapper never returns. */
interface StampedMemberRecord extends MemberRecord {
  joinedAt?: Date;
  leftAt?: Date;
}

interface StampedGroupRecords {
  groups: [StampedGroupRecord];
  members: StampedMemberRecord[];
}

type StampedGroupStore = DataStore<StampedGroupRecords, string, Transaction>;

/** Group g-1, owned by u-1, with u-2 as a member, its group record holding `fields`. */
function stampedGroup(
  fields: Partial<StampedGroupRecord> = {},
): StampedGroupRecords {
  return {
    groups: [{ _id: "g-1", name: "Climbers", ...fields }],
    members: [
      memberRecord("g-1", "u-1", "owner"),
      memberRecord("g-1", "u-2", "member"),
    ],
  };
}

/** Wires a group repository over a store holding `stored` at `version`. */
function createStampedSetup(
  stored: StampedGroupRecords,
  mapper: Mapper<Group, StampedGroupRecords, string> = stampedGroupMapper,
  version = 1,
) {
  const apply = vi.fn<StampedGroupStore["apply"]>(async () => undefined);
  const deleteRecords = vi.fn<StampedGroupStore["delete"]>(
    async () => undefined,
  );
  const setup = createSetup(mapper, stampedGroupKeys, {
    findById: async () => versioned(structuredClone(stored), version),
    findAll: async () => [versioned(structuredClone(stored), version)],
    apply,
    delete: deleteRecords,
  });

  return { ...setup, apply, deleteRecords };
}

/** Finds the group by name with a query of its own, as an adapter's repository would. */
class StampedGroupsByName extends TrackingRepository<
  Group,
  StampedGroupRecords,
  string,
  Transaction
> {
  constructor(
    dataStore: StampedGroupStore,
    private readonly stored: StampedGroupRecords,
  ) {
    super(dataStore, stampedGroupMapper);
  }

  findByName(name: string): Promise<Group | null> {
    return this.findOneBy(async () =>
      this.stored.groups[0].name === name
        ? versioned(structuredClone(this.stored))
        : null,
    );
  }
}

/** Returns only the fields of `GroupRecords`: the stamped ones are the store's. */
const stampedGroupMapper: Mapper<Group, StampedGroupRecords, string> = {
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

/** Leaves the members who left out of the entity, as a soft delete would. */
const softDeletingGroupMapper: Mapper<Group, StampedGroupRecords, string> = {
  ...stampedGroupMapper,
  toDomain(records) {
    return stampedGroupMapper.toDomain({
      ...records,
      members: records.members.filter(({ leftAt }) => leftAt === undefined),
    });
  },
};

/** Reads a record set without members as a group without members. */
const lenientGroupMapper: Mapper<Group, StampedGroupRecords, string> = {
  ...stampedGroupMapper,
  toDomain({ groups, members }) {
    return stampedGroupMapper.toDomain({
      groups,
      // Only a cast gets the missing collection past the types.
      members: Array.isArray(members) ? members : [],
    });
  },
};

/** Refuses to map a group without a name, with `failure`. */
function strictGroupMapper(
  failure: Error,
): Mapper<Group, StampedGroupRecords, string> {
  return {
    ...stampedGroupMapper,
    toRecords(group) {
      if (group.name === "") throw failure;
      return stampedGroupMapper.toRecords(group);
    },
  };
}

const stampedGroupKeys: RecordKeys<StampedGroupRecords> = {
  groups: (group) => group._id,
  members: (member) => member._id,
};

/** Leaves the optional field out of the record, rather than as undefined, once it is cleared. */
const omittingDraftMapper: Mapper<Draft, DraftRecords, string> = {
  ...draftMapper,
  toRecords(draft) {
    return {
      drafts: [
        draft.nickname === undefined
          ? { id: draft.id }
          : { id: draft.id, nickname: draft.nickname },
      ],
    };
  },
};

interface Priced {
  id: string;
  currency: string;
}

interface PricedRecord {
  id: string;
  currency?: string;
}

interface PricedRecords {
  priced: [PricedRecord];
}

/** Defaults a currency the store lacks, as a lazy migration would. */
const pricedMapper: Mapper<Priced, PricedRecords, string> = {
  toDomain({ priced: [record] }) {
    return { id: record.id, currency: record.currency ?? "EUR" };
  },
  toRecords(priced) {
    return { priced: [{ id: priced.id, currency: priced.currency }] };
  },
  identity(priced) {
    return priced.id;
  },
};

const pricedKeys: RecordKeys<PricedRecords> = {
  priced: (record) => record.id,
};

/** Trims the stored name, as a normalizing mapper would. */
const trimmingProductMapper: Mapper<Product, ProductRecords, string> = {
  ...productMapper,
  toDomain({ products: [record] }) {
    return { id: record.productId, name: record.productName.trim() };
  },
};

describe("TrackingRepository identityKey option", () => {
  it("keys composite identities with the identityKey of the options object", async () => {
    const { repository } = createSetup(
      orderMapper,
      orderKeys,
      { findById: async () => versioned(storedOrder()) },
      {
        identityKey: (identity) =>
          `${identity.accountId}:${identity.orderNumber}`,
      },
    );

    await repository.findById({
      accountId: "account-1",
      orderNumber: "order-1",
    });
    const error = await reasonOf(
      repository.add({
        identity: { accountId: "account-1", orderNumber: "order-1" },
        description: "Mouse",
      }),
    );

    // The key in the message is the option's, not identityKeyOf's.
    expectNativeError(
      error,
      Error,
      'An entity with identity "account-1:order-1" is already tracked.',
    );
  });
});

describe("TrackingRepository domain events", () => {
  const context: Transaction = { id: "transaction-1" };

  it("collects no event without the pullEvents option, leaving the queue as it is", async () => {
    const { repository } = createSetup(accountMapper, accountKeys, {
      findById: async (id) => versioned(storedAccount(id, "Ada"), 3),
    });

    const account = await repository.findById("a-1");
    account!.queue.push(accountEvent("noted", "a-1"));

    expect(repository.pullEvents()).toEqual([]);
    expect(account!.queue).toEqual([accountEvent("noted", "a-1")]);
  });

  it("hands over the event of a loaded and changed aggregate, and plans its update", async () => {
    const { repository, apply } = createAccountSetup({
      "a-1": storedAccount("a-1", "Ada"),
    });

    const account = await repository.findById("a-1");
    account!.owner = "Grace";
    account!.queue.push(accountEvent("transferred", "a-1"));

    const units = repository.planFlush();
    expect(units.map(({ kind }) => kind)).toEqual(["update"]);
    for (const unit of units) {
      await unit.run(context);
    }
    expect(apply).toHaveBeenCalledExactlyOnceWith(
      {
        id: "a-1",
        expectedVersion: 3,
        changes: {
          accounts: {
            inserted: [],
            updated: [
              {
                record: { accountId: "a-1", owner: "Grace" },
                set: { owner: "Grace" },
                unset: [],
              },
            ],
            deleted: [],
          },
        },
      },
      context,
    );
    expect(repository.pullEvents()).toEqual([
      accountEvent("transferred", "a-1"),
    ]);
    // pullEvents takes the events: the aggregate's queue is emptied.
    expect(account!.queue).toEqual([]);
  });

  it("hands over the event of a loaded aggregate whose state did not change, with no write", async () => {
    const { repository } = createAccountSetup({
      "a-1": storedAccount("a-1", "Ada"),
    });

    const account = await repository.findById("a-1");
    account!.queue.push(accountEvent("viewed", "a-1"));

    expect(repository.planFlush()).toEqual([]);
    expect(repository.pullEvents()).toEqual([accountEvent("viewed", "a-1")]);
  });

  it("hands over the event of a loaded and removed aggregate, and plans its delete", async () => {
    const { repository, deleteRecords } = createAccountSetup({
      "a-1": storedAccount("a-1", "Ada"),
    });

    const account = await repository.findById("a-1");
    account!.queue.push(accountEvent("closed", "a-1"));
    await repository.remove(account!);

    const units = repository.planFlush();
    expect(units.map(({ kind }) => kind)).toEqual(["delete"]);
    for (const unit of units) {
      await unit.run(context);
    }
    expect(deleteRecords).toHaveBeenCalledExactlyOnceWith("a-1", 3, context);
    expect(repository.pullEvents()).toEqual([accountEvent("closed", "a-1")]);
  });

  it("hands over the events of a new aggregate in queue order", async () => {
    const { repository } = createAccountSetup();
    const account = newAccount("a-1", "Ada");
    account.queue.push(
      accountEvent("opened", "a-1"),
      accountEvent("credited", "a-1"),
    );

    await repository.add(account);

    expect(repository.pullEvents()).toEqual([
      accountEvent("opened", "a-1"),
      accountEvent("credited", "a-1"),
    ]);
  });

  it("hands over the events of every tracked aggregate in tracking order, then queue order", async () => {
    const { repository } = createAccountSetup({
      "a-2": storedAccount("a-2", "Grace"),
      "a-3": storedAccount("a-3", "Edsger"),
    });
    const first = newAccount("a-1", "Ada");
    await repository.add(first);
    const second = await repository.findById("a-2");
    const third = await repository.findById("a-3");
    await repository.remove(third!);

    // Raised in another order than the aggregates were tracked.
    third!.queue.push(accountEvent("closed", "a-3"));
    second!.queue.push(accountEvent("viewed", "a-2"));
    first.queue.push(
      accountEvent("opened", "a-1"),
      accountEvent("credited", "a-1"),
    );
    second!.queue.push(accountEvent("renamed", "a-2"));

    expect(repository.pullEvents()).toEqual([
      accountEvent("opened", "a-1"),
      accountEvent("credited", "a-1"),
      accountEvent("viewed", "a-2"),
      accountEvent("renamed", "a-2"),
      accountEvent("closed", "a-3"),
    ]);
  });

  it("hands over the removed instance's events, then the added one's, for a replaced identity", async () => {
    const { repository } = createAccountSetup({
      "a-1": storedAccount("a-1", "Ada"),
    });

    const removed = await repository.findById("a-1");
    removed!.queue.push(accountEvent("closed", "a-1"));
    await repository.remove(removed!);
    const added = newAccount("a-1", "Grace");
    added.queue.push(accountEvent("opened", "a-1"));
    await repository.add(added);

    // The removed instance leaves tracking at the add, so its events are taken there.
    expect(removed!.queue).toEqual([]);
    expect(repository.pullEvents()).toEqual([
      accountEvent("closed", "a-1"),
      accountEvent("opened", "a-1"),
    ]);
  });

  it("hands over the events of the three instances of an identity removed and added twice, in that order", async () => {
    const { repository } = createAccountSetup({
      "a-1": storedAccount("a-1", "Ada"),
    });

    const loaded = await repository.findById("a-1");
    loaded!.queue.push(accountEvent("closed", "a-1"));
    await repository.remove(loaded!);
    const second = newAccount("a-1", "Grace");
    second.queue.push(accountEvent("reopened", "a-1"));
    await repository.add(second);
    await repository.remove(second);
    const third = newAccount("a-1", "Edsger");
    third.queue.push(accountEvent("opened", "a-1"));
    await repository.add(third);

    expect(repository.pullEvents()).toEqual([
      accountEvent("closed", "a-1"),
      accountEvent("reopened", "a-1"),
      accountEvent("opened", "a-1"),
    ]);
  });

  it("forgets the events of a replaced instance on clear", async () => {
    const { repository } = createAccountSetup({
      "a-1": storedAccount("a-1", "Ada"),
    });

    const removed = await repository.findById("a-1");
    removed!.queue.push(accountEvent("closed", "a-1"));
    await repository.remove(removed!);
    await repository.add(newAccount("a-1", "Grace"));
    repository.clear();

    // The same identity, tracked again after clear, must not bring back the
    // replaced instance's events.
    const reloaded = await repository.findById("a-1");
    reloaded!.queue.push(accountEvent("viewed", "a-1"));

    expect(repository.pullEvents()).toEqual([accountEvent("viewed", "a-1")]);
  });

  it("hands over no event of an aggregate added and then removed, and leaves its queue as it is", async () => {
    const { repository, pullEvents } = createAccountSetup();
    const account = newAccount("a-1", "Ada");
    account.queue.push(accountEvent("opened", "a-1"));

    await repository.add(account);
    await repository.remove(account);

    expect(repository.planFlush()).toEqual([]);
    expect(repository.pullEvents()).toEqual([]);
    expect(account.queue).toEqual([accountEvent("opened", "a-1")]);
    expect(pullEvents).not.toHaveBeenCalled();
  });

  it("reports no pending change for a loaded, unchanged aggregate with a queued event, leaving the queue as it is", async () => {
    const { repository, pullEvents } = createAccountSetup({
      "a-1": storedAccount("a-1", "Ada"),
    });

    const account = await repository.findById("a-1");
    account!.queue.push(accountEvent("viewed", "a-1"));

    expect(repository.hasPendingChanges()).toBe(false);
    expect(account!.queue).toEqual([accountEvent("viewed", "a-1")]);
    expect(pullEvents).not.toHaveBeenCalled();
  });

  it("propagates the error the app's pullEvents throws", async () => {
    const failure = new Error("the queue is corrupt");
    const { repository } = createAccountSetup(
      { "a-1": storedAccount("a-1", "Ada") },
      () => {
        throw failure;
      },
    );

    await repository.findById("a-1");

    let error: unknown;
    try {
      repository.pullEvents();
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBe(failure);
  });
});

interface AccountEvent {
  type: string;
  accountId: string;
}

/** An aggregate that queues the domain events it raises, outside its records. */
interface Account {
  id: string;
  owner: string;
  queue: AccountEvent[];
}

interface AccountRecord {
  accountId: string;
  owner: string;
}

interface AccountRecords {
  accounts: [AccountRecord];
}

type AccountStore = DataStore<AccountRecords, string, Transaction>;

const accountMapper: Mapper<Account, AccountRecords, string> = {
  toDomain({ accounts: [record] }) {
    return { id: record.accountId, owner: record.owner, queue: [] };
  },
  toRecords(account) {
    return { accounts: [{ accountId: account.id, owner: account.owner }] };
  },
  identity(account) {
    return account.id;
  },
};

const accountKeys: RecordKeys<AccountRecords> = {
  accounts: (record) => record.accountId,
};

function accountEvent(type: string, accountId: string): AccountEvent {
  return { type, accountId };
}

function newAccount(id: string, owner: string): Account {
  return { id, owner, queue: [] };
}

function storedAccount(id: string, owner: string): AccountRecords {
  return { accounts: [{ accountId: id, owner }] };
}

/**
 * Wires an account repository that pulls each aggregate's queue, over a store
 * holding `stored` at version 3.
 */
function createAccountSetup(
  stored: Readonly<Record<string, AccountRecords>> = {},
  pull: (account: Account) => readonly AccountEvent[] = (account) =>
    account.queue.splice(0),
) {
  const apply = vi.fn<AccountStore["apply"]>(async () => undefined);
  const deleteRecords = vi.fn<AccountStore["delete"]>(async () => undefined);
  const pullEvents = vi.fn(pull);
  const dataStore: AccountStore = {
    recordKeys: accountKeys,
    findById: async (id) => {
      const records = stored[id];
      return records === undefined
        ? null
        : versioned(structuredClone(records), 3);
    },
    findAll: async () =>
      Object.values(stored).map((records) =>
        versioned(structuredClone(records), 3),
      ),
    apply,
    delete: deleteRecords,
  };
  const repository = new TrackingRepository(dataStore, accountMapper, {
    pullEvents,
  });

  return { repository, apply, deleteRecords, pullEvents };
}
