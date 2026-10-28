# @enardo/uow-repository-mongo

The MongoDB data store for [`@enardo/uow-repository`](../uow-repository/README.md). You describe where each collection of an aggregate lives, and the store reads it, writes only what changed, and checks versions. It writes inside the transactions of [`@enardo/transaction-manager-mongo`](../transaction-manager-mongo/README.md).

```ts
const productStore = new MongoDataStore<ProductRecords, ObjectId>({
  client,
  collections: {
    products: { collection: db.collection("products"), root: true },
  },
});
const transactionManager = new MongoTransactionManager(client);
```

> Published to the `@enardo` registry, version 0.2.0: the API can still change. MongoDB transactions need a replica set or a sharded cluster, even a single-node replica set. A standalone server doesn't work.

## Contents

- [What it provides](#what-it-provides)
- [Quick start](#quick-start)
- [Configuration and usage](#configuration-and-usage)
- [Contributing](#contributing)

## What it provides

`@enardo/uow-repository` leaves two pieces to you: a `DataStore` and an `ITransactionManager`. This package implements the `DataStore` for MongoDB. The transaction manager is `MongoTransactionManager` from `@enardo/transaction-manager-mongo`, whose `IMongoTransaction` context carries the session the store writes with.

| Export | Implements | Job |
| --- | --- | --- |
| `MongoDataStore` | `DataStore<TRecords, TId, IMongoTransaction, number>` | Reads an aggregate from a root collection and any child collections, and applies change sets after checking the version on the root document |
| `InvalidDataStoreOptionsError` | | Thrown when the collections name no root, or more than one |

You still write the `Mapper`, and you create the `Repository` and `UnitOfWork` from the core package.

## Quick start

You need Node.js 24, pnpm 11, and access to the `@enardo` registry (`https://npm.enriconardo.com`, which needs a token to read). You'll save a product and change its price against an in-memory replica set, so you need no MongoDB server.

**1. Install the packages** in the package that will use them. `mongodb-memory-server` is only needed for this quick start.

```sh
pnpm add @enardo/transaction-manager-mongo @enardo/uow-repository @enardo/uow-repository-mongo mongodb
pnpm add -D mongodb-memory-server
```

`@enardo/transaction-manager-mongo` has a peer of its own, which [its install line](../transaction-manager-mongo/README.md#usage) shows.

**2. Save this as `quickstart.mts`** in that package.

```ts
import { MongoClient, ObjectId } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import {
  MongoTransactionManager,
  type IMongoTransaction,
} from "@enardo/transaction-manager-mongo";
import { Repository, UnitOfWork, type Mapper } from "@enardo/uow-repository";
import { MongoDataStore } from "@enardo/uow-repository-mongo";

// 1. The entity, the records that store it, and the mapper between them.
interface Product {
  id: string;
  name: string;
  price: number;
}

interface ProductRecord {
  _id: ObjectId;
  name: string;
  price: number;
}

interface ProductRecords {
  products: [ProductRecord];
}

const productMapper: Mapper<Product, ProductRecords, ObjectId> = {
  toDomain: ({ products: [record] }) => ({
    id: record._id.toHexString(),
    name: record.name,
    price: record.price,
  }),
  toRecords: (product) => ({
    products: [
      { _id: new ObjectId(product.id), name: product.name, price: product.price },
    ],
  }),
  identity: (product) => new ObjectId(product.id),
};

// 2. A single-node replica set in memory: transactions need a replica set.
const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
const client = await new MongoClient(replSet.getUri()).connect();
const db = client.db("shop");

// 3. The adapters. They hold no state, so every use case shares them.
const productStore = new MongoDataStore<ProductRecords, ObjectId>({
  client,
  collections: {
    products: { collection: db.collection("products"), root: true },
  },
});
const transactionManager = new MongoTransactionManager(client);

// 4. One unit of work, with its repositories, per use case.
function createContext() {
  // An ObjectId isn't a primitive identity, so the repository needs a key for it.
  const products = new Repository(productStore, productMapper, (id) =>
    id.toHexString(),
  );
  const unitOfWork = new UnitOfWork<IMongoTransaction>(transactionManager);
  unitOfWork.register(products);
  return { products, unitOfWork };
}

// 5. Run two use cases: add a product, then change its price.
const id = new ObjectId("65f0a1b2c3d4e5f6a7b8c9d0");

const adding = createContext();
await adding.unitOfWork.execute(() =>
  adding.products.add({ id: id.toHexString(), name: "Keyboard", price: 49.9 }),
);

const repricing = createContext();
await repricing.unitOfWork.execute(async () => {
  const keyboard = await repricing.products.findById(id);
  if (keyboard) keyboard.price = 39.9; // no save(), no markDirty()
});

console.log(await db.collection("products").findOne({ _id: id }));

await client.close();
await replSet.stop();
```

**3. Run it.** The first run downloads a `mongod` binary, which takes a while.

```sh
node quickstart.mts
```

```text
{
  _id: new ObjectId('65f0a1b2c3d4e5f6a7b8c9d0'),
  name: 'Keyboard',
  price: 39.9,
  _version: 2
}
```

What happened:

- The first use case inserted the product with `_version: 1`. The version lives in the document, but `findById` strips it from the records, so the mapper never sees it.
- The second use case loaded version 1 and changed only `price`. On commit, the store ran one `updateOne` that matched `{ _id, _version: 1 }`, set `price` and incremented `_version`.

To use your own server, replace part 2 of `quickstart.mts` with a `MongoClient` connected to your replica set.

## Configuration and usage

### `MongoDataStore` options

```ts
new MongoDataStore<TRecords, TId>({ client, collections, versionField });
```

| Option | Type | Required | Meaning |
| --- | --- | --- | --- |
| `client` | `MongoClient` | yes | Opens the snapshot sessions used to read aggregates that span several collections |
| `collections` | one entry per collection of `TRecords` | yes | Where each collection is stored. The compiler requires every collection, because a collection left out would never be written. |
| `versionField` | `string` | no, defaults to `"_version"` | The field of the root document that holds the version. The underscore marks it as bookkeeping, like `_id`, so it doesn't collide with record fields. |

Each entry of `collections` is one of:

| Kind | Fields | Meaning |
| --- | --- | --- |
| Root | `collection`, `root: true`, `idField?` | Holds exactly one record per aggregate, found by `idField` (default `_id`) equal to the aggregate's identity. It carries the version. |
| Child | `collection`, `aggregateIdField`, `idField?` | Holds any number of records per aggregate, found by `aggregateIdField` equal to the aggregate's identity. `idField` (default `_id`) identifies a record within the collection. |

Exactly one entry must be the root, or the constructor throws `InvalidDataStoreOptionsError`. The store keys records by their `idField` value in extended JSON, so two equal `ObjectId` instances match. The store holds no state: create it once and share it.

### Aggregates in one collection

The quick start shows it: one collection, marked `root: true`, whose record is the whole aggregate.

### Aggregates across collections

A group with members is stored as one document per group and one document per member. Each member document names its group in `groupId`:

```ts
interface GroupRecords {
  groups: [{ _id: ObjectId; name: string }];
  members: { _id: ObjectId; groupId: ObjectId; userId: ObjectId; role: "owner" | "member" }[];
}

const groupStore = new MongoDataStore<GroupRecords, ObjectId>({
  client,
  collections: {
    groups: { collection: db.collection("groups"), root: true },
    members: { collection: db.collection("members"), aggregateIdField: "groupId" },
  },
});
```

- **Reads.** Every read loads the root documents first and then the children of those roots only, in one snapshot session (`{ snapshot: true }`), so all collections come from the same point in time. An aggregate held in a single collection is read without a session. Child documents whose aggregate has no root document are never read.
- **Writes.** `apply` checks and increments the version on the root document first, even when only members changed. Then it writes each child collection in one ordered `bulkWrite`: deletes, then inserts, then updates. Deletes and updates of a child are filtered by both its `idField` and `aggregateIdField`, so they never touch another aggregate's records.
- **Record ids.** Give every child record an id your application assigns, such as `new ObjectId()` created in the mapper or the domain. A record key must be known before the record is written.
- **Index the child link.** Create an index on each `aggregateIdField`, for example `members.createIndex({ groupId: 1 })`. Every read and delete filters on it.

### Identities

`Repository` derives change-tracker keys only from `string`, `number`, `bigint` and `boolean` identities. When the root's `_id` is an `ObjectId`, pass it as the identity and give the repository a key function:

```ts
const products = new Repository(productStore, productMapper, (id) => id.toHexString());
```

`TId` of the store is always the identity as the documents hold it. When the domain has an identity of its own, such as a value object, the mapper converts it with `toStoredId`, and the repository hands the store the converted value (see [Stored identities](../uow-repository/README.md#stored-identities)). Every filter on an id field, including the `aggregateIdField` of child collections, uses that value, and so does `ConcurrencyConflictError`:

```ts
const toStoredId = (id: EntityId) => new ObjectId(id.toString());

const userMapper: Mapper<User, UserRecords, EntityId, ObjectId> = {
  // toDomain, and toRecords writing `_id: toStoredId(user.id)`
  identity: (user) => user.id,
  toStoredId,
};
const userStore = new MongoDataStore<UserRecords, ObjectId>({
  client,
  collections: { users: { collection: db.collection("users"), root: true } },
});
const users = new Repository(userStore, userMapper, (id) => id.toString());
```

The mapper can keep `ObjectId` out of the entity, as the quick start does with hex strings. Records keep `ObjectId`, `Decimal128`, `Long` and other BSON values as they are: the core package copies class instances by reference, so they reach the driver with their prototype.

### Queries

Besides the `DataStore` methods, the store reads aggregates by any filter on the root collection. Every result strips the version from the records and carries the children of each root:

| Method | Returns |
| --- | --- |
| `findOne(filter)` | The first aggregate whose root matches, or `null` |
| `findMany(filter?, { sort?, skip?, limit? })` | Every aggregate whose root matches; sorting and paging apply to the root documents |
| `count(filter?)` | The number of root documents that match |

- **Lookups a write depends on**, such as a user found by email and then changed, need tracking. Extend `Repository` and pass the query to its protected `findOneBy`, as the [core README](../uow-repository/README.md#custom-finders) shows:

  ```ts
  findByEmail(email: Email): Promise<User | null> {
    return this.findOneBy(() => this.store.findOne({ email: email.toString() }));
  }
  ```

- **Lists that are only displayed** need no tracking. Call `findMany` and `count` directly and map each result with the mapper's `toDomain`, without a repository or a unit of work.

### Versions

- **Format.** The version is a number stored in the `_version` field of the root document, or in `versionField` if you set it. An insert writes version 1, and every checked write increments it with `$inc`.
- **Documents without a version.** A root document without the field, for example one written before this package was used, reads as version 0. A write expecting version 0 matches a missing or `null` field and sets it to 1, so existing data needs no migration.
- **Conflicts.** When `apply` or `delete` expects a version and the root document no longer has it, they throw `ConcurrencyConflictError` before writing anything else. The transaction rolls back, and `retryOnConflict` from the core package can run the use case again.
- **Aggregates across collections.** The version write on the root document also serializes use cases that change only the children. While one transaction has written the root document, MongoDB answers a second one with a transient `WriteConflict`, and `withTransaction` retries it. Once the first commits, the retry no longer matches the old version and fails with `ConcurrencyConflictError`.
- **Unconditional deletes.** `delete` with no expected version, which is what `remove()` on an entity you didn't load produces, deletes the root and its children whatever the version, and succeeds even if nothing exists.

### What each write does

All writes pass the transaction's session.

| Call | Root collection | Child collections |
| --- | --- | --- |
| `apply`, insert (`expectedVersion` undefined) | `insertOne` of the record with `_version: 1` | `bulkWrite` of `insertOne` per record |
| `apply`, update | `updateOne({ _id, _version }, { $set, $unset, $inc })`; `$set` and `$unset` are left out when empty | `bulkWrite`: `deleteOne`, then `insertOne`, then `updateOne` with `$set`/`$unset` |
| `delete` | `deleteOne({ _id })`, with `_version` in the filter when one is expected | `deleteMany({ [aggregateIdField]: id })` |

Driver errors, such as a duplicate key (code 11000) from a unique index, reach the caller unchanged, and the transaction rolls back.

### Transactions

Run the unit of work with `MongoTransactionManager` from [`@enardo/transaction-manager-mongo`](../transaction-manager-mongo/README.md), and declare its context on the unit of work: `new UnitOfWork<IMongoTransaction>(transactionManager)`. Every write of the store passes the transaction's session, so the writes of all repositories commit or roll back together. That package's README covers the transaction options and retries.

### Limits

- **Custom finders return one aggregate.** `Repository` tracks query results through `findOneBy` only. Lists that a write depends on have to be loaded one aggregate at a time.
- **The root record keeps its id.** On an update, only the root record's `$set` and `$unset` are written. A mapper that changes the root's `_id` for the same identity loses that change.
- **A replace restarts the version.** `remove` followed by `add` of the same identity writes version 1 again. A use case that read version 1 before several later updates could then pass the check. This needs a long-running use case, and is unlikely with one unit of work per request.
- **No standalone server.** Transactions and snapshot reads need a replica set or a sharded cluster.

### Errors

The package adds two errors. Both extend [`BaseError`](../errors/src/base/base-error.ts) from `@enardo/errors`. The core errors, such as `ConcurrencyConflictError`, are described in the [core README](../uow-repository/README.md#errors).

| Class | `code` | `details` | Raised when |
| --- | --- | --- | --- |
| `InvalidDataStoreOptionsError` | `INVALID_DATA_STORE_OPTIONS` | `{ roots }`: the names of the collections marked as root | The `MongoDataStore` constructor finds no root collection, or more than one |
| `MissingCollectionChangesError` | `MISSING_COLLECTION_CHANGES` | `{ collection }`: the collection with no entry | `apply` gets a change set without an entry for a mapped collection; a `ChangeSet` must carry every collection, even those with nothing to write |

## Contributing

### Setup

```sh
pnpm install
pnpm exec turbo run build --filter=@enardo/uow-repository-mongo^...   # the tests import the core package from its dist/
cd packages/uow-repository-mongo
pnpm test
```

The tests run against a real single-node replica set. The global setup of `mongoReplicaSet()` from `@enardo/vitest-config` starts it with `mongodb-memory-server`, once per run, and every test uses a database of its own. The first run downloads a `mongod` binary.

### Commands

Run these inside `packages/uow-repository-mongo`.

| Command | What it does |
| --- | --- |
| `pnpm test` | Integration tests (Vitest) against the in-memory replica set |
| `pnpm test:watch` | Tests in watch mode |
| `pnpm typecheck` | `tsc --noEmit` over `src` and `__tests__` |
| `pnpm lint` / `pnpm lint:fix` | ESLint |
| `pnpm format` / `pnpm format:check` | Prettier |
| `pnpm build` | Cleans `dist/` and builds ESM with `.d.mts` types (tsdown) |
| `pnpm dev` | Build in watch mode |

### Layout

```text
src/
  index.ts                      public API: anything not exported here is internal
  mongo-data-store.ts           MongoDataStore and its option types
  errors/                       one BaseError subclass per file
__tests__/
  support/fixtures.ts           client, per-test database, the `mongoUri` declaration, record types and stores
  mongo-data-store.test.ts      the DataStore contract, called directly
  repository-with-mongo.test.ts Repository and UnitOfWork end to end
```

### Conventions

- The conventions of the [core package](../uow-repository/README.md#conventions) apply: public API through `src/index.ts`, one error per file, doc comments that explain why.
- Write the test first, against the replica set. Don't mock the driver: filters, `$inc`, sessions and rollbacks are what these tests check.
- Commit messages follow `[@enardo/uow-repository-mongo] <summary>`.
- When a change alters behavior described here, update this README in the same commit.

### Before opening a pull request

```sh
pnpm format && pnpm lint && pnpm typecheck && pnpm test
```

Open the pull request against `main`.
