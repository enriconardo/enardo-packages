---
status: done
type: feature
packages: ["@enardo/http-client", "@cambusa/web"]
branch: feature/http-client/timeouts-and-abort
---

# `@enardo/http-client`: timeouts and `signal`

## Why

The first queued item of the backlog, a prerequisite for server use: "`signal` and timeouts, with errors distinct from `NetworkError`", from the architectural review of `@enardo/http` (2026-09-25). The spec of `feature/http/client-errors` left the read of the error body to this branch too. The README lists both under *Not there yet*: "A request, or the read of an error body, can wait forever."

Probes ran in the dev container: Node 24.21.0, TypeScript 5.9.3, `@types/node` 26.4.0. The client was probed on `master` (`66bfcc0`), through its `dist/` rebuilt with `turbo run build --filter=@enardo/http-client... --force`. The type probes ran in a throwaway container with npm `undici` 7.30.0 and 8.11.2. No browser was probed: the container has none.

## Today

- **A request can wait forever.** Against a local `node:http` server that accepts the connection and never answers, `client.get()` is still pending after 3 s. So is a `get` with `throwOnError` whose response is a `500` with a body that never ends.
- **`RequestOptions` has no `signal` and no `timeout`.** Passed through a cast, both are ignored: with a signal already aborted and `timeout: 1`, `get` resolves with the `200`, and the request reaches the server.
- **A fetch implementation's own timeout is a `NetworkError`.** A `fetchImpl` of `(url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(100) })`, against the server that never answers, gives a `NetworkError` whose `cause` is `{ name: "TimeoutError" }`, logged at `warn` (`HTTP request got no response.`).

### What the runtime does

Node's `fetch` with a `signal`, against a local `node:http` server:

| The signal aborts | `fetch` | The server |
| --- | --- | --- |
| before the call | rejects with `signal.reason`, the same object | receives nothing |
| before the response | rejects with `signal.reason`, the same object: an `Error`, a string, or, for `abort()` with no argument, a `DOMException` named `AbortError` | sees its socket close |
| while the body is read | `res.text()` rejects with `signal.reason` | sees its socket close |
| after the body was read | nothing happens | |

- **`AbortSignal.timeout()`** aborts with a `DOMException` named `TimeoutError` (`code` 23).
- **`AbortSignal.any()`** is declared by the DOM lib of TypeScript 5.9.3 and by `@types/node` 26.4.0.
  - Its reason is the first source's to abort when something listens to it.
  - When nothing listens to it and nothing reads it between the aborts, Node gives it the reason of the first aborted source in array order instead: with `any([a, b])`, `b` aborted, then `a`, its `reason` is `a`'s.
- **`AbortSignal.any()` over a long-lived signal does not leak.** One signal combined with 1,000,000 short-lived ones leaves the heap flat once GC settles; combined with 200,000, it has no listener left. Listeners added to it with `addEventListener` and never removed stay: 20 added, 20 left.
- **A combined signal outlives `fetch`'s promise.** With `fetch(url, { signal: AbortSignal.any([own, caller]) })` resolved and a forced GC, aborting `caller` makes the pending `res.text()` reject with `caller`'s reason.
- **Nothing reads a reason on its way through**: `abort(reason)`, `AbortSignal.any()`, a `throw` in an async function, and `Promise.race` all carry a `Proxy` whose every trap throws without calling a trap. Resolving a promise with it does call one: resolution reads `then`, so a `.then` handler that returns the proxy rejects with the trap's error.
- **`setTimeout`** fires after about 1 ms, with a warning (`TimeoutOverflowWarning`, `TimeoutNegativeWarning`, `TimeoutNaNWarning`), for a delay above 2147483647, `Infinity`, a negative number or `NaN`. `0.5` fires at once too.
- **Types.** With `signal?: AbortSignal` added to `FetchInit`, the global `fetch` still fits `FetchImpl` in a program with the DOM libs alone, with the Node types alone, and with both. The `fetch` of npm `undici` 7.30.0 and 8.11.2 still fits in a program with the Node types and no DOM lib, as the README says. A control with `signal?: number` fails for all three `fetch`es.

## Changes

### 1. Options

```ts
interface HttpClientOptions {
  // baseUrl, fetchImpl, logger: unchanged
  /** The timeout of every request, in milliseconds, or `false` for none. @default 30_000 */
  timeout?: number | false;
}

interface RequestOptions {
  // method, headers, body, query, throwOnError: unchanged
  /** Aborts the request. */
  signal?: AbortSignal;
  /** The timeout of this request, in milliseconds, or `false` for none, instead of the client's. */
  timeout?: number | false;
}

interface FetchInit {
  // method, headers, body, duplex: unchanged
  /** Present when the request has a signal or a timeout. */
  signal?: AbortSignal;
}
```

