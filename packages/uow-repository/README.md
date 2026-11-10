# @enardo/uow-repository

Save domain aggregates without writing save logic. You load entities through a `TrackingRepository` and change them like plain objects. A `TransactionalUnitOfWork` then writes only the records and fields that changed, across every repository, in one transaction.

```ts
await unitOfWork.execute(async () => {
  const keyboard = await products.findById("p-1");
  if (keyboard) keyboard.price = 39.9; // no save(), no markDirty()

  await products.add({ id: "p-2", name: "Mouse", price: 19.9 });
});
// Committed in one transaction: an update of p-1 that sets only `price`, and an insert of p-2.
```

> Published to the `@enardo` registry, version 0.3.0: the API can still change. The package ships no database adapters: install an adapter package for your database, or write a `DataStore` and a `TransactionManager` for your driver.

## Contents

- [Why it exists](#why-it-exists)
- [Quick start](#quick-start)
- [Configuration and usage](#configuration-and-usage)
- [Upgrading from 0.2](#upgrading-from-02)
- [Upgrading from 0.1](#upgrading-from-01)
- [Contributing](#contributing)

## Why it exists

Hand-written persistence code in use cases runs into the same problems again and again:

- **Save calls leak into business logic.** Each use case has to remember which entities it touched and save each one. Here the repository tracks what you load, and the unit of work finds what changed.
- **Changes to several aggregates aren't atomic.** Here, writes from every registered repository run in one transaction, or none of them do.
- **Whole aggregates get rewritten.** An aggregate can span several collections or tables, such as a group and its members. Here it is written as a diff: new records are inserted, missing ones are deleted, and changed records get only their changed top-level fields.
- **Domain code learns the storage schema.** Here a `Mapper` keeps entities free of storage shapes, so they can be classes with private state.
- **Concurrent edits overwrite each other silently.** Here every write checks the version the aggregate had when it was loaded. If someone else changed it in between, the use case fails with `ConcurrencyConflictError` and can run again.

The work is split between the package and your code:

| Piece | Written by | Job |
| --- | --- | --- |
| `TrackingRepository` | this package | Loads entities, keeps one instance per identity, and plans writes by comparing each entity with a snapshot of its records |
| `TransactionalUnitOfWork` | this package | Runs your use case, collects the planned writes of every registered repository, and runs them in one transaction |
| `Mapper` | you | Converts an entity to and from its records, and reads its identity |
| `DataStore` | you | Reads records with their version, and applies changes after checking the version, with your database driver |
| `TransactionManager` | you, or an adapter package | Opens, commits and rolls back a transaction with your driver. The contract comes from [`@enardo/transaction-manager`](../transaction-manager/README.md). |

## Quick start

You need Node.js 24, pnpm 11, and access to the `@enardo` registry (`https://npm.enriconardo.com`, which needs a token to read). You'll wire a repository over an in-memory store, and watch the writes it produces.

**1. Install the packages** in the package that will use them.

```sh
pnpm add @enardo/transaction-manager @enardo/uow-repository
```

**2. Save this as `quickstart.mts`** in that package.

```ts
import type {
  Transaction,
  TransactionManager,
} from "@enardo/transaction-manager";
import {
  ConcurrencyConflictError,
  TrackingRepository,
  TransactionalUnitOfWork,
  type DataStore,
  type Mapper,
  type VersionedRecords,
} from "@enardo/uow-repository";

// 1. The entity, and the records that store it: one array per collection.
interface Product {
  id: string;
  name: string;
  price: number;
}

interface ProductRecord {
  _id: string;
  name: string;
  price: number;
}

interface ProductRecords {
  products: [ProductRecord];
}

// 2. Mapper: converts between the entity and its records.
const productMapper: Mapper<Product, ProductRecords, string> = {
  toDomain: ({ products: [record] }) => ({
    id: record._id,
    name: record.name,
    price: record.price,
  }),
  toRecords: (product) => ({
    products: [{ _id: product.id, name: product.name, price: product.price }],
  }),
  identity: (product) => product.id,
};

// 3. DataStore: reads and writes records, and checks versions.
//    A Map stands in for the database.
interface Row {
  record: ProductRecord;
  version: number;
}

const table = new Map<string, Row>([
  ["p-1", { record: { _id: "p-1", name: "Keyboard", price: 49.9 }, version: 1 }],
]);

const toVersionedRecords = (row: Row): VersionedRecords<ProductRecords, number> => ({
  records: { products: [structuredClone(row.record)] },
  version: row.version,
});

const productStore: DataStore<ProductRecords, string, Transaction> = {
  recordKeys: { products: (record) => record._id },
  async findById(id) {
    const row = table.get(id);
    return row ? toVersionedRecords(row) : null;
  },
  async findAll() {
    return [...table.values()].map(toVersionedRecords);
  },
  async apply({ id, expectedVersion, changes }, transaction) {
    console.log(
      transaction.id,
      `expected version: ${expectedVersion ?? "none"}`,
      JSON.stringify(changes.products),
    );
    const row = table.get(id);
    // Compare and set: the stored version must still be the one that was read.
    if (row?.version !== expectedVersion) {
      throw new ConcurrencyConflictError(id, expectedVersion);
    }
    // A product is one record: either inserted whole, or updated field by field.
    // ProductRecord has no optional fields, so `unset` is always empty here.
    const [inserted] = changes.products.inserted;
    const [updated] = changes.products.updated;
    const record = inserted ?? { ...row!.record, ...updated.set };
    table.set(id, { record, version: (expectedVersion ?? 0) + 1 });
  },
  async delete(id, expectedVersion) {
    if (expectedVersion !== undefined && table.get(id)?.version !== expectedVersion) {
      throw new ConcurrencyConflictError(id, expectedVersion);
    }
    table.delete(id);
  },
};

// 4. TransactionManager: runs the writes in a transaction. This one only hands out an id.
let transactions = 0;
const transactionManager: TransactionManager = {
  async runInTransaction(work) {
    return work({ id: `tx-${++transactions}` });
  },
};

// 5. Wire them up: one unit of work, with its repositories, per use case.
function createContext() {
  const products = new TrackingRepository(productStore, productMapper);
  const unitOfWork = new TransactionalUnitOfWork(transactionManager);
  unitOfWork.register(products);
  return { products, unitOfWork };
}

// 6. Run a use case.
const { products, unitOfWork } = createContext();
await unitOfWork.execute(async () => {
  const keyboard = await products.findById("p-1");
  if (keyboard) keyboard.price = 39.9; // a plain mutation: no save(), no markDirty()

  await products.add({ id: "p-2", name: "Mouse", price: 19.9 });
});
```

**3. Run it.** Node.js 24 runs TypeScript files directly.

```sh
node quickstart.mts
```

```text
tx-1 expected version: 1 {"inserted":[],"updated":[{"record":{"_id":"p-1","name":"Keyboard","price":39.9},"set":{"price":39.9},"unset":[]}],"deleted":[]}
tx-1 expected version: none {"inserted":[{"_id":"p-2","name":"Mouse","price":19.9}],"updated":[],"deleted":[]}
```

What happened:

- `findById` loaded p-1 at version 1 and kept a snapshot of its record. Changing `price` needed no extra call.
- When the use case finished, the repository compared p-1 with its snapshot and planned an update whose `set` holds only `price`, expected to still be at version 1. It planned p-2 as an insert, with no version to check.
- Both writes ran in the same transaction, `tx-1`. p-1 is now at version 2, and p-2 at version 1.

Next, replace the `Map` with your database: an adapter package, or a `DataStore` of your own that follows the [DataStore contract](#datastore-contract).

## Configuration and usage

There are no config files or environment variables. Everything is wired in code:

```ts
const repository = new TrackingRepository(dataStore, mapper, options); // options is optional
const unitOfWork = new TransactionalUnitOfWork(transactionManager, unitOfWorkOptions); // unitOfWorkOptions is optional
unitOfWork.register(repository);
```

| Argument | Type | Required |
| --- | --- | --- |
| `dataStore` | `DataStore<TRecords, TId, TContext, TVersion>`. `TVersion` defaults to `number`. | yes |
| `mapper` | `Mapper<TDomain, TRecords, TId, TStoredId>`. `TStoredId` defaults to `TId` (see [Stored identities](#stored-identities)). | yes |
| `options.identityKey` | `(id: TId) => string` | only when `TId` isn't a `string`, `number`, `bigint` or `boolean` (see [Composite identities](#composite-identities)) |
| `options.pullEvents` | `(aggregate: TDomain) => readonly TEvent[]` | only to collect domain events (see [Domain events](#domain-events)) |
| `transactionManager` | `TransactionManager<TContext>` from `@enardo/transaction-manager` | yes |
| `unitOfWorkOptions.onEvents` | `(events: readonly TEvent[], context: TContext) => void \| Promise<void>` | only when a repository collects events (see [Domain events](#domain-events)) |

The contracts, with doc comments, are defined in [`src/data-store.ts`](src/data-store.ts), [`src/mapper.ts`](src/mapper.ts), [`src/record-set.ts`](src/record-set.ts) and [`src/repository.ts`](src/repository.ts). The transaction contracts are in [`@enardo/transaction-manager`](../transaction-manager/README.md).

### Scope: one unit of work per use case

A `TransactionalUnitOfWork` can be used once. Create one, with its repositories, for each request or use case. `DataStore`, `Mapper` and transaction manager implementations hold no state and can be shared.

```ts
// Shared adapters, created once.
const productStore = new MongoDataStore<ProductRecords, string>({
  client,
  collections: { products: { collection: db.collection("products"), root: true } },
});
const transactionManager = new MongoTransactionManager(client);

// Created for each request.
export function createProductContext() {
  const products = new TrackingRepository(productStore, productMapper);
  const unitOfWork = new TransactionalUnitOfWork(transactionManager);
  unitOfWork.register(products);
  return { products, unitOfWork };
}
```

When `execute()` ends, whether it succeeded or failed, the unit of work clears every registered repository:

- **Nothing is cached between use cases.** The next read queries the store again.
- **Entities returned from `execute()` are detached.** Editing one has no effect, and passing one to `add` plans an insert. To change an entity, load it again in a new use case:

  ```ts
  const first = createProductContext();
  const product = await first.unitOfWork.execute(() =>
    first.products.findById("p-1"),
  );
  product!.price = 10; // detached: never written

  const second = createProductContext();
  await second.unitOfWork.execute(async () => {
    const product = await second.products.findById("p-1");
    if (product) product.price = 10; // written on commit
  });
  ```

- **A second `execute()` rejects** with a native `Error`: after the first call has finished, and also while it is still running (a nested or concurrent call). The work of the rejected call doesn't run.

Register each repository on exactly one unit of work. Give application code the narrower interfaces: `Repository<TDomain, TId>` for repositories, and `UnitOfWork` for the unit of work, which hides the transaction context type.

### Records and record keys

A record set holds every record of one aggregate, with one array per collection or table. An aggregate stored as a single record has one collection holding one record. This one is stored in two collections:

```ts
interface GroupRecords {
  groups: [GroupRecord]; // one record for the group
  members: MemberRecord[]; // one record per member
}

const recordKeys: RecordKeys<GroupRecords> = {
  groups: (group) => group._id,
  members: (member) => member._id, // e.g. JSON.stringify([groupId, userId])
};
```

`recordKeys` belongs to the `DataStore`, and it tells the diff how to match records. Each record key must be:

- **Unique within its collection.** Otherwise every commit fails with a native `Error`, even in use cases that only read.
- **Stable.** A record whose key changes is written as a delete plus an insert. A common cause is a key the mapper returns in another form than the store's (an `ObjectId` read back as a string): the stored record is deleted and the mapper's is inserted.
- **Known before the record is written.** Use ids your application assigns, or natural keys. An id the database generates on insert never reaches the snapshot.

A stored record whose key the mapper does not return is deleted on the next commit, so a child `toDomain` filters out (a soft-deleted one) belongs in the entity.

List every collection in `recordKeys`. A listed collection that a record set lacks fails with a `TypeError`. A collection you don't list is never compared, so its changes are silently not written.

Records hold data: primitives, plain objects, arrays, `Map`, `Set`, `Date`, `RegExp` and binary data, which the repository copies, plus instances of value classes such as a driver's `ObjectId` or `Decimal128`, which it keeps as they are, with their prototype. Treat those instances as immutable: one mutated in place changes the snapshot too, so the change is never written. Nested objects and arrays are compared and written as a whole. If array elements have their own identity, store them in a collection of their own, as `members` does above. For a full two-collection example, see the "entities stored across collections" tests in [`__tests__/repository.test.ts`](__tests__/repository.test.ts).

### Mapper rules

- **Round-trip.** `toRecords(toDomain(records))` must reproduce the records the store returns: the same keys, and for the fields it returns, top-level values that are deeply equal. Fields set to `undefined` and the order of records don't matter. Otherwise every entity you only read looks edited and is written again on each commit. What is compared is the fields `toRecords` returns, with the values the store holds for them. A field it never returns is never written (unless `toRecords` fails on the entity at load and the use case repairs it: the commit then unsets every field the mapper does not return), so a field the store or another writer sets on its own (`createdAt`, `__v`) needs no place in the entity. A field the store reads back but never writes itself, such as a child's link to its aggregate, is still the mapper's to return. Defaults, trimming and lossy conversions (dates that lose information) still show as a write on the first commit after a load, until they are stored. A top-level field is compared whole: a nested field `toDomain` drops, or another writer adds, is lost on the first commit after a load, even in a use case that only reads.
- **Stable identity.** `identity(entity)` must return the same value for the whole life of the entity.
- **One conversion for the identity.** When the store holds the identity in another form, `toStoredId` and `toRecords` must agree: write the conversion once and call it from both.

A short test catches round-trip bugs:

```ts
it("round-trips stored records", async () => {
  const products = new TrackingRepository(productStore, productMapper);
  await products.findById("p-1");
  expect(products.hasPendingChanges()).toBe(false);
});
```

### DataStore contract

The repository relies on these rules, and the compiler can't check them:

- **Return every collection on reads**, as an empty array when the aggregate has no records in it.
- **Read all collections of one aggregate from one consistent state**, with a single query or a session with snapshot isolation. Otherwise a mix of two versions can be written back. Reads get no transaction context, so they run outside the unit of work's transaction.
- **Return fresh objects.** Database drivers already do. An in-memory store must copy, which is why the quick start calls `structuredClone`.
- **Pass the context to every write** (`apply`, `delete`), so the write joins the transaction.
- **`apply` works field by field.** For each collection it inserts `inserted`, deletes `deleted`, and for each entry in `updated` sets the fields in `set` and removes the fields in `unset`. Never write `record` whole: it lacks the fields the mapper does not return. Order writes across collections as your schema needs, for example parents before children on insert.
- **`delete(id)` removes every record of the aggregate** in every collection, found by identity. The aggregate may never have been loaded.
- **Identities arrive in the stored form.** `findById`, `apply` and `delete` receive the identity already converted by the mapper's `toStoredId`, so a store never converts identities itself.
- **Return the version beside the records, never inside them**, for example by stripping a `version` field from the document. The mapper must not see it.
- **Check and advance the version in one atomic write** when `expectedVersion` is set, in `apply` and in `delete`. Use a conditional write inside the transaction, such as `updateOne({ _id, version })` in MongoDB or `UPDATE ... WHERE id = ? AND version = ?` in SQL. Do it before any other write of the aggregate, and even when the record holding the version has no change of its own. If nothing matched, throw `ConcurrencyConflictError`. In MySQL, count matched rows rather than changed rows, or rely on the version write always changing the row.
- **Choose the version format.** The library never computes a version: it only hands back the one it read. A number (`expectedVersion + 1`), an ETag or a timestamp all work. Set `TVersion` accordingly. Give inserted aggregates a first version.
- **Duplicates and missing records are yours to handle.** The repository never checks the store, so `apply` can receive an insert for a key that already exists, and `delete` an id that doesn't. Whatever your store does in those cases is what the use case gets.

### Transaction manager contract

The contract is `TransactionManager` from `@enardo/transaction-manager`. The unit of work relies on these rules:

- Commit when `work` resolves. Roll back and rethrow when it rejects.
- Resolve only after the commit succeeded, because `execute()` reports success as soon as `runInTransaction` resolves.
- `work` may be called again after a transient error, as MongoDB's `withTransaction` does. That is safe: planned writes use data computed beforehand, and each run gets a fresh copy of the changes.

### Custom finders

`TrackingRepository` loads entities only by identity. To find one by another criterion, such as a unique field, extend it and pass your store's query to the protected `findOneBy`:

```ts
interface UserRepository extends Repository<User, string> {
  findByEmail(email: string): Promise<User | null>;
}

class UserStoreRepository
  extends TrackingRepository<User, UserRecords, string, Transaction>
  implements UserRepository
{
  constructor(private readonly store: UserStore) {
    super(store, userMapper);
  }

  findByEmail(email: string): Promise<User | null> {
    // store.findByEmail is your own store method, returning VersionedRecords or null.
    return this.findOneBy(() => this.store.findByEmail(email));
  }
}
```

`findOneBy` tracks what the query returns exactly as `findById` does, so edits to the entity are written on commit against the version read:

- An identity already tracked resolves to the in-memory instance, with its edits, and the fresh content is ignored.
- An identity tracked as removed resolves to `null`.
- An entity added in this unit of work but not yet written is never found: the query runs against the store, and its criteria can't be checked in memory.

Use custom finders for the lookups a write depends on. Paginated lists that are only displayed don't need tracking: read them from the database directly.

### Stored identities

The domain and the store may hold an identity in different forms, such as a value object in the domain and an ObjectId in the store. The mapper converts between them with `toStoredId`, and the repository is the boundary: callers and the change tracker use the domain identity, and the store receives the stored one.

```ts
const toStoredId = (id: ProductId) => new ObjectId(id.value);

const productMapper: Mapper<Product, ProductRecords, ProductId, ObjectId> = {
  toDomain: ({ products: [record] }) => ({
    id: new ProductId(record._id.toHexString()),
    name: record.name,
  }),
  toRecords: (product) => ({
    products: [{ _id: toStoredId(product.id), name: product.name }],
  }),
  identity: (product) => product.id,
  toStoredId,
};

const products = new TrackingRepository(productStore, productMapper, {
  identityKey: (id) => id.value,
});
```

- **Required only when the forms differ.** The compiler requires `toStoredId` when `TStoredId` is another type than `TId`. Leave both type arguments equal, and the method out, when the store keeps the identity as it is.
- **Converted while planning.** The repository converts the identities of a flush while it plans the writes, so an identity that can't be converted fails the commit before its transaction opens.
- **Errors carry the stored form.** A `ConcurrencyConflictError` thrown by the store reports the identity it received.

### Composite identities

Identities that are a `string`, `number`, `bigint` or `boolean` work as they are. `"1"` and `1` count as different identities. For any other identity, which rejects with a `TypeError` without one, pass an `identityKey` option, a function that never maps two ids to the same string:

```ts
const orders = new TrackingRepository(orderStore, orderMapper, {
  identityKey: (id) => JSON.stringify([id.accountId, id.orderNumber]),
});
```

Prefer a serialized tuple to string concatenation: `` `${accountId}:${orderNumber}` `` can give two different ids the same key when a value contains `:`.

### What gets written

| In `execute(work)` you… | On commit the store receives… | `expectedVersion` |
| --- | --- | --- |
| `add(entity)` | `apply` with every record in `inserted` | `undefined` |
| change an entity you loaded | `apply` with only the changed records and fields, or no write at all if nothing changed | the version read |
| `remove(entity)` after loading it | `delete` | the version read |
| `remove(entity)` without loading it | `delete` | `undefined`: the delete is unconditional |
| `add` and then `remove` the same entity | no write | none |
| `add` an identity that is already new, loaded or removed | nothing: `add` rejects with a native `Error` | none |

- **Reads.** `findById` returns the tracked instance without querying the store when the identity is already tracked. `findAll` always queries the store, but returns the tracked instances for identities it already knows, drops removed entities, and appends added ones. A tracked identity keeps the version of its first read, because its in-memory state is based on that read.
- **Change detection.** A snapshot is a deep copy with `undefined` fields dropped, and holding, of each stored record, only the fields the mapper returns for the entity as loaded, with the values the store returned. A stored record the mapper does not return is kept whole, and so is every record when `toRecords` fails on the entity at load. Class instances, such as an `ObjectId`, are kept rather than copied, so they reach the store with their prototype. On commit, every loaded entity is mapped again and compared with its snapshot: records by key, and top-level fields with `isDeepStrictEqual`. Each check maps, copies and compares every loaded entity. `hasPendingChanges()` runs the same comparison and is useful for "unsaved changes" warnings.
- **Write order.** Repositories run in registration order. Within a repository, writes run in the order identities were first tracked, not grouped by kind. If a unique index or foreign key depends on the order, load or remove the old entity before adding the new one.

### Concurrent use cases

Reads run outside the transaction, so another use case can change an aggregate between your read and your commit. The version check turns that into an error instead of a silent overwrite. The losing use case fails with `ConcurrencyConflictError`, its transaction rolls back, and its repositories are cleared as after any failure.

Continuing the quick start, Bob changes p-1 while Alice's use case is still running:

```ts
const alice = createContext();
const bob = createContext();

await alice.unitOfWork
  .execute(async () => {
    const keyboard = await alice.products.findById("p-1"); // version 2

    await bob.unitOfWork.execute(async () => {
      const same = await bob.products.findById("p-1"); // version 2
      if (same) same.price = 29.9;
    }); // Bob commits first: p-1 is now at version 3

    if (keyboard) keyboard.name = "Keyboard Pro";
  })
  .catch((error: Error) => console.log(error.name));
```

```text
tx-2 expected version: 2 {"inserted":[],"updated":[{"record":{"_id":"p-1","name":"Keyboard","price":29.9},"set":{"price":29.9},"unset":[]}],"deleted":[]}
tx-3 expected version: 2 {"inserted":[],"updated":[{"record":{"_id":"p-1","name":"Keyboard Pro","price":39.9},"set":{"name":"Keyboard Pro"},"unset":[]}],"deleted":[]}
ConcurrencyConflictError
```

To recover, run the whole use case again with `retryOnConflict`. Each attempt must create its own unit of work and repositories, so that it reads the current version:

```ts
import { retryOnConflict } from "@enardo/uow-repository";

await retryOnConflict(async () => {
  const { products, unitOfWork } = createContext();
  await unitOfWork.execute(async () => {
    const keyboard = await products.findById("p-1");
    if (keyboard) keyboard.name = "Keyboard Pro";
  });
});
```

- It makes 3 attempts by default. Change that with `{ attempts }`. It passes the attempt number to your function, starting at 1.
- Only `ConcurrencyConflictError` triggers another attempt. Any other error is rethrown at once, and the last conflict is rethrown when the attempts run out.
- Attempts run back to back, with no delay.
- Everything in your function runs again, so send emails or call other services after the unit of work has committed, not inside `work`.

What the version check doesn't cover:

- **Aggregates you only read.** Only aggregates that are written get checked. A decision about aggregate B based on aggregate A isn't protected if A doesn't change.
- **Removing without loading.** `remove(entity)` on an entity you didn't load deletes it whatever its version. Load it first if the delete depends on its state.
- **Rules across aggregates**, such as a unique username. Enforce them with database constraints.

### Domain events

An aggregate decides its own domain events, and the unit of work hands them over inside the transaction, so an outbox row commits or rolls back with the aggregate's write. The package knows nothing of how an aggregate queues them: tell the repository how to take them with the `pullEvents` option, and the unit of work where to put them with `onEvents`.

```ts
const products = new TrackingRepository(productStore, productMapper, {
  pullEvents: (product) => product.pullEvents(), // takes the events and empties the aggregate's queue
});

const unitOfWork = new TransactionalUnitOfWork(transactionManager, {
  onEvents: async (events: readonly ProductEvent[], ctx) => {
    // ctx is the transaction: write the events with it, for example into an outbox table.
    await outbox.insert(events, ctx);
  },
});
unitOfWork.register(products);
```

- **When.** At commit, before the transaction opens, the unit of work pulls the events of every participant, in registration order. Inside the transaction it runs the writes, then calls `onEvents(events, ctx)` once, when there is at least one event. A commit with events and no write still opens a transaction.
- **Which aggregates.** Every aggregate the repository tracks: new, loaded and unchanged, changed or removed. An aggregate may raise an event with no change of persisted state. One added and then removed in the same unit of work gives no event, since it never reached the store.
- **Order.** Tracking order, as for the writes, and within an aggregate the order of its queue.
- **Retries.** The events are pulled once, before the transaction, so a transaction the transaction manager runs again hands `onEvents` the same events. A use case retried with `retryOnConflict` runs again on fresh aggregates.
- **Failures.** An error of `onEvents` rolls the transaction back, and `execute()` rethrows it. An error of `pullEvents` fails the commit before any transaction opens.
- **No hook.** If events are collected and the unit of work has no `onEvents`, the commit throws an `Error` before the transaction opens, rather than dropping them.
- **`hasPendingChanges()`** counts only the store writes the repositories plan: reading an aggregate's queue empties it, so events are not counted.
- **The hook may be synchronous.** The unit of work awaits the result either way.

Both classes take the event type as their last type argument, `TEvent`, which defaults to `never`. TypeScript infers `TEvent` only from an annotated `events` parameter of `onEvents` (as above); otherwise it falls back to `never` and `register` refuses the repository, so give both type arguments. It infers no type argument once you give one, so a unit of work that names its context (as the Mongo adapter's does) names `TEvent` too, and `register` refuses a repository whose events are not part of it:

```ts
const unitOfWork = new TransactionalUnitOfWork<Transaction, ProductEvent>(transactionManager, {
  onEvents,
});
```

A subclass with custom finders that wants events writes every type argument up to `TEvent`:

```ts
class ProductStoreRepository extends TrackingRepository<
  Product,
  ProductRecords,
  string,
  Transaction,
  number, // TVersion
  string, // TStoredId
  ProductEvent
> {
  constructor(store: ProductStore) {
    super(store, productMapper, { pullEvents: (product) => product.pullEvents() });
  }
}
```

### Failures and rollback

If anything fails, whether your `work`, a write or the commit, `execute()` clears the repositories as it always does and rethrows the original error:

- Pending changes are discarded, including those made before `execute()` was called.
- Clearing only resets memory. Rolling back the database is the transaction manager's job.
- To retry, create a new unit of work and new repositories, and run the whole use case again.

### Errors

Errors a caller may handle by `code` extend [`BaseError`](../errors/src/base/base-error.ts) from `@enardo/errors` and carry a `code` and `details`. Errors thrown by your adapters or mapper reach the caller unchanged.

| Class                      | `code`                 | `details`                                               | Raised when                                                                                                                      |
| -------------------------- | ---------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `ConcurrencyConflictError` | `CONCURRENCY_CONFLICT` | `{ id, expectedVersion }`, with `id` in its stored form | Thrown by your `DataStore` when the stored version differs from the one read. See [Concurrent use cases](#concurrent-use-cases). |

A misuse is a fault in the caller's code, which it fixes rather than handles: it throws a native error, with no `code`.

| Type         | Raised when                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------------- |
| `Error`      | `execute()` is called again on the same unit of work, including while the first call is running |
| `Error`      | Repositories collected domain events and the unit of work has no `onEvents` option              |
| `TypeError`  | An identity isn't a `string`, `number`, `bigint` or `boolean`, and no `identityKey` was given   |
| `TypeError`  | A record set lacks a collection listed in `recordKeys`, or the collection isn't an array        |
| `Error`      | Two records of one collection share a key                                                       |
| `Error`      | `add()` targets an identity already tracked as new, clean or removed (the promise rejects)     |
| `RangeError` | `retryOnConflict` gets a bad `attempts`                                                         |

The messages of the record sets name the side at fault: `previous` is the snapshot, `next` the records the mapper produced.

## Upgrading from 0.2

The third argument of `TrackingRepository` is now an options object, so the positional `identityKey` moves into it:

```ts
// 0.2
new TrackingRepository(store, mapper, (id) => id.value);
// 0.3
new TrackingRepository(store, mapper, { identityKey: (id) => id.value });
```

`add` of an identity removed in the same unit of work no longer replaces it: it rejects with an `Error`, as over a new or clean one. Remove-then-add (a delete, then an insert, restarting the version at 1) is gone, `FlushUnit.kind` loses `"replace"` and `EntityState` loses `"replaced"`. Update the loaded entity instead.

`pullEvents` and `onEvents` are optional and add the type parameter `TEvent`, which defaults to `never`; see [Domain events](#domain-events). A participant of your own needs no change: its `pullEvents` member is optional.

## Upgrading from 0.1

A field `toRecords` never returns is no longer compared, so it is no longer unset on commit. An app that removed a field by leaving it out of `toRecords` now keeps it in the store: remove it with a migration of the stored documents, since a field `toRecords` returns as `undefined` is absent from both sides of the diff.

`UnitOfWorkAlreadyUsedError`, `UnsupportedIdentityError`, `InvalidRecordSetError`, `DuplicateRecordKeyError` and `DuplicateEntityError` are removed, with their codes (`UOW_ALREADY_USED`, `UNSUPPORTED_IDENTITY`, `INVALID_RECORD_SET`, `DUPLICATE_RECORD_KEY`, `DUPLICATE_ENTITY`). Each misuse now throws a native error with the same message. A caller that read a `code` fixes the cause instead: the call, the mapper, the aggregate's invariant or the stored data.

The `I` prefix is gone, and the contracts take the plain names, so the classes take a qualifier:

| 0.1 | 0.2 |
| --- | --- |
| class `Repository` | class `TrackingRepository` |
| class `UnitOfWork` | class `TransactionalUnitOfWork` |
| `IRepository` | `Repository` |
| `IUnitOfWork` | `UnitOfWork` |

`@enardo/transaction-manager` `^2.0.0` is the dependency: its `ITransaction` and `ITransactionManager` are now `Transaction` and `TransactionManager`.

Rename the classes first, then the contracts. Renaming `IRepository` to `Repository` first merges it with the class, and the next rename would hit both. A use of the class that is left behind fails to compile (`import { Repository }` with `verbatimModuleSyntax`, `extends Repository<…>`, `new UnitOfWork()`). The one form that still compiles is a `UnitOfWork` type with no type argument, which is now the contract: it keeps `execute` and `hasPendingChanges`, and has no `register`. Application code that held `IUnitOfWork` or `IRepository` takes the new `UnitOfWork` or `Repository`, never the classes.

## Contributing

### Setup

```sh
pnpm install
pnpm exec turbo run build --filter=@enardo/uow-repository   # the tests import @enardo/errors from its dist/
cd packages/uow-repository
pnpm test
```

### Commands

Run these inside `packages/uow-repository`.

| Command | What it does |
| --- | --- |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm test:watch` | Unit tests in watch mode |
| `pnpm typecheck` | `tsc --noEmit` over `src` and `__tests__` |
| `pnpm lint` / `pnpm lint:fix` | ESLint |
| `pnpm format` / `pnpm format:check` | Prettier |
| `pnpm build` | Cleans `dist/` and builds ESM with `.d.mts` types (tsdown) |
| `pnpm dev` | Build in watch mode |

### Layout

```text
src/
  index.ts            public API: anything not exported here is internal
  repository.ts       TrackingRepository, Repository: reads, tracking, flush planning
  unit-of-work.ts     TransactionalUnitOfWork, FlushUnit, UnitOfWorkParticipant
  change-tracker.ts   identity map and entity states
  record-set.ts       record set types, diffRecordSets, restrictToMappedFields (internal)
  snapshot.ts         toSnapshot, copyData (internal): deep copies that keep class instances
  identity-key.ts     identityKeyOf
  retry-on-conflict.ts  retryOnConflict
  data-store.ts       DataStore, VersionedRecords and AggregateWrite contracts
  mapper.ts           Mapper contract
  errors/             one BaseError subclass per file
__tests__/            one *.test.ts per module; support/ holds shared helpers
```

### Conventions

- Export public API from `src/index.ts`, and export types with `export type`.
- A new error extends `BaseError` when a caller may handle it by `code`; a misuse throws a native error. Put each `BaseError` in `src/errors/<name>.error.ts`. It extends `BaseError` with a `name`, an upper-snake-case `code` declared with `declare readonly code: "<CODE>"` (a code belongs to one class across packages) and `details`, and is re-exported from `src/errors/index.ts`. Add it to the [Errors](#errors) table.
- In tests, import sources through the `~/` alias, e.g. `import { TrackingRepository } from "~/repository"`.
- `hasPendingChanges()` must always agree with `planFlush()`, and a test checks it.
- Doc comments explain why code behaves as it does, not only what it does. See [`src/snapshot.ts`](src/snapshot.ts).
- Commit messages follow `[@enardo/uow-repository] <summary>`.
- When a change alters behavior described here, update this README in the same commit.

### Before opening a pull request

```sh
pnpm test && pnpm typecheck && pnpm lint && pnpm format:check
```

Open the pull request against `main`.
