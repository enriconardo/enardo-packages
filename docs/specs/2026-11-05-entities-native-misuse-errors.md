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

From the backlog item *`ENTITY_NOT_MUTABLE` and `ENTITY_ALREADY_MARKED_FOR_REMOVAL` of `@enardo/entities` become native errors*, which applies the verdict of ADR 0018, and from a discussion with the user at intake, which settled the decisions below; the `critic`'s first run added open question 1.

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
- The README against `src/` → `pullDomainEvents` (`:123,175,220,230`), `addDomainEvent` (`:123,276`), `clearDomainEvents` (`:234`) and `new EntityId` (`:170,185`) do not exist: the methods are `pullEvents`, `addEvent` and `clearEvents` (`src/aggregate-root.ts:515,405,527`), and the constructor is private, behind `EntityId.create` (`src/entity-id.vo.ts`).
- `pnpm pack` of `packages/entities`, in the dev container → the tarball declares `@enardo/errors` `^1.2.0`, `@enardo/events` `^1.1.0`. `pnpm view @enardo/errors versions` and `@enardo/cqrs` (host) → `1.0.0` alone for each, so `@enardo/errors` 1.2.0 goes first at the publish.
- `cambusa`'s tree → `@enardo/errors@1.0.0` locked (`pnpm-lock.yaml:857`), `^1.0.0` in its manifests, `@enardo/cqrs` `^1.0.0` in four of them. `mapErrorToString` of its `cqrs` 1.0.0 (`dist/index.mjs`) → `error.code` on `instanceof BaseError`, else `error.message`, which `result.error` carries to the route. `packages/cqrs/src/command-handler.ts:25-29`, 2.0.0, unpublished → rethrows an error it does not expect.
- That `cqrs` 1.0.0 with this repo's built entities, in the `critic`'s run → one copy of `@enardo/errors`: `INVALID_ENTITY_ID`; two copies: `EntityId cannot be empty`. A native error, the message of decision 2, entity id included, in `result.error`. **Not probed:** that pnpm makes two copies in `cambusa`, reasoned from the ranges above; ADR 0012 (*Consequences*) describes it, and `pnpm why @enardo/errors` settles it at that move.
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
- **Holding the major** until the next breaking change of `@enardo/entities`, or a project's first `markForRemoval`, and dropping only the README's example in an S task, as the `critic` proposes: *Open questions*.

## Open questions

1. Now, or at the next major of `@enardo/entities`, or a project's first `markForRemoval` (*Not taken*)? Nothing calls these errors, so the major changes no running behaviour: its gain is a smaller public surface and the ADR applied. The recommendation is now: no reader exists, so it is the cheapest moment, and the first `markForRemoval` of a project would otherwise be written on the classes. `cambusa` need not follow: `^1.1.0` loses nothing by staying, so the costs of its move (*Risks*) wait until it has a reason.

## Changes

`packages/entities`:

- `src/aggregate-root.ts`: both throws are `new Error(<the message>)`, from `this.modelName` and `this.id`; `buildLifecycleErrorContext()` and the import go; the JSDoc of `setAttribute`, `setAttributes`, `assertMutable` and `markForRemoval` says `@throws {Error}`, and the `{@link EntityNotMutableError}` of `markForRemoval`'s text goes (`:360`): no check reports a dangling link.
- `src/errors/`: `entity-lifecycle.error.ts`, `entity-not-mutable.error.ts` and `entity-already-marked-for-removal.error.ts` removed, and their exports from `index.ts`.
- `package.json`: `version` `2.0.0`.
- `README.md`: the example at `:223` says it throws an `Error`; *Error classes* becomes *Errors*, in the contents too: `InvalidEntityIdError` with its `code`, which the table lacks today, and a paragraph on the two native errors, with no `code`, whose message is for a person, and on `isMarkedForRemoval()` to check first. Its example goes. A new *Upgrading from 1.x*: the classes, the types and `buildLifecycleErrorContext()` are gone and a use of them fails to compile, a comparison with the old `code` still compiles and is never reached, `JSON.stringify` of an error gives `{}`; `2.0.0` depends on `@enardo/errors` `^1.2.0`, so an app whose other packages allow 1.0.0 keeps one copy of it, or an `instanceof BaseError` of another copy misses `InvalidEntityIdError`.
- `README.md`, in a commit of its own: the names the probes list become `pullEvents`, `addEvent`, `clearEvents` and `EntityId.create`, so `2.0.0` does not ship them.
- `__tests__/entity-lifecycle.error.test.ts`: removed. It tests only the classes.
- `__tests__/aggregate-root.test.ts`: the cases below that reach an aggregate; what stands there stays unchanged.
- `__tests__/index.test.ts`: new, case 8.

