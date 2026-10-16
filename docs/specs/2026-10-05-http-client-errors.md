---
status: done
type: feature
packages: ["@enardo/http", "@enardo/errors", "@cambusa/web"]
branch: feature/http/client-errors
---

# `@enardo/http`: its own errors, the native `Response`, one log per outcome

## Why

The first item of the backlog, a prerequisite for using `@enardo/http` in a server. From the architectural review of `@enardo/http` (2026-09-25):

- errors: `HttpResponseError` and `NetworkError`, as sibling classes, in `@enardo/http`;
- fetch calls:
  - keep calling `fetchImpl(url, init)`: a global `Request` breaks the npm `undici` fetch;
  - build the URL and headers outside the `try`;
  - pass fetch's rejection as `cause`;
- type `fetchImpl` so that other fetch implementations can be injected;
- return the native `Response`;
- logs: one per outcome, with the body left out of `toJSON` and no query string;
- finish the package README and `CLAUDE.md`.

The backlog also leaves this spec to decide the optional rename to `@enardo/http-client` (decision 9).

Probes ran on `master` (`41204fb`) in the dev container: Node 24.21.0, which bundles undici 7.29.1; TypeScript 5.9.3; `@types/node` 26.4.0. The client was probed through its built `dist/`. The other fetch implementations were installed in a scratch directory outside the repo: npm `undici` 7.30.0 and 8.11.2, and `node-fetch` 3.3.2.

## Today

| Call | Result | Logs |
| --- | --- | --- |
| `get("not a url")`, no `baseUrl` | `NetworkError`: `Invalid URL provided: 'not a url' (Base URL: 'None'). Error: Invalid URL` | error |
| `get("/p", { headers: { "bad name": "v" } })` | `NetworkError`: `Network or request error for http://…/p: Headers.append: "bad name" is an invalid header name.` | debug, error |
| `fetch` rejects (`fetch failed`) | `NetworkError`: `Network or request error for <the URL, query included>: fetch failed`, with no `cause`: the reason (a refused connection, a DNS failure) is lost | debug, error |
| a 404 with `throwOnError` | `NotFoundHttpError`: `Request to <the URL, query included> failed with status 404.` | debug, warn, warn |
| a 200 | an `HttpResponse` | debug, debug |
| a 302 to a 404, without `throwOnError` | an `HttpResponse` with `url: ""`, `redirected: false`, `type: "default"`. The native `fetch` gives the final URL, `true` and `"basic"` | |

- **The logs and messages carry the whole URL**, credentials and query string included. Probed with `baseUrl: "https://user:pass@api.example.com/?k=base"` and `get("/users?token=secret", { query: { q: "s2" } })`: both debug logs carry `https://user:pass@api.example.com/users?token=secret&q=s2`, and the logger context carries the `baseUrl` as given.
- **The response body reaches the logs.** The 14 HTTP classes of `@enardo/errors` keep it in `httpError`, an own enumerable field, so `toJSON()` serializes it. Probed: `new NotFoundHttpError("m", { httpError: { token: "secret" } }).toJSON()` contains `"httpError":{"token":"secret"}`.
- **The `try` of `request()` covers everything**: the headers, the call, the mapping of the status. A malformed header is the caller's error, yet it comes out as a `NetworkError`.

## Changes

### 1. Two errors, in `src/errors/`

Both extend `BaseError` from `@enardo/errors` directly. They are siblings, with no common base, as the backlog item says.

**`HttpResponseError`**: a response arrived, with a status the caller asked to treat as an error (`throwOnError`).

```ts
new HttpResponseError(method: HttpMethod, url: URL, response: {
  status: number;
  headers?: Headers; // default: an empty Headers
  body?: unknown;    // default: undefined
});
```

| Member | Value | In `toJSON()` |
| --- | --- | --- |
| `name` | `"HttpResponseError"` | yes |
| `code` | `"HTTP_RESPONSE_ERROR"`, typed as that literal | yes |
| `message` | `Status 404 in response to GET https://api.example.com/users` | yes |
| `details` | `{ method, url, status }`. `url` has no credentials, query string or fragment | yes |
| `headers` | the response's headers | **no** |
| `body` | the response's body, read by the client (section 3) | **no** |

