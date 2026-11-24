# @enardo/ddd-entities

Domain-model building blocks for DDD-style applications: `Entity`, `AggregateRoot`, and a typed `Id`.

## Contents

- [Overview](#overview)
- [Installation](#installation)
- [Core concepts](#core-concepts)
  - [Id](#id)
  - [Entity](#entity)
  - [AggregateRoot](#aggregateroot)
- [Errors](#errors)
- [Scripts](#scripts)

---

## Overview

The package is a small core, and holds three guarantees:

1. **Identity.** Entities are compared by concrete class and identifier, never by value. An id of one kind does not pass for another at compile time.
2. **Private state.** The id and the attributes live in ECMAScript private fields. Nothing outside the class assigns them.
3. **Encapsulated mutation.** State changes only through the protected `setAttribute` and `setAttributes`. The base raises no event and keeps no timestamp: those belong to the domain.

---

## Installation

The package is published to the `@enardo` registry (`https://npm.enriconardo.com`, which needs a token to read):

```sh
pnpm add @enardo/ddd-entities
```

---

## Core concepts

### Id

A frozen value object that wraps a non-empty string, branded by a type parameter. The brand exists only in the type: nothing is added at run time.

```ts
import { Id } from "@enardo/ddd-entities";

type UserId = Id<"User">;
type ProductId = Id<"Product">;

const id = Id.create<"User">("user-abc-123");

id.value; // "user-abc-123"
id.toString(); // "user-abc-123", usable in template literals
id.toJSON(); // "user-abc-123", JSON.stringify-safe
id.equals(Id.create<"User">("user-abc-123")); // true

const productId: ProductId = id; // does not compile
```

`create` keeps the value as given, untrimmed. An empty or whitespace-only string throws `InvalidEntityIdError`:

```ts
Id.create(""); // InvalidEntityIdError: An entity id cannot be empty
Id.create("   "); // InvalidEntityIdError: An entity id cannot be empty
```

An entity's id need not be an `Id`. Any type with an `equals(other)` method fits `Equatable<T>`, such as a value object of the domain with its own validation:

```ts
export interface Equatable<T> {
  equals(other: T): boolean;
}
```

---

### Entity

Abstract base class for objects identified by an id. It takes the type of the id and the type of the attributes.

```ts
import { Entity, Id } from "@enardo/ddd-entities";

type ProductId = Id<"Product">;

interface ProductAttributes {
  sku: string;
  price: number;
}

class Product extends Entity<ProductId, ProductAttributes> {
  constructor(id: ProductId, attributes: ProductAttributes) {
    super(id, attributes);
  }

  get sku(): string {
    return this.attributes.sku;
  }

  reprice(price: number): void {
    if (price < 0) throw new Error("A price cannot be negative");
    this.setAttribute("price", price);
  }
}

const product = new Product(Id.create<"Product">("prod-1"), { sku: "WIDGET-42", price: 9.99 });
```

A subclass declares its own constructor. Keep it public if a mapper builds the entity with `new`, or non-public behind the subclass's own static factories (`register`, `restore`). The base has no static factory.

#### State

- `id` is read-only. It is not one of the attributes: an attribute named `id` would be a field of its own, unrelated to `entity.id`, so avoid it.
- `attributes` is a `Readonly<TAttributes>`. The constructor stores a shallow, frozen copy of the object it receives, so a later change to a top-level key of that object does not reach the entity. The mapper reads `entity.id` and `entity.attributes` to build the store's records.
- The freeze is shallow, as the type is. A nested object, array, `Map`, `Set` or `Date` is shared with the caller and stays mutable: keeping nested values immutable is the domain's job.
- `TAttributes` is a plain object. An array or a class instance loses its prototype in the copy and is not supported.
- The base adds no own enumerable key: for it `Object.keys(entity)` is `[]` and `JSON.stringify(entity)` gives `{}` (a subclass's own fields are listed). Serialize `id` and `attributes` explicitly.

#### Mutation

`setAttribute(key, value)` and `setAttributes(values)` are protected, and are the only way to write the state. Each compares the new values with the current ones through `Object.is`: if none differs, nothing happens and `attributes` stays the same object. Otherwise `attributes` becomes a new frozen copy.

```ts
this.setAttributes({ price: 12, sku: "WIDGET-43" });
```

An invariant goes in the domain method, before the call. One that holds for every mutation overrides `setAttributes` and calls `super`; `setAttribute` goes through it.

#### Equality

`equals(other)` is `true` for the same reference, and for another instance of the same concrete class whose `this.id.equals(other.id)`. It is `false` otherwise, for `null`, `undefined` and other types included: two subclasses with the same id are not equal.

In tests, compare `id` and `attributes` of two entities: vitest's `toEqual` ignores `#` fields, so it passes between two entities of the same class whatever their state.

---

### AggregateRoot

Abstract base class for aggregate roots. It extends `Entity` with a queue of domain events, typed by a third parameter.

```ts
AggregateRoot<TId, TAttributes, TEvent = never>
```

- `raise(event)` (protected) appends to the queue.
- `pullEvents()` returns the queued events in the order raised, and empties the queue.
- `clearEvents()` empties it without returning them.

`TEvent` has no constraint. Pick the union of the aggregate's events. If the app publishes them through an event package, make them extend that package's event type. With the default `never`, `raise` cannot be called, which suits an aggregate that raises nothing. The base raises no event of its own, on construction, mutation or anything else.

```ts
import { AggregateRoot, Id } from "@enardo/ddd-entities";

type UserId = Id<"User">;

interface UserRegistered {
  eventName: "user.registered";
  occurredAt: Date;
  userId: string;
}

interface UserRenamed {
  eventName: "user.renamed";
  occurredAt: Date;
  userId: string;
}

type UserEvent = UserRegistered | UserRenamed;

interface UserAttributes {
  name: string;
  email: string;
}

class User extends AggregateRoot<UserId, UserAttributes, UserEvent> {
  static register(id: UserId, attributes: UserAttributes): User {
    const user = new User(id, attributes);
    user.raise({ eventName: "user.registered", occurredAt: new Date(), userId: id.value });
    return user;
  }

  static restore(id: UserId, attributes: UserAttributes): User {
    return new User(id, attributes);
  }

  protected constructor(id: UserId, attributes: UserAttributes) {
    super(id, attributes);
  }

  rename(name: string): void {
    if (name === this.attributes.name) return;
    this.setAttribute("name", name);
    this.raise({ eventName: "user.renamed", occurredAt: new Date(), userId: this.id.value });
  }
}
```

An object type is declared as an `interface`, as the repository's lint preset asks, and their union as a `type`.

#### Draining the event queue

```ts
// After persisting the aggregate:
const events = user.pullEvents(); // returns and clears the queue
dispatchAll(events);

// On failure, discard without dispatching:
user.clearEvents();
```

---

## Errors

| Class | Code | Thrown when |
|---|---|---|
| `InvalidEntityIdError` | `INVALID_ENTITY_ID` | `Id.create` gets an empty or blank value |

`InvalidEntityIdError` is a `BaseError` (`@enardo/errors`), with details `{ entityId, reason: "empty" }`: recognize it with `isBaseErrorLike` and its `code`. The types `InvalidEntityIdDetails` and `InvalidEntityIdReason` are exported.

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