`docs/backlog.md`: the item goes, in a commit of its own.

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
11. `EntityId.create(" ")` → `InvalidEntityIdError`, `code` `INVALID_ENTITY_ID`, and `isBaseErrorLike` of it is true: a new assertion in `__tests__/invalid-entity-id.error.test.ts`, whose existing tests stay.

## Risks

`low`. An app that matched on a class by import stops compiling; one that compares `code` as a string compiles and no longer matches, which case 5 pins and *Upgrading from 1.x* says. A caller serializing an error by hand with `JSON.stringify` goes from the whole record to `{}`, and an app's handler recognizing a `BaseError` no longer treats these as its own: on `@enardo/cqrs` 2.x they reach it as unknown errors, which is the point. On `cqrs` 1.0.0, which `cambusa` runs, a native error is no exception: `execute()` returns its `message` as `result.error`, and a route sends it to the client, entity id included (probes). It is latent, since no project calls `markForRemoval`: an app on these versions moves to `cqrs` 2 before its first call.

Moving an app to `2.0.0` brings `@enardo/errors` `^1.2.0`. Beside a package on 1.0.0 that makes two copies, and `INVALID_ENTITY_ID` reaches `cqrs` 1.0.0 as its message, not its `code`, as ADR 0012 *Consequences* warns: the app keeps one copy. No known project does the first group's; `cambusa` meets this one only if it moves.

The message reads `modelName`, a subclass's getter, and `this.id`. `buildLifecycleErrorContext()` already read both at the same point; what is new is `toString()` on the id. It is `EntityId`'s by type, and cannot throw; a value forced in by a cast with a throwing `toString()` would replace this error with a `TypeError`, on a path only a bug reaches. The message now holds the id, as `details` did: an id reaches the same logs as before, and also the `stack`, and no log line gains a newline (probes).

A hook that throws leaves the flag set (case 10), so a retry reports "already" while no `deleted` event exists. It holds today, and stays: the hook's own error came first.

If a project restores `_isMarkedForRemoval` from storage, ADR 0018 judges the verdict again. No project does (probes).

## Out of scope

- Publishing `2.0.0`, after `@enardo/errors` 1.2.0: a session of its own, with the user's approval.
- Moving `cambusa`: it stays on `^1.1.0` until it has a reason. That move, in that repo, keeps one copy of `@enardo/errors` and goes to `cqrs` 2 before the first `markForRemoval`.
- ADR 0012 points 4 and *Alternatives*, which name `EntityLifecycleError` as an example: an accepted ADR records its time, and the rule stands.
- `@enardo/email`'s verdict of ADR 0018: a branch of its own.

## Plan

1. **Test-first:** the `test-author` writes cases 1 to 3, 5, 8 and 9 from this spec, which fail for the expected reason, and 4, 6, 7, 10 and 11, which pass today and pin what stays. Committed with the change of step 2, since a red state is never committed.
2. The throws, `buildLifecycleErrorContext()`, the removal of the classes and of their test file, the exports, the JSDoc, the manifest. `./dev.sh exec pnpm --filter @enardo/entities test`, `typecheck` and `lint` green.
3. README, with the wrong names in a commit of their own.
4. The backlog item goes, in a commit of its own, whose body holds the follow-up of *Out of scope* on `cambusa`. The report of checkpoint 2 repeats it. `pnpm verify`.