The shortcuts take them too: their options are `Omit<RequestOptions, "method" | "body">`.

### 2. The timeout

- **30 seconds by default.** **Amended at checkpoint 1**: the spec first had no default (decision 4).
- **A number of milliseconds, an integer from 1 to 2147483647** (2³¹ − 1, the longest delay `setTimeout` keeps), **or `false` for none.** Any other value is the caller's error, a `TypeError: Expected a timeout in milliseconds, an integer from 1 to 2147483647, or false`:
  - for the client's, from the constructor;
  - for a request's, from `request()`, before anything is sent, and not logged, like the other caller's errors.
- **A request's own timeout wins**, `false` included: a request can turn off the client's timeout, or set one on a client that has none. Without one (absent or `undefined`), the client's applies; the client's is 30 s when its options leave it out (absent or `undefined`).
- **It covers what `request()` waits for**: the call to `fetchImpl`, and, with `throwOnError`, the read of the error body. When it passes, `request()` rejects with a `TimeoutError` (section 5), in either phase.
- **It ends when `request()` settles.** After that, it aborts nothing: the body that the caller reads from a returned `Response` is not covered. A `signal` covers it (section 3).

### 3. The caller's signal

- **When it aborts, `request()` rejects with its `reason`**, the very value, as `fetch` does. That holds in either phase, the call or the read of the error body.
- **Already aborted when `request()` is called**: `fetchImpl` is not called. The caller's errors come first: an invalid URL, header or timeout throws its `TypeError` before the signal is checked.
- **It keeps covering the body after `request()` returns**: `init.signal` follows it (section 4), so a read of the body rejects with its reason.
- **The client never reads into the reason**: no field, no getter, no `instanceof`, and no promise resolved with it, since resolution reads its `then` (probed above). It reads the signal's `aborted` and `reason`, and listens to its `abort` event (**amended after the third review**: to the combined signal's, see below), then rejects with the reason as it is. It does not log it. So a reason of any shape reaches the caller unchanged (a cycle, a deep chain, a `Proxy` whose every trap throws), and nothing the client does with it can throw.
- **Its listeners leave the caller's signal when `request()` settles.** A long-lived signal, such as a server's shutdown signal passed to every request, would otherwise collect one per request (probed above).
  **Amended after the third review**: and the combined signal. Since every caller's signal goes through `AbortSignal.any()`, the client listens to the combined signal only, never to the caller's. Node keeps a combined signal alive while it has an `abort` listener: the third review measured, over 50,000 requests with one long-lived signal, +120 MB of heap with the listener of the error-body read left, +193 MB with the listener of `race` left, and +5.6 MB with both removed.
- **A `signal` is not checked at runtime**: the types require an `AbortSignal`. **Added after review**: with a timeout, a value that is not one makes `AbortSignal.any()` throw its `TypeError` before anything is sent, and no timer is left behind: the combined signal is built before the timer starts. The review probed a timer left running for the whole timeout, which kept the process alive.
  **Amended after the second review**: with or without a timeout. A caller's signal always goes through `AbortSignal.any()`, alone when there is no timeout. With `timeout: false`, the review probed a `fetchImpl` called with the value, a `TypeError` from `addEventListener` instead, and the rejection of `fetchImpl` left unhandled, which ends a Node process by default.

### 4. What `fetchImpl` receives, and when `request()` settles

- **Neither a signal nor a timeout** (`timeout: false`): no `signal` key in `init`, as today. With the default, every other request has one.
- **A signal, a timeout, or both**: `init.signal` aborts when the caller's signal aborts, with its reason, or when the timeout passes, with the `TimeoutError` that `request()` rejects with. With both, the client combines its own signal with the caller's through `AbortSignal.any()`.
- **`request()` does not wait for `fetchImpl` to honor the signal.** It settles when the timeout passes or the signal aborts, even with a `fetchImpl` that ignores `init.signal` (a stub, or a wrapper that drops it). What `fetchImpl` does next is dropped, and logged by nobody:
  - a `Response` it resolves with later has its body cancelled, so that it releases its connection. **Amended after review**: any value whose `body` has a `cancel` method, not only an instance of the global `Response`. The `Response` of npm `undici` is another class: the review probed a late one left uncancelled, its connection still open;
  - a rejection is caught, so it never surfaces as unhandled;
  - anything that goes wrong there (a value that is not a `Response`, a body already locked) is dropped.
  - **Added after the second review**: a read of the error body that the timeout or the signal ended is cancelled, so that the body stops flowing and releases its connection. `response.text()` would hold the stream's lock, and nothing could cancel it: the review probed 13.4 MB more read and buffered in 2 s after the `TimeoutError`, through Node's `fetch` and a `fetchImpl` that drops the signal, and the socket still open; 9.8 MB in 1.5 s through npm `undici` 7.30.0. So the client reads the body through a reader of its own, decodes it as `text()` does (UTF-8, a leading BOM dropped), and cancels the reader, with no reason: the caller's reason is never passed on. A body with no `getReader` (not a web stream) is read with `text()`, as before, and cannot be cancelled.
    **Amended after the third review**: a `cancel()` of that reader that throws, or returns something other than a promise, is dropped, as with a late body. It runs in an `abort` listener, where Node rethrows an error as an `uncaughtException`: the third review probed a process ended with exit code 1 by a stub reader whose `cancel()` throws.
  - A late body with no `cancel` method is left as it is. Passing `init.signal` on to `fetch` is what releases a connection in every case.
