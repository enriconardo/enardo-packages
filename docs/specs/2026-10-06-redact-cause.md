---
status: done
type: fix
packages: ["@enardo/http-client"]
branch: fix/http-client/redact-cause
---

# `@enardo/http-client`: the `cause` of a `NetworkError` leaks URLs and response bytes

## Report

The first item of the backlog, a prerequisite for server use: the logs must carry no response bodies or query strings.

`NetworkError` keeps what `fetchImpl` rejected with as its `cause`. Whatever that chain holds reaches the log of `HttpClient` and the error's `toJSON()`.

Probed on `master` (`5ca5f21`), on Node 24.21.0, through the built `dist/`: the default `fetchImpl`, local `node:http` and `node:net` servers, and `@enardo/logger`'s console logger in JSON format. The fourth trigger ran in a throwaway container with npm `undici` 8.11.2.

| Trigger | Chain of the `cause` | What leaks | Markers in the log and in `toJSON()` |
| --- | --- | --- | --- |
| a URL with credentials, from the caller | `TypeError` | its message: `Request cannot be constructed from a URL that includes credentials: http://u:p@127.0.0.1:1/p?q-s=1` | the credentials, the query string |
| a redirect to `/bad?hop-secret=1#hop-frag`, then a `Location` that does not parse | `TypeError: fetch failed` → `TypeError` `ERR_INVALID_URL` | own fields `input` (the `Location`) and `base` (that hop's URL) | `hop-secret`, `hop-frag`, the `Location` |
| a malformed response (`X-Note : a`) | `TypeError: fetch failed` → `HTTPParserError` | own field `data`: the rest of the raw response | `body-secret` |
| npm `undici`'s `responseError` interceptor, through `fetchImpl` | `TypeError: fetch failed` → `ResponseError` `UND_ERR_RESPONSE` | own fields `headers` and `body` | `header-secret`, `body-secret` (in `toJSON()`) |

The other failures probed carry nothing secret today, and give their reason through a `code`:

| Failure | Chain |
| --- | --- |
| a refused connection (a closed port) | `TypeError: fetch failed` → `Error` `ECONNREFUSED`, with `errno`, `syscall`, `address`, `port` |
| a DNS failure (`nonexistent.invalid`) | `TypeError: fetch failed` → `Error` `ENOTFOUND`, with `errno`, `syscall`, `hostname` |
| a self-signed certificate | `TypeError: fetch failed` → `Error` `DEPTH_ZERO_SELF_SIGNED_CERT` |
| the socket closed before a response | `TypeError: fetch failed` → `SocketError` `UND_ERR_SOCKET`, with `socket` (addresses and ports) |
| a port `fetch` refuses (`:1`) | `TypeError: fetch failed` → `Error: bad port`, no code |
| `GET` with a body | `TypeError: Request with GET/HEAD method cannot have body.`, no code |

**Added after review**: a name that resolves to both `::1` and `127.0.0.1`, both refused, gives the same chain as a refused connection, with the `Error` of the last address, and no `AggregateError` (probed in a throwaway container, with two `--add-host` entries for one name).

## Root cause

`toJSON()` (`serializeError` of `@enardo/errors`) writes, for each error of the chain, its own enumerable fields, its `message` and its `stack`. A `stack` starts with the message (probed: `TypeError: Request cannot be constructed from a URL that includes credentials: http://u:p@h/?q-s=1`). `util.inspect` prints the chain too.

**Overriding `toJSON()` on `NetworkError` would not close it.** Probed with a subclass whose `toJSON()` returns `{ name, overridden: true }`: alone, its JSON is the override's. Wrapped as the `cause` of another `BaseError`, the case the README shows for `HttpResponseError`, the wrapper's `toJSON()` and its log carry the credentials: `serializeError` walks a nested cause with its own rules and never calls the cause's `toJSON()`. `util.inspect` of the wrapper carries them as well.

## Fix

**The `NetworkError` constructor replaces the `cause` it is given with a reduced copy.** No field of the instance points to the original, so no serializer can reach it, whoever builds the error.

The reduced copy is a chain of plain objects, one per error of the original chain:

```ts
/** What a `NetworkError` keeps of one error of the rejection's `cause` chain. */
export interface NetworkErrorCause {
  readonly name: string;
  /** The error's `code`, when it is a string (`"ECONNREFUSED"`). */
  readonly code?: string;
  readonly cause?: NetworkErrorCause;
}
```

`NetworkError` declares `cause` as `NetworkErrorCause | undefined`.

- **Kept, for each error:** `name`, and `code` when it is a string. A key whose value is missing is left out, not set to `undefined`.
- **Dropped:** the `message`, the `stack`, every other own field (`input`, `base`, `data`, `headers`, `body`, `socket`, `errno`, `syscall`, `address`, `port`, `hostname`), and the `errors` of an `AggregateError`: only `cause` is followed.
- **Only an `Error` (`instanceof Error`) makes a link.** A non-`Error` ends the chain: a rejection with a string or a plain object gives no `cause` at all, and one deeper in the chain is left out. An error from another realm fails `instanceof` and is left out too.
- **A cycle ends the chain** at the first error already seen.
- **Added after review: a link needs a string `name`.** An `Error` whose `name` is not a string ends the chain, as a non-`Error` does. The review probed `name: { leak: "body-secret" }`: it reached the JSON whole, and `name: undefined` gave a key set to `undefined`, against the type and the rule above.
- **Added after review: the reduction never throws.** It reads the rejection, which the constructor did not do before. A getter or a Proxy trap that throws made the constructor throw, so `request()` rejected with that error instead of a `NetworkError`, and logged nothing; so did a chain of 20,000 links, with `RangeError: Maximum call stack size exceeded` (the review, verified by running). A read that throws counts as missing:
  - a throwing `instanceof` check (a revoked Proxy) or `name`: the chain ends before that error;
  - a throwing `code`: the link has no `code`;
  - a throwing `cause`: the chain ends after that error.
- **Added after review: at most 10 links.** The longest chain probed has two. The links past the tenth are left out, with no marker.
- **`HttpClient` does not change**: it already builds `new NetworkError(method, url, { cause })`.

Probed with this rule (in JavaScript, on a stand-in subclass of `BaseError`), fed with the real rejections of Node's `fetch`. No marker reaches `toJSON()`, the JSON of a wrapping `BaseError`, `@enardo/logger`'s JSON log, or `util.inspect` of the wrapper. For npm `undici`'s trigger, only the reduced chain was checked:

| Trigger | `cause` after |
| --- | --- |
| a refused connection | `{ name: "TypeError", cause: { name: "Error", code: "ECONNREFUSED" } }` |
| a DNS failure | `{ name: "TypeError", cause: { name: "Error", code: "ENOTFOUND" } }` |
| a `Location` that does not parse | `{ name: "TypeError", cause: { name: "TypeError", code: "ERR_INVALID_URL" } }` |
| a malformed response | `{ name: "TypeError", cause: { name: "HTTPParserError" } }` |
| npm `undici`'s `responseError` (undici 8.11.2) | `{ name: "TypeError", cause: { name: "ResponseError", code: "UND_ERR_RESPONSE" } }` |
| a URL with credentials; `GET` with a body | `{ name: "TypeError" }` |
| a port `fetch` refuses (`:1`) (**added after review**) | `{ name: "TypeError", cause: { name: "Error" } }` |
| `new DOMException("…", "AbortError")` (its `code` is the number 20) | `{ name: "AbortError" }` |
| a `TypeError` whose `cause` is a string | `{ name: "TypeError" }` |
| two errors that are each other's `cause` | `{ name: "Error", cause: { name: "Error" } }` |

**The type** compiles in both runtime programs (`tsconfig.node.json`, `tsconfig.browser.json`) with `isolatedDeclarations`, and the declaration comes out as written (probed). An assignment to `cause` fails, as it does for the `readonly` `details`.

**Docs**, in the same commit as the code, as `packages/http-client/CLAUDE.md` asks for a public API change:

- **README**, *Errors*: what `cause` keeps, with the refused connection as the example; the three failures whose reason is lost (below); how to see a rejection whole, by wrapping `fetchImpl`. The bullet *Not the `cause` of a `NetworkError`* and its four triggers go from *What the errors keep out of the logs*, replaced by a bullet saying what `cause` keeps. **Amended after review**: the bullet that replaces it says what `cause` no longer has, and keeps the four triggers as the list of what the client keeps out; `CLAUDE.md` points to that list for the tests. The README also says that an `Error` from another realm gives no `cause`, and gives the shape of each of the three failures whose reason is lost.
- **README**, *Logs*: the sentence on the `error` of a `NetworkError` goes. *Not there yet*: the `cause` bullet goes. *Exports*: `NetworkErrorCause`.
- **`CLAUDE.md`**: the logs meet the server requirement, with no exception; the reduction is done in the constructor, never in `toJSON()`, and why (the probe of *Root cause*).
- **JSDoc** on `NetworkError` (its `cause`) and on `NetworkErrorCause`.

### Public API, before and after

| Export | After |
| --- | --- |
| `NetworkError` | `cause` is a `NetworkErrorCause`, or `undefined`, instead of the object given |
| `NetworkErrorCause` | new type |
| everything else | unchanged |

## Decisions (to confirm at checkpoint 1)

1. **The original rejection is not kept, not even in memory.** A `toJSON()` override would keep it for code that inspects it, but would leak through a wrapping error and `util.inspect` (see *Root cause*). A second, non-enumerable field holding the original would stay out of both by default (not probed), but would put back on the error what this branch takes off it, one serializer option (`showHidden`) away from a log. A caller that needs the whole rejection, to debug it, wraps `fetchImpl` and reads it there; the README shows how.
2. **Messages are dropped**, as the backlog item requires. Three failures lose their reason, because Node's `fetch` gives them no `code`: a URL with credentials, a port `fetch` refuses, and `GET` or `HEAD` with a body. All three are requests that never went out. The alternative, messages with their URLs redacted, closes the four triggers known today, but trusts every fetch implementation to put no response bytes in a message.
3. **`name` and a string `code`, and nothing else.** The `code` is the reason (`ECONNREFUSED`, `ENOTFOUND`); `errno` and `syscall` repeat it, `hostname` repeats `details.url`, and `address` and `port` belong to the transport. A number `code` (a `DOMException`'s legacy one) repeats its `name`. `name` and `code` are identifiers by convention, and the client trusts that convention.
4. **Plain objects under `cause`**, typed and exported. Rebuilt `Error`s would carry a stack pointing at the client instead of where the failure happened. `cause` is where the reason was before, so `error.cause?.cause?.code` still reads `"ECONNREFUSED"` on Node. Moving the reason into `details` would also work, but change where callers look for it.

## Found while exploring

To add to `docs/backlog.md`, in a commit of its own, if approved:

- **`serializeError` of `@enardo/errors` never calls a nested cause's `toJSON()`** (probed, see *Root cause*). An error class that controls its serialized form through `toJSON()` loses that control once another error wraps it. `@enardo/logger` calls `toJSON()` on the logged value only, so the nested cause goes through `serializeError` there too. **Amended after review**: that sentence is wrong. `@enardo/logger` calls the `toJSON()` of every value it reaches, at any depth: under a wrapping plain `Error`, the nested cause's `toJSON()` is called. Under a wrapping `BaseError`, the wrapper's own `toJSON()` hands the logger a chain that `serializeError` has already serialized, so the cause's `toJSON()` is never called (the review, verified by running). Latent: no error class in the monorepo overrides `toJSON()` today. *To evaluate*.
- **A URL with credentials loses its reason** with this branch: its `cause` becomes `{ name: "TypeError" }`. The item of this branch says that `fix/http-client/base-url` rejects such a URL, but the item of `fix/http-client/base-url` does not say so. Rejecting it before the call, as a `TypeError` like an invalid URL, would give the reason back. Proposed: add it to the *What* of `fix/http-client/base-url`.
- **The item on `GET` and `HEAD` with a body** (*To evaluate*) gets one more reason: after this branch, the `NetworkError` no longer says why the request did not go out.

## Out of scope

- **The path of the URL is logged**, as before: a token in `/reset/<token>` reaches the logs.
- **The `TypeError`s of a URL or a header that cannot be built** stay unredacted and unlogged: they are the caller's errors (decision 7 of `feature/http/client-errors`).
- **Browsers**: not probed, the container has none. The reduction uses only `instanceof Error`, `name`, `code` and `cause`. A browser's `fetch` rejects with a `TypeError` whose message (`Failed to fetch` in Chrome, `Load failed` in Safari) says little more than its name (not probed).

## Test cases

Test-first: a bug fix, on the public API of an `@enardo/*` package. The `test-author` writes them from this spec in one run, in the foreground. The tests import from `~/index` only; `BaseError` comes from `@enardo/errors`.

The cases reproduce the shapes probed in the *Report*, with markers in the places that leak:

- **credentials**: `new TypeError("Request cannot be constructed from a URL that includes credentials: https://alice:hunter2@api.example.com/v1/users?token=q-secret")`;
- **bad `Location`**: `new TypeError("fetch failed", { cause })`, where `cause` is a `TypeError("Invalid URL")` with the own fields `code: "ERR_INVALID_URL"`, `input: "http://exa mple.com/"` and `base: "https://api.example.com/bad?hop-secret=1#hop-frag-secret"`;
- **malformed response**: `new TypeError("fetch failed", { cause })`, where `cause` is an `Error` with the own fields `name: "HTTPParserError"`, `code: undefined` and `data: " : a\r\nSet-Cookie: sid=cookie-secret\r\n\r\nbody-secret"`;
- **`responseError`**: `new TypeError("fetch failed", { cause })`, where `cause` is an `Error("Response Error")` with the own fields `name: "ResponseError"`, `code: "UND_ERR_RESPONSE"`, `statusCode: 500`, `headers: { "set-cookie": "sid=header-secret" }` and `body: { token: "body-secret" }`;
- **refused**: `new TypeError("fetch failed", { cause })`, where `cause` is an `Error("connect ECONNREFUSED 10.0.0.1:443")` with the own fields `errno: -111`, `code: "ECONNREFUSED"`, `syscall: "connect"`, `address: "10.0.0.1"` and `port: 443`.

### `__tests__/errors/network-error.test.ts`

1. For each of the five shapes, `error.cause` is the chain of the *Fix* table (`toStrictEqual`, so a plain object, with no `message`, `stack` or other key). The shape is a fresh instance per case.
2. For the first four shapes, no marker reaches `JSON.stringify(error)`, the `JSON.stringify` of an error of a `BaseError` subclass defined in the test with `error` as its `cause`, or `util.inspect` of that wrapper (`depth: null`). Markers: `alice`, `hunter2`, `q-secret`, `hop-secret`, `hop-frag-secret`, `exa mple`, `cookie-secret`, `body-secret`, `header-secret`.
3. `toJSON().cause` equals the same chain.
4. `error.cause` is not the object given (`not.toBe`).
5. A `code` that is not a string is left out: `new DOMException("The operation was aborted.", "AbortError")` gives `{ name: "AbortError" }`, and an `Error` with `code: 42` gives `{ name: "Error" }`.
6. A non-`Error` rejection gives an undefined `cause`, and no `cause` key in `toJSON()`: the string `"body-secret"`, a plain object `{ name: "ResponseError", code: "UND_ERR_RESPONSE", body: "body-secret" }`, and `null`.
7. A non-`Error` deeper in the chain is left out: `new TypeError("fetch failed", { cause: "body-secret" })` gives `{ name: "TypeError" }`.
8. Cycles end: a `TypeError` and a `RangeError` that are each other's `cause` give `{ name: "TypeError", cause: { name: "RangeError" } }`; a `TypeError` that is its own `cause` gives `{ name: "TypeError" }`.
9. Only `cause` is followed: an `AggregateError` with the own field `code: "ECONNREFUSED"` and one error in `errors`, itself with a code, gives `{ name: "AggregateError", code: "ECONNREFUSED" }`.
10. Type level: `NetworkError["cause"]` is exactly `NetworkErrorCause | undefined`; `NetworkErrorCause` is exactly `{ readonly name: string; readonly code?: string; readonly cause?: NetworkErrorCause }`; an assignment to `error.cause` fails (`@ts-expect-error`).

The existing case *keeps the given cause, and serializes it with its name and message* is replaced by cases 1, 3 and 4. *has an undefined cause when built without options* stays.

### `__tests__/index.test.ts`

11. `NetworkErrorCause` is in the list of exported types.

### `__tests__/http-client.test.ts`

12. The two cases of *request() with no response* (`fetchImpl` rejects; `fetchImpl` throws synchronously) expect `error.cause` to equal `{ name: "TypeError" }` (`toStrictEqual`), instead of being the given `TypeError` (`toBe`).
13. In *no marker reaches the logs*, the `rejected` outcome rejects with a chain that carries the case's markers in a message, in own fields and so in stacks: a `TypeError` whose message has `https://alice:hunter2@api.example.com/v1/users?token=q-secret&q=query-secret#frag-secret`, with a `cause` holding `headers` with `header-secret` and `body` with `body-secret`.
14. With Node's `fetch` and local servers, as the stream body tests already do (a `node:http` server, and a `node:net` server for the raw response):
    - a port that was listening and is closed: `cause` equals `{ name: "TypeError", cause: { name: "Error", code: "ECONNREFUSED" } }`;
    - `http://alice:hunter2@127.0.0.1:<port>/?token=q-secret`: `cause` equals `{ name: "TypeError" }`;
    - a `302` to `/bad?hop-secret=1#hop-frag-secret`, then a `302` with `Location: http://exa mple.com/`: `cause.cause.code` is `"ERR_INVALID_URL"`;
    - a response with `X-Note : a`, a `Set-Cookie: sid=header-secret` and the body `body-secret`: `cause.cause.name` is `"HTTPParserError"`;
    - for each of the four, the call rejects with a `NetworkError`, and the `JSON.stringify` of every logged argument contains no marker of the request.

Seen failing, before any production code:

- cases 1, 3–9, 12 and the first two bullets of 14: `cause` is the object given, an `Error`;
- cases 2, 13 and the last bullet of 14: the markers reach the JSON and `util.inspect`;
- cases 10 and 11: `typecheck` fails, `NetworkErrorCause` is not exported.

The refused shape passes case 2 before and after: it carries no marker, which is why case 2 leaves it out.

### Review follow-ups

**Added after review.** A second `test-author` run, in the foreground, in `__tests__/errors/network-error.test.ts` unless said otherwise. Each case builds fresh instances, and checks that `new NetworkError(...)` does not throw.

15. A read that throws counts as missing:
    - a `TypeError("fetch failed")` whose `code` is a getter that throws gives `{ name: "TypeError" }`;
    - an `Error` whose `name` is a getter that throws, as the rejection, gives an undefined `cause`; as the `cause` of a `TypeError("fetch failed")`, it gives `{ name: "TypeError" }`;
    - a `TypeError("fetch failed")` whose `cause` is a getter that throws gives `{ name: "TypeError" }`;
    - a revoked Proxy (`Proxy.revocable(new TypeError("x"), {})`, then `revoke()`), as the rejection, gives an undefined `cause`.
16. In `__tests__/http-client.test.ts`: `fetchImpl` rejects with a `TypeError("fetch failed")` whose `code` is a getter that throws. The call rejects with a `NetworkError` whose `cause` is `{ name: "TypeError" }`, and logs exactly once, at `warn`.
17. A `name` that is not a string ends the chain: `new TypeError("fetch failed", { cause })`, where `cause` is an `Error` with the own field `name: { leak: "body-secret" }`, gives `{ name: "TypeError" }`, and `JSON.stringify(error)` has no `body-secret`. An `Error` with the own field `name: undefined`, as the rejection, gives an undefined `cause`.
18. At most 10 links: a chain of 11 `Error`s, whose codes are `L1` to `L11` from the rejection down, gives 10 links, `L1` to `L10`, and the tenth has no `cause`. A chain of 20,000 `Error`s gives 10 links too.
19. An `Error` from another realm (`vm.runInNewContext("new TypeError('x')")`), as the rejection, gives an undefined `cause`.

Seen failing against the code of the first run: 15 and 16 throw the getter's or the Proxy's error; 17 gives the object `name` and `{ name: undefined }`; 18 gives 11 links, and a `RangeError` for 20,000. Case 19 passes before and after: it pins a rule the README now states.

### Second review follow-ups

**Added after the second review.** Cases 15–18 each use an error with nothing else on it, so three wrong implementations pass them (the review ran the tests against each):

- one `try` around the reads of `code` and `cause` together, which loses both when one throws;
- a non-string `name` that skips its link instead of ending the chain;
- the `"code" in value` check outside the guard, so a Proxy whose `has` trap throws makes the constructor throw again.

A third `test-author` run, in the foreground, in `__tests__/errors/network-error.test.ts`. Each case builds fresh instances, and checks that `new NetworkError(...)` does not throw:

20. A `TypeError("fetch failed")` whose `code` is a getter that throws, and whose `cause` is an `Error` with `code: "INNER"`, gives `{ name: "TypeError", cause: { name: "Error", code: "INNER" } }`.
21. A `TypeError("fetch failed")` with `code: "OUTER"`, whose `cause` is a getter that throws, gives `{ name: "TypeError", code: "OUTER" }`.
22. `new TypeError("fetch failed", { cause })`, where `cause` is an `Error` with the own field `name: 42` and a `cause` of its own, an `Error` with `code: "DEEP"`, gives `{ name: "TypeError" }`.
23. `new Proxy(new TypeError("x"), { has() { throw new Error("has") } })`, as the rejection, gives `{ name: "TypeError" }`.

All four pass against the code of the second run: they pin what it does. Instead of being seen failing before the code, each is seen failing against the wrong implementation it targets, in that order: case 20 and 21 against the first, 22 against the second, 23 against the third.

## Verification

1. **`pnpm verify`**: `@enardo/http-client`, and `@cambusa/web`, which depends on it.
2. **The tests seen failing** for the reasons above, before the production code.
3. **The probes of the *Report*, run again** on the rebuilt `dist/` with `@enardo/logger`: the four triggers, the npm `undici` one in a throwaway container. Expected: no marker in the log, in `toJSON()`, in a wrapping error's JSON or in `util.inspect`; the chains of the *Fix* table.
4. **The built declarations**: `dist/index.d.mts` exports `NetworkErrorCause`, and types `NetworkError["cause"]` with it.

## Plan

Each step ends with `pnpm verify` green, and one commit.

1. **Spec** (this file).
2. **The fix**: the `test-author` run, seen failing; then the `NetworkError` constructor, `NetworkErrorCause` and its export, the JSDoc, the README and `CLAUDE.md`.
3. **Backlog**, in a commit of its own: the items of *Found while exploring*, if approved.
4. **Review follow-ups** (**added after review**): the second `test-author` run, seen failing; then the reduction's guards and limit, and the README, the backlog item and this spec's corrections.
   **Added after the second review**: the third `test-author` run, each case seen failing against its wrong implementation; and the README's wording of the rule on `name`.
5. **Verification** 3–4, a second review, checkpoint 2, integration. The item leaves `docs/backlog.md` in a commit of its own, before the merge.
