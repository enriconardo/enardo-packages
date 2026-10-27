---
status: draft
type: fix
tier: M
implementer: sonnet/medium
packages: ["@enardo/http-client"]
branch: fix/http-client/error-body-limit
---

# Stop reading an error body past 1 MiB

## Why

With `throwOnError`, the client reads the body of an error response whole, into a string, with no size limit (`readText`, `src/http-client.ts:398`). An upstream that sends a large error body, or one that never ends, fills the caller's memory for as long as the timeout lets it: 30 s by default, gigabytes on a fast link. Without `throwOnError` the caller reads the `Response` and can bound the read; with it, the client reads, and the caller has no way to bound it but a `fetchImpl` that wraps the stream. The package's `CLAUDE.md` makes server needs requirements, and the README lists this one as the last thing a server needs before it relies on the client (*Not there yet*).

From the backlog, queued; the item comes from the spec of `feature/http/client-errors` (2026-10-05).

## Probes

On Node 24.21.0 in the dev container, `fetch` against local `node:http` servers (`probe-limit.mjs`, scratchpad):

- A 500 with `content-length: 2097152` → `headers.get("content-length")` is `"2097152"`; read through `getReader()`, chunks of at most 65 536 bytes; a `reader.cancel()` once past 1 MiB (after 1 113 939 bytes) → the server's socket is closed within 200 ms.
- A chunked 500 with no `content-length`, writing 16 KiB every millisecond and never ending → `content-length` is `null`; the reader passes 1 MiB after 1 064 960 bytes; the cancel closes the socket.
- A gzip 500 of 2 MiB → `content-length` is the encoded size (`"2068"`), the reader gets the decoded bytes, and the count passes 1 MiB as above: only the count of the bytes read bounds a compressed body.
- A 500 whose `body.cancel()` is called before any read → the socket is closed.
- `new Response("x".repeat(10), { status: 500, headers: { "content-length": "99999999" } })` → `headers.get("content-length")` is `"99999999"`: a stub can declare a length its body does not have.
- No existing test sends an error body over 1 MiB (`git grep` over `packages/http-client/__tests__` for `repeat(`, `1024`, `content-length`: only a 11-byte raw response at `http-client.node.test.ts:84`).
- The pieces to reuse: `readText`'s reader and its cancel through `cancelQuietly` → `src/http-client.ts:398-440`, `src/http-client.ts:357`; `cancelBody` → `src/http-client.ts:334`; `expectSocketsClosed` → `__tests__/http-client.node.test.ts:194`; `errorsReachingProcess` → `__tests__/support/http-client.ts:293`.
- Not probed: that browsers expose `content-length` to a cross-origin caller. The Fetch standard lists it among the CORS-safelisted response headers; when a browser hides it, the count still stops the read.

## Decisions

All four taken with the user at intake:

- **A fixed limit of 1 MiB (1 048 576 bytes), not an option.** An option (`maxErrorBodySize`) would be public API no caller asked for; it can come later without a break. 1 MiB is far above any error body an API sends, and keeps the memory bounded at the limit plus one chunk.
- **Over the limit, `body` is `undefined`**, as for a body that could not be read, and the `HttpResponseError` is thrown as before, with its status and headers. Not taken: the text cut at the limit, which turns a JSON body into text that does not parse, and gives a `body` that looks whole.
- **A `content-length` over the limit stops the read before it starts**: the body is cancelled unread. The bytes read are counted in every case, since the header can be missing, wrong, or the encoded size of a compressed body.
- **A body that is not a web stream**, read with `text()` (another fetch implementation), **stays unbounded**: nothing can stop `text()`. Only the `content-length` check applies to it. The README says so.

## Open questions

None.

## Changes

`@enardo/http-client`:

- `src/http-client.ts`:
  - a constant `MAX_ERROR_BODY_BYTES = 1024 * 1024`, beside `DEFAULT_TIMEOUT`, with a comment saying why it is fixed;
  - `readText` resolves with `undefined` when the body is over the limit. Before getting a reader it reads `content-length`: a value of digits only, over the limit, cancels the body through `cancelBody` and resolves with `undefined`, for a web stream and for a body read with `text()` alike. Any other value (missing, `"abc"`, `"5, 5"`, `""`) is ignored. A throw while reading the header (a `headers` from another implementation, a getter) counts as no header: `readBody` never rejects. With a reader, each chunk's `byteLength` is added to a count before the chunk is decoded; past the limit, the reader is cancelled through `cancelQuietly`, with no reason, and the read resolves with `undefined`, the chunk undecoded. A body of exactly the limit is kept;
  - `readBody` gives `undefined` when `readText` does; its JSDoc and `readText`'s say why.
