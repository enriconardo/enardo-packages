---
status: done
type: chore
packages: ["@enardo/http"]
branch: chore/http/package-hygiene
---

# `@enardo/http`: package hygiene

## Why

The first item of the backlog, from the architectural review of `@enardo/http` (2026-09-25):

- drop the unused `undici` peer dependency, and update the `undici` example in the root `CLAUDE.md`;
- set a real `description`;
- use named exports;
- fix `isIterable` per ADR 0003, and use `Object.entries`;
- make the tests import from the entry point, and add a public-surface test.

Probes ran on `master` (`9858ce8`) in the dev container, unless stated otherwise.

## Changes

### 1. The `undici` peer dependency

`package.json` declares `undici: ">=5"` as an optional peer dependency. `src/` never imports it, and the lint forbids it since `fix/http/runtime-neutral-types`. `peerDependencies` and `peerDependenciesMeta` go.

Probed by removing them and running `pnpm install`:
- the lockfile loses `undici@8.10.0`, from the `packages/http` importer and from the packages: nothing else depends on it;
- `packages/http/node_modules/undici` is gone;
- in a temporary file in `src/`, `import type … from "undici"`, `import type … from "undici-types"` and `import("undici")` each fail all three programs (`tsconfig.json`, `tsconfig.browser.json`, `tsconfig.node.json`) with TS2307;
- the lint still reports the static `undici` import, with its message.

Two blind spots recorded by the last branch close with it:
- the browser program missed Node globals after an `undici` import, whose types pull in `@types/node`. The import no longer resolves;
- a dynamic `import("undici")` passed every check. It now fails the typechecks.

Follow-ups:
- `packages/http/CLAUDE.md`: the *Checks* table and the comment in `eslint.config.js` stop describing the `undici` blind spot, and say that `undici` is not installed in the package, so an import of it fails every program.
- The lint restriction on `undici` stays (decision 4).
- Root `CLAUDE.md`: "Third-party drivers (`mongodb`, `bcrypt`, `undici`) are `peerDependencies` of the adapter" becomes "(`mongodb`, `bcrypt`)". These are the only two drivers declared as peer dependencies today.

### 2. The description

`"A Fetch Package"` becomes `"HTTP client over the Fetch API, for browser apps and Node servers"`, the role stated in the package's `CLAUDE.md`.

### 3. Named exports

`http-client.ts` and `http-response.ts` end with `export default`. They become `export class HttpClient` and `export class HttpResponse`, and `index.ts` re-exports them by name. The "Export classes" and "Export types" comments go: they say what, not why.

The entry point does not change. Its runtime exports are `HttpClient` and `HttpResponse` (probed on the built `dist/`). `@cambusa/web`, the only consumer, imports `{ HttpClient }`.

### 4. `isIterable` and `Object.entries`

`toHeaders` (`src/utils.ts`) turns a `HeadersInput` into `Headers`. After `null`, `undefined` and `Headers` are handled, the input is a `HeadersInputRecord` or a `HeadersInputIterable`, and `isIterable` picks the branch:

```ts
function isIterable(input: unknown): input is HeadersInputIterable
```

It checks only that `Symbol.iterator` is a function. ADR 0003 names it as a guard that claims more than it checks, and offers two fixes.

**Typing the parameter as the union does not fix it.** The check would need to tell the two members apart, and it does not. Probed: an object whose only member is a `Symbol.iterator` method that yields numbers compiles as a `HeadersInputRecord`, because a string index signature does not see symbol keys. That object passes the check, and is not an iterable of pairs.

**So the guard narrows to what it proves, and the elements are checked while iterating:**
- `isIterable` narrows to `Iterable<unknown>`;
- each element must be a header pair: an array of exactly two items, whose name is a string, and whose value is a string, an array of strings, or `undefined`;
- any other element throws a `TypeError` with the message `Expected a [name, value] header pair`. Native `Headers` also throws a `TypeError` for a malformed pair.

**Records take their own keys only.** The record branch iterates with `for…in`, which also visits inherited enumerable keys. `Object.entries` replaces it. It takes own enumerable string keys, as native `Headers` does. Record values are not checked: no guard claims anything about them (decision 2).

Probed with the current `toHeaders`, and with `new Headers()` on the same input:

| Input | `toHeaders` today | `new Headers()` | After |
| --- | --- | --- | --- |
| a record whose prototype has an enumerable `x-inherited` | `x-inherited` is set | left out | left out |
| `[["x-only-name"]]` | nothing is set | `TypeError` | `TypeError` |
| `[["a", "b", "c"]]` | `a: b` is set | `TypeError` | `TypeError` |
| `["ab"]` | `a: b` is set | `TypeError` | `TypeError` |
| `[[1, "v"]]` | `1: v` is set | `1: v` is set | `TypeError` |
| `[["x-n", 1]]` | `x-n: 1` is set | `x-n: 1` is set | `TypeError` |
| a `Set<number>`, or the object above | `TypeError` (`.for is not iterable`) | `TypeError` | `TypeError`, with the message above |
| a `Map<string, string>` | its entries are set | its entries are set | unchanged |
| `{ "x-n": 1 }` | `x-n: 1` is set | `x-n: 1` is set | unchanged |
| **Added after review:** the string `"abc"` | `0: a`, `1: b`, `2: c` are set: it took the record branch | `TypeError` | `TypeError`, with the message above |
| **Added after review:** `[new Set(["x-s", "v"])]` | `x-s: v` is set | `x-s: v` is set | `TypeError`: a pair is an array |

Every input the types accept behaves as before, except a record with an inherited key, and the message of the `TypeError` for the object above. Only casts and JavaScript callers can pass the other rows.

Through `HttpClient`, `toHeaders` runs inside the `try` of `request()`. So the `TypeError` reaches the caller wrapped in a `NetworkError`, as the destructuring `TypeError` already does today (probed by the review: `fetchImpl` is not called). `feature/http/client-errors` builds the headers outside the `try`.

**Added after review**: the `Headers` of the npm `undici`, which a `fetchImpl` built on it returns, are not `instanceof` the global `Headers`, so they now go through the pair check. Probed with `undici` 8 installed outside the repo: a `Response` of it, passed through `HttpResponse`, keeps its entries, and `getSetCookie()` still gives the two `set-cookie` values apart.

### 5. Tests through the entry point

Today the tests import `~/http-client`, `~/http-response`, `~/logger` and `~/utils`. Nothing pins the public surface, and moving a file breaks tests that do not test it.

After this branch, every test imports from `~/index` only:
- `http-client.test.ts` and `http-response.test.ts` change only their imports;
- `utils.test.ts` tests `toHeaders`, which the entry point does not export. Its cases move to `header.test.ts`, which mirrors `src/header.ts`, where `HeadersInput` is declared. They go through the `headers` option of `HttpResponse`, the shortest public path to `toHeaders`;
- its clone case moves to `http-client.test.ts`. `Response` copies its headers anyway, so the copy shows only in what the client hands to `fetchImpl`;
- `index.test.ts` pins the public surface, as `@enardo/errors` does.

## Test cases

Designed here, written by the `test-author` in two runs (decision 5).

### Run 1: move to the entry point, pin the surface

All pass on `master`: they pin what exists, and reproduce nothing.

**`index.test.ts`**
1. The runtime exports of the entry point are exactly `HttpClient` and `HttpResponse`, compared as a sorted list.
2. Each exported type imports from the entry point and is not `any`: `HttpMethod`, `HttpClientOptions`, `RequestOptions`, `QueryValue`, `HttpResponseOptions`, `HeadersInput`, `HeadersInputRecord`, `HeadersInputIterable`, `Logger`, `LoggerMetadata`. Removing one fails `typecheck`.
3. `HttpBody` is not exported (`@ts-expect-error` on its import), per decision 4 of `fix/http/runtime-neutral-types`.

**`header.test.ts`**, through `new HttpResponse(null, { headers })` and `response.headers`:

4. `undefined` and `null` give no headers.
5. A record sets its headers. A `string[]` value sets the header once per item. An `undefined` value sets nothing. **Amended after review**: "once per item" is observed on `set-cookie`, with `getSetCookie()`; `Headers` joins the values of any other name, so a joined value would look the same.
6. An iterable of pairs (an array) sets its headers, with the same `string[]` and `undefined` rules.
7. A `Map<string, string>` sets its entries.

**`http-client.test.ts`**

8. A `Headers` instance passed as `headers` does not reach `fetchImpl` as the same object, and the object `fetchImpl` gets has the same entries.

