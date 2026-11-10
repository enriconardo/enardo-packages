---
status: approved
branch: feature/entities/lean-aggregate-core
---

# A lean core for `@enardo/entities` 3.0.0: typed ids, typed events, nothing of the store

## Why

From the first queued item of `docs/backlog.md`, `feature/entities/lean-aggregate-core`, which comes from the analysis of `@enardo/entities` on `docs/repo/entities-events-backlog` (2026-11-10), and from the brainstorming of this branch, where the user took decisions 1–5.

What 2.0.0 does, read in `packages/entities/src` on `3a9eb21`:

- **One id type for every aggregate.** `Entity.id` is typed `EntityId` (`src/entity.ts:33`), a single class whose brand is the literal `"EntityId"` (`src/entity-id.vo.ts:11`). A `UserId` and a `ProductId` are the same type, so one passes where the other is expected.
- **The model is bound to the store.** `Entity<TAttributes>` documents its attributes as the "persisted/normalized" shape (`src/entity.ts:15`, `src/aggregate-root.ts:75`). `AggregateRootCommonAttributes` adds `createdAt`/`updatedAt` (`:6-9`), and `setAttributes` bumps `updatedAt` on every change (`:190-192`), which is a concern of the store.
- **Change notifications pose as domain events.** `create` queues `<model>.created` (`:295-308`), `markForRemoval` queues `<model>.deleted` (`:348-359`), and `createUpdatedEvent` builds a mergeable `<model>.updated` (`:458-487`) that the public `addEvent` merges (`:387-404`). They say a record changed, not what happened in the domain. The aggregate cannot know whether the store confirms them, and they need `modelName` (`:100`) and `@enardo/events` (`package.json:35`). The change tracker of `@enardo/uow-repository` already knows which entities are new, changed and removed (`feature/uow-repository/commit-change-set`, in the backlog).
- **Removal is in two places.** `markForRemoval` is a lifecycle of the aggregate (`:348-364`), with `assertMutable` (`:258-264`) and `onMarkedForRemoval` (`:275`). The repository's `remove` and the change tracker hold the same lifecycle (`packages/uow-repository/src/change-tracker.ts:73`).
- **Bugs**, found by the probe on 2.0.0 recorded in the item (2026-11-10):
  - `create` compiles with required attributes missing. Its `this: { prototype: AggregateRootType }` leaves `Attributes` free (`:295-308`).
  - `_attributes` (`src/entity.ts:21`), `_events` (`:85`) and `_isMarkedForRemoval` (`:91`) are public and writable.
  - `deepFreeze` freezes a Map and a Set with `Object.freeze`, which does not stop `set`, `add` or `delete`, and leaves a Date mutable (`src/utils/deep-freeze.ts`). The README promises "deeply frozen" (`README.md:26`).
  - `onBeforeAttributeMutation` runs before the no-op check (`:164-167`), so it runs when nothing changes, against its JSDoc.

**Consumers.**

- No package of this monorepo depends on `@enardo/entities` in code. The explorer's `git grep "@enardo/entities"` found no `package.json` and no import outside the package. Only `packages/uow-repository-mongo/README.md:236-238` uses `EntityId`, as an example, without importing it. `@enardo/events` has no other importer.
- `cambusa`'s six packages are on `^1.1.0`, and migrate when they take the major. At `9cc4f5f`, `git grep` (2026-11-10) shows:
  - no `pullEvents`, `addEvent`, lifecycle event name, `markForRemoval` or mutation hook;
  - `AggregateRoot<…>` and `EntityId` in its domains, with `modelName` implemented (`packages/catalog/src/domain/product.entity.ts:36-39`, `packages/collaboration/src/domain/group.entity.ts:31`, `packages/culinary/src/domain/recipe.entity.ts:32`);
  - the base's `createdAt`/`updatedAt` read by its mappers and routes (`packages/catalog/src/infrastructure/repository/product.mongo.repository.ts:42-54`, `apps/api-server/src/controllers/groups/products/get-product-by-id.route.ts:39-40`, and others);
  - `_attributes` read throughout its subclasses (`packages/catalog/src/domain/product.entity.ts:44-106`, `packages/collaboration/src/domain/group-member.entity.ts:55-59`);
  - `create` in a handler (`packages/catalog/src/application/use-cases/create-product/create-product.handler.ts:57`), and `rehydrate` in every Mongo repository (`product.mongo.repository.ts:36`, `group.mongo.repository.ts:55`, `recipe.mongo.repository.ts:31`).

