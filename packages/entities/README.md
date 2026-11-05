# @enardo/entities

Domain-model building blocks for DDD-style applications: `Entity`, `AggregateRoot`, and `EntityId`.

## Contents

- [Overview](#overview)
- [Installation](#installation)
- [Core concepts](#core-concepts)
  - [EntityId](#entityid)
  - [Entity](#entity)
  - [AggregateRoot](#aggregateroot)
- [Lifecycle events](#lifecycle-events)
- [Mutation hooks](#mutation-hooks)
- [Errors](#errors)
- [Upgrading from 1.x](#upgrading-from-1x)
- [Scripts](#scripts)

---

## Overview

The package enforces three DDD invariants out of the box:

1. **Identity** — entities are compared by type + identifier, never by value.
2. **Immutability** — attribute objects are deeply frozen on construction and on every `setAttribute` call.
3. **Encapsulated mutation** — state changes are made through `setAttribute` and `setAttributes`, which handle timestamp updates and lifecycle guards, leaving the door open for domain-event queuing through override hooks.

---

## Installation

The package is published to the `@enardo` registry (`https://npm.enriconardo.com`, which needs a token to read):

```sh
pnpm add @enardo/entities
```

---

## Core concepts

### EntityId

A frozen value object that wraps a non-empty string identifier.

```ts
import { EntityId } from "@enardo/entities";

const id = EntityId.create("user-abc-123");

id.value;        // "user-abc-123"
id.toString();   // "user-abc-123"  — usable in template literals
id.toJSON();     // "user-abc-123"  — JSON.stringify-safe
id.equals(EntityId.create("user-abc-123")); // true
```

Empty or whitespace-only strings throw on construction:

```ts
EntityId.create("");      // Error: EntityId cannot be empty
EntityId.create("   ");   // Error: EntityId cannot be empty
```

---

### Entity

Abstract base class for read-only domain objects identified by an `EntityId`.

```ts
import { Entity, EntityId } from "@enardo/entities";
import type { EntityCommonAttributes } from "@enardo/entities";

interface ProductAttributes extends EntityCommonAttributes {
  sku: string;
  price: number;
}

class Product extends Entity<ProductAttributes> {
  static create(attributes: ProductAttributes): Product {
    return new Product(attributes);
  }

  private constructor(attributes: ProductAttributes) {
    super(attributes);
  }

  get sku(): string {
    return this._attributes.sku;
  }

  get price(): number {
    return this._attributes.price;
  }
}

const product = Product.create({
  id: EntityId.create("prod-1"),
  sku: "WIDGET-42",
  price: 9.99,
});
```

In concrete entities, keep constructors non-public (typically `private` or
`protected`) and expose static factories (`create`, `rehydrate`) when input
data must be transformed into the normalized internal attribute shape.

**Equality** is based on the concrete class and the identifier — two instances of different subclasses with the same `EntityId` are *not* equal:

```ts
product.equals(sameProduct);       // true  — same class, same id
product.equals(otherClassSameId);  // false — different class
```

---

### AggregateRoot

Abstract base class for aggregate roots. Extends `Entity` with:

- protected `setAttribute` for immutable attribute mutation
- protected `setAttributes` for batch immutable attribute mutation
- domain-event queue (`addEvent` / `pullEvents`)
- soft-delete lifecycle (`markForRemoval`)
- optional `createdAt` / `updatedAt` timestamp management

#### Defining an aggregate

```ts
import { AggregateRoot, EntityId } from "@enardo/entities";
import type { AggregateRootCommonAttributes } from "@enardo/entities";

interface UserAttributes extends AggregateRootCommonAttributes {
  name: string;
  email: string;
}

class User extends AggregateRoot<UserAttributes> {
  protected constructor(attributes: UserAttributes) {
    super(attributes);
  }

  protected get modelName(): string {
    return "user";
  }

  get name(): string {
    return this._attributes.name;
  }

  rename(name: string): void {
    this.setAttribute("name", name);
  }
}

// Works even with protected/private constructors:
const user = User.create({
  id: EntityId.create("user-1"),
  name: "Ada",
  email: "ada@example.com",
});
```

#### Creating a new aggregate

Use `create` for brand-new aggregates. It queues a `user.created` lifecycle event automatically.

```ts
const user = User.create({
  id: EntityId.create("user-1"),
  name: "Ada",
  email: "ada@example.com",
});

user.pullEvents();
// [{ eventName: "user.created", occurredAt: Date, payload: { entityType: "user", entityId: EntityId } }]
```

#### Rehydrating from persistence

Use `rehydrate` when reconstructing an aggregate from a database record. No events are queued.

```ts
const user = User.rehydrate({
  id: EntityId.create("user-1"),
  name: "Ada",
  email: "ada@example.com",
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-03-10"),
});
```

#### Mutating attributes

```ts
user.rename("Grace");             // setAttribute under the hood
user.updatedAt;                   // updated automatically
```

`setAttribute` is a no-op when the new value is strictly equal (`Object.is`) to the current one.

For batch updates inside aggregate methods, use `setAttributes`:

```ts
this.setAttributes({
  name: "Grace",
  email: "grace@example.com",
});
```

`setAttributes` runs one pre-mutation hook, updates timestamps at most once, and calls `onAttributeMutation` once per changed key.

#### Soft-deleting

```ts
user.markForRemoval("merged into another account");

user.isMarkedForRemoval();  // true

user.pullEvents();
// [{ eventName: "user.deleted", payload: { ..., reason: "merged into another account" } }]

user.rename("X");  // throws an Error
```

#### Draining the event queue

```ts
// After persisting the aggregate:
const events = user.pullEvents();  // returns and clears the queue
dispatchAll(events);

// On failure, discard without dispatching:
user.clearEvents();
```

---

## Lifecycle events

Every `AggregateRoot` subclass automatically produces three event types. The event name is derived from `modelName`:

| Event | Name format | Queued by |
|---|---|---|
| Created | `<modelName>.created` | `create()` |
| Updated | `<modelName>.updated` | `onAttributeMutation` override |
| Deleted | `<modelName>.deleted` | `markForRemoval()` |

`updated` events are **mergeable**: consecutive calls to `setAttribute` that produce update events with the same `mergeKey` are collapsed into a single event whose `changedKeys` is the union of all individual mutations.

---

## Mutation hooks

Three protected hooks let subclasses extend the mutation lifecycle without overriding `setAttribute` or `setAttributes` directly:

### `onBeforeAttributeMutation()`

Called before the attribute snapshot is replaced. Use it for validation or pre-mutation side-effects.

```ts
protected override onBeforeAttributeMutation(): void {
  if (this._attributes.locked) {
    throw new Error("Cannot mutate a locked entity");
  }
}
```

### `onAttributeMutation(changedKey: string)`

Called after the attribute snapshot is replaced. The default is a no-op. Override it to queue domain events:

```ts
protected override onAttributeMutation(changedKey: string): void {
  if (this.hasCreatedEventQueued()) return; // not yet persisted
  this.addEvent(this.createUpdatedEvent(changedKey));
}
```

### `onMarkedForRemoval(reason?: string)`

Called after `_isMarkedForRemoval` is set but before the `deleted` event is queued. Use it for cleanup or additional event queuing.

---

## Errors

| Class | Code | Thrown when |
|---|---|---|
| `InvalidEntityIdError` | `INVALID_ENTITY_ID` | `EntityId.create` gets an empty or blank value |

`InvalidEntityIdError` is a `BaseError` (`@enardo/errors`): recognize it with `isBaseErrorLike` and its `code`.

Misusing the lifecycle of an aggregate throws a native `Error`, with no `code`: a second `markForRemoval` (`Cannot mark user user-1 for removal: it already is`) and any mutation of a removed aggregate (`Cannot mutate user user-1: it is marked for removal`). Only a bug reaches them, so there is nothing to branch on; check `isMarkedForRemoval()` first. The message names the entity for a person to read: don't parse it.

---

## Upgrading from 1.x

- `EntityNotMutableError`, `EntityAlreadyMarkedForRemovalError`, `EntityLifecycleError`, `EntityLifecycleErrorCode` and `EntityLifecycleErrorContext` are gone, and so is the protected `buildLifecycleErrorContext()`: a use of them fails to compile. A subclass reads `modelName` and `id` itself.
- Both errors are now a native `Error`. A comparison with the old `code` (`ENTITY_NOT_MUTABLE`, `ENTITY_ALREADY_MARKED_FOR_REMOVAL`) still compiles and is never true, and `JSON.stringify` of the error gives `{}`.
- `2.0.0` depends on `@enardo/errors` `^1.2.0`. If another package of the app allows `1.0.0`, the app gets two copies of it, and an `instanceof BaseError` of one misses an `InvalidEntityIdError` of the other: keep one copy.

---

## Scripts

```sh
pnpm build          # compile to dist/
pnpm dev            # compile in watch mode
pnpm test           # run Vitest test suite
pnpm test:watch     # Vitest in watch mode
pnpm lint           # ESLint
pnpm lint:fix       # ESLint with auto-fix
pnpm format         # Prettier write
pnpm format:check   # Prettier check
```