Every other case of `http-client.test.ts` and `http-response.test.ts` stays as it is, with its import changed. `utils.test.ts` is deleted once its cases are in `header.test.ts`.

### Run 2: the new behavior

In `header.test.ts`. Each is seen failing on the current `toHeaders` for the reason given.

9. A record whose prototype has an enumerable `x-inherited`, plus an own `x-own`: only `x-own` is set. Fails today: `x-inherited` is set.
10. Each malformed element throws a `TypeError` with the message `Expected a [name, value] header pair`: `["x-only-name"]`, `["a", "b", "c"]`, `"ab"`, `[1, "v"]`, `["x-n", 1]`, `["x-a", ["a", 1]]`. These need a cast. Fails today: nothing is thrown.
11. The object of the probe, typed as a `HeadersInputRecord` with no cast, whose `Symbol.iterator` yields numbers: the same `TypeError` and message. Fails today on the message (`.for is not iterable`).

## Decisions (to confirm at checkpoint 1)

1. **Checking the pairs is part of fixing the guard.** ADR 0003 offers two fixes, and the probe rules out the one with no runtime change. The other one changes behavior only for inputs that the types reject, and matches native `Headers` on malformed pairs.
2. **Record values are not checked.** No guard claims anything about them: `Object.entries` gives them the record's declared value type. A number value is still converted by `Headers.append`, as native `Headers` does. Pair values are checked, because there the check is what makes the narrowing sound. The two branches differ only for inputs the types reject.
3. **No test imports an internal module.** The `toHeaders` cases go through `HttpResponse`, so the internal files can move (as `feature/http/client-errors` will move them) without touching the tests.
4. **The lint restriction on `undici` stays.** An import already fails the typechecks. The lint adds the reason, in the editor: transport settings go through `fetchImpl`. Adding `undici` back as a dependency would make the TS2307 go away and reopen the browser program's blind spot: the lint would be the only check left.
5. **Two `test-author` runs.** Run 1 passes on `master` and gets its own commit. Run 2 is red until the fix, and is committed with it. With one run, the green part and the red part would share `header.test.ts`, and could only be split by staging hunks.

## Found while exploring

To add to *To evaluate* in `docs/backlog.md`, in a commit of their own, if approved:

- **Default exports in `@enardo/database` and `@enardo/database-mongo`** (`DatabaseError`, `MongoDatabase`), the only ones left in `packages/*/src` after this branch. `no-restricted-exports` with `restrictDefaultExports`, on `src/` in the presets, would keep them out.
- **`nodemailer` is a dependency of `@enardo/email-nodemailer`**, not a peer dependency, while the root `CLAUDE.md` says that third-party drivers are peer dependencies of the adapter.

## Out of scope

- **Building the headers outside the `try` of `request()`**: `feature/http/client-errors`.
- **Checking record values**: decision 2.
- **The lint rule against default exports**: it belongs in a preset, with the item above.

## Verification

1. **`pnpm verify`**: `@enardo/http` and `@cambusa/web`, its only dependent.
2. **Run 2 seen failing** on the current `toHeaders`, each case for the reason listed, before any production code.
3. **The undici probe, repeated** after the removal: the three temporary imports fail all three programs with TS2307; the lint reports the static one. The temporary file is removed and never committed.
4. **The lockfile diff** removes `undici@8.10.0` and nothing else.
5. **The built entry point**: the runtime exports of `dist/index.mjs` are still `HttpClient` and `HttpResponse`, and `dist/index.d.mts` exports the same names as on `master`. `pnpm --filter @cambusa/web build` passes.

## Plan

Each step ends with `pnpm verify` green and one commit.

1. **Spec** (this file).
2. **`undici`**: the peer dependency, the lockfile, the root `CLAUDE.md` example, the package's `CLAUDE.md` and the `eslint.config.js` comment. Verification 3 and 4.
3. **Description.**
4. **Run 1** of the `test-author`, committed once green.
5. **Run 2** of the `test-author`, seen failing (verification 2); then `isIterable`, the pair check and `Object.entries`. One commit.
6. **Named exports**, with the tests unchanged. Verification 5.
7. **The package's `CLAUDE.md`**: tests import from the entry point only, and `index.test.ts` lists the surface. The *To evaluate* items, in a commit of their own.
8. **Review**, checkpoint 2, integration. The backlog item leaves `docs/backlog.md` in a commit of its own, before the merge.