## What

`@enardo/entities` 3.0.0 exports, at run time, exactly `Entity`, `AggregateRoot`, `Id` and `InvalidEntityIdError`. As types it exports `Equatable`, `InvalidEntityIdDetails` and `InvalidEntityIdReason`. Its only dependency is `@enardo/errors`; `@enardo/events` leaves `dependencies`, and `version` becomes `3.0.0`.

### `Equatable<T>`

```ts
export interface Equatable<T> {
  equals(other: T): boolean;
}
```

This is what an entity's id must offer. Any value object with an `equals` serves, as does `Id<B>`.

### `Id<B extends string>`

```ts
declare const idBrand: unique symbol; // not exported

export class Id<B extends string> implements Equatable<Id<B>> {
  declare readonly [idBrand]: B;
  private constructor(value: string);
  static create<B extends string>(value: string): Id<B>;
  get value(): string;
  equals(other: Id<B>): boolean;
  toString(): string;
  toJSON(): string;
}
```

- **The brand is in the type only.** It is a `declare`d property of type `B`, under a `unique symbol` that the module does not export (probe 5).
  - `Id<"User">` is not assignable to `Id<"Product">`, for a consumer of the built `dist/index.d.mts` as well as for the source.
  - No property exists at run time, and none can be named from outside.
  - The probed form is `declare readonly [idBrand]: B`. A `private` modifier on it is not needed, since the key cannot be written outside the module.
  - A comment in the source says why it is a symbol: a `private` brand is emitted without its type, and the brand is lost for every consumer (probe 5, V1).
- `create(" a ")` keeps the value as given, untrimmed, as 2.0.0 does.
- `create("")` and `create("  ")` throw `InvalidEntityIdError`, code `INVALID_ENTITY_ID`, details `{ entityId, reason: "empty" }`. The code and the class are unchanged (ADR 0018). The message becomes `An entity id cannot be empty`.
- The instance is frozen, and holds its value in `#value`.
- `equals` compares `this.value` with `other.value`, the public getter. It is `false` on a nullish `other`.
  - An `Id` from a second copy of the package compares by value and never throws. A `#value` read on it would throw a `TypeError`.
- An app names its ids as types, `type UserId = Id<"User">`, and creates them with `Id.create<"User">(raw)`, or through a typed target that infers `B`.

### `Entity<TId, TAttributes>`

```ts
export abstract class Entity<TId extends Equatable<TId>, TAttributes extends object> {
  protected constructor(id: TId, attributes: TAttributes);
  get id(): TId;
  get attributes(): Readonly<TAttributes>;
  equals(other: unknown): boolean;
  protected setAttribute<K extends keyof TAttributes>(key: K, value: TAttributes[K]): void;
  protected setAttributes<K extends keyof TAttributes>(values: Pick<TAttributes, K>): void;
}
```

- **Private state.** `id` and the attributes are held in ECMAScript private fields (`#id`, `#attributes`). `Object.keys(entity)` is `[]`, and no assignment from outside reaches them.
- **The snapshot.** The constructor stores a shallow copy of `attributes` (`{ ...attributes }`), frozen with `Object.freeze`. `attributes` returns that snapshot.
  - A later change to a top-level key of the object the caller passed does not reach the entity.
  - The type says `Readonly<TAttributes>`, shallow, and the run time freezes exactly that much. A nested object, array, Map, Set or Date is shared with the caller and stays mutable. The README says so.
  - `TAttributes` is a plain object in the domain's shape. The copy keeps its own enumerable keys, symbols included. An array or a class instance as `TAttributes` loses its prototype, is not supported, and the README says so.
  - The id is not one of the attributes. An attribute named `id` would be a field of its own, unrelated to `entity.id`; the README advises against it. The mapper converts the attributes and the id to the store's records.
