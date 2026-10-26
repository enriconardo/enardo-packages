---
status: done
type: fix
tier: L
implementer: sonnet/medium
packages: ["@enardo/errors", "@enardo/logger"]
branch: fix/repo/aggregate-error-errors
---

# Keep an `AggregateError`'s `errors` in the serialized form and the logs

## Why

The backlog item *The logger drops some errors' content*, from the review of `fix/logger/serialize-nested-errors`. Of its two points, only the first is taken: the second, an error of another realm, moves to *Dropped* (see *Decisions*).

`AggregateError.errors` is an own property that is not enumerable, so the serializers, which copy own enumerable fields plus `name`, `message`, `stack` and `cause`, drop it. Node throws one whenever a connection to a host with several addresses fails (`autoSelectFamily`, on by default): its `message` is empty and its only enumerable field is `code`, so the log keeps `ECONNREFUSED` and loses which address and port were refused, the part needed to act on it.

Two serializers drop it: `serializeError` of `@enardo/errors`, behind every `BaseError.toJSON()`, which the logger uses for a `BaseError` and its whole `cause` chain; and `toLoggable` of `@enardo/logger`, for any other `Error`. Fixing the logger alone would leave the common shape, a `BaseError` wrapping the `AggregateError` as its `cause`, without `errors`.

## Probes

- Dev container, Node 24.21.0: `net.connect` with `autoSelectFamily: true` and a lookup giving `127.0.0.1` and `::1` on a closed port → `AggregateError`, `message: ""`, `Object.keys` `["code"]`, `errors` holding `connect ECONNREFUSED 127.0.0.1:59999` and `connect ECONNREFUSED ::1:59999`.
- `Object.getOwnPropertyDescriptor(new AggregateError([]), "errors")` → `{ writable: true, enumerable: false, configurable: true }`: a caller can replace it with any value or a getter. An `AggregateError` can hold itself in `errors`.
- After `pnpm exec turbo run build --filter=@enardo/logger... --filter=@enardo/errors... --force`, on `main`: a `BaseError` whose `cause` is that `AggregateError` → `toJSON()` gives `cause: { code: "ECONNREFUSED", name: "AggregateError", message: "", stack }`, no `errors`.
- On `main`, `toLoggable({ err: aggregate })` → `{ err: { code, name, message, stack } }`, no `errors`.
- `serializeError`'s `seen` (`packages/errors/src/base/serialize-error.ts:13`) is a set of the errors already visited, never emptied: on a chain, a repeat is a cycle; on a tree (one error in `errors` twice, or in `errors` and as `cause`), it is not. `toLoggable` already tracks ancestors (`packages/logger/src/serialize/to-loggable.ts:42`).
- That browsers' `AggregateError` has the same descriptor is not probed: the tests of `@enardo/errors` run in its browser project too, and show it. `@enardo/logger` is Node only, with no browser project.
- Paths in this repo (the `critic`'s run): `@enardo/database-mongo` logs the driver's error on a failed connect (`mongo.database.ts:82`); with driver 7.6.0 and a dual-stack lookup, the chain is `MongoServerSelectionError` → `MongoNetworkError` → `AggregateError`, and the top message already lists both addresses. `@enardo/http-client`'s `NetworkError` reduces its cause to `name` and `code` (`network-error.ts:76-99`) and never reads `errors`. The gain is for apps that log a raw `net`, `http` or `fetch` error, or wrap one as a `BaseError`'s `cause`, as the errors README recommends.
- `SerializedError`'s index signature (`base-error.types.ts:33`) already types an `errors` key as `unknown`, with `noPropertyAccessFromIndexSignature` off; `__tests__/types.test.ts:166-172` pins its exact shape, so a declared `errors` field fails it (the `critic`'s run: `Expected 1 arguments, but got 0.`).

## Decisions

- **Both packages**, in one branch (tier L), taken with the user: the logger alone would leave a `BaseError`'s cause without `errors`.
- **The second point of the backlog item is dropped**, with the user: no code in the repo, nor an app's log path, meets an error of another realm (`vm`, Jest's environments); `Error.isError` is missing from Node 22 and from the `ES2022` lib of the presets, and `serializeError` would need the same change.
- **`SuppressedError` (`error`, `suppressed`) is left out**: the same gap, but only `using` and `DisposableStack` produce one, and no case is observed.
- **Recognized by `instanceof AggregateError`**, not by an own `errors` field on any error: a class with an enumerable `errors` field already keeps it, and a non-enumerable one elsewhere is not observed.
- **An element of `errors` is treated as a cause is**: an `Error` serialized the same way, anything else kept as is (in the logger: converted as any value).
- **An `errors` that is not an array** (replaced by a caller) is kept as is, as `cause` is; in the logger, converted as any value.
- **Key order:** `errors` after `stack`, before `cause`.
- **No `errors` field on `SerializedError`**: the index signature already types it, and the interface's JSDoc names it. The type, and its test, stay as they are.

## Open questions

None.

## Changes

### `@enardo/errors` (1.1.0 → 1.2.0)

