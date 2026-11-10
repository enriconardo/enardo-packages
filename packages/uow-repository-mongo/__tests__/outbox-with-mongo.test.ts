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
  type MongoClient,
} from "mongodb";
import {
  MongoTransactionManager,
  type MongoTransaction,
} from "@enardo/transaction-manager-mongo";
import {
  TrackingRepository,
  TransactionalUnitOfWork,
  type Mapper,
} from "@enardo/uow-repository";
import {
  connect,
  createDatabase,
  createProductStore,
  type ProductRecords,
} from "./support/fixtures";

interface ProductEvent {
  type: "product.listed" | "product.priced";
  productId: string;
}

/** An aggregate that queues the domain events it raises, as `AggregateRoot` does. */
interface Product {
  id: string;
  name: string;
  price: string;
  listedAt: Date;
  events: ProductEvent[];
}

/** The events are not records: the mapper never sees the queue. */
const productMapper: Mapper<Product, ProductRecords, ObjectId> = {
  toDomain({ products: [record] }) {
    return {
      id: record._id.toHexString(),
      name: record.name,
      price: record.price.toString(),
      listedAt: record.listedAt,
      events: [],
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
        },
      ],
    };
  },
  identity(product) {
    return new ObjectId(product.id);
  },
};

const hexKey = (id: ObjectId): string => id.toHexString();

describe("an outbox written through onEvents on MongoDB", () => {
  let client: MongoClient;
  let db: Db;
  let transactionManager: MongoTransactionManager;
  let inserts: CommandStartedEvent[];

  function recordInserts(event: CommandStartedEvent): void {
    if (event.commandName === "insert") {
      inserts.push(event);
    }
  }

  beforeAll(async () => {
    client = await connect({ monitorCommands: true });
    client.on("commandStarted", recordInserts);
    transactionManager = new MongoTransactionManager(client);
  });

  afterAll(async () => {
    client.off("commandStarted", recordInserts);
    await client.close();
  });

  beforeEach(async () => {
    db = await createDatabase(client);
    // Created up front, like the fixtures' collections: a transaction's
    // snapshot does not see a collection created after it.
    await db.createCollection("outbox");
    inserts = [];
  });

  afterEach(async () => {
    await db.dropDatabase();
  });

  /** One unit of work whose onEvents writes the events to the outbox, with the session. */
  function createContext(afterInsert: () => void = () => undefined) {
    const unitOfWork = new TransactionalUnitOfWork<
      MongoTransaction,
      ProductEvent
    >(transactionManager, {
      onEvents: async (events, { session }) => {
        await db.collection("outbox").insertMany(
          events.map((event) => ({ ...event })),
          { session },
        );
        afterInsert();
      },
    });
    const products = new TrackingRepository(
      createProductStore(client, db),
      productMapper,
      {
        identityKey: hexKey,
        pullEvents: (product: Product) => product.events.splice(0),
      },
    );
    unitOfWork.register(products);
    return { unitOfWork, products };
  }

  async function outbox(): Promise<unknown[]> {
    return db
      .collection("outbox")
      .find({}, { projection: { _id: 0 } })
      .sort({ _id: 1 })
      .toArray();
  }

  it("commits the aggregate and its events in the outbox together", async () => {
    const keyboard = listedProduct();
    const { unitOfWork, products } = createContext();

    await unitOfWork.execute(() => products.add(keyboard));

    expect(await db.collection("products").find().toArray()).toEqual([
      {
        _id: new ObjectId(keyboard.id),
        name: "Keyboard",
        price: Decimal128.fromString("49.90"),
        listedAt: keyboard.listedAt,
        _version: 1,
      },
    ]);
    expect(await outbox()).toEqual([
      { type: "product.listed", productId: keyboard.id },
      { type: "product.priced", productId: keyboard.id },
    ]);
    expect(keyboard.events).toEqual([]);
  });

  it("inserts the outbox documents in the transaction of the aggregate's write, after it", async () => {
    const keyboard = listedProduct();
    const { unitOfWork, products } = createContext();

    await unitOfWork.execute(() => products.add(keyboard));

    expect(inserts.map(({ command }) => command.insert as string)).toEqual([
      "products",
      "outbox",
    ]);
    const [write, outboxWrite] = inserts.map(({ command }) => command);
    expect(write?.txnNumber).toBeDefined();
    expect(outboxWrite?.lsid).toEqual(write?.lsid);
    expect(outboxWrite?.txnNumber).toEqual(write?.txnNumber);
  });

  it("leaves neither the aggregate's write nor the outbox documents when onEvents throws after inserting", async () => {
    const failure = new Error("relay bookkeeping failed");
    const keyboard = listedProduct();
    const { unitOfWork, products } = createContext(() => {
      throw failure;
    });

    await expect(unitOfWork.execute(() => products.add(keyboard))).rejects.toBe(
      failure,
    );

    expect(inserts.map(({ command }) => command.insert as string)).toEqual([
      "products",
      "outbox",
    ]);
    expect(await db.collection("products").countDocuments()).toBe(0);
    expect(await db.collection("outbox").countDocuments()).toBe(0);
  });
});

function listedProduct(): Product {
  const id = new ObjectId().toHexString();
  return {
    id,
    name: "Keyboard",
    price: "49.90",
    listedAt: new Date("2026-01-01T00:00:00Z"),
    events: [
      { type: "product.listed", productId: id },
      { type: "product.priced", productId: id },
    ],
  };
}