- **Equality.** `equals(other)` is `true` for the same reference. It is also `true` for another instance of the same concrete class (`constructor` identity) whose `id.equals(this.id)`, read through the public `id`. Otherwise, including `null`, `undefined` and non-entities, it is `false`.
- **Mutation.** `setAttributes(values)` compares each own key of `values` (`Reflect.ownKeys`, symbols included) with `Object.is`.
  - If none differs, nothing happens: the snapshot is the same object.
  - Otherwise `#attributes` becomes a new frozen shallow copy, holding the changed values.
  - `setAttribute(key, value)` is `setAttributes({ [key]: value })`. It goes through `setAttributes`, so a subclass that overrides `setAttributes` and calls `super` sees every mutation (probe 2f).
  - They are the only write path to the snapshot, and no event is raised.
- **Construction.** A subclass declares its own constructor. It is public if the mapper builds it with `new`, or stays non-public behind the subclass's own static factories (`register`, `restore`). The base has no static factory.

### `AggregateRoot<TId, TAttributes, TEvent = never>`

```ts
export abstract class AggregateRoot<
  TId extends Equatable<TId>,
  TAttributes extends object,
  TEvent = never,
> extends Entity<TId, TAttributes> {
  protected constructor(id: TId, attributes: TAttributes);
  protected raise(event: TEvent): void;
  pullEvents(): TEvent[];
  clearEvents(): void;
}
```

- `raise` appends to a private queue (`#events`). `pullEvents` returns the queued events in the order raised, and empties the queue. `clearEvents` empties it.
  - With the default `TEvent = never`, `raise` cannot be called, which is right for an aggregate that raises nothing.
  - `TEvent` has no constraint. The app picks it, typically a union of the aggregate's events, and makes it extend `Event` of its event package if it publishes them.
  - The repository's lint preset asks for an `interface` for an object type (`consistent-type-definitions`): the README declares each event as an interface, and their union as a `type`.
- No event is raised by the base, on construction, mutation, or anything else.

### Gone

Each of these fails to compile when used. The README's *Upgrading from 2.x* lists them.

- `EntityId`, which becomes `Id<B>`.
- The one-argument forms `Entity<TAttributes>` and `AggregateRoot<TAttributes>`, which fail with `TS2314`: `Entity` takes `<TId, TAttributes>`, and `AggregateRoot` `<TId, TAttributes, TEvent>`.
- `EntityCommonAttributes` and `AggregateRootCommonAttributes`.
- The lifecycle types: `AggregateRootLifecycleContext`, `AggregateRootCreatedPayload`, `AggregateRootDeletedPayload`, `AggregateRootUpdatedPayload`, `AggregateRootCreatedEvent`, `AggregateRootDeletedEvent` and `AggregateRootUpdatedEvent`.
- `AggregateRoot.create`, `AggregateRoot.rehydrate`, `modelName`, `lifecycleEventName`, `createdAt` and `updatedAt`.
- `markForRemoval`, `isMarkedForRemoval`, `assertMutable` and `onMarkedForRemoval`.
- `onBeforeAttributeMutation`, `onAttributeMutation`, `hasCreatedEventQueued` and `addEvent`.
- `createCreatedEvent`, `createDeletedEvent` and `createUpdatedEvent`.
- `_attributes`, `_events` and `_isMarkedForRemoval`.
- `deepFreeze` was never exported, and goes.

These changes still compile, and behave differently:

- a comparison with the 2.0.0 lifecycle messages, or a `"user.updated"` handler, is never reached;
- `JSON.stringify(entity)` gives `{}`;
- vitest's `toEqual` between two entities of the same class passes whatever their state, since `#` fields are not compared: compare `id` and `attributes` instead;
- nested attribute values are no longer frozen;
- a method overriding a removed hook fails with `TS4113` if it carries `override`; without the keyword, and with `noImplicitOverride` off, it compiles and never runs.

### Files

`packages/entities`:

