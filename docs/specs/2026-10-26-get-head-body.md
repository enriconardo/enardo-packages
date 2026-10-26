---
status: draft
type: fix
tier: M
implementer: sonnet/medium
packages: ["@enardo/http-client"]
branch: fix/http-client/get-head-body
---

# Reject a body with GET or HEAD as the caller's error

## Why

`request()` accepts a `body` with `method: "GET"` or `"HEAD"`. Every `fetch` rejects such a request before sending it, so the client reports a `NetworkError`, logged at `warn`, for a request that never went out. Since `fix/http-client/redact-cause` that error no longer says why: Node's rejection has no `code`, and its reduced `cause` is `{ name: "TypeError" }` (README, *Errors*). From the backlog, queued; the item comes from the spec of `feature/http/client-errors` (2026-10-05).

Only `request()` with an explicit `method` reaches it: `get()` and `head()` take no `body`, and a `body` without a `method` defaults to `POST`.

## Probes

- `new Request("http://x.test/", { method, body, duplex: "half" })` on Node 24.21.0 in the dev container, and in Chromium 153, WebKit 26.6 and Firefox 155 through a temporary test of the browser project, same results everywhere:
  - `GET`, `HEAD`, `get`, `head` with `"x"`, `""`, an empty `Blob`, an empty `Uint8Array`, a `ReadableStream` → `TypeError` (Node's message: `Request with GET/HEAD method cannot have body.`, no `code`);
  - the same methods with `null` or `undefined` → accepted;
  - `POST` with any of them → accepted.
- `fetch("http://127.0.0.1:1/", { method: "GET", body: "" })` on Node → rejects with the same `TypeError`, before connecting.
- The caller's errors are native `TypeError`s thrown before `fetchImpl`, with a message holding no part of the URL → `src/http-client.ts:91` (`Expected a request URL without credentials`), README *Errors* table.
- The checks run before the aborted-signal check, so a caller's error wins over it → `src/http-client.ts:136-160`.
- No existing test sends a body with `GET` or `HEAD` (`git grep` over `packages/http-client/__tests__` for `method: "GET"` / `"HEAD"` and their bodies). The only doc line on the old behavior is `packages/http-client/README.md:126`.

## Decisions

- **A runtime check, not the types** (with the user). `request()` throws `TypeError: Expected no body with GET or HEAD` before calling `fetchImpl`, unlogged, as the other caller's errors. It also covers a `method` held in a variable of type `HttpMethod`, and untyped callers. Not taken: a `RequestOptions` discriminated on `method`. It would stop being an interface, and `{ method: m, body }` with `m: HttpMethod` would stop compiling even when `m` is `POST`: a new major for a case no consumer has.
- **The check matches `fetch`'s**: a body other than `null` and `undefined`, empty ones included, with a method that is `GET` or `HEAD` ignoring case. `HttpMethod` is uppercase, but the client passes the method on unchanged, and `fetch` normalizes `get` and `head`: an untyped caller would otherwise still get a `NetworkError`.
- **A fix, not a breaking change**: the input never produced a request. Only the error it gives changes, from a `NetworkError` to a `TypeError`. The version is the `publish` skill's.

## Open questions

None.

## Changes

`@enardo/http-client`:

- `src/http-client.ts`, `request()`: after the URL and the headers are built, before the aborted-signal check, throw the `TypeError` when `requestBody != null` and the method, uppercased, is `GET` or `HEAD`. A comment says why (fetch rejects it, with no `code` to tell why). The JSDoc of `request()` gains `@throws {TypeError}` for it, next to the others the method documents.
- `src/http-client.types.ts`: the JSDoc of `RequestOptions.body` says that `GET` and `HEAD` take none.
- `README.md`: a row in the *Errors* table, among the caller's errors (*The first five* becomes *The first six*); the sentence on `GET` or `HEAD` at line 126 goes, the one on a blocked port and a redirect stays; *The body* in the request section says `GET` and `HEAD` take none.
- `CLAUDE.md` of the package: the list of caller's errors in *Errors and logs* gains the body with `GET` or `HEAD`.

## Test cases

In `__tests__/http-client.test.ts` (both projects), with a `fetchImpl` mock and a logger spy:

1. `request("/users", { method: "GET", body: "x" })` → rejects with a `TypeError` whose message is `Expected no body with GET or HEAD`; `fetchImpl` not called; nothing logged.
2. Same with `method: "HEAD"`.
3. `method: "GET"` with each of `""`, `new Blob([])`, `new Uint8Array(0)`, a `ReadableStream` → the same `TypeError`, `fetchImpl` not called (empty bodies count; a stream is not let through by the `duplex` branch).
4. `method: "get"` and `"head"` (cast to `HttpMethod`) with `body: "x"` → the same `TypeError` (case ignored, as `fetch` does).
5. `method: "GET"` with `body: null`, and with `body: undefined` → resolves; `fetchImpl` called once, with no `body` in its init.
6. `method` `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS` with `body: ""` → `fetchImpl` called with `body: ""` (the check is limited to `GET` and `HEAD`, and an empty body is passed on).
7. `method: "GET"`, `body: "x"`, and a signal already aborted → rejects with the `TypeError`, not the signal's reason; nothing logged (caller's errors first).
8. The message holds no part of the URL: with a URL carrying a query string `?token=secret`, the message does not contain `secret`.

In `__tests__/http-client.node.test.ts`, against Node's real `fetch` (no stub), so that the check is shown to precede it:

9. The default `fetchImpl`, `method: "GET"`, `body: "x"`, URL of a local server → rejects with the `TypeError` of case 1, and the server receives no request.

## Out of scope

- Typing `RequestOptions` to refuse the combination (decided against, above).
- Other requests `fetch` refuses without a `code` (a blocked port, a redirect to a `Location` with credentials): they stay `NetworkError`s, as the README says.

## Plan

1. Test-first: cases 1–9, red for the expected reason (1–4 and 8 resolve, since the mock accepts the body; 7 rejects with the signal's reason; 9 rejects with a `NetworkError`; 5 and 6 pass already), then the check in `request()` and its JSDoc. Commit: `[@enardo/http-client] fix: reject a body with get or head`.
2. Docs: the JSDoc of `RequestOptions.body`, `README.md`, the package's `CLAUDE.md`. Commit: `[@enardo/http-client] docs: document the body check of get and head`.
3. Backlog: remove the item, in a commit of its own. Commit: `[repo] docs: remove the get and head body item`.
