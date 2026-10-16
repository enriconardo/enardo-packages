---
status: done
type: fix
packages: ["@enardo/http"]
branch: fix/http/stream-body-duplex
---

# `@enardo/http`: stream bodies fail on Node without `duplex`

## Report

On Node, a request whose body is a stream never leaves the client: `HttpClient` throws a `NetworkError` before any byte is sent.

Probed on `master` (`b9e9061`), on Node 24.21.0 (undici 7.29.1), with the built `dist/`, the default `fetchImpl` (Node's `fetch`) and a local `node:http` server:

| Call | Result |
| --- | --- |
| `post("/", <ReadableStream>)` | `NetworkError`: `Network or request error for http://127.0.0.1:<port>/: RequestInit: duplex option is required when sending a body.` |
| `put("/", <ReadableStream>)` | the same |
| `request("/", { body: <async generator of Uint8Array> })` | the same |
| `post("/", "hi")` | 200, and the server receives `hi` |

`HttpBody` accepts both kinds of stream on Node. Probed: under `tsconfig.node.json`, a `ReadableStream<Uint8Array>` and an `AsyncGenerator<Uint8Array>` are both assignable to it. Under the DOM lib, only the `ReadableStream` is.

## Root cause

Node's `fetch` requires `duplex: "half"` when the body is a stream, and `HttpClient.request` never passes it.

Probed with Node's `fetch` on every member of the two `BodyInit` unions (the DOM lib's and undici's), with and without `duplex: "half"`:

| Body | Without `duplex` | With `duplex: "half"` |
| --- | --- | --- |
| `string`, `ArrayBuffer`, `Uint8Array`, `DataView`, `Buffer`, `Blob`, `FormData`, `URLSearchParams` | sent, with a `content-length` | the same |
| `ReadableStream` | `TypeError: RequestInit: duplex option is required when sending a body.` | sent, `transfer-encoding: chunked` |
| an async generator of `Uint8Array` | the same `TypeError` | sent, chunked |
| a sync `Iterable<Uint8Array>` (a generator, an array) | sent as a string: `[object Generator]`, `104,105` | the same |

So the two kinds of stream need `duplex`, and it changes nothing for the other bodies. The last row is a different defect: see *Decisions*.

The Fetch Standard requires `duplex` for a stream body in browsers too. That comes from reading the standard. It was not probed, because the container has no browser.

## Fix

In `HttpClient.request`, the init passed to `fetchImpl` gets `duplex: "half"` when the body is a stream, and only then.

- **A stream** is a `ReadableStream` (`instanceof`), or an object with a `Symbol.asyncIterator`.
  - On Node 24 the second test would cover both, since a `ReadableStream` is async-iterable there.
  - The first test makes the result independent of whether a browser's `ReadableStream` is async-iterable, which was not probed.
  - Probed on Node: none of the other body types has `Symbol.asyncIterator` or is a `ReadableStream`.
- **Every other init is unchanged**: it has no `duplex` key, and the same `method`, `headers` and `body` as today.
- **The init's type** is `RequestInit & { duplex?: "half" }`, and it stays internal. The DOM lib's `RequestInit` (TypeScript 5.9.3) has no `duplex`, while undici's has one. Probed:
  - an object literal with `duplex: "half"`, typed as `RequestInit`, fails `tsconfig.json` and `tsconfig.browser.json` with TS2353, and passes `tsconfig.node.json`;
  - the same literal, typed as the intersection and passed to a `typeof fetch`, passes all three programs and the lint;
  - the stream test passes all three and the lint too, written over `NonNullable<RequestInit["body"]>`.
- **JSDoc on `RequestOptions.body`**: what counts as a stream body, and that it is sent with `duplex: "half"`.
- **`packages/http/CLAUDE.md`**:
  - *Two runtimes*: a stream body needs `duplex`, and the DOM lib's `RequestInit` does not declare it;
  - *Checks*: the tests also use Node's real `fetch` against a local server, for what only that `fetch` checks.

## Decisions (to confirm at checkpoint 1)

1. **`duplex` only for stream bodies, not on every request.**
   - The standard allows it on any body (from reading the standard, not probed). On Node, it changes nothing for the other bodies (probed).
   - In a browser it was not probed. If every request carried it, so would every request of `@cambusa/web`, which sends a `JSON.stringify` string (`src/lib/api/http.ts`).
   - Limited to streams, the fix changes no request that works today, in either runtime.
2. **The sync `Iterable<Uint8Array>` goes to *To evaluate*, not into this branch.**
   - `HttpBody` accepts it on Node because undici's types declare it. Probed in `undici-types` 7.24.6, the top of the range the latest `@types/node` 24 depends on, and in 8.3.0, the one the catalog's `@types/node` 26.4.0 installs.
   - Node 24's `fetch` sends it as a string (probed, table above).
   - `duplex` does not fix it. It needs a fix of its own (drop it from `HttpBody`, or reject it at runtime), and it is a different defect.
3. **The tests run Node's real `fetch` against a local server, as well as stubs.** The check that fails lives inside Node's `fetch`, so a stubbed `fetchImpl` cannot reproduce it. `__tests__/` may import `node:http`, because the runtime rules of `eslint.config.js` apply to `src/` only.

## Out of scope

- **Redirects with a stream body.** On a 307, Node's `fetch` rejects a stream body with `TypeError: fetch failed`, even with `duplex: "half"` (probed). The client then reports a `NetworkError`. Following the redirect would require buffering the stream.
- **Browsers.** Not probed. Under the DOM lib, an async iterable does not compile as a body. A `ReadableStream` does, and it gets `duplex` like on Node.
- **The `NetworkError` itself**, its message and its `cause`: `feature/http/client-errors`.

## Test plan

Test-first, because this is a bug fix. The `test-author` writes the tests from this spec, in `__tests__/http-client.test.ts`, inside a new `describe("stream bodies")`. Like the other tests, they import from `~/index`.

**Node's real `fetch`.** A `node:http` server on `127.0.0.1`, on a port the OS picks, started before these tests and closed after them. It answers 200 and sends back the method and the body it received. The client has a `baseUrl` on that server and no `fetchImpl`, so it uses Node's `fetch`.

1. **Regression**: `post("/", <ReadableStream that enqueues "hello">)` → status 200, and the server received `POST` with the body `hello`. Today: it rejects with a `NetworkError` whose message contains `duplex option is required`.
2. **Regression**: `request("/", { body: <async generator yielding "hel" and "lo" as Uint8Array> })`, with no method → status 200, and the server received `POST` with the body `hello`. Today: the same `NetworkError`.
   - The tests compile under `tsconfig.json`, where the DOM lib makes an async iterable an invalid body type. The test casts it (`as unknown as RequestOptions["body"]`). Probed: with the cast, it compiles and passes the lint.

**Stubbed `fetchImpl`** (`createMockFetch`, as in the other tests). The assertions are on the init the stub receives.

3. **Regression**: a `ReadableStream` body → the init has `duplex: "half"`. Today it has no `duplex`.
4. **Regression**: an async generator body → the same.
5. **Existing behavior**: no body (`get`), then a string, a `Uint8Array`, an `ArrayBuffer`, a `Blob`, a `FormData` and a `URLSearchParams` → the init has no `duplex` key (`not.toHaveProperty("duplex")`). This passes today and must keep passing.

Cases 1–4 must be seen failing before the fix, for the reasons given. Case 5 passes before and after.

## Plan

1. **Spec** (this file).
2. **Tests and fix**, one commit:
   - the `test-author` writes cases 1–5. Cases 1–4 are seen failing as described, and case 5 passing;
   - then the fix, the JSDoc and the `CLAUDE.md` lines, with `pnpm verify` green.
3. **Backlog**: the item of decision 2 joins *To evaluate*, in a commit of its own.
4. **Manual check**: the probe of the *Report*, run again against the rebuilt `dist/`. Expected: the three stream calls resolve with 200 and the server receives the body. The string call is unchanged.
5. **Review**, checkpoint 2, integration. The backlog item leaves `docs/backlog.md` in a commit of its own, before the merge.