- `src/equatable.ts` and `src/id.vo.ts` are new. `src/entity.ts` and `src/aggregate-root.ts` are rewritten. `src/errors/invalid-entity-id.error.ts` changes only its message.
- `src/entity-id.vo.ts` and `src/utils/` go.
- `src/index.ts` exports each module once. It exports `entity-id.vo` twice today (`:3`, `:5`).
- `__tests__/id.vo.test.ts` and `__tests__/entity.test.ts` are new.
- `__tests__/aggregate-root.test.ts` is rewritten. Every case of 2.0.0 there builds with `create`, `rehydrate` or `modelName`, so the whole file goes.
- `__tests__/deep-freeze.test.ts` and `__tests__/entity-id.vo.test.ts` go.
- `__tests__/invalid-entity-id.error.test.ts` keeps its cases on the class, with `Id.create` in place of `EntityId.create`.
- `__tests__/index.test.ts` changes for case 21.
- `package.json` and `README.md` change as above.

Elsewhere:

- `pnpm-lock.yaml` is updated in the dev container (`./dev.sh exec pnpm install`).
- `packages/uow-repository-mongo/README.md:236-238` changes.
- `packages/eslint-config/README.md:57`, *Known limit*: its example of a cast that steers generic inference, `Aggregate.rehydrate({ … } as Attributes)`, names an API that goes. It becomes a generic factory of no package, `build({ … } as Options)` → `build<Options>({ … })`.
- `docs/adr/0020-…` is new. In `docs/adr/README.md`, the 0020 row is added, and 0018's status notes its `ENTITY_*` row.
- `docs/backlog.md` loses this item, in a commit of its own.

### Out of scope

- Change notifications of a commit (`feature/uow-repository/commit-change-set`).
- The removal of `MergeableEvent` from `@enardo/events` (`feature/events/drop-mergeable-event`).
- Publishing, which goes through the `publish` skill.
- `cambusa`'s migration.

## Decisions

Decisions 1–5 were taken by the user at the brainstorming. Decisions 6 onward are the spec's.

1. **Any `TId` with an `equals`, and a ready `Id<B>`.**
   - Not taken: one `Id<B>` as the only accepted id type. It would forbid a domain's own value object, such as a UUID with validation.
   - Not taken: any `TId`, primitives included. `equals` could not compare a value object, and a `string` id gives back the cross-aggregate leak.
   - The name `EntityId` goes.
2. **The id outside the attributes:** `constructor(id, attributes)`.
   - The id has no setter, and `TAttributes` needs no `id` key of type `TId`.
   - The mapper reads `entity.id` and `entity.attributes`, and builds with `new User(id, attrs)`.
   - Not taken: the id in the snapshot. `setAttribute("id", …)` would compile unless excluded by type, and the two type parameters would be coupled.
3. **No deep freeze. `Readonly<T>`, shallow, and private state.**
   - Not taken: fixing `deepFreeze` for Map, Set and Date. Proxies or copies on read would cost every access, and would still miss a class instance's own state.
   - Not taken: keeping the deep freeze for plain objects and arrays, which 2.0.0 does correctly (`src/utils/deep-freeze.ts:22-30`), and documenting Map, Set and Date as exceptions.
     - For it: nested plain values stay guarded at run time, the common case.
     - Against it: it freezes the caller's own objects in place, so an object passed to the constructor, or to `setAttribute`, becomes frozen for the caller too. The guarantee would then hold for some nested types and not others, by a rule the type does not show. `Readonly<T>` makes one promise, and the run time keeps it.
   - The user chose this at the brainstorming, on the backlog's words: "readonly types and private state, rather than a promise the runtime breaks".
   - Not taken: no freeze at all. Decision 8 explains why.
4. **No static factory in the base. The constructor is `protected`.**
   - Without generic events, `create` and `rehydrate` would both be `new this(…)`. Kept, they would be a second way to build an aggregate, bypassing the domain's factory, its invariants and its event.
   - The bug of `create` goes with it. Case 20 checks that `create` is gone. A subclass's own constructor has concrete types, and case 11 checks that a missing attribute fails there.
   - `cambusa` calls `create` in a handler and `rehydrate` in its three Mongo repositories (*Why*). Its migration is no constraint: it is a pilot project, to be rebuilt from scratch (the user, at checkpoint 1).