- **The client decides the outcome from its own timer and the caller's signal**, never from what `fetchImpl` rejected with, nor from the reason of `init.signal`, which Node can set lazily (probed above). The first of the two to happen decides: once `request()` has settled, the other changes nothing.
- **A rejection that looks like a timeout or an abort**, while neither happened (a `DOMException` named `TimeoutError` or `AbortError`, from a `fetchImpl` with a signal of its own), stays a `NetworkError`, as today.

### 5. `TimeoutError`

In `src/errors/timeout-error.ts`. It extends `BaseError` of `@enardo/errors`: a sibling of `NetworkError` and `HttpResponseError`, none of the three extending another.

```ts
new TimeoutError(method: HttpMethod, url: URL, timeout: number);
```

| Member | Value |
| --- | --- |
| `name` | `"TimeoutError"` |
| `code` | `"TIMEOUT_ERROR"`, typed as that literal |
| `message` | `GET https://api.example.com/users timed out after 5000 ms` |
| `details` | `{ method, url, timeout }`. `url` keeps the origin and the path, as in the other two errors |
| `cause` | none: the timeout is the client's own |

### 6. Logs

Two outcomes join the table of the README; each is still logged once.

| Outcome | Level | Message | Metadata |
| --- | --- | --- | --- |
| a `TimeoutError` | `warn` | `HTTP request timed out.` | `{ method, url, timeout, error }` |
| the caller's signal aborted | `debug` | `HTTP request aborted.` | `{ method, url }` |

A signal already aborted when `request()` is called logs that `debug` line too. A late resolution or rejection of `fetchImpl` adds nothing.

### 7. Docs

In the same commit as the code, as `packages/http-client/CLAUDE.md` asks for a public API change.

- **README**:
  - *Exports*: `TimeoutError`; `timeout` in `HttpClientOptions`; `signal` and `timeout` in `RequestOptions`.
  - *Requests*: a subsection on timeouts and cancellation: the default of 30 s and `false`, what the timeout covers and what it does not, the request's over the client's, the signal for the body read, with `AbortSignal.timeout()` as the example.
  - *Errors*: rows for an invalid timeout, an abort and a `TimeoutError`; a paragraph on `TimeoutError`; a fetch implementation's own timeout stays a `NetworkError`.
  - *Logs*: the two rows of section 6.
  - *`fetchImpl`*: `signal` in `FetchInit`; `request()` does not wait for `fetchImpl` to honor it.
  - *Runtimes*: `AbortSignal.any()`, for a request with both a signal and a timeout (**amended after the second review**: for every request with a signal).
  - *Not there yet*: the bullet on timeouts and cancellation goes.
- **`CLAUDE.md`**:
  - the opening paragraph: the timeouts meet the server requirement;
  - *Layout*: the new files;
  - *Errors and logs*: three errors of its own; the reason passed on, unread and unlogged; the outcome decided by the client's own state, never by the reason of a combined signal, and why (the probe above);
  - *Two runtimes*: `AbortSignal.any()` in the list of what `src/` uses.
- **JSDoc** on `TimeoutError`, on the new options, and in the `@throws` of `HttpClient`.

### 8. `@cambusa/web`

**Added at checkpoint 1**, with the default of decision 4. In `src/lib/api/http.ts`, the comment of the `catch` lists what the client throws without `throwOnError`: a `NetworkError`, and a `TypeError` for a URL or a header it cannot build. It now also throws a `TimeoutError`, after 30 s: the comment says so. The code does not change: the `catch` turns any rejection into status 0, as it does today, and the client keeps the default (no `timeout` in its options).

### Public API, before and after

| Export | After |
| --- | --- |
| `TimeoutError` | new |
| `HttpClientOptions` | `timeout`, 30 s by default |
| `RequestOptions` | `signal`, `timeout` |
| `FetchInit` | `signal` |
| `HttpClient` | rejects with a `TimeoutError`, by default after 30 s, or with the reason of the caller's signal; a `TypeError` for an invalid timeout |
| everything else | unchanged |

## Decisions (to confirm at checkpoint 1)