**`NetworkError`**: no response arrived, because `fetchImpl` rejected or threw.

```ts
new NetworkError(method: HttpMethod, url: URL, options?: ErrorOptions);
```

| Member | Value |
| --- | --- |
| `name` | `"NetworkError"` |
| `code` | `"NETWORK_ERROR"`, typed as that literal |
| `message` | `No response to GET https://api.example.com/users` |
| `details` | `{ method, url }`, with `url` reduced as above |
| `cause` | what `fetchImpl` rejected with |

- **The constructor reduces the URL** to `origin + pathname`, so no instance carries credentials or a query string, whoever builds it. Probed: for `https://user:pass@api.example.com/v1/users?token=secret#frag`, that gives `https://api.example.com/v1/users`.
- **`headers` and `body` are not enumerable**, instead of being left out by an override of `toJSON()`. `@enardo/logger` calls `toJSON()` when an object has one, but other serializers enumerate the own keys (`Object.keys`, `util.inspect`). Not enumerable, they stay out of both.
- **The message does not repeat the cause's**, per the rule of `@enardo/errors`: the cause is serialized with the error.
- `@enardo/errors` keeps its own `NetworkError` until `refactor/errors/drop-http-errors`. The two share their name and code. Nothing imports both: `@cambusa/web` imports neither, and the api-server's lint rejects the old one in `src/`.

### 2. The request is built outside the `try`

`request()` does, in order:

1. build the URL and apply `query`;
2. build the `Headers`;
3. build the init: `method`, `headers`, `body`, and `duplex: "half"` for a stream body (unchanged);
4. **inside the `try`, and alone there**: `fetchImpl.call(globalThis, url, init)`. A rejection, or a synchronous throw, becomes `new NetworkError(method, url, { cause })`.

Steps 1–3 throw what they throw, unwrapped, before any call and any log:

- an invalid URL: the `TypeError` of `new URL()` (on Node: `Invalid URL`, code `ERR_INVALID_URL`, probed);
- a malformed header pair: the `TypeError` of `toHeaders` (`Expected a [name, value] header pair`);
- an invalid header name or value: the `TypeError` of `Headers.append`.

**`fetchImpl` is still called with `(url, init)`**, never with a `Request`. Probed against a local server: npm `undici` 7 and 8 reject a global `Request` (`TypeError: Failed to parse URL from [object Request]`), and `node-fetch` rejects it too (`TypeError: Invalid URL`). Called with `(URL, init)`, all three send the request, and npm `undici` sends the entries of a global `Headers` instance.

### 3. `throwOnError` and the error body

With `throwOnError` (default `false`, unchanged) and a status in 400–599 (`isErrorStatus`, unchanged), the client reads the body, then throws an `HttpResponseError`:

- the body is read as text. Empty, `body` is `undefined`; valid JSON, the parsed value; anything else, the text;
- if reading fails (the stream errors), `body` is `undefined`, and the error is still an `HttpResponseError` with its status;
- reading the body releases the connection. On Node, a body left unread holds its connection until it is garbage collected (from undici's documentation, not probed).

The 14 classes chosen by status are gone: a caller branches on `details.status`.

### 4. The native `Response`

`request()` and the shortcut methods resolve with the object `fetchImpl` resolved with, unread and not wrapped. Wrapping it lost `url`, `redirected` and `type` (see *Today*).

`HttpResponse` and `HttpResponseOptions` leave the package (decision 3). The only consumer, `@cambusa/web`, names the type as `Awaited<ReturnType<typeof httpClient.request>>` and reads the body with `response.text()`: both work with a `Response`.

### 5. The type of `fetchImpl`

Today it is `typeof fetch`: a function has to accept everything `fetch` accepts (`string | URL | Request`, and an optional init), though the client only passes a `URL` and an init. After:

```ts
export type FetchImpl = (url: URL, init: FetchInit) => Promise<Response>;

export interface FetchInit {
  method: HttpMethod;
  headers: Headers;
  body?: HttpBody;
  duplex?: "half";
}
```

`FetchInit` lists what the client passes, and nothing else. Extending `RequestInit` would bring in, under the Node types, undici's `dispatcher`, whose type differs between undici versions.

Probed by assigning each implementation to each candidate type, in three programs: DOM libs only; Node types only; both, which is what a Node app gets today, since the presets set no `lib`. npm `undici` and `node-fetch` were checked in the two programs with the Node types: their own types need them.

| Implementation | `typeof fetch` (today) | `(url: URL, init: RequestInit & { duplex?: "half" }) => Promise<Response>` | `FetchImpl` above |
| --- | --- | --- | --- |
| the global `fetch` | all three | all three | all three |
| `(url: URL, init: RequestInit) => fetch(url, init)` | none | all three | all three |
| `async (url: URL) => new Response("x")` | none | all three | all three |
| npm `undici` 8 `fetch` | none | Node only | Node only |
| npm `undici` 7 `fetch` | none | none | Node only |
| npm `undici` 7 or 8 `fetch`, wrapped to add a `dispatcher` | not probed | Node only | Node only |
| the global `fetch`, wrapped to add an npm `undici` 8 `dispatcher` | not probed | Node only | Node only |
| `node-fetch` 3 | none | none | none |

- **With both the DOM libs and the Node types**, npm `undici`'s types do not match the DOM's: its `Response` lacks `[Symbol.dispose]` on the iterators of its headers, and the DOM's `ReadableStream` is not one of its body types. Such a program needs a cast. The *To evaluate* item on the presets' `lib` would take the DOM out of Node apps.
- **`node-fetch`** has its own `Response` type. It is not a target: Node has its own `fetch`.
- The global `fetch` stays the default.

### 6. One log per outcome

| Outcome | Level | Message | Metadata |
| --- | --- | --- | --- |
| a response, returned | `debug` | `HTTP response received.` | `{ method, url, status }` |
| an `HttpResponseError`, thrown | `warn` | `HTTP response with an error status.` | `{ method, url, status, error }` |
| a `NetworkError`, thrown | `warn` | `HTTP request got no response.` | `{ method, url, error }` |
| a `TypeError` of steps 1–3 | none | | |

- `url` is reduced as in section 1, the same value as the errors' `details.url`.
- The `Executing HTTP request.` log goes, and so do the `hasBody`, `throwOnError` and `code` fields.
- The logger context keeps `"HttpClient"`, and loses `baseUrl` (decision 6).
- `error` is serialized through `toJSON()`, so `headers` and `body` stay out. The `cause` of a `NetworkError` goes in as `fetchImpl` gave it (see *Found while exploring*).
- The levels are decision 5.

### 7. Docs and JSDoc

- **`packages/http/README.md`**, new:
  - what the client is, in both runtimes;
  - requests: methods, `query`, headers, bodies, streams and `duplex`;
  - responses: the native `Response`, and `throwOnError`;
  - the errors, and what each one carries and leaves out of its logs;
  - the logs, and that the path of the URL is logged;
  - `fetchImpl`: its type, an example with an npm `undici` dispatcher, and the limit of section 5;
  - what a server still lacks, pointing to `docs/backlog.md`.
- **`packages/http/CLAUDE.md`**: the layout; the errors live here; the README is the public contract. The sentences about the missing README and the classes still in `@enardo/errors` go.
- **JSDoc on every export**, the methods of `HttpClient` included. That closes the *To evaluate* item on the missing JSDoc of `@enardo/http`.
- **`packages/errors/README.md`**: two sentences say that `@enardo/http` throws the HTTP classes. They become: `@enardo/http` no longer uses them, and `refactor/errors/drop-http-errors` removes them. The rest of the `errors` docs is that branch's.
- **`@cambusa/web`, `src/lib/api/http.ts`**: the comment of the `catch` says that, without `throwOnError`, the client only throws a `NetworkError`. It can now also throw a `TypeError`, for a URL or a header it cannot build. The comment says so. The code does not change: the `catch` handles both, as it does today.

### Public API, before and after

| Export | After |
| --- | --- |
| `HttpClient` | `request()` and the shortcuts resolve with a `Response`; `fetchImpl` is a `FetchImpl` |
| `HttpResponse`, `HttpResponseOptions` | removed |
| `HttpResponseError`, `NetworkError` | new |
| `FetchImpl`, `FetchInit` | new types |
| `HttpMethod`, `HttpClientOptions`, `RequestOptions`, `QueryValue`, `HeadersInput`, `HeadersInputRecord`, `HeadersInputIterable`, `Logger`, `LoggerMetadata` | unchanged, with JSDoc |
| `HttpBody` | still internal (decision 8) |

## Decisions (to confirm at checkpoint 1)

1. **`body` is parsed when it is JSON, and kept as text otherwise.** That serves both cases: an upstream's JSON error, and a proxy's HTML page to read. A plain `string` would make every caller write the same `JSON.parse` inside a `try`. Choosing by `content-type` would miss error bodies sent with the wrong type. The cost: a text body that is valid JSON (`404`) comes out parsed.
2. **The error carries `headers` and `body`, not the `Response`.** The body is read, so the `Response` would offer a `json()` and a `text()` that throw. And its `url` has the query string.
3. **`HttpResponse` is removed**, not kept beside the native `Response`. Nothing returns it any more, and all it added to `Response` was a `HeadersInput` in its constructor. Its header tests move to `HttpClient` (run 3).
4. **One `HttpResponseError` with a constant `code`**, not a class or a code per status. The status is in `details.status`, and a code per status (`HTTP_404`) would repeat it.
5. **Log levels: `debug` for a returned response, `warn` for both errors.** The client reports the failure to its caller, which knows whether it was expected (a 404 it handles, a retry), and logs it as an error if it was not. Today a network failure is logged at `error`.
6. **`baseUrl` leaves the logger context**, instead of being reduced like the request's URL. Every log carries the request's URL already. Reducing it would need a fallback for a `baseUrl` that does not parse, which `fix/http/base-url` will reject in the constructor.
7. **The errors of steps 1–3 stay native `TypeError`s**, with no class of ours: `fetch` and `Headers` throw the same for the same inputs, and `toHeaders` already does. They are not logged: no request went out, and the caller gets the exception.
8. **`HttpBody` stays internal.** `RequestOptions["body"]` and `FetchInit["body"]` name it.
9. **The rename to `@enardo/http-client` is queued, as a branch of its own, right after this one** (`refactor/http/rename-to-http-client`). The package has only the caller's role, but its name and its description ("for browser apps and Node servers") read as client and server: at checkpoint 1 they did. Renaming it now touches a single consumer, and lets `fix/http/base-url` and `feature/http/timeouts-and-abort` start with the new scope. It stays out of this branch: it is a different logical change.

## Found while exploring

To add to *To evaluate* in `docs/backlog.md`, in a commit of their own, if approved:

- **The error body is read whole, with no size limit.** With `throwOnError`, an upstream that sends a large error body fills the caller's memory. Today's `res.json()` does the same.
- **The `cause` of a `NetworkError` can carry the request's URL into the logs**, credentials and query string included. The `NetworkError` keeps fetch's rejection as its `cause`, and `toJSON()` serializes the whole chain: each error's message, and its own enumerable fields. Two triggers are probed on Node 24.21.0:
  - **a URL with credentials**, from the caller. Node's `fetch` rejects it with a message that contains the URL: `Request cannot be constructed from a URL that includes credentials: http://u:p@127.0.0.1:1/`;
  - **a redirect whose `Location` does not parse**, from the upstream. **Added after review**: a `302` with `Location: http://exa mple.com/` makes `fetch` reject with `TypeError: fetch failed`, whose own `cause` is an `ERR_INVALID_URL` `TypeError` with the own fields `input` (the `Location`) and `base` (the request's URL, query string included). Both the log and `toJSON()` then contain the query string.

  In the fetch source of npm `undici` 7.30.0, the only other message that embeds a URL is `Failed to parse URL from <input>`, which a `URL` input does not reach (from reading the source; Node 24.21.0 bundles 7.29.1). The review found the second trigger in the fields of an error, which that reading did not cover. Rejecting a URL with credentials before the call, in `fix/http/base-url`, would close the first trigger only: closing the second means redacting the `cause` chain, or keeping it out of the log.

  **Added after the second review**: the leak is not only of URLs.
  - `base` is the URL of the hop whose `Location` fails, which is the request's URL on the first hop only, fragment included. Probed: `/hop` redirected to `/bad?hop-secret=1`, then to the bad `Location`, logs `hop-secret`.
  - A malformed response (`X-Note : a`, a space before the colon) makes the nested error an `HTTPParserError` whose own field `data` holds the rest of the raw response. Probed: a `Set-Cookie: sid=header-secret` and a body `body-secret` both reach the log.
  - Another `fetchImpl` brings its own errors: the review probed npm `undici` 8.10.0's `responseError` interceptor, whose nested error holds the response's `headers` and `body`.
  - So redacting URLs closes nothing but the first trigger. A fix has to drop the messages and own fields of the chain, or keep it out of the log.
- **`request()` accepts a body with `GET` and `HEAD`.** `fetch` rejects it (probed: `Request with GET/HEAD method cannot have body.`), so the client reports a `NetworkError` for a request that never went out. The types of `RequestOptions` could refuse it.

## Out of scope

- **Timeouts and `signal`**: `feature/http/timeouts-and-abort`. Until then, reading the error body has no time limit either: that branch has to cover it.
- **`baseUrl` as a validated prefix**: `fix/http/base-url`.
- **What `refactor/errors/drop-http-errors` covers**:
  - the 14 classes in `@enardo/errors`, and their docs beyond the two sentences of section 7;
  - the example in the `http-status` README;
  - the api-server's lint rule;
  - the api-server tests that build those classes. One of their comments says that `HttpClient` builds them, which stops being true here.
- **Redacting the `cause`**: it is logged as `fetchImpl` gave it. See *Found while exploring*. At checkpoint 2, after the two reviews widened the leak, the user chose to merge with it documented and to queue `fix/http/redact-cause` right after the rename.
- **The path of the URL is logged.** A secret in a path, such as a token in `/reset/<token>`, reaches the logs. The README says so.
- **Redirects with a stream body**: still a `NetworkError`, as `fix/http/stream-body-duplex` left them.
- **The `Error` the constructor throws when no `fetch` exists**: unchanged.
- **The rename to `@enardo/http-client`**: its own branch (decision 9).

## Test cases

Test-first: this is the public API of an `@enardo/*` package. The `test-author` writes the tests from this spec in four runs, one per step of the *Plan*, each in the foreground. The tests import from `~/index` only; `BaseError` comes from `@enardo/errors`.

The URL used by the error and log cases carries a marker in each part that must not come out: `https://alice:hunter2@api.example.com/v1/users?token=q-secret#frag-secret`. Its reduced form is `https://api.example.com/v1/users`.

### Run 1: the errors

In `__tests__/errors/http-response-error.test.ts` and `__tests__/errors/network-error.test.ts`.

`HttpResponseError`, built with `"GET"`, the marked URL, and `{ status: 404, headers: new Headers({ "x-header": "header-secret" }), body: { error: "body-secret" } }`:

1. It is an `HttpResponseError`, a `BaseError` and an `Error`, and not a `NetworkError`.
2. `name` is `"HttpResponseError"`, and `stack` starts with `HttpResponseError: Status 404 in response to GET https://api.example.com/v1/users`.
3. `code` is `"HTTP_RESPONSE_ERROR"`. In type position, `HttpResponseError["code"]` is exactly that literal.
4. `details` equals `{ method: "GET", url: "https://api.example.com/v1/users", status: 404 }`.
5. `headers.get("x-header")` is `"header-secret"`, and `body` equals the object given.
6. `Object.keys(error)` is exactly `code`, `details` and `name`: `name` is an own field, as in every `BaseError` subclass. `JSON.stringify(error)` contains no marker: `alice`, `hunter2`, `q-secret`, `frag-secret`, `body-secret`, `header-secret`. **Amended during run 1**: the list first left out `name`.
7. Built with `{ status: 500 }` alone: `headers` is a `Headers` with no entries, and `body` is `undefined`.
8. Type level: `headers`, `body` and `details` are `readonly` (`@ts-expect-error` on an assignment).

`NetworkError`, built with `"POST"`, the marked URL, and `{ cause }`, where `cause` is `new TypeError("Failed to fetch")`:

9. It is a `NetworkError`, a `BaseError` and an `Error`, and not an `HttpResponseError`.
10. `name` is `"NetworkError"`, and `stack` starts with `NetworkError: No response to POST https://api.example.com/v1/users`.
11. `code` is `"NETWORK_ERROR"`, exactly that literal in type position.
12. `details` equals `{ method: "POST", url: "https://api.example.com/v1/users" }`.
13. `cause` is the given object (`toBe`), and `toJSON().cause` has its `name` and `message`.
14. Built without options, `cause` is `undefined`.
15. `JSON.stringify(error)` contains none of the URL's markers.

`index.test.ts`: the runtime exports become `HttpClient`, `HttpResponse`, `HttpResponseError` and `NetworkError`.

Seen failing: the two classes are not exported, so every case fails on building them, and `typecheck` reports the missing exports.

### Run 2: the client's errors and logs

In `__tests__/http-client.test.ts`, with a stubbed `fetchImpl` and a mock logger.

Building the request:

16. `get("not a url")` on a client without `baseUrl` rejects with a `TypeError` that is not a `NetworkError`. `fetchImpl` is not called, and nothing is logged.
17. The same for the headers `{ "bad name": "v" }`, whose message names an invalid header name (**amended after review**: the case first checked only the class), and for a malformed pair (`[["x-only-name"]]`, cast), whose message is `Expected a [name, value] header pair`.

No response:

18. `fetchImpl` rejects with `new TypeError("Failed to fetch")`: the call rejects with a `NetworkError` whose `cause` is that object (`toBe`), and whose `details` equal `{ method: "GET", url: "https://api.example.com/users" }`.
19. `fetchImpl` throws synchronously: the same.

With `throwOnError: true`:

20. Statuses 400, 404, 418, 500, 503 and 599 each reject with an `HttpResponseError` whose `details` hold that status, the method and the reduced URL.
21. Status 399 resolves.
22. A JSON body `{"error":"X"}` gives `body` equal to `{ error: "X" }`.
23. A `text/plain` body `Not Found` gives `body` equal to `"Not Found"`.
24. An empty body gives `body` equal to `undefined`.
25. A body stream that errors: still an `HttpResponseError` with its status, and `body` is `undefined`.
26. After the rejection, the stubbed `Response` has `bodyUsed` set to `true`.
27. The error's `headers` carry the response's, for example a `retry-after`.

Logs, one per outcome. "Exactly one call" counts the calls on `debug`, `info`, `warn` and `error` together:

28. A 200: exactly one call, `debug("HTTP response received.", { method: "GET", url: "https://api.example.com/users", status: 200 })`.
29. A 500 without `throwOnError`: the same single `debug`, with `status: 500`.
30. A 404 with `throwOnError`: exactly one call, `warn("HTTP response with an error status.", { method, url, status: 404, error })`, where `error` is the rejected instance.
31. A rejection of `fetchImpl`: exactly one call, `warn("HTTP request got no response.", { method, url, error })`, where `error` is the rejected instance.
32. No marker reaches the logs. A client with `baseUrl: "https://alice:hunter2@api.example.com"` calls `get("/v1/users?token=q-secret#frag-secret", { query: { q: "query-secret" } })` three times: answered 200; answered 404 with `throwOnError` and the body `body-secret`; rejected. Each time, the logged `url` is `https://api.example.com/v1/users`, and the `JSON.stringify` of every logged argument contains no marker (`query-secret` included).
33. The logger's `child` is called once, with `context: "HttpClient"` and no `baseUrl` in its metadata.

These existing cases are replaced: the 12 per-status cases of `throwOnError`; `should include httpError from JSON body when available`; `should handle non-JSON error response body gracefully`, now case 23; `should throw NetworkError on fetch failure`, now cases 18 and 31; `should throw NetworkError for invalid URL`, now case 16; `should use the provided logger with HttpClient context`, now case 33; `convenience methods should support throwOnError`, now with `HttpResponseError`. The imports from `@enardo/errors` go, apart from `BaseError` if a case needs it.

Seen failing: cases 16 and 17 get the old `NetworkError`; 18 and 19 get one that is not the new class, with no `cause`; 20 and 22–27 get the per-status classes; 28–33 see the old logs and context. Case 21 passes before and after.

### Run 3: the native `Response`

34. `request()` and each shortcut method resolve with the very object `fetchImpl` resolved with (`toBe`): for a 200, and for a 404 and a 500 without `throwOnError`. Its body is unread (`bodyUsed` is `false`).
35. In type position, `ReturnType<HttpClient["request"]>` is `Promise<Response>`.
36. `header.test.ts`: every case goes through `HttpClient`, reading the `Headers` that `fetchImpl` receives, instead of through `HttpResponse`. Same inputs, same expectations.
37. `http-response.test.ts` is deleted.
38. `index.test.ts`: the runtime exports are exactly `HttpClient`, `HttpResponseError` and `NetworkError`, and `HttpResponseOptions` is not exported (`@ts-expect-error` on its import).

Seen failing: case 34 gets an `HttpResponse`, a different object; 38 fails `typecheck`. Case 36 passes before and after: it only moves.

**Amended during run 3**: case 35 passes before and after too. `HttpResponse` adds no member to `Response`, so the two types are the same to the compiler, and `Promise<HttpResponse>` equals `Promise<Response>`. The case stays, to pin the type: a `Promise<any>`, or a wrapper with members of its own, would fail it.

### Run 4: the type of `fetchImpl`

Type level, enforced by `typecheck`:

39. `HttpClientOptions["fetchImpl"]` is `FetchImpl | undefined`; `Parameters<FetchImpl>` is `[URL, FetchInit]`; `ReturnType<FetchImpl>` is `Promise<Response>`.
40. Each of these compiles as `fetchImpl`: `async (url: URL, init: FetchInit) => new Response()`; `async (url: URL) => new Response()`; the global `fetch`; `vi.fn<typeof fetch>()`.
41. `index.test.ts`: `FetchImpl` and `FetchInit` are in the list of exported types.

Seen failing: `FetchImpl` and `FetchInit` are not exported, and the first two functions of case 40 are not a `typeof fetch`.

### Run 5: review follow-ups

**Added after review.** Cases 22 and 23 send JSON as `application/json` and text as `text/plain`, so a body parsed by its `content-type` would pass them, against decision 1.

42. With `throwOnError`, a JSON body `{"error":"X"}` sent as `text/plain` gives `body` equal to `{ error: "X" }`; the same body with no `content-type` too. A text body `Not Found` sent as `application/json` gives `"Not Found"`.
43. Case 17's amendment: the `TypeError` for the header name `bad name` has a message matching `invalid header name` (Node's wording; the tests run on Node only).

Both pass against the code already in place: they pin what it does. Instead of being seen failing before the code, each is seen failing against a mutation of it: a body parsed by its `content-type` fails case 42.

## Verification

1. **`pnpm verify`**: `@enardo/http`, `@enardo/errors` (docs only) and `@cambusa/web`.
2. **Each run seen failing** for the reasons listed, before its production code.
3. **The probes of *Today*, run again** on the rebuilt `dist/`. Expected:
   - an invalid URL and a bad header name: a `TypeError`, and no log;
   - a rejected `fetch`: a `NetworkError` whose `cause` is fetch's `TypeError`;
   - a 404 with `throwOnError`: an `HttpResponseError`, with the body;
   - the redirect: the native `Response`, with the final `url`;
   - the logged URLs carry no credentials and no query string.
4. **The type probe, run again** with `HttpClientOptions["fetchImpl"]` from the built `dist/index.d.mts`: the last column of section 5 holds.
5. **The built entry point**: `dist/index.mjs` exports exactly `HttpClient`, `HttpResponseError` and `NetworkError`. `pnpm --filter @cambusa/web build` passes.

## Plan

Each step ends with `pnpm verify` green, and one commit.

1. **Spec** (this file).
2. **The errors**: run 1, seen failing; then `src/errors/`, the URL reduction and the exports.
3. **The client's errors and logs**: run 2, seen failing; then `request()`. The comment in `@cambusa/web` gets a commit of its own.
4. **The native `Response`**: run 3, seen failing; then `HttpResponse` goes.
5. **The type of `fetchImpl`**: run 4, seen failing; then `FetchImpl` and `FetchInit`.
6. **Docs**: the README, `CLAUDE.md`, the two sentences of the `errors` README. Verification 3–5.
7. **Backlog**, in a commit of its own: the items of *Found while exploring*, if approved; the JSDoc item leaves *To evaluate*; the rename item moves to *Queued*, right after this branch (decision 9).
8. **Review**, checkpoint 2, integration. The backlog item leaves `docs/backlog.md` in a commit of its own, before the merge.