5. **No mutation hooks.**
   - An invariant goes in the domain method, before `setAttribute`. One that holds for every mutation overrides the protected `setAttributes` and calls `super`.
   - The no-op bug of `onBeforeAttributeMutation` goes with the hooks. `assertMutable` goes with `markForRemoval`.
6. **The base raises no event, and depends on no event package** (ADR 0020).
   - The lifecycle events, their merge, `modelName`, `markForRemoval` and the timestamps leave the base.
   - Not taken: keeping them opt-in. They stay change notifications built by an aggregate that cannot know whether the store confirms them, and the change tracker already holds the data (`feature/uow-repository/commit-change-set`).
   - Not taken: `TEvent extends Event`, which keeps the dependency on `@enardo/events` for a constraint an app may not want. An aggregate whose events stay inside the process needs no `eventName`.
7. **ECMAScript `#` fields, not TypeScript `private`.**
   - The bug is state writable from outside. `private` stops TypeScript callers only, while `as any`, JavaScript and `Object.assign` still reach a `_field`.
   - `#` is emitted natively, with no helper, and the lint preset accepts it (probe 3).
   - It keeps the state out of subclasses too, which decides where the setters live (decision 10).
   - It departs from the `private` of the surrounding code, which holds no state of an instance that a caller could corrupt.
   - A `Proxy` of an entity throws on `#` access. No consumer proxies one.
   - `#` is never read on the `other` of an `equals`. Both `equals` read public getters, so a value from a second copy of the package compares instead of throwing.
8. **A shallow `Object.freeze` of the snapshot.**
   - `attributes` returns the snapshot itself, so without a freeze, a JavaScript caller or a cast could change the state without `setAttributes`.
   - The freeze guards exactly what the type claims, by analogy with ADR 0003, which asks a type guard to claim no more than its check proves. No more is promised: the README states that nested values are the domain's to keep immutable.
   - Not taken: a copy on every read, which costs each access to defend against a cast.
9. **`attributes` public.**
   - The mapper's `toRecords` reads the whole snapshot in one place, without a getter per field.
   - Reading the state breaks no invariant: writing it is what the protected setters guard.
   - Not taken: `protected`. Every entity would need a getter per field, or a `toSnapshot` of its own, for its mapper.
10. **`setAttribute` and `setAttributes` move to `Entity`**, from `AggregateRoot`.
    - A `#` field is visible only to the class that declares it. `AggregateRoot` can write `Entity`'s `#attributes` only through a protected member of `Entity` (probe 2g).
    - With that member being the two setters, `Object.is` and the freeze hold on the only write path.
    - Not taken: a protected `replaceAttributes(next)` on `Entity`, keeping the setters on `AggregateRoot`. Every subclass of `Entity` would then get a raw write that skips the no-op check and the freeze.
    - Not taken: TypeScript `private` for `#attributes` alone, so that the setters stay on `AggregateRoot`. That gives back the bug decision 7 fixes.
    - What it changes: a child entity of an aggregate can now change its own state, as an order line's quantity does. It changes nothing for `AggregateRoot`'s subclasses.
11. **`InvalidEntityIdError` keeps its name, `code` and `details`.**
    - A `code` belongs to one class (root `CLAUDE.md`), and `cambusa` maps it (ADR 0018).
    - Only the message changes, since it names `EntityId`. A message is for a person, so its change needs no note beyond the upgrade section.
12. **An ADR, 0020**, for decision 6: it binds `feature/uow-repository/commit-change-set` and `feature/events/drop-mergeable-event`.
    - ADR 0018 is not edited, except its status. That status and its index row note that its `ENTITY_*` row has no subject since 3.0.0 (ADR 0020).