1. **The timeout ends when `request()` settles**, and does not cover the body that the caller reads afterwards. The client cannot tell when the caller is done with the body, so a timer kept armed past `request()` would run until it fires. A read it cut would reject with an error that the client never sees, so it could be neither a `TimeoutError` nor logged. A caller that wants the body covered passes a `signal`, such as `AbortSignal.timeout(ms)`, which `fetch` applies to the body too.
2. **An abort rejects with the signal's `reason`, unwrapped**, as `fetch` and Node's own APIs do: a caller that aborts with a reason of its own gets that reason back, and `error === signal.reason` holds. The alternative is a `BaseError` subclass of ours with the reason as its `cause`. The abort is logged at `debug`: it is the caller's decision, not a failure.
3. **`TimeoutError`, `TIMEOUT_ERROR`, a sibling class.** The name follows `NetworkError` and `HttpResponseError`, and so does the code. A `DOMException` from `AbortSignal.timeout()` has the same `name`; `instanceof` and `code` tell them apart. `RequestTimeoutError` would read as the status 408, which is the responder's timeout.
4. **A default of 30 seconds, and `false` to turn it off.** **Amended at checkpoint 1**: the spec first had no default, so a consumer that forgot the timeout waited as long as the transport let it. The user chose a default with an opt-out, as ky has (`number | false`, 10 s there). 30 s is long enough not to cut a slow request that would have succeeded, and still turns a hang into an error. It changes the behavior of every consumer: `@cambusa/web` reports a request stuck for 30 s as a failure (section 8). A request can turn the default off, so turning off a client's timeout for one request leaves *Out of scope*.
5. **`request()` does not wait for `fetchImpl` past the timeout or the abort.** The README says that a function of the URL alone fits `FetchImpl`: such a function ignores `init.signal`, and so would a timeout that relied on it.
6. **An invalid timeout throws a `TypeError`**, instead of being clamped or ignored. `false` says "no timeout"; `Infinity`, `0` or `null` would otherwise reach `setTimeout`, and `Infinity` would time out every request after 1 ms on Node (probed above).
7. **A signal already aborted means no call to `fetchImpl`**, and the same rejection and log as an abort during the request. `fetch` itself sends nothing in that case (probed above); a `fetchImpl` that ignores the signal would send it.
8. **`AbortSignal.any()` when a request has both a signal and a timeout.** **Amended after the second review**: for every request with a signal, alone without a timeout (section 3). It is what the platform offers to follow two signals, and probed not to leak over a long-lived one; listeners of our own would have to stay on the caller's signal as long as the body can be read, which the client cannot tell. Browsers have it since Chrome 116, Firefox 124 and Safari 17.4 (not probed: from MDN's compatibility data). There is no fallback.
9. **A timeout during the read of the error body is a `TimeoutError`**, not an `HttpResponseError` with no body: one rule for every phase, and the caller learns that the timeout passed.

## Found while exploring

- **`@cambusa/web` sets no timeout.** Against an API that accepts the connection and never answers, a form stays in its submitting state until the browser gives up (not probed: the container has no browser). Proposed for the backlog in the first draft; **amended at checkpoint 1**: the default of decision 4 covers it, so nothing goes to the backlog.

## Out of scope

- **A timeout per phase** (connect, headers, body), and **retries**.
- **The size of the error body**: its own item in the backlog.
- **A transport's own timeouts**, such as a connect timeout set through `fetchImpl`: they stay `NetworkError`s (section 4).
- **Browsers**: not probed. The client uses `AbortController`, `AbortSignal.any()`, `setTimeout` and `clearTimeout`, which both runtimes declare. At checkpoint 2, the user queued a browser run of the package's tests as a branch of its own: `chore/repo/browser-tests`.

## Test cases

Test-first: the public API of an `@enardo/*` package. The `test-author` writes them from this spec in one run, in the foreground. The tests import from `~/index` only; `BaseError` comes from `@enardo/errors`.

The cases with a stubbed `fetchImpl` may use fake timers; the cases with Node's `fetch` use real ones. "Never settles" is a promise that neither resolves nor rejects. The marked URL is the one of `feature/http/client-errors`: `https://alice:hunter2@api.example.com/v1/users?token=q-secret#frag-secret`, reduced to `https://api.example.com/v1/users`.

### `__tests__/errors/timeout-error.test.ts` (new)

`TimeoutError`, built with `"GET"`, the marked URL and `5000`:

1. It is a `TimeoutError`, a `BaseError` and an `Error`, and neither a `NetworkError` nor an `HttpResponseError`.
2. `name` is `"TimeoutError"`; `message` is `GET https://api.example.com/v1/users timed out after 5000 ms`; `stack` starts with `TimeoutError: ` and that message.
3. `code` is `"TIMEOUT_ERROR"`. In type position, `TimeoutError["code"]` is exactly that literal.
4. `details` equals `{ method: "GET", url: "https://api.example.com/v1/users", timeout: 5000 }`.
5. `cause` is `undefined`. `Object.keys(error)` is exactly `code`, `details` and `name`. `JSON.stringify(error)` contains no marker: `alice`, `hunter2`, `q-secret`, `frag-secret`.
6. Type level: `TimeoutError["details"]` is exactly `{ readonly method: HttpMethod; readonly url: string; readonly timeout: number }`, and an assignment to `details` fails (`@ts-expect-error`).

