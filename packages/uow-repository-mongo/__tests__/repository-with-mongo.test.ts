import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  Decimal128,
  ObjectId,
  type CommandStartedEvent,
  type Db,
  type Document,
  type MongoClient,
} from "mongodb";
import {
  MongoTransactionManager,
  type IMongoTransaction,
} from "@enardo/transaction-manager-mongo";
import {
  ConcurrencyConflictError,
  Repository,
  UnitOfWork,
  retryOnConflict,
  type Mapper,
} from "@enardo/uow-repository";
import {
  connect,
  createDatabase,
  createGroupStore,
  createProductStore,
  type GroupRecords,
  type ProductRecords,
} from "./support/fixtures";

interface Product {
  id: string;
  name: string;
  price: string;
  listedAt: Date;
  notes?: string | undefined;
}

interface Member {
  id: string;
  userId: string;
  role: "owner" | "member";
}

interface Group {
  id: string;
  name: string;
  members: Member[];
}

/** Keeps ObjectId and Decimal128 out of the entity, as a domain model would. */
const productMapper: Mapper<Product, ProductRecords, ObjectId> = {
  toDomain({ products: [record] }) {
    return {
      id: record._id.toHexString(),
      name: record.name,
      price: record.price.toString(),
      listedAt: record.listedAt,
      notes: record.notes,
    };
  },
  toRecords(product) {
    return {
      products: [
        {
          _id: new ObjectId(product.id),
          name: product.name,
          price: Decimal128.fromString(product.price),
          listedAt: product.listedAt,
          notes: product.notes,
        },
      ],
    };
  },
  identity(product) {
    return new ObjectId(product.id);
  },
};

const groupMapper: Mapper<Group, GroupRecords, ObjectId> = {
  toDomain({ groups: [record], members }) {
    return {
      id: record._id.toHexString(),
      name: record.name,
      members: members.map((member) => ({
        id: member._id.toHexString(),
        userId: member.userId.toHexString(),
        role: member.role,
      })),
    };
  },
  toRecords(group) {
    return {
      groups: [{ _id: new ObjectId(group.id), name: group.name }],
      members: group.members.map((member) => ({
        _id: new ObjectId(member.id),
        groupId: new ObjectId(group.id),
        userId: new ObjectId(member.userId),
        role: member.role,
      })),
    };
  },
  identity(group) {
    return new ObjectId(group.id);
  },
};

/** ObjectId is not a primitive identity, so the change tracker needs a key for it. */
const hexKey = (id: ObjectId): string => id.toHexString();