13. **The brand under an unexported `unique symbol`** (probe 5).
    - Not taken: `declare private readonly brand: B`. It works against the source, but the `.d.ts` emits `private readonly brand;` without its type, so `Id<"User">` passes for `Id<"Product">` for every consumer (V1).
    - Not taken: `declare protected readonly brand: B`. It works (V2), but publishes a `brand` name in the declarations and in completions.
    - The type cases of the tests compile against `src/` (the `~/*` alias), so they cannot see a loss at declaration emit. Probe 5 checked the built declarations, and the source comment of *What* guards the form.
    - Not taken, and an open question for the checkpoint: a type test compiling against `dist/`. It would take:
      - a `packages/entities/turbo.json` with `"extends": ["//"]` and `typecheck.dependsOn: ["build", "^build"]`, so only this package changes, but it would be the first per-package turbo config of the repository;
      - a test importing the package by its own name, so it resolves `exports`;
      - a build before each `typecheck` of the package.

      It guards one line, which a comment already explains, and a review of a change to that line reads the comment.
14. **The README is rewritten** around the 3.0.0 surface.
    - *Lifecycle events*, *Mutation hooks* and the soft-delete section go.
    - *Errors* keeps `InvalidEntityIdError`, without the paragraph on the native lifecycle errors.
    - It names neither `@enardo/events` nor `@enardo/uow-repository`, which are not dependencies (root `CLAUDE.md`): it speaks of "the app's event type" and "the repository's mapper".
    - A new *Upgrading from 2.x* comes before *Upgrading from 1.x*, and says that an app on 1.x reads both, 1.x first. It covers:
      - the list of *Gone*, and the changes that still compile;
      - `EntityId` → `Id<B>`, and the constructor `(id, attributes)`;
      - the events, which are now the app's, and removal, which is now the repository's;
      - timestamps: a `createdAt`/`updatedAt` the domain shows is one of its attributes, set by its own methods, or a field the store manages and the mapper or a read model returns (ADR 0019).
    - `packages/uow-repository-mongo/README.md:236-238` takes `UserId` in place of `EntityId`, a domain value object it names no package for.

## Probes

Run by the prober on 2026-11-10, in `node:24-bookworm`, in scratch projects outside the repository, with copies of `library.json`, `base.json` and the eslint node preset. Versions: tsc 5.9.3, tsdown 0.19.0, vitest 4.1.12, typescript-eslint ^8.68, eslint 10.x. Probes 1–4 used the shapes of *What*, with `Entity` writing `#attributes` through a protected `replaceAttributes`. Their assignability checks ran against the source. Probe 5 ran against the built declarations.

1. **The brand, against the source.** `declare private readonly brand: B` on `Id<B>`:
   - `Id<"User">` → `Id<"Product">`: `TS2322`. `Id<string>` → `Id<"User">`: `TS2322`. `Id<"User">` → `Id<string>` compiles.
   - `const c: Id<"User"> = Id.create("x")` compiles, so `B` is inferred from the target.
   - At run time, `Object.keys(id)` → `[]`, `"brand" in id` → `false`, `JSON.stringify(id)` → `"x"`.
   - Probe 5 shows this form loses the brand in `dist/`.
2. **The shapes compile.**
   - (a) `Id<"User">` satisfies `Equatable<TId>`. `string` fails: `TS2344`.
   - (b) A subclass widens the protected constructor to public, and `new User(id, attrs)` compiles.
   - (c) `new User(id, { tags: [] })`: `TS2345`, `Property 'name' is missing`.
   - (d) With `TEvent = never`, every `raise` fails. With a union, each member passes and `{ type: "other" }` fails: `TS2322`.
   - (e) `pullEvents()` is `UserEvent[]`.
   - (f) A subclass's `protected override setAttributes<K extends keyof UserAttrs>(…)` that calls `super` compiles under `noImplicitOverride`, and a `setAttribute` reaches it at run time.
   - (g) `AggregateRoot` cannot reach `Entity`'s `#attributes`. A protected method of `Entity` serves, and stays out of the public type: `TS2445` from outside. This decided decision 10.