### `__tests__/index.test.ts`

7. The runtime exports are exactly `HttpClient`, `HttpResponseError`, `NetworkError` and `TimeoutError`. This changes the existing case.

### `__tests__/http-client.test.ts`

**Types.**

8. `HttpClientOptions["timeout"]` and `RequestOptions["timeout"]` are exactly `number | false | undefined`; `RequestOptions["signal"]` is exactly `AbortSignal | undefined`. Each shortcut accepts `signal` and `timeout` in its options (compile only).
9. The existing case *should type FetchInit as what the client passes, and nothing else* gains `signal?: AbortSignal`.

**The timeout's value.**

10. The constructor throws a `TypeError` with the message of section 2 for a `timeout` of `0`, `-1`, `1.5`, `NaN`, `Infinity`, `2147483648`, and, through a cast, `"100"`, `true` and `null`. It accepts `1`, `2147483647` and `false`.
11. `request()` rejects with the same `TypeError` for the same values, with no call to `fetchImpl` and no log. With `1`, `2147483647` and `false`, it calls `fetchImpl`.
12. The default, and a request's timeout over the client's, both ways. With a `fetchImpl` that never settles:
    - no `timeout` anywhere, and then a client with `timeout: undefined`: still pending at 29,999 ms; at 30,000 ms, a `TimeoutError` with `details.timeout` `30000`;
    - client `false`: still pending after an hour;
    - client `1000`, request `50`: a `TimeoutError` at 50 ms, with `details.timeout` `50`;
    - client `50`, request `1000`: still pending at 50 ms, then a `TimeoutError` at 1000 ms, with `details.timeout` `1000`;
    - client `50`, request `undefined`: a `TimeoutError` at 50 ms, with `details.timeout` `50`;
    - client `50`, request `false`: still pending after an hour;
    - client `false`, request `50`: a `TimeoutError` at 50 ms, with `details.timeout` `50`.

**The timeout.** The client has `baseUrl` and a logger; the request is `get("/v1/users?token=q-secret#frag-secret", { timeout: 100 })`.

13. With a `fetchImpl` that never settles: still pending at 99 ms; at 100 ms, it rejects with a `TimeoutError`, not a `NetworkError`, whose `details` equals `{ method: "GET", url: "https://api.example.com/v1/users", timeout: 100 }`.
14. `init.signal` is an `AbortSignal`, not aborted at 99 ms; at 100 ms it is aborted, and its `reason` is the very `TimeoutError` of the rejection (`toBe`).
15. One log in all, at `warn`: `HTTP request timed out.`, with metadata exactly `{ method: "GET", url: "https://api.example.com/v1/users", timeout: 100, error }` (`toStrictEqual`), `error` being the rejection.
16. With `throwOnError`, a `fetchImpl` that resolves with a `500` whose body is a stream that never closes: at 100 ms, it rejects with a `TimeoutError`, not an `HttpResponseError`. One log in all, the `warn` of case 15.
17. The timer ends when `request()` settles. For each outcome below, time advanced 10 s past the timeout leaves `init.signal` not aborted, and the logs exactly the one of that outcome:
    - a `200`, returned;
    - a `500` with a body, with `throwOnError`: an `HttpResponseError`;
    - a rejection of `fetchImpl`: a `NetworkError`.
18. A `fetchImpl` that ignores `init.signal` still gets the `TimeoutError` at 100 ms (case 13). What it does afterwards is dropped:
    - it resolves at 200 ms with a `Response` whose body is a stream with a `cancel` callback: the callback is called, and the logs stay the one `warn`;
    - it rejects at 200 ms: no `unhandledRejection` reaches `process`, and the logs stay the one `warn`;
    - it resolves at 200 ms with `undefined`, or with a `Response` whose body is locked (the stub took a reader): nothing is thrown, no `unhandledRejection` reaches `process`, and the logs stay the one `warn`.
19. A rejection that looks like a timeout or an abort, while neither happened: with `timeout: 10_000` and a signal that is not aborted, `fetchImpl` rejects with `new DOMException("…", "TimeoutError")`, then, in a second case, with `new DOMException("…", "AbortError")`. Each gives a `NetworkError` whose `cause` is `{ name: "TimeoutError" }`, then `{ name: "AbortError" }`, logged once at `warn` with `HTTP request got no response.`.

**The caller's signal.** Same client and request, with `signal` instead of `timeout` unless said otherwise.