describe("Repository over MongoDB", () => {
  let client: MongoClient;
  let db: Db;
  let transactionManager: MongoTransactionManager;
  let writes: CommandStartedEvent[];

  function recordWrites(event: CommandStartedEvent): void {
    if (["insert", "update", "delete"].includes(event.commandName)) {
      writes.push(event);
    }
  }

  beforeAll(async () => {
    client = await connect({ monitorCommands: true });
    client.on("commandStarted", recordWrites);
    transactionManager = new MongoTransactionManager(client);
  });

  afterAll(async () => {
    client.off("commandStarted", recordWrites);
    await client.close();
  });

  beforeEach(async () => {
    db = await createDatabase(client);
    writes = [];
  });

  afterEach(async () => {
    await db.dropDatabase();
  });

  /** Builds one unit of work, with its repositories, for one use case. */
  function createContext() {
    const unitOfWork = new UnitOfWork<IMongoTransaction>(transactionManager);
    const groups = new Repository(
      createGroupStore(client, db),
      groupMapper,
      hexKey,
    );
    const products = new Repository(
      createProductStore(client, db),
      productMapper,
      hexKey,
    );
    unitOfWork.register(groups);
    unitOfWork.register(products);
    return { unitOfWork, groups, products };
  }

  async function addProduct(product: Product): Promise<void> {
    const { unitOfWork, products } = createContext();
    await unitOfWork.execute(() => products.add(product));
  }

  async function addGroup(group: Group): Promise<void> {
    const { unitOfWork, groups } = createContext();
    await unitOfWork.execute(() => groups.add(group));
  }

  it("loads aggregates holding ObjectId, Decimal128 and Date values without seeing a change", async () => {
    const keyboard = product();
    const climbers = group([owner(), joiner()]);
    await addProduct(keyboard);
    await addGroup(climbers);
    const { unitOfWork, groups, products } = createContext();

    await unitOfWork.execute(async () => {
      expect(await products.findById(new ObjectId(keyboard.id))).toEqual(
        keyboard,
      );
      expect(await groups.findById(new ObjectId(climbers.id))).toEqual(
        climbers,
      );
      expect(unitOfWork.hasPendingChanges()).toBe(false);
    });
  });

  it("stores ObjectId, Decimal128 and Date values as BSON types, beside a numeric version", async () => {
    const keyboard = product();

    await addProduct(keyboard);

    expect(
      await db.collection("products").countDocuments({
        _id: { $type: "objectId" },
        price: { $type: "decimal" },
        listedAt: { $type: "date" },
        _version: 1,
      }),
    ).toBe(1);
  });

  it("writes only the fields and child records that changed", async () => {
    const leaving = joiner();
    const climbers = group([owner(), leaving]);
    await addGroup(climbers);
    const joining = joiner();
    const { unitOfWork, groups } = createContext();
    writes = [];

    await unitOfWork.execute(async () => {
      const loaded = await groups.findById(new ObjectId(climbers.id));
      loaded!.name = "Boulderers";
      loaded!.members = loaded!.members.filter(({ id }) => id !== leaving.id);
      loaded!.members.push(joining);
    });

    expect(writes.map(describeWrite)).toEqual([
      {
        collection: "groups",
        update: [
          {
            q: { _id: new ObjectId(climbers.id), _version: 1 },
            u: { $set: { name: "Boulderers" }, $inc: { _version: 1 } },
          },
        ],
      },
      {
        collection: "members",
        delete: [
          {
            q: {
              _id: new ObjectId(leaving.id),
              groupId: new ObjectId(climbers.id),
            },
          },
        ],
      },
      {
        collection: "members",
        insert: [
          {
            _id: new ObjectId(joining.id),
            groupId: new ObjectId(climbers.id),
            userId: new ObjectId(joining.userId),
            role: "member",
          },
        ],
      },
    ]);
  });

  it("replaces an aggregate removed and added again in one unit of work, restarting at version 1", async () => {
    const climbers = group([owner()]);
    await addGroup(climbers);
    const replacement = { ...climbers, name: "Hikers", members: [owner()] };
    const { unitOfWork, groups } = createContext();

    await unitOfWork.execute(async () => {
      const loaded = await groups.findById(new ObjectId(climbers.id));
      await groups.remove(loaded!);
      await groups.add(replacement);
    });

    expect(await db.collection("groups").find().toArray()).toEqual([
      { _id: new ObjectId(climbers.id), name: "Hikers", _version: 1 },
    ]);
    expect(await db.collection("members").find().toArray()).toEqual([
      expect.objectContaining({
        _id: new ObjectId(replacement.members[0]!.id),
      }),
    ]);
  });

  it("rolls back the writes of every repository when a later write fails", async () => {
    await db
      .collection("products")
      .createIndex({ name: 1 }, { unique: true, name: "unique_name" });
    await addProduct(product({ name: "Keyboard" }));
    const { unitOfWork, groups, products } = createContext();

    await expect(
      unitOfWork.execute(async () => {
        await groups.add(group([owner()]));
        await products.add(product({ name: "Keyboard" }));
      }),
    ).rejects.toMatchObject({ code: 11000 });

    expect(await db.collection("groups").countDocuments()).toBe(0);
    expect(await db.collection("members").countDocuments()).toBe(0);
    expect(await db.collection("products").countDocuments()).toBe(1);
  });

  it("fails the use case that commits second with ConcurrencyConflictError", async () => {
    const keyboard = product();
    await addProduct(keyboard);
    const alice = createContext();
    const bob = createContext();

    await expect(
      alice.unitOfWork.execute(async () => {
        const loaded = await alice.products.findById(new ObjectId(keyboard.id));

        await bob.unitOfWork.execute(async () => {
          const same = await bob.products.findById(new ObjectId(keyboard.id));
          same!.price = "29.90";
        });

        loaded!.name = "Keyboard Pro";
      }),
    ).rejects.toBeInstanceOf(ConcurrencyConflictError);

    expect(await db.collection("products").findOne()).toMatchObject({
      name: "Keyboard",
      price: Decimal128.fromString("29.90"),
      _version: 2,
    });
  });

  it("runs the use case again with retryOnConflict, on top of the other write", async () => {
    const keyboard = product();
    await addProduct(keyboard);
    const attempts: number[] = [];

    await retryOnConflict(async (attempt) => {
      attempts.push(attempt);
      const { unitOfWork, products } = createContext();

      await unitOfWork.execute(async () => {
        const loaded = await products.findById(new ObjectId(keyboard.id));

        if (attempt === 1) {
          const other = createContext();
          await other.unitOfWork.execute(async () => {
            const same = await other.products.findById(
              new ObjectId(keyboard.id),
            );
            same!.price = "29.90";
          });
        }

        loaded!.name = "Keyboard Pro";
      });
    });

    expect(attempts).toEqual([1, 2]);
    expect(await db.collection("products").findOne()).toMatchObject({
      name: "Keyboard Pro",
      price: Decimal128.fromString("29.90"),
      _version: 3,
    });
  });
});

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: new ObjectId().toHexString(),
    name: "Keyboard",
    price: "49.90",
    listedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function group(members: Member[]): Group {
  return { id: new ObjectId().toHexString(), name: "Climbers", members };
}

function owner(): Member {
  return {
    id: new ObjectId().toHexString(),
    userId: new ObjectId().toHexString(),
    role: "owner",
  };
}

function joiner(): Member {
  return { ...owner(), role: "member" };
}

/** Keeps the parts of a write command a test can assert on, without session fields. */
function describeWrite({ commandName, command }: CommandStartedEvent) {
  const writesOf: Record<string, string> = {
    insert: "documents",
    update: "updates",
    delete: "deletes",
  };
  const statements = (command[writesOf[commandName]!] as Document[]).map(
    ({ q, u, ...statement }: Document) =>
      commandName === "insert" ? statement : { q, ...(u ? { u } : {}) },
  );

  return {
    collection: command[commandName] as string,
    [commandName]: statements,
  };
}