3. **The `#` fields after tsdown.**
   - They are emitted natively (`#id;`, `#attributes;`, `#events = [];`), with no WeakMap helper.
   - `Object.keys(user)` → `[]`, and `JSON.stringify(user)` → `{}`.
   - The type-aware node preset of ESLint reports nothing on the prototype. That covers the `#` fields, `declare private`, the `as Pick<…>` and `as K[]` casts and `static create<B>`.
   - On the scratch files, `consistent-type-definitions` flags an object type declared with `type`, but not a union of object types (*What*, `AggregateRoot`).
4. **Type cases in tests.**
   - An unused `@ts-expect-error` fails `tsc --noEmit`: `TS2578`. A wrong `expectTypeOf` fails it too.
   - `vitest run` passes both, since `expectTypeOf` does nothing at run time. The type cases are checked by the package's `typecheck`, whose tsconfig includes `__tests__`.
5. **The brand, against the built declarations**, from a consumer project importing the package through `exports` (`types: ./dist/index.d.mts`). Four variants of `Id`:

   | Variant | `.d.mts` | `Id<"User">` → `Id<"Product">` | brand from outside |
   |---|---|---|---|
   | V0, no brand | `#private;` | compiles | — |
   | V1, `declare private readonly brand: B` | `private readonly brand;` (no type) | **compiles** | `TS2341` |
   | V2, `declare protected readonly brand: B` | `protected readonly brand: B;` | `TS2322` | `TS2445` |
   | V3, `declare readonly [idBrand]: B`, `idBrand` an unexported `unique symbol` | `declare const idBrand: unique symbol;` and `readonly [idBrand]: B;`, with `export { Id }` | `TS2322` | `TS2339` |

   - In every variant, `const u: Id<"User"> = Id.create("x")` infers `B`, `Id<"User">` → `Id<string>` compiles, and `Id<string>` → `Id<"User">` fails in V2 and V3.
   - `#private` alone does not make the ids distinct (V0). `B` is left only in `equals`'s parameter, which is compared bivariantly.
   - `class X extends Id<"A"> {}` fails, `TS2675`, as the constructor is private.
   - At run time, `Object.keys(Id.create("x"))` → `[]` and `JSON.stringify` → `"x"`, in every variant. `dist/index.mjs` has no brand.
   - ESLint on V3's source reports nothing on the brand. Its one finding, `prefer-optional-chain`, is on the prototype's `other != null && …` in `equals`, which the implementation writes as the rule asks.

## Test cases

`Id`:

1. `Id.create("u1")`: `value`, `toString()` and `JSON.stringify` give `"u1"`. The instance is frozen, and `Object.keys` of it is `[]`.
2. `Id.create("")` and `Id.create("   ")` throw `InvalidEntityIdError`, with `code` `INVALID_ENTITY_ID`, `details` `{ entityId, reason: "empty" }` and `message` `An entity id cannot be empty`, recognized by `isBaseErrorLike`.
3. `equals`:
   - the same value → `true`;
   - another value → `false`;
   - `null` → `false`;
   - an object of another class with the same `value`, standing for a second copy of the package, → `true`, without throwing.
4. Types: `Id<"User">` is not assignable to `Id<"Product">` (`@ts-expect-error`), and `Id.create` infers `B` from a typed target.

`Entity`:

5. `id` returns the id passed. `attributes` deep-equals the attributes passed, is not the same object, and is frozen.
6. A change to a top-level key of the object passed to the constructor, after construction, does not reach `attributes`.
7. `Object.keys(entity)` is `[]`, and `JSON.stringify(entity)` is `"{}"`.
8. `equals`:
   - the same instance → `true`;
   - the same class with an equal id → `true`;
   - the same class with another id → `false`;
   - another class with an equal id → `false`;
   - `null`, `undefined` and a plain object with the same `id` → `false`.
