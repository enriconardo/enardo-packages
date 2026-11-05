---
status: draft
type: fix
tier: M
implementer: sonnet/medium
packages: ["@enardo/entities"]
branch: fix/entities/native-misuse-errors
---

# Report lifecycle misuse of an aggregate with native errors

## Why

From the backlog item *`ENTITY_NOT_MUTABLE` and `ENTITY_ALREADY_MARKED_FOR_REMOVAL` of `@enardo/entities` become native errors*, which applies the verdict of ADR 0018, and from a discussion with the user at intake, which settled the decisions below.

The two errors refuse a state of the same instance in memory: `_isMarkedForRemoval` is never restored, and `isMarkedForRemoval()` lets a caller check first. Only a bug reaches them, the program has to change, and no branch on a `code` helps. Every `code` is public API (ADR 0012 point 4), and these two have no reader.

Nothing is broken today, and no failure asks for this: it applies the ADR's verdict, and removes public classes that nothing reads.

## Probes

- `pnpm view @enardo/entities versions --registry https://npm.enriconardo.com` (host) → `1.1.0` alone; the manifest's `1.2.0` is unpublished.
- `node_modules/.pnpm/@enardo+entities@1.1.0/.../dist/index.d.mts` in `~/Projects/cambusa` → `1.1.0` exports the three classes and the two types, and has `buildLifecycleErrorContext` (`:257`). So the change breaks a published version, and ships as `2.0.0`.
- `grep -l '"@enardo/entities"'` over `~/Projects/*`, its `packages/*` and `apps/*` manifests → six packages of `cambusa`, on `^1.1.0`, and `en-monorepo/packages/entities`, that repo's own copy. In this repo, none but the package itself.
- `grep -r` in `~/Projects/cambusa`, without `node_modules` and `dist`, for the classes, the codes, `markForRemoval`, `isMarkedForRemoval`, `_isMarkedForRemoval`, `buildLifecycleErrorContext` and `assertMutable` → nothing.
- `git grep` for the same names, outside `packages/entities` and `docs/specs` → `docs/adr/0012-errors-recognized-by-a-brand.md:22,44` (`EntityLifecycleError`, as an example), `docs/adr/0018-where-the-refused-value-comes-from.md:29`, `docs/backlog.md:14`, this item.
- The throw sites, every one → `packages/entities/src/aggregate-root.ts:280` (`assertMutable`, which `setAttributes` calls and `setAttribute` through it) and `:368` (`markForRemoval`). Each reads `buildLifecycleErrorContext()`, which has no other caller.
- The tests today, `./dev.sh exec pnpm --filter @enardo/entities test` → 32 pass, 11 of them in `__tests__/entity-lifecycle.error.test.ts`. `__tests__/aggregate-root.test.ts` has no `toThrow`: no test reaches either throw site.
- What the errors expose, after `./dev.sh exec pnpm exec turbo run build --filter=@enardo/entities... --filter=@enardo/logger... --force`, through `createLogger("console", { format })` of `@enardo/logger`, on `main`'s code → `code`, `details: { entityId: "user-1", entityType: "user" }`, `message`, `name`, `stack`; neither the message nor the stack names the entity. An `Error` whose message holds the two → `message`, `name`, `stack`, each holding `user` and `user-1`, on `json` and `pretty`. So the log keeps what it had, once the message holds them, and loses only `code`. `JSON.stringify` of it → `{}`. `isBaseErrorLike` of it → `false`.
- The same logger, on an id holding a newline, on both formats → the line stays one, the newline escaped as `\n`.
- `src/entity-id.vo.ts` → `EntityId` has a `toString()` returning its string, and `Entity.id` is typed `EntityId`.
- The change of *Changes*, in a throwaway clone, in a throwaway container of the dev image, after `pnpm install --frozen-lockfile --ignore-scripts` and `turbo run build --filter=@enardo/entities...`:
  - `tsc --noEmit` passes; `vitest run` passes on the 21 tests left; `Object.keys` of `dist/index.mjs` → `AggregateRoot`, `Entity`, `EntityId`, `InvalidEntityIdError`. `@enardo/errors` stays a dependency: `InvalidEntityIdError` extends `BaseError`, and `EntityId.create(" ")` gives `INVALID_ENTITY_ID`, which `isBaseErrorLike` accepts.
  - On a removed aggregate of a subclass with `modelName` `user`: a second `markForRemoval` → `constructor === Error`, `Cannot mark user u1 for removal: it already is`; `setAttribute` → `Cannot mutate user u1: it is marked for removal`; each with no own key and no `code`. After both: the hook of `markForRemoval` ran once, one event in the queue, the attribute unchanged.
  - `setAttribute` to the value the attribute already holds, on a removed aggregate → it throws: `assertMutable` runs before the no-op check. The same on `main`.
  - An `onMarkedForRemoval` that throws a `RangeError` → that error reaches the caller, the flag stays set, no `deleted` event; a retry gets the "already" error.
  - The usage of 1.x against those types → `import` of each class and type gives `TS2305`; `this.buildLifecycleErrorContext()` in a subclass, `err.code` and `err.context` on an `Error` give `TS2339`. `(err as { code?: string }).code === "ENTITY_NOT_MUTABLE"` compiles, and is never true.