20. With a `fetchImpl` that never settles, the caller aborts during the call; `request()` rejects with the very reason (`toBe`), neither a `NetworkError` nor a `TimeoutError`:
    - `abort(new Error("stop"))`: that `Error`;
    - `abort("stop")`: the string;
    - `abort()`: `controller.signal.reason`, a `DOMException` named `AbortError`.
21. One log in all, at `debug`: `HTTP request aborted.`, with metadata exactly `{ method: "GET", url: "https://api.example.com/v1/users" }` (`toStrictEqual`): no reason.
22. A reason whose every trap throws: a `Proxy` over an `Error`, with `get`, `has`, `getPrototypeOf`, `ownKeys` and `getOwnPropertyDescriptor` traps that throw. `request()` rejects with that very proxy (`toBe`), and logs once, at `debug`. The caller aborts during the call, as in case 20 (**amended during the test-author run**: the case did not say when). The test takes the rejection with `try`/`await`/`catch`, not with `reasonOf`: a `.then` handler that returns the proxy resolves a promise with it, which calls its `get` trap (probed).
23. A signal already aborted with `new Error("stop")`: `request()` rejects with that `Error`, `fetchImpl` is not called, and the one log is the `debug` of case 21.
24. The caller's errors come first. With a signal already aborted, each rejects with its `TypeError`, with no call to `fetchImpl` and no log:
    - `get("not a url")` on a client with no `baseUrl`: the `TypeError` of `new URL()`;
    - an invalid header name;
    - `timeout: 0`: the `TypeError` of section 2.
25. With `throwOnError`, a `fetchImpl` that resolves with a `500` whose body never closes; the caller aborts during the read of the body. `request()` rejects with the very reason, and the one log is the `debug` of case 21.
26. `init.signal` follows the caller's signal after `request()` returned a `200`: the caller aborts, and `init.signal` is aborted with the very reason. Twice:
    - with a signal and `timeout: false`;
    - with a signal and `timeout: 100`, time first advanced to 10 s with `init.signal` still not aborted.
27. With no signal, and `timeout: false` on the client, then on the request alone: `init` has no `signal` key.
28. The first of the two decides. With a signal, `timeout: 100`, and a `fetchImpl` that never settles:
    - the caller aborts at 50 ms: the rejection is the reason; at 10 s, the logs are still the one `debug`;
    - the timeout passes at 100 ms: the rejection is a `TimeoutError`; the caller then aborts, and the logs are still the one `warn`.
29. No listener stays on the caller's signal. On a client with `timeout: false`, one signal, never aborted, goes to five requests, settled in turn: a `200`; an `HttpResponseError`; a `NetworkError`; a `TimeoutError` (`timeout: 100`); and a `200` with `timeout: 100`. After each, `getEventListeners(signal, "abort")` of `node:events` is empty.

**The logs.** In *no marker reaches the logs*:

30. Two more outcomes: a request with `timeout` and a `fetchImpl` that never settles; and a request with a signal already aborted, and a `fetchImpl` that never settles. The reason is an `Error` with the own enumerable field `token: "body-secret"`. The case's assertions hold: every log has the reduced URL, and no marker reaches the logged arguments.
    **Amended after the test-author run**: the reason was `new Error("body-secret")`, whose `JSON.stringify` is `{}`, so a logged reason passed the case. The own field puts the marker in its JSON.

**With Node's `fetch` and local servers**, as the existing tests do. Real timers.

31. A server that accepts the connection and never answers; `timeout: 100`. `request()` rejects with a `TimeoutError`, and the server sees its socket close.
32. The same server; the caller aborts at 50 ms. `request()` rejects with the very reason, and the server sees its socket close.
33. A server that answers `500` with a body that never ends; `throwOnError` and `timeout: 100`. `request()` rejects with a `TimeoutError`, and the server sees its socket close.
34. A server that sends a `200`'s headers at once and its body at 300 ms; `timeout: 100`. `request()` resolves, and `res.text()` resolves with the body.
35. The same server, with a signal and `timeout: 100`. `request()` resolves; the caller aborts; `res.text()` rejects with the very reason.

### Review follow-ups

**Added after review.** A second `test-author` run, in the foreground, in `__tests__/http-client.test.ts`. The client has `baseUrl` and a logger; the request is `get("/v1/users?token=q-secret#frag-secret", …)` unless said otherwise.

