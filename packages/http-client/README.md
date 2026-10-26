# @enardo/http-client

An HTTP client over the Fetch API. It runs unchanged in browsers and on Node 24, and it only makes requests: a browser app calls its API with it, and a Node server calls upstream services with it. Receiving requests is the server framework's job.

## Exports

| Export | Meaning |
| --- | --- |
| `HttpClient` | The client: `request()`, and `get`, `post`, `put`, `patch`, `delete`, `head`, `options`. |
| `HttpResponseError` | Thrown with `throwOnError` for a status in 400–599. See [Errors](#errors). |
| `NetworkError` | Thrown when no response arrived. See [Errors](#errors). |
| `TimeoutError` | Thrown when the timeout passed before the request settled. See [Errors](#errors). |
| `NetworkErrorCause` | The `cause` of a `NetworkError`: the names and codes of what `fetchImpl` rejected with. See [Errors](#errors). |
| `HttpClientOptions` | Constructor options: `baseUrl`, `fetchImpl`, `logger`, `timeout`. |
| `RequestOptions` | Request options: `method`, `headers`, `body`, `query`, `throwOnError`, `signal`, `timeout`. |
| `HttpMethod` | The methods the client sends. |
| `QueryValue` | A value of `query`: an array repeats the key, `null` and `undefined` leave it out. |
| `HeadersInput`, `HeadersInputRecord`, `HeadersInputIterable` | What `headers` accepts: a `Headers`, a record, or `[name, value]` pairs. |
| `FetchImpl`, `FetchInit` | The type of `fetchImpl`, and the init it receives. See [`fetchImpl`](#fetchimpl). |
| `Logger`, `LoggerMetadata` | What `logger` must implement. The type is structural: any logger with these methods fits it. |

## Requests

```ts
import { HttpClient } from "@enardo/http-client";

const client = new HttpClient({ baseUrl: "https://api.example.com", logger });

const response = await client.get("/users", { query: { page: 2, tag: ["a", "b"] } });
// GET https://api.example.com/users?page=2&tag=a&tag=b

await client.post("/users", JSON.stringify(user), {
  headers: { "content-type": "application/json" },
});
```

- **The resource**, with a `baseUrl`, is a path under it when it is a string. See [`baseUrl`](#baseurl). Without a `baseUrl`, it is an absolute URL.
- **The method** defaults to `POST` when there is a body, `GET` otherwise. The shortcuts set it.
- **The body** is anything `fetch` takes. The client does not serialize it: send JSON as a string, with its `content-type`.
- **A stream body**, a `ReadableStream` or, on Node, an async iterable of `Uint8Array`, is sent with `duplex: "half"`, which `fetch` requires for it.
- **Not a sync iterable of `Uint8Array`** (a generator, an array of chunks): Node's `fetch` sends it as a string, such as `[object Generator]`.

### `baseUrl`

With a `baseUrl`, a string resource is a path under it: the URL is the origin and the path of `baseUrl`, a `/`, and the resource. A trailing `/` of `baseUrl` and a leading `/` of the resource are optional.

| `baseUrl` | resource | URL |
| --- | --- | --- |
| `https://api.example.com/v2` or `https://api.example.com/v2/` | `/users` or `users` | `https://api.example.com/v2/users` |
| `https://api.example.com/v2/` | `""` or `/` | `https://api.example.com/v2/` |
| `https://api.example.com/v2/` | `/users?page=2`, with `query: { tag: "a" }` | `https://api.example.com/v2/users?page=2&tag=a` |
| `https://api.example.com/v2/` | `//evil.example.com/x` | `https://api.example.com/v2//evil.example.com/x` |
| `https://api.example.com/v2/` | `https://other.example.com/x` | `https://api.example.com/v2/https://other.example.com/x` |

- **A string never leaves the origin of `baseUrl`**, whatever it holds. To reach another origin, pass a `URL`: it is used as it is.
- **It can leave the path of `baseUrl`.** Dot segments are resolved as in any URL, so `../admin` and `%2e%2e/admin` give `https://api.example.com/admin`. `encodeURIComponent` leaves dots as they are: check a segment that comes from untrusted input.
- **The constructor checks `baseUrl`.** It throws a `TypeError` for a value that is not an absolute `http` or `https` URL (an empty string included), and for credentials, a query string or a fragment, which the join would lose. The client keeps a copy, so a `URL` changed after the constructor changes nothing.

### Timeouts and cancellation

```ts
const client = new HttpClient({ baseUrl, timeout: 10_000 }); // every request: 10 s

await client.get("/report", { timeout: 60_000 }); // this one: 60 s
await client.get("/events", { timeout: false }); // this one: none

const controller = new AbortController();
await client.get("/users", { signal: controller.signal });
```

- **Every request has a timeout of 30 s**, unless the client or the request sets another: an integer of milliseconds from 1 to 2147483647, or `false` for none. A request's `timeout` wins over the client's.
- **Any other value throws a `TypeError`**, from the constructor or from the request, `Infinity` included: on Node, `setTimeout` would turn it into 1 ms.
- **The timeout covers what `request()` waits for**: the response, and with `throwOnError` the error body. When it passes, `request()` rejects with a `TimeoutError`.
- **It ends when `request()` settles**, so it does not cover the body you read from the returned response. A `signal` does: `fetch` applies it to the body too. The timeout still applies to the response, 30 s by default: turn it off when the signal is the whole budget.

  ```ts
  const response = await client.get("/export", {
    signal: AbortSignal.timeout(60_000),
    timeout: false,
  });
  const data = await response.json(); // rejects too, once 60 s have passed
  ```

- **When the `signal` aborts**, `request()` rejects with its `reason`, as it is, as `fetch` does. `abort()` with no argument gives a `DOMException` named `AbortError`. A signal of `AbortSignal.timeout()` is a signal like any other: it gives a `DOMException` named `TimeoutError`, not a `TimeoutError` of this package.
- **A signal already aborted sends nothing**: `fetchImpl` is not called.
- **`request()` does not wait for `fetchImpl` to stop.** It settles when the timeout passes or the signal aborts, even with a `fetchImpl` that ignores the signal. A response that arrives later has its body cancelled, and so does an error body the client was reading. A body with no `cancel` method is left as it is: pass `init.signal` on to `fetch`, which stops the request in every case.

## Responses

`request()` and the shortcuts resolve with the `Response` that `fetchImpl` resolved with, unread, whatever its status: check `response.ok` or `response.status`, then read the body.

With `throwOnError: true`, a status in 400–599 is not returned: the client reads the body and throws an `HttpResponseError`.

```ts
const response = await client.get(`/users/${id}`);
if (response.status === 404) return undefined;
if (!response.ok) throw new Error(`Unexpected status ${response.status}`);
return (await response.json()) as User;
```

## Errors

| When | Thrown | Logged |
| --- | --- | --- |
| The constructor cannot use `baseUrl` | the `TypeError` of `new URL()`, or one that says why (see [`baseUrl`](#baseurl)) | no |
| The URL cannot be built: only a string without `baseUrl` can fail | the `TypeError` of `new URL()` | no |
| The URL has credentials | `TypeError: Expected a request URL without credentials` | no |
| A header cannot be built | the `TypeError` of `Headers`, or `Expected a [name, value] header pair` | no |
| The constructor or the request cannot use `timeout` | `TypeError: Expected a timeout in milliseconds, an integer from 1 to 2147483647, or false` | no |
| The request's `signal` aborted, before or during the request | its `reason`, as it is | `debug` |
| No response arrived: `fetchImpl` rejected or threw | `NetworkError` | `warn` |
| The timeout passed before the request settled | `TimeoutError` | `warn` |
| `throwOnError`, and a status in 400–599 | `HttpResponseError` | `warn` |

The first five are the caller's errors: no request goes out, and the client does not log them. They are native `TypeError`s. The messages the client writes hold no part of the URL, but nothing redacts the others. The error of `new URL()` can hold the string it could not parse (a `baseUrl`, or a request's URL), credentials and query string included: on Node, in its own field `input`. An invalid header value appears in the message of `Headers`. A caller that logs them logs those too.

The three classes extend `BaseError` of `@enardo/errors`; none extends another.

**`NetworkError`**: `code` is `"NETWORK_ERROR"`, `details` is `{ method, url }`, and `cause` says why no response arrived. It is what `fetchImpl` rejected with, reduced to a `NetworkErrorCause`: the `name` of each error of its `cause` chain, and its `code` when that is a string. On Node, a refused connection gives:

```ts
{ name: "TypeError", cause: { name: "Error", code: "ECONNREFUSED" } }
```

- Each link is an `Error` of this realm (not one from `vm`) with a string `name`. A rejection that is not one gives no `cause`; deeper in the chain, such a value ends it. The chain keeps 10 links at most.
- Node's `fetch` gives no code when it refuses to send a request, so the reason, which was in the message, is lost. For `GET` or `HEAD` with a body, the `cause` is `{ name: "TypeError" }`; for a port it blocks, or a redirect to a `Location` with credentials, `{ name: "TypeError", cause: { name: "Error" } }`.
- The client keeps nothing else of the rejection. To see it whole while debugging, wrap `fetchImpl`:

```ts
const client = new HttpClient({
  fetchImpl: async (url, init) => {
    try {
      return await fetch(url, init);
    } catch (error) {
      console.debug(error); // whole: URLs and response bytes included
      throw error;
    }
  },
});
```

**`TimeoutError`**: `code` is `"TIMEOUT_ERROR"`, `details` is `{ method, url, timeout }`, and there is no `cause`. It is the client's own timeout only. The timeout of a fetch implementation, such as a `fetchImpl` that passes a signal of its own to `fetch`, rejects as a `NetworkError`, with the rejection's name in the `cause`: `{ name: "TimeoutError" }` for `AbortSignal.timeout()`.

**`HttpResponseError`**: `code` is `"HTTP_RESPONSE_ERROR"`, `details` is `{ method, url, status }`, and two more fields hold the response:

- `headers`: the response's `Headers`;
- `body`: the parsed value when the body is JSON, the text otherwise, `undefined` when it is empty or could not be read.

Branch on `details.status`, never on the message:

```ts
import { HttpResponseError } from "@enardo/http-client";

try {
  await client.delete(`/users/${id}`, { throwOnError: true });
} catch (error) {
  if (error instanceof HttpResponseError && error.details.status === 404) {
    throw new UserNotFoundError(id, { cause: error });
  }
  throw error;
}
```

**What the errors keep out of the logs:**

- `details.url` is the request's URL without credentials, query string or fragment: only its origin and path. The message uses the same URL.
- `headers` and `body` are not enumerable, so `toJSON()`, and any serializer that enumerates own keys, leaves them out.
- The `cause` of a `NetworkError` has no message, stack or other field of the rejection. Those can hold URLs and raw response bytes. On Node:
  - a URL with credentials: `fetch` rejects it with a message that contains it. The client rejects such a URL before the call, so only a `fetchImpl` that builds its own URL gets that message;
  - a redirect whose `Location` does not parse: the nested error's own field `base` is the URL of that hop, query string and fragment included;
  - a malformed response (a space before a header's colon, a NUL byte in a value): the nested `HTTPParserError`'s own field `data` holds the rest of the raw response, headers and body included;
  - with another `fetchImpl`, its own errors: npm `undici`'s `responseError` interceptor turns an error status into a rejection whose nested error holds the response's `headers` and `body`.

  The error does not keep the original rejection, so no serializer reaches it, not even through an error of yours that wraps the `NetworkError`.

Like every `BaseError`, `toJSON()` is for logs: never send it in an HTTP response.

## Logs

Pass a `logger` to get one log per request, once it is built: the caller's errors of [Errors](#errors) are not logged, a signal already aborted is. With a `child` method, the client calls it once, with the context `"HttpClient"`.

| Outcome | Level | Message | Metadata |
| --- | --- | --- | --- |
| a response, returned | `debug` | `HTTP response received.` | `{ method, url, status }` |
| an `HttpResponseError` | `warn` | `HTTP response with an error status.` | `{ method, url, status, error }` |
| a `NetworkError` | `warn` | `HTTP request got no response.` | `{ method, url, error }` |
| a `TimeoutError` | `warn` | `HTTP request timed out.` | `{ method, url, timeout, error }` |
| the request's `signal` aborted | `debug` | `HTTP request aborted.` | `{ method, url }` |

The reason of an abort is not logged: it is the caller's value, and it can hold anything. `url` has no credentials, query string or fragment. Its path is logged: keep secrets out of paths (a token in `/reset/<token>`), or they reach the logs.

The levels leave the judgement to the caller, which knows whether a failure was expected: a 404 it handles, a request it retries.

## `fetchImpl`

The client sends every request through `fetchImpl`, the global `fetch` by default:

```ts
type FetchImpl = (url: URL, init: FetchInit) => Promise<Response>;

interface FetchInit {
  method: HttpMethod;
  headers: Headers;
  body?: HttpBody;
  duplex?: "half"; // only with a stream body
  signal?: AbortSignal; // only with a signal or a timeout
}
```

- It is called with a `URL` and that init, never with a `Request`: npm `undici` and `node-fetch` do not recognize a global `Request`.
- It is called with `globalThis` as `this`, so a browser's `fetch` works.
- `init.signal` aborts when the request's `signal` does, with its reason, or when the timeout passes, with the `TimeoutError`. Pass it on to `fetch`, which then stops the request: Node's `fetch` closes the connection. `request()` settles at that moment either way.
- A function of the URL alone, a stub, or a wrapper fits the type. It does not have to accept everything `fetch` accepts.
- Node transport settings, such as a proxy or connection limits, go through it:

```ts
import { Agent, fetch } from "undici";

const dispatcher = new Agent({ connections: 10 });
const client = new HttpClient({
  baseUrl: "https://upstream.example.com",
  fetchImpl: (url, init) => fetch(url, { ...init, dispatcher }),
});
```

The `fetch` of npm `undici` 7 or 8 fits `FetchImpl` in a program with the Node types and no DOM lib. With the DOM lib too, its types do not match the DOM's (`Response`, the stream body), and it needs a cast.

## Runtimes

`src/` uses only what browsers and Node 24 both define, and the public types resolve with the DOM libs alone or with the Node types alone. [CLAUDE.md](./CLAUDE.md) lists the checks that keep it so. The tests run on Node and in Playwright's builds of Chromium, Firefox and WebKit, apart from those that need Node.

A request with a `signal` passes it through `AbortSignal.any()`, combined with its timeout when it has one. Browsers have it since Chrome 116, Firefox 124 and Safari 17.4, according to MDN's compatibility data. The tests cover only Playwright's current builds, not those first versions.

## Not there yet

A server needs this before it relies on the client. [docs/backlog.md](../../docs/backlog.md) has it, to evaluate.

- **The error body is read whole**, with no size limit.

## Contributing

Run these inside `packages/http-client`, in the dev container: the browser tests need its `playwright` service (see the root `CLAUDE.md`).

```sh
pnpm format && pnpm lint && pnpm typecheck && pnpm test
```

The rules for changing the package are in [CLAUDE.md](./CLAUDE.md).