- `serializeError`: for an `AggregateError`, an `errors` key holding its `errors`, each `Error` element serialized like a cause (`"[Circular]"` for an ancestor), any other element as is; an `errors` that is not an array, as is.
- Cycle detection moves from visited to ancestors: an error is `"[Circular]"` only when it is on the path from the root to itself, so the same error reached twice without a cycle is serialized at both places.
- A read of `errors` that throws makes `toJSON()` throw, as a throwing `message` or `stack` already does: unchanged rule, not guarded here (the logger guards).
- JSDoc of `SerializedError` (`base-error.types.ts:23-26`) and of `BaseError.toJSON` (`base-error.ts:71-78`), which list the keys: the `errors` of an `AggregateError`. The type itself does not change.
- README, *Logging: `toJSON()`*: the `errors` of an `AggregateError`, and a cycle defined as a return to an ancestor. *Accept a `cause`* (README:39): the chain's errors include an `AggregateError`'s elements, with their messages, stacks and fields.

### `@enardo/logger` (1.1.0 → 1.2.0)

- `convertError`: for an `AggregateError`, an `errors` key from `convertValue(() => error.errors, ancestors)`, between `stack` and `cause`, left out when `undefined`. Its elements go through `convert`: a `BaseError` element through its `toJSON()`, a cycle to `"[Circular]"`, a throwing read to `"[Unserializable]"`.
- JSDoc of `toLoggable`, README *Conversion*, and the `toLoggable` line of `CLAUDE.md`'s *Invariants*: an `AggregateError` keeps its `errors`.

### Repo

- `docs/backlog.md`: the item leaves *Queued*; its second point goes to *Dropped* with the reason above.

## Test cases

`@enardo/errors`, `BaseError#toJSON`:

1. A `BaseError` whose `cause` is `new AggregateError([new Error("a"), new Error("b")], "")` with `code: "ECONNREFUSED"` → `cause` has `code`, `name: "AggregateError"`, `message: ""`, `stack`, and `errors` with two serialized errors (`name`, `message: "a"` / `"b"`, `stack`), in order.
2. An `AggregateError` cause whose `errors` holds a `BaseError` with its own `cause` → the element has its `code` and its serialized `cause`.
3. `errors` holding a non-error (`"b"`, `{ x: 1 }`, `null`) → kept as is, next to the serialized errors.
4. An `AggregateError` with `errors: []` → `errors: []`.
5. An `AggregateError` whose `errors` holds itself → that element is `"[Circular]"`, no throw.
6. An `AggregateError` whose `errors` holds the wrapping `BaseError` → `"[Circular]"`.
7. The same `Error` twice in `errors` → serialized at both places, not `"[Circular]"` (catches a visited set).
8. One `Error` both in an `AggregateError`'s `errors` and as that `AggregateError`'s `cause` → serialized at both places.
9. An `AggregateError` whose `errors` was replaced by `"x"` → `errors: "x"`.
10. A plain `Error` cause with no `errors` → no `errors` key (existing shape unchanged).
11. The existing cycle cases stay green unchanged.

`@enardo/logger`, `toLoggable`:

12. `toLoggable({ err })` of the aggregate of case 1 → `err` with `code`, `name`, `message`, `stack`, `errors` of two converted errors; key order `…, stack, errors` (and `cause` after `errors` when set).
13. An element that is a `BaseError` → its `toJSON()` shape.
14. An `AggregateError` holding itself in `errors` → `"[Circular]"` at the element.
15. An element whose read throws (a getter on index 0 via `Object.defineProperty` on the array) → `"[Unserializable]"`, the other elements kept.
16. `errors` redefined as a getter that throws → `errors: "[Unserializable]"`, `name`, `message`, `stack` kept.
17. A plain `Error` → no `errors` key.
18. A `BaseError` whose `cause` is the aggregate of case 1, its `toJSON` hidden (as the existing case at `to-loggable.test.ts:60-72`) → `toLoggable` gives what its `toJSON()` gives: the two serializers stay in step.
19. Through `createConsoleLogger` with the `json` format: a log call with an `AggregateError` in metadata, on the call's metadata, a child's and the defaults (package `CLAUDE.md`, *Tests*) → the line holds `errors` with the elements' messages.

## Risks

- **A wrong cycle rule in `serializeError`**: a false `"[Circular]"` hides an error, a missing one recurses until a stack overflow. Cases 5 to 8 and the existing cycle cases show it.
- **Larger log lines**: an `AggregateError` with many elements now logs them all. Accepted: the elements are what the error reports; Node's carry one per address.

## Out of scope

- `SuppressedError`, errors of another realm (see *Decisions*).
- `serializeError` calling a nested cause's `toJSON()` (its own backlog item).
- `@enardo/http-client`: a fetch failure still logs its `NetworkError`'s reduced cause, `{ name: "AggregateError", code }`, by design.

## Plan

1. `[repo] docs`: the backlog item leaves *Queued*, its second point goes to *Dropped*.
2. `@enardo/errors`, test-first: cases 1–9 fail for the missing `errors` key, case 10 passes already (it guards the existing shape); 7 and 8 then pass only with ancestors, not with the visited set kept; then `serializeError`, the JSDoc of `SerializedError` and `toJSON`, README, version 1.2.0.
3. `@enardo/logger`, test-first: cases 12–16, 18 and 19 fail, 17 passes already; then `convertError`, JSDoc, README, `CLAUDE.md`, version 1.2.0.
4. `pnpm verify`.
