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

With `throwOnError`, the client reads the body of an error response whole, into a string, with no size limit (`readText`, `src/http-client.ts:398`). An upstream that sends a large error body, or one that never ends, fills the caller's memory for as long as the timeout lets it, 30 s by default: nothing else bounds the read (a local server sent 13.4 MB in 2 s, `docs/specs/2026-10-07-timeouts-and-abort.md`). No consumer has met it: the only one runs in a browser. Without `throwOnError` the caller reads the `Response` and can bound the read; with it, the client reads, and the caller has no way to bound it but a `fetchImpl` that wraps the stream. The package's `CLAUDE.md` makes server needs requirements, and the README lists this one as the last thing a server needs before it relies on the client (*Not there yet*).

From the backlog, queued; the item comes from the spec of `feature/http/client-errors` (2026-10-05).

## Probes

On Node 24.21.0 in the dev container, `fetch` against local `node:http` servers (`probe-limit.mjs`, scratchpad):

- A 500 with `content-length: 2097152` → `headers.get("content-length")` is `"2097152"`; read through `getReader()`, chunks of at most 65 536 bytes; a `reader.cancel()` once past 1 MiB (after 1 113 939 bytes) → the server's socket is closed within 200 ms.
- A chunked 500 with no `content-length`, writing 16 KiB every millisecond and never ending → `content-length` is `null`; the reader passes 1 MiB after 1 064 960 bytes; the cancel closes the socket.
- A gzip 500 of 2 MiB → `content-length` is the encoded size (`"2068"`), the reader gets the decoded bytes, and the count passes 1 MiB as above: only the count of the bytes read bounds a compressed body.
- `node-fetch@2.7.0`, from the pnpm store, read-only (the `critic`'s probe): its `res.body` has no `getReader` and no `cancel`. A 500 body left unread holds its socket after `request()` settles (open after 15 s, and the next request opens a second one); read with `text()`, as today, the socket goes back to the pool. Any check that skips `text()` would hold it.
- No existing test sends an error body over 1 MiB (`git grep` over `packages/http-client/__tests__` for `repeat(`, `1024`, `content-length`: only a 11-byte raw response at `http-client.node.test.ts:84`).
- The pieces to reuse: `readText`'s reader and its cancel through `cancelQuietly` → `src/http-client.ts:398-440`, `src/http-client.ts:357`; `expectSocketsClosed` → `__tests__/http-client.node.test.ts:194`; `errorsReachingProcess` → `__tests__/support/http-client.ts:293`.

## Decisions

Taken with the user at intake; the last two changed after the `critic`'s run, with the user:

- **A fixed limit of 1 MiB (1 048 576 bytes), not an option.** An option (`maxErrorBodySize`) would be public API no caller asked for; it can come later without a break. 1 MiB is far above any error body an API sends, and keeps the memory bounded at the limit plus one chunk.
- **Over the limit, `body` is `undefined`**, as for a body that could not be read, and the `HttpResponseError` is thrown as before, with its status and headers. Not taken: the text cut at the limit, which turns a JSON body into text that does not parse, and gives a `body` that looks whole.
- **Only the bytes read are counted; `content-length` is not read.** The count alone bounds the memory, and closes the socket just past 1 MiB (*Probes*). A check of the header would save at most 1 MiB of transfer, from a broken or hostile upstream, for a parsing rule, a header read that must survive a throw, and an edge: the header of a compressed body is its encoded size, which gzip makes larger than the body for data that does not compress, so a body the count keeps would be dropped. Not taken: the check before the read, proposed at intake. It can come later, as an internal change, once an app measures a cost.
- **A body that is not a web stream**, read with `text()` (another fetch implementation), **stays as it is today: read whole.** Nothing can stop `text()`, and skipping it would leave such a body, with no `cancel`, holding its connection (*Probes*, `node-fetch`). The README says it is unbounded.

## Open questions

None.

## Changes

`@enardo/http-client`:

- `src/http-client.ts`:
  - a constant `MAX_ERROR_BODY_BYTES = 1024 * 1024`, beside `DEFAULT_TIMEOUT`, with a comment saying why it is fixed;
  - `readText` resolves with `undefined` when the body is over the limit. With a reader, each chunk's `byteLength` is added to a count before the chunk is decoded; past the limit, the reader is cancelled through `cancelQuietly`, with no reason, and the read resolves with `undefined`, the chunk undecoded. A body of exactly the limit is kept;
  - `readBody` gives `undefined` when `readText` does; its JSDoc and `readText`'s say why.
- `src/errors/http-response-error.ts`: the JSDoc of `body` says `undefined` when the body is empty, over 1 MiB, or could not be read.
- `src/http-client.types.ts`: the JSDoc of `throwOnError` says the body is read up to 1 MiB.
- `README.md`: the `body` bullet of `HttpResponseError` gains the limit, counted on the bytes read; the timeout section stays; *Not there yet* goes, its one item done; a line says a body that is not a web stream, from another `fetchImpl`, is read whole with `text()`, with no limit.
- `CLAUDE.md` of the package: the opening paragraph lists the error-body limit among the server needs met; the bullet on `readText` in *Timeouts and the caller's signal* gains the count, why `content-length` is not read, and the exception of `text()` with its reason (a body skipped there holds its connection).
- `docs/backlog.md`: the item goes, in a commit of its own.

## Test cases

`L` is 1 048 576. In `__tests__/http-client.test.ts` (both projects), with `throwOnError: true` and a stubbed `fetchImpl`; every rejection is an `HttpResponseError` whose `details.status` is the answer's status:

1. A 500 whose body is `"a"` repeated `L` times → `body` is that string (exactly the limit is kept).
2. A 500 whose body is `"a"` repeated `L + 1` times, in one chunk → `body` is `undefined`; the `headers` are the answer's.
3. A 500 whose body is `"é"` repeated `L / 2` times (`L` bytes in UTF-8) → `body` is that string; with `L / 2 + 1` of them (`L / 2 + 1` characters, `L + 2` bytes) → `body` is `undefined`: bytes are counted, not characters.
4. A 500 whose stream enqueues a 64 KiB chunk on each pull and closes after the 64th (4 MiB), with its source's `cancel` a spy → `body` is `undefined`; the spy was called once, with `undefined` (the client's cancel has no reason); the source was pulled fewer than 32 times (the read stopped near 17 chunks). Finite on purpose: a stream that enqueues on each pull and never closes keeps the read in microtasks, so no timer fires, and the red run builds a 512 MiB string until V8 throws `RangeError` (the `critic`'s probe, about 700 MB). The stream that never ends is case 8, against a server.
5. An answer that is not a `Response`, with no `getReader`, `text` a spy resolving with `"a"` repeated `L + 1` times → `body` is that string, `text` called once (the `text()` path stays unbounded, as the README says).
6. A 500 whose stream sends `L + 1` bytes and whose source's `cancel` throws, then, in a second run, rejects → `body` is `undefined`, an `HttpResponseError` in both runs; nothing reaches the process (`errorsReachingProcess`).

In `__tests__/http-client.node.test.ts`, with Node's `fetch` and local servers:

7. A 500 with `content-length: 2097152` and its 2 MiB body → `body` is `undefined`, and the server's sockets close (`expectSocketsClosed`).
8. A chunked 500 that writes 16 KiB chunks and never ends, `timeout: 5000` → an `HttpResponseError` with `body` `undefined`, not a `TimeoutError`; the sockets close.
9. A gzip 500 whose decoded body is 2 MiB, its `content-length` the encoded size → `body` is `undefined` (the decoded bytes are counted).

## Out of scope

- An option to set the limit, or a limit on the body of a returned response, which the caller reads.
- Bounding `text()` for a body that is not a web stream.
- A check of `content-length` before the read (decided against, above).
- The text cut at the limit (decided against, above).

## Plan

1. Test-first: cases 1–9, red for the expected reason (2, 3's second half, 4, 6, 7, 9 give the body read whole, and 4 pulls all 64 chunks; 8 rejects with a `TimeoutError`), then the limit in `readText` and `readBody`, with their JSDoc. Cases 1, 3's first half and 5 pass already, and pin what must not change. Commit: `[@enardo/http-client] fix: stop reading an error body past a limit`.
2. Docs: the JSDoc of `HttpResponseError.body` and `throwOnError`, `README.md`, the package's `CLAUDE.md`. Commit: `[@enardo/http-client] docs: document the error body limit`.
3. Backlog: remove the item. Commit: `[repo] docs: remove the error body limit item`.