- `git grep pullDomainEvents` → `packages/entities/README.md:123,175,220,230`, and none in `src/`: the method is `pullEvents` (`src/aggregate-root.ts:515`).
- The earlier misuse tasks → an upgrade section for this same break at `packages/uow-repository-mongo/README.md:306`, `packages/email-nodemailer/README.md:110`, `packages/uow-repository/README.md:496`.

## Decisions

Taken with the user at intake.

1. **A native `Error`, both.** The refused thing is the instance's state, not an argument, so a `TypeError` does not describe it, and no caller branches on the difference (ADR 0018).
2. **The message names the entity:** `Cannot mutate user user-1: it is marked for removal`, and `Cannot mark user user-1 for removal: it already is`. It takes over what `details` gave, or the log would lose which aggregate failed; the messages of `@enardo/env` could stay word for word because they already held their key. The message is for a person, as `@enardo/errors` says ("never parse `message`"); the tests pin the wording, which still may change in a minor.
3. **The classes go**, `EntityNotMutableError`, `EntityAlreadyMarkedForRemovalError` and `EntityLifecycleError`, with the types `EntityLifecycleErrorCode` and `EntityLifecycleErrorContext`, `details` and `context`. A class of the package's own would invite the `instanceof` the rule means to remove the need for, as in the earlier misuse tasks.
4. **`buildLifecycleErrorContext()` goes.** With no error to attach it to it has no purpose; it is `protected`, so public API to a subclass, and `cambusa` does not call it. `assertMutable()` stays.
5. **`2.0.0`,** with an *Upgrading from 1.x* section in the README. The unpublished `1.2.0` is folded into it.
6. **No `code` on the native errors** (ADR 0018 point 4). Adding one later is a minor.
7. **`InvalidEntityIdError` stays as it is** (ADR 0018), and `@enardo/errors` with it.

Not taken:

- **`TypeError`, or `RangeError`:** decision 1.
- **The messages word for word, as in `@enardo/env`:** decision 2.
- **Keeping `buildLifecycleErrorContext()` as a helper for subclasses:** nothing known calls it, and a subclass reads `modelName` and `id` itself.

## Open questions

None.

## Changes

`packages/entities`:

- `src/aggregate-root.ts`: both throws are `new Error(<the message>)`, from `this.modelName` and `this.id`; `buildLifecycleErrorContext()` and the import go; the JSDoc of `setAttribute`, `setAttributes`, `assertMutable` and `markForRemoval` says `@throws {Error}`.
- `src/errors/`: `entity-lifecycle.error.ts`, `entity-not-mutable.error.ts` and `entity-already-marked-for-removal.error.ts` removed, and their exports from `index.ts`.
- `package.json`: `version` `2.0.0`.
- `README.md`: the example at `:223` says it throws an `Error`; *Error classes* becomes *Errors*, in the contents too: `InvalidEntityIdError` with its `code`, which the table lacks today, and a paragraph on the two native errors, with no `code`, whose message is for a person, and on `isMarkedForRemoval()` to check first. Its example goes. A new *Upgrading from 1.x*: the classes, the types and `buildLifecycleErrorContext()` are gone and a use of them fails to compile, a comparison with the old `code` still compiles and is never reached, `JSON.stringify` of an error gives `{}`.
- `__tests__/entity-lifecycle.error.test.ts`: removed. It tests only the classes.
- `__tests__/aggregate-root.test.ts`: the cases below that reach an aggregate; what stands there stays unchanged.
- `__tests__/index.test.ts`: new, case 8.

`docs/backlog.md`: the item goes, in a commit of its own; a new item under *To evaluate*, on the README's `pullDomainEvents` (*Out of scope*).