9. `equals` calls the `TId`'s own `equals`: a custom value object whose `equals` compares case-insensitively makes two entities equal.
10. Types: `user.id` is `UserId`, and is not assignable to a `ProductId` parameter (`@ts-expect-error`). A `string` `TId` fails the constraint (`@ts-expect-error`).
11. A subclass with a public constructor is built with `new`. Types: the same construction with a required attribute missing fails (`@ts-expect-error`).
12. `setAttribute` with a new value: `attributes` holds it, is a new frozen object, and the previous snapshot is unchanged.
13. `setAttribute` with an `Object.is`-equal value, and `setAttributes` with every value equal: `attributes` is the same object (`toBe`).
14. `setAttributes` with two keys, one changed: one new snapshot holding both.
15. `setAttributes` on a symbol-keyed attribute changes it.
16. A subclass overriding `setAttributes` and calling `super` sees both a `setAttribute` and a `setAttributes` call.
17. Types: `setAttribute` and `setAttributes` from outside fail (`@ts-expect-error`), and so does `setAttribute` with a key outside `TAttributes`.

`AggregateRoot`:

18. Two `raise` calls, then `pullEvents()` → both events in order. A second `pullEvents()` → `[]`. After `clearEvents()`, `pullEvents()` → `[]`.
19. A fresh aggregate, and one after `setAttribute`, have no events: the base raises nothing.
20. Types:
    - `raise` from outside fails (`@ts-expect-error`);
    - `raise` of an event outside `TEvent` fails;
    - `raise` with `TEvent = never` fails;
    - `pullEvents()` is `TEvent[]` (`expectTypeOf`);
    - `create`, `rehydrate`, `markForRemoval`, `addEvent` and `createdAt` do not exist (`@ts-expect-error`). Each is read, not called (`void Order.create`), since the lint preset refuses a call of a member it cannot type (`no-unsafe-call`). On 2.0.0 each read compiles, and the directive fails with `TS2578`. The symptom of the `create` bug, a missing attribute accepted, is covered on the constructor by case 11.

Package:

21. `index` exports exactly `AggregateRoot`, `Entity`, `Id` and `InvalidEntityIdError` at run time.

## Chunks

- [x] 1. Typed `Id` and `Equatable` (test-first). Cases 1–4.
  - New: `packages/entities/src/equatable.ts`, `packages/entities/src/id.vo.ts`, `packages/entities/__tests__/id.vo.test.ts`.
  - Changed: `packages/entities/src/errors/invalid-entity-id.error.ts` (message only), and `packages/entities/__tests__/invalid-entity-id.error.test.ts` (`Id.create` in place of `EntityId.create`).
  - `__tests__/entity-id.vo.test.ts:12,17` take the new message, since `EntityId` shares the error until chunk 3 deletes both.
  - `Id` is not exported from `src/index.ts` yet: its tests import it through `~/`, and the old `index.test.ts` stays green.
- [x] 2. `Entity` and `AggregateRoot` on `Equatable`, with private state and no events from the base (test-first). Cases 5–20.
  - Rewritten: `packages/entities/src/entity.ts`, `packages/entities/src/aggregate-root.ts`, `packages/entities/__tests__/aggregate-root.test.ts`.
  - New: `packages/entities/__tests__/entity.test.ts`.
  - Deleted: `packages/entities/src/utils/`, `packages/entities/__tests__/deep-freeze.test.ts`.
  - It holds 16 cases, one over the threshold. The old `AggregateRoot` extends `Entity<TAttributes>`, so the two classes change in one commit.
- [ ] 3. The 3.0.0 surface (test-first). Case 21.
  - `packages/entities/src/index.ts` and `packages/entities/__tests__/index.test.ts` change.
  - `packages/entities/src/entity-id.vo.ts` and `packages/entities/__tests__/entity-id.vo.test.ts` are deleted.
  - In `packages/entities/package.json`, `version` becomes `3.0.0` and `@enardo/events` goes. `pnpm-lock.yaml` is updated with `./dev.sh exec pnpm install`.
- [ ] 4. Docs for 3.0.0 (no test-first). No cases.
  - `packages/entities/README.md`, `packages/uow-repository-mongo/README.md`, `packages/eslint-config/README.md` (*Known limit*).
  - `docs/adr/README.md` (the 0020 row, and 0018's status), and `docs/adr/0018-where-the-refused-value-comes-from.md` (status only).
  - ADR 0020 is committed with this spec.
- [ ] 5. The item leaves the backlog (no test-first): `docs/backlog.md`. No cases.