36. A late value that is not a global `Response`. With `timeout: 100`, a `fetchImpl` that ignores the signal resolves at 200 ms with a plain object, not a `Response`, whose `body` is a `ReadableStream` with a `cancel` callback: the callback is called. With an object whose `body` getter throws, and with one whose `body.cancel` is not a function, nothing is thrown, no `unhandledRejection` reaches `process`, and the logs stay the one `warn`.
37. One timeout for both phases. With `throwOnError` and `timeout: 100`, a `fetchImpl` that resolves at 60 ms with a `500` whose body never closes: still pending at 99 ms, a `TimeoutError` at 100 ms, not at 160 ms.
38. The client's timeout applies to a request with a signal. A signal that never aborts, no `timeout` anywhere, a `fetchImpl` that never settles: still pending at 29,999 ms, a `TimeoutError` at 30,000 ms.
39. With `timeout: false` on the client, a `fetchImpl` that never settles and ignores the signal: the caller aborts, and `request()` rejects with the very reason, logged once at `debug`.
40. The reason of case 22, the `Proxy` whose every trap throws, in the other two phases. The test takes each rejection with `try`/`await`/`catch`:
    - a signal already aborted with it: `request()` rejects with that very proxy, `fetchImpl` is not called, and the one log is the `debug` of case 21;
    - with `throwOnError`, the case 25 setup, the caller aborting with it during the read of the error body: `request()` rejects with that very proxy, and the one log is the `debug`.
41. A signal that is not an `AbortSignal` (`{ aborted: false }`, through a cast), with `timeout: 100`: `request()` rejects with a `TypeError`, `fetchImpl` is not called, nothing is logged, and no timer is left (`vi.getTimerCount()` is 0).
42. Cases 34 and 35 run with `timeout: 500`, and the server sends the body at 1,000 ms: on a loaded machine, local headers could take more than 100 ms (the review). Each still checks what it did.

Seen failing before the fix: case 36's plain object, whose callback is not called; case 41, whose timer is left. Cases 37–40 pass against the code: each is seen failing against the wrong implementation the review found, after the fix:

| Case | Wrong implementation |
| --- | --- |
| 37 | the timer started again before the read of the error body |
| 38 | no client timeout for a request with a signal |
| 39 | no race without a timer, leaving the signal to `fetchImpl` |
| 40 | the reason resolved (`await Promise.resolve(reason)`) on the already-aborted path, then on the error-body path |

### Second review follow-ups

**Added after the second review.** A third `test-author` run, in the foreground, in `__tests__/http-client.test.ts`. Same client and request as the review follow-ups.

43. The read of the error body is cancelled at the timeout. With `throwOnError` and `timeout: 100`, a `fetchImpl` that ignores the signal resolves at once with a `500` whose body is a stream that never closes, with a `cancel` callback: at 100 ms, a `TimeoutError`, and the callback has been called, with `undefined` as its reason.
44. The same with the caller's abort: `timeout: false` on the client, the caller aborts with an `Error` during the read. `request()` rejects with the very reason, and the callback has been called with `undefined`, not with the caller's reason.
45. The body is decoded as `text()` does. With `throwOnError`, a `500` whose body stream sends the UTF-8 bytes of `\uFEFF{"msg":"café"}` in two chunks, split inside the two bytes of `é`: the `HttpResponseError`'s `body` equals `{ msg: "café" }`.
46. A body that is not a web stream. With `throwOnError`, a `fetchImpl` that resolves with an object that is not a `Response`: `status` `500`, `headers` a `Headers`, `body` an object with no `getReader`, and a `text()` that resolves with `{"error":"x"}`. The `HttpResponseError`'s `body` equals `{ error: "x" }`.
47. A signal that is not an `AbortSignal` (`{ aborted: false }`, through a cast), with `timeout: false`: `request()` rejects with a `TypeError`, `fetchImpl` is not called, nothing is logged, and nothing reaches `process` as an `unhandledRejection`.

48. Aborted between the response and the read of its error body. With `throwOnError` and `timeout: false`, a `fetchImpl` that ignores the signal resolves with an object that is not a `Response`: a `status` getter that returns `500` and aborts the caller's controller with an `Error`, `headers` a `Headers`, and a `body` stream that never closes, with a `cancel` callback. `request()` rejects with the very reason, the callback has been called with `undefined`, and the one log is the `debug` of case 21. **Added after the fix**: the read checks the signal when it starts, since an abort that came before it fires no event; removing that check passed cases 43–47.

Seen failing before the fix: cases 43 and 44, whose callback is not called; case 47, whose `fetchImpl` is called. Case 48 passes against the fix, and is seen failing with the check removed. Cases 45 and 46 pass against the code, which reads with `text()`; each is seen failing against a wrong implementation after the fix:

| Case | Wrong implementation |
| --- | --- |
| 45 | each chunk decoded alone (no `stream: true`); a `TextDecoder` that keeps the BOM (`ignoreBOM: true`) |
| 46 | a reader taken from any body, with no fallback to `text()` |

### Third review follow-ups

**Added after the third review.** A fifth `test-author` run, in the foreground, in `__tests__/http-client.test.ts`.