## Test cases

Cases 1 to 3 run on two subclasses, `user`/`user-1` and `order`/`o-9`, so a message fixed to one, or to the class's name, fails.

1. A second `markForRemoval` → an error whose `constructor` is `Error` and `name` `"Error"`, so a subclass or a `TypeError` fails it. Message: `Cannot mark <model> <id> for removal: it already is`.
2. `setAttribute`, then `setAttributes`, with a new value, on a removed aggregate → the same class and name. Message: `Cannot mutate <model> <id>: it is marked for removal`.
3. `assertMutable()`, called by a subclass → on a removed aggregate, the error of case 2; on a live one, no throw.
4. `setAttribute` to the value the attribute already holds, on a removed aggregate → the error of case 2. It pins today's order, so an implementation moving the check after the no-op fails.
5. Each of the two errors → no own `code`, `details` or `cause` (`Object.hasOwn`), and `"code" in error` and `"context" in error` are false; `isBaseErrorLike(error)` is false.
6. A refused second `markForRemoval`, on a subclass counting `onMarkedForRemoval` → the hook ran once, `pullEvents()` holds one `user.deleted`, `isMarkedForRemoval()` is true. So a throw placed after the hook or the event fails.
7. A refused `setAttribute`, on a subclass with `updatedAt` counting `onBeforeAttributeMutation` and `onAttributeMutation` → neither ran, the attribute and `updatedAt` are unchanged, and no `user.updated` is queued.
8. The entry point → `Object.keys` sorted is exactly `AggregateRoot`, `Entity`, `EntityId`, `InvalidEntityIdError`.
9. `"buildLifecycleErrorContext" in aggregate` → false.
10. An `onMarkedForRemoval` that throws a `RangeError` → that very object reaches the caller, `isMarkedForRemoval()` is true, `pullEvents()` is empty; a second `markForRemoval` gives the error of case 1. It pins what holds today.
11. `EntityId.create(" ")` → the `InvalidEntityIdError` of `__tests__/invalid-entity-id.error.test.ts`, with no change to that file; `isBaseErrorLike` of it is true (added there only if it does not say so yet).

## Risks

`low`. An app that matched on a class by import stops compiling; one that compares `code` as a string compiles and no longer matches, which case 5 pins and *Upgrading from 1.x* says. A caller serializing an error by hand with `JSON.stringify` goes from the whole record to `{}`, and an app's handler recognizing a `BaseError` no longer treats these as its own: they reach it as unknown errors, which is the point. No known project does any of these.

The message reads `modelName`, a subclass's getter, and `this.id`. `buildLifecycleErrorContext()` already read both at the same point; what is new is `toString()` on the id. It is `EntityId`'s by type, and cannot throw; a value forced in by a cast with a throwing `toString()` would replace this error with a `TypeError`, on a path only a bug reaches. The message now holds the id, as `details` did: an id reaches the same logs as before, and also the `stack`, and no log line gains a newline (probes).

A hook that throws leaves the flag set (case 10), so a retry reports "already" while no `deleted` event exists. It holds today, and stays: the hook's own error came first.

If a project restores `_isMarkedForRemoval` from storage, ADR 0018 judges the verdict again. No project does (probes).

## Out of scope

- Publishing `2.0.0`: a session of its own, with the user's approval. Then `cambusa` moves from `^1.1.0`, in that repo: it reads nothing this removes.
- The README's `pullDomainEvents`, which no version has: a new item under *To evaluate*, with its own branch.
- ADR 0012 points 4 and *Alternatives*, which name `EntityLifecycleError` as an example: an accepted ADR records its time, and the rule stands.
- `@enardo/email`'s verdict of ADR 0018: a branch of its own.

## Plan

1. **Test-first:** the `test-author` writes cases 1 to 3, 5, 8 and 9 from this spec, which fail for the expected reason, and 4, 6, 7, 10 and 11, which pass today and pin what stays. Committed with the change of step 2, since a red state is never committed.
2. The throws, `buildLifecycleErrorContext()`, the removal of the classes and of their test file, the exports, the JSDoc, the manifest. `./dev.sh exec pnpm --filter @enardo/entities test`, `typecheck` and `lint` green.
3. README.
4. The backlog item goes and the new one enters, in a commit of its own, whose body holds the follow-up: `cambusa` moves to `^2.0.0` once it is published. The report of checkpoint 2 repeats it. `pnpm verify`.