- `src/errors/http-response-error.ts`: the JSDoc of `body` says `undefined` when the body is empty, over 1 MiB, or could not be read.
- `src/http-client.types.ts`: the JSDoc of `throwOnError` says the body is read up to 1 MiB.
- `README.md`: the `body` bullet of `HttpResponseError` gains the limit and the `content-length` check; the timeout section stays; *Not there yet* goes, its one item done; a line says a body that is not a web stream, from another `fetchImpl`, is read whole unless its `content-length` is over the limit.
- `CLAUDE.md` of the package: the opening paragraph lists the error-body limit among the server needs met; the bullet on `readText` in *Timeouts and the caller's signal* gains the count, the `content-length` check, and the exception of `text()`.
- `docs/backlog.md`: the item goes, in a commit of its own.

## Test cases

`L` is 1 048 576. In `__tests__/http-client.test.ts` (both projects), with `throwOnError: true` and a stubbed `fetchImpl`; every rejection is an `HttpResponseError` whose `details.status` is the answer's status:

1. A 500 whose body is `"a"` repeated `L` times, no `content-length` → `body` is that string (exactly the limit is kept).
2. A 500 whose body is `"a"` repeated `L + 1` times, in one chunk → `body` is `undefined`; the `headers` are the answer's.
3. A 500 whose body is `"é"` repeated `L / 2` times (`L` bytes in UTF-8) → `body` is that string; with `L / 2 + 1` of them (`L / 2 + 1` characters, `L + 2` bytes) → `body` is `undefined`: bytes are counted, not characters.
4. A 500 whose stream enqueues 64 KiB chunks on each pull and never closes, with its source's `cancel` a spy, and `timeout: 5000` → rejects with an `HttpResponseError` (not a `TimeoutError`), `body` `undefined`; the spy was called once, with `undefined` (the client's cancel has no reason); the source was pulled fewer than 32 times (the read stopped near 17 chunks, not at the timeout).
5. A 500 with `content-length: String(L + 1)` and a stream of `highWaterMark: 0` whose `pull` and `cancel` are spies → `body` is `undefined`; `pull` never called, `cancel` called once (the body is cancelled unread).
6. A 500 with `content-length: String(L)` and a body of `"a"` repeated `L` times → `body` is that string (the header check uses "over", not "at").
7. A 500 with `content-length` each of `"abc"`, `""`, `"5, 5"`, `"-1"`, `"1e9"` and a body `'{"error":"x"}'` → `body` is `{ error: "x" }` (a value that is not digits only is ignored).
8. A 500 with `content-length: "10"` and a body of `"a"` repeated `L + 1` times → `body` is `undefined` (a header under the limit does not stop the count).
9. An answer that is not a `Response`, whose `headers.get` throws, with a `getReader` body of `'{"error":"x"}'` → `body` is `{ error: "x" }`; nothing reaches the process (`errorsReachingProcess`).
10. An answer that is not a `Response`, with no `getReader`, `text` a spy resolving with `"a"` repeated `L + 1` times, no `content-length` → `body` is that string (the `text()` path stays unbounded, as the README says).
11. The same answer with `content-length: String(L + 1)` and a `body` with a `cancel` spy → `body` is `undefined`; `text` never called; `cancel` called once.
12. A 500 whose stream sends `L + 1` bytes and whose source's `cancel` throws, then, in a second run, rejects → `body` is `undefined`, an `HttpResponseError` in both runs; nothing reaches the process.

In `__tests__/http-client.node.test.ts`, with Node's `fetch` and local servers:

13. A 500 with `content-length: 2097152` and its 2 MiB body → `body` is `undefined`, and the server's sockets close (`expectSocketsClosed`).
14. A chunked 500 that writes 16 KiB chunks and never ends, `timeout: 5000` → an `HttpResponseError` with `body` `undefined`, not a `TimeoutError`; the sockets close.
15. A gzip 500 whose decoded body is 2 MiB, its `content-length` the encoded size → `body` is `undefined` (the decoded bytes are counted).

## Out of scope

- An option to set the limit, or a limit on the body of a returned response, which the caller reads.
- Bounding `text()` for a body that is not a web stream.
- The text cut at the limit (decided against, above).

## Plan

1. Test-first: cases 1–15, red for the expected reason (2, 3's second half, 5, 8, 11, 12, 13, 15 give the body read whole or its parsed text; 4 and 14 reject with a `TimeoutError`; 5 and 11 also see `pull`/`text` called), then the limit in `readText` and `readBody`, with their JSDoc. Cases 1, 6, 7, 9, 10 pass already, and pin what must not change. Commit: `[@enardo/http-client] fix: stop reading an error body past a limit`.
2. Docs: the JSDoc of `HttpResponseError.body` and `throwOnError`, `README.md`, the package's `CLAUDE.md`. Commit: `[@enardo/http-client] docs: document the error body limit`.
3. Backlog: remove the item. Commit: `[repo] docs: remove the error body limit item`.