49. Case 29 also checks the combined signal: after each of its five requests, `getEventListeners(init.signal, "abort")` is empty, besides the caller's signal. With the listeners of `race` left, the third review counted 1, 2, 1, 0 and 1 listeners left after the five requests; with the listener of the error-body read left, 0, 1, 0, 0 and 0.
50. A reader whose `cancel()` misbehaves, with `throwOnError` and a `500` whose `body` has a `getReader` returning a reader whose `read()` never settles:
    - its `cancel()` throws; `timeout: 100`: at 100 ms, a `TimeoutError`; nothing reaches `process` as an `uncaughtException` or an `unhandledRejection`; the one log is the `warn`;
    - its `cancel()` returns `undefined`; `timeout: 100`: the same;
    - its `cancel()` throws; `timeout: false`, the caller aborts during the read: `request()` rejects with the very reason, nothing reaches `process`, and the one log is the `debug`.

Case 49 passes against the code, and is seen failing against the two wrong implementations above. Case 50 is seen failing before the fix: the error reaches `process`.

### Seen failing

Before any production code:

- `typecheck` fails: `TimeoutError`, the options and `FetchInit["signal"]` do not exist (cases 1–9, and every case that names them);
- cases 1–6: `TimeoutError` is `undefined` at runtime; case 7: it is missing from the exports;
- cases 10–16, 20–23, 25–26, 28, 31–33, 35: the options are ignored, so the call resolves, stays pending, or calls `fetchImpl`. A case that would stay pending checks the state of the promise at a given time instead of awaiting it;
- case 30: its two outcomes resolve or stay pending, and log no timeout or abort.

Cases that pass before the code pin a rule. Each is seen failing against the wrong implementation it targets instead, after the code is written. So are cases 18 and 29: they fail on `master`, but only because they include a `TimeoutError`, not on the rule they pin (**amended after the test-author run**: the first draft said they pass).

| Case | Passes on `master` because | Wrong implementation |
| --- | --- | --- |
| 17 | there is no timer | a timer cleared only when a response is returned |
| 18 | fails on its `TimeoutError` alone | a late `Response` left uncancelled; a late rejection left unhandled; a late value read without a guard |
| 19 | the options are ignored | the outcome taken from the rejection's `name` |
| 24, first two | the URL and the headers are built first | the signal checked before the URL and the headers are built |
| 27 | there is no `signal` | an `init.signal` even with `timeout: false` |
| 29 | fails on its `TimeoutError` alone; its listener checks pass | a listener removed only when the signal aborts (**amended after the third review**: on the caller's signal, the case no longer sees one; see case 49) |
| 34 | there is no timeout | a timer that is not cleared when `request()` returns |

## Verification

1. **`pnpm verify`**: `@enardo/http-client`, and `@cambusa/web`, which depends on it. No existing test sends a request that stays pending, or checks the keys of `init` exactly (searched), so the default changes none of them.
2. **The tests seen failing** for the reasons above.
3. **The probes of *Today*, run again** on the `dist/` rebuilt with `turbo run build --filter=@enardo/http-client... --force`. Expected: against the server that never answers, `timeout: 100` gives a `TimeoutError` after about 100 ms, and a signal aborted at 50 ms rejects with its reason; with a signal already aborted, nothing reaches the server.
4. **The type probe, run again** against the built `dist/index.d.mts`, in the throwaway container: the `fetch` of npm `undici` 7 and 8 fits `FetchImpl` in a program with the Node types and no DOM lib.
5. **The built declarations**: `dist/index.d.mts` exports `TimeoutError`, and declares `signal` and `timeout` as section 1 does.

## Plan

Each step ends with `pnpm verify` green, and one commit.

1. **Spec** (this file).
2. **The feature**: the `test-author` run, seen failing; then `TimeoutError` and its export, the options, the client, the JSDoc, the README and `CLAUDE.md`.
3. **`@cambusa/web`**: the comment of section 8, in a commit of its own.
4. **Verification** 3–5, the cases of the table seen failing against their wrong implementations, the review, checkpoint 2, integration.
5. **Review follow-ups** (**added after review**): the second `test-author` run, cases 36 and 41 seen failing; then the late body cancelled by its shape, the combined signal built before the timer, the README example and the JSDoc of `signal`; cases 37–40 seen failing against their wrong implementations; a second review. The item leaves `docs/backlog.md` in a commit of its own, before the merge.
6. **Second review follow-ups** (**added after the second review**): the third `test-author` run, cases 43, 44 and 47 seen failing; then the error body read through a reader the deadline cancels, every caller's signal through `AbortSignal.any()`, the README's wording of the logs; cases 45 and 46 seen failing against their wrong implementations; a third review.
7. **Third review follow-ups** (**added after the third review**): the paragraph of the review follow-ups repaired; the fifth `test-author` run, case 50 seen failing; then the cancel of the reader guarded; case 49 seen failing against its two wrong implementations; a fourth review.
