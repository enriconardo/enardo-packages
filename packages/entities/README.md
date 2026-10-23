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
- [Error classes](#error-classes)
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
import type { IEntityCommonAttributes } from "@enardo/entities";

interface IProductAttributes extends IEntityCommonAttributes {
  sku: string;
  price: number;
}

class Product extends Entity<IProductAttributes> {
  static create(attributes: IProductAttributes): Product {
    return new Product(attributes);
  }

  private constructor(attributes: IProductAttributes) {
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
- domain-event queue (`addDomainEvent` / `pullDomainEvents`)
- soft-delete lifecycle (`markForRemoval`)
- optional `createdAt` / `updatedAt` timestamp management

#### Defining an aggregate

```ts
import { AggregateRoot, EntityId } from "@enardo/entities";
import type { IAggregateRootCommonAttributes } from "@enardo/entities";

interface IUserAttributes extends IAggregateRootCommonAttributes {
  name: string;
  email: string;
}

class User extends AggregateRoot<IUserAttributes> {
  protected constructor(attributes: IUserAttributes) {
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
  id: new EntityId("user-1"),
  name: "Ada",
  email: "ada@example.com",
});

user.pullDomainEvents();
// [{ eventName: "user.created", occurredAt: Date, payload: { entityType: "user", entityId: EntityId } }]
```

#### Rehydrating from persistence

Use `rehydrate` when reconstructing an aggregate from a database record. No events are queued.

```ts
const user = User.rehydrate({
  id: new EntityId("user-1"),
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

user.pullDomainEvents();
// [{ eventName: "user.deleted", payload: { ..., reason: "merged into another account" } }]

user.rename("X");  // throws EntityNotMutableError
```

#### Draining the event queue

```ts
// After persisting the aggregate:
const events = user.pullDomainEvents();  // returns and clears the queue
dispatchAll(events);

// On failure, discard without dispatching:
user.clearDomainEvents();
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
  this.addDomainEvent(this.createUpdatedEvent(changedKey));
}
```

### `onMarkedForRemoval(reason?: string)`

Called after `_isMarkedForRemoval` is set but before the `deleted` event is queued. Use it for cleanup or additional event queuing.

---

## Error classes

| Class | Code | Thrown when |
|---|---|---|
| `EntityNotMutableError` | `ENTITY_NOT_MUTABLE` | `setAttribute` is called on a removed aggregate |
| `EntityAlreadyMarkedForRemovalError` | `ENTITY_ALREADY_MARKED_FOR_REMOVAL` | `markForRemoval` is called more than once |

Both extend the abstract `EntityLifecycleError`, a `BaseError` (`@enardo/errors`) whose `code` is typed `EntityLifecycleErrorCode`, narrowed by each subclass to its own literal and whose `details` is the `{ entityType, entityId }` object, also exposed as `context`, for structured logging.

```ts
import {
  EntityNotMutableError,
  EntityAlreadyMarkedForRemovalError,
} from "@enardo/entities";

try {
  user.markForRemoval();
  user.markForRemoval(); // throws
} catch (err) {
  if (err instanceof EntityAlreadyMarkedForRemovalError) {
    console.error(err.code, err.context);
    // "ENTITY_ALREADY_MARKED_FOR_REMOVAL" { entityType: "user", entityId: EntityId }
  }
}
```

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
