# @enardo/http-client

HTTP client over the Fetch API: it makes requests, in browsers and on Node alike. A web app, in a repo of its own, is its only consumer today; a Node consumer would be a server calling upstream services. The public contract is in [README.md](./README.md); this file holds the rules for changing the package.

Server needs are requirements, not extras: timeouts, a `baseUrl` with a path, logs without response bodies or query strings. The logs, the `baseUrl` and the timeouts meet them (below).

## Layout

```
src/http-client.ts          HttpClient, and the read of an error body
src/http-client.types.ts    HttpClientOptions, RequestOptions, HttpMethod, QueryValue, FetchImpl, FetchInit, HttpBody (internal)
src/errors/                 HttpResponseError, NetworkError and the reduction of its cause, TimeoutError
src/deadline.ts             Deadline (the timeout and the caller's signal, raced against fetchImpl), toTimeout
src/header.ts               HeadersInput and its record and iterable shapes
src/logger.ts               the Logger interface (a local copy) and the noop logger
src/utils.ts                toBasePrefix, hasCredentials, toHeaders, redactUrl, isStreamBody
tsconfig.json               editor, build and __tests__: the DOM libs and the Node types together
tsconfig.browser.json       src/ alone, as a browser sees it: DOM libs, no Node types (runtime-browser.json)
tsconfig.node.json          src/ alone, as Node sees it: Node types, no DOM libs (runtime-node.json)
eslint.config.js            runtimeNeutral of @enardo/eslint-config
vitest.config.ts            the test projects: node (every file), browser (all but *.node.test.ts, browserProject() of @enardo/vitest-config)
__tests__/support/          the helpers both kinds of test file share, beyond a few lines; nothing from node:*
```

## URLs

- **A string resource is joined after the origin and the path of `baseUrl` and a `/`**, one trailing `/` of that path and one leading `/` of the resource dropped first. It is never resolved as a relative reference (`new URL(resource, baseUrl)`): after the origin and a `/`, the parser reads a path, so nothing in the resource can change the origin. Dot segments can still climb above the base's path; whether to check them is in the backlog, to evaluate.
- **The base keeps its origin and its path, and nothing else.** What the join would lose (credentials, a query string, a fragment) is refused by the constructor, and so is any scheme but `http` and `https`.

## Errors and logs

- **The client throws three errors of its own**, siblings over `BaseError`: `HttpResponseError`, `NetworkError` and `TimeoutError`. The caller's errors stay native `TypeError`s: a `baseUrl` or a `timeout` the constructor cannot use, and, thrown before `fetchImpl` is called, a timeout, a URL or a header that cannot be used, or a URL with credentials. Only `Deadline.race` wraps the call to `fetchImpl`, so nothing else becomes a `NetworkError`. The messages the client writes for them hold no part of the URL.
- **What the client itself puts in a log or an error's `toJSON()` carries no credentials, query string, response headers or body.** A URL goes through `redactUrl` (origin and path). Response headers and bodies are non-enumerable fields, so they stay out of `toJSON()` and of serializers that enumerate own keys. One known leak remains, in the README: the path of the URL is logged as it is.
- **The `NetworkError` constructor reduces its `cause` to the `name` and string `code` of each error of the chain, and keeps nothing of the original.**
  - Only identifiers: a message, a stack or an own field of a fetch implementation's error can hold anything. On Node they hold URLs (in a message, or in `base`) and raw response bytes (`HTTPParserError.data`). Redacting URLs would not be enough.
  - It never throws: it reads a value the client does not control, so a read that throws (a getter, a Proxy trap) counts as missing, and the chain stops at 10 links. A throw there would replace the `NetworkError` and its log.
  - In the constructor, never in a `toJSON()` override: `serializeError` of `@enardo/errors` walks a nested cause without calling its `toJSON()`, so an error that wraps a `NetworkError` would log the original. `util.inspect` prints it too.
  - The tests reproduce the four triggers the README lists: three against Node's real `fetch`, npm `undici`'s as a stub. The client rejects a URL with credentials itself, so that trigger reaches Node's `fetch` through a `fetchImpl` that adds them. A new trigger gets a test of its own.
- **One log per outcome**, with the levels and messages of the README. A request that is never built logs nothing; one whose signal is already aborted logs its abort.
- **`fetchImpl` is called with `(url, init)`**, never with a `Request`: npm `undici` and `node-fetch` reject a global `Request`. `FetchInit` lists only what the client passes, so that other implementations fit `FetchImpl`.

## Timeouts and the caller's signal

- **An abort rejects with the caller's reason, as it is.** The client never reads into it: no field, no `instanceof`, no promise resolved with it, since resolution reads its `then`. That is why `Deadline.race` resolves with a wrapper (`Raced`), never with a value. The reason is not logged either: it is a value the client does not control.
- **The outcome comes from the client's own state**: its timer first, then the caller's signal. Never from what `fetchImpl` rejected with: a rejection named `TimeoutError` or `AbortError` while neither fired is a `NetworkError`. Never from the reason of the combined signal either: with nothing listening to it, Node sets that reason lazily, to the first aborted source in array order (probed in the spec of `feature/http-client/timeouts-and-abort`).
- **`request()` never waits for `fetchImpl` to honor the signal.** `Deadline.race` settles at the abort. A response that arrives later has its body cancelled, recognized by its shape (a `body` with a `cancel` method), never by `instanceof Response`: npm `undici`'s `Response` is another class. A later rejection, or a failure there, is dropped.
- **The timeout ends when `request()` settles**, in a `finally`. The caller's signal keeps reaching the body of a returned response through `init.signal`.
- **A caller's signal always goes through `AbortSignal.any()`**, with the timeout's signal or alone. It leaves no listener on the caller's signal: a listener of the client's own would have to stay there as long as the body can be read, and a long-lived signal, passed to every request, would collect them. It also throws a `TypeError`, before anything is sent, for a value that is not an `AbortSignal` (one that claims to be aborted is taken at its word by the check that comes first). The client's listeners go on the combined signal, and leave it when they are done: `race`'s when its promise settles, `readText`'s when the read ends. Node keeps a combined signal alive while it has an `abort` listener, so a listener left there keeps one per request: the third review measured it with a long-lived caller's signal.
- **The error body is read through a reader of the client's own** (`readText`), which the deadline cancels, with no reason. `response.text()` would hold the stream's lock, so a read that the request stopped waiting for would go on, buffering, from a `fetchImpl` that ignores the signal. It decodes as `text()` does: UTF-8, a leading BOM dropped. A body that is not a web stream is read with `text()`. Every `cancel()` on a value from `fetchImpl` goes through `cancelQuietly`: one in an `abort` listener that throws would end a Node process.
- **`toTimeout` checks every timeout**: an integer from 1 to 2147483647, or `false`. Node turns `Infinity`, `NaN`, a negative or a larger delay into 1 ms, with only a warning.

## Two runtimes

- **`src/` runs unchanged in browsers and on Node 24.** It uses only what both define: `fetch`, `Request`, `Response`, `Headers`, `URL`, `URLSearchParams`, `FormData`, `Blob`, `AbortController`, `AbortSignal.any()`, `TextDecoder`, the streams, the timers.
  - No `node:*` or builtin module imports, and no `undici`.
  - No global that only one runtime has: `window`, `document`, `process`, `Buffer`. Nor one that Node 24 lacks though `@types/node` declares it: `ErrorEvent`, Web Storage.
- **Public types resolve in both.** A consumer may have the DOM libs and no Node types (a browser app), or the Node types and no DOM libs (a Node server).
  - Never name a DOM-only type alias (`BodyInit`, `HeadersInit`, `RequestInfo`): `@types/node` does not declare them. Derive the type from a global both runtimes declare, as `HttpBody = NonNullable<RequestInit["body"]>` does.
  - Every consumer has `skipLibCheck`. An unresolved name in the declarations turns into `any`, with no error anywhere.
- **A stream body needs `duplex: "half"`.** Node's `fetch` rejects a `ReadableStream` or an async iterable without it, before sending anything. The DOM lib's `RequestInit` does not declare `duplex`; `FetchInit`, the client's own init type, does. Only a stream gets it: every other init stays as it was.
- **Exported types are written out**: the two runtime programs require it (`isolatedDeclarations`, in their presets). An inferred type would be written by the build with the name its own program gives it, a DOM one (`BodyInit`) or a Node one (`NodeJS.Timeout`), and neither runtime program would see it. Written out, the build emits the same names as `src/`, so `tsconfig.json` needs no option.
- **Node transport settings** (dispatcher, proxy) go through `fetchImpl`, never through an import.
- **Wording**: "browser/Node" for the runtimes, "caller/responder" for the two roles in an HTTP exchange. "Client side" mixes them up.

## Checks

`typecheck` runs `tsconfig.json`, then the two runtime programs. The checks come from three presets: the programs from `runtime-browser.json` and `runtime-node.json` of `@enardo/typescript-config`, the lint rules, on `src/` only, from `runtimeNeutral` of `@enardo/eslint-config`, and the `browser` project from `browserProject()` of `@enardo/vitest-config`. Each check covers a blind spot of another:

| Check | Catches | Misses |
| --- | --- | --- |
| `tsconfig.browser.json` | Node globals, `node:*` and builtin imports | all of them after a `/// <reference types="node" />`: `@types/node` is a devDependency |
| `tsconfig.node.json` | DOM globals, DOM-only type names | what `@types/node` declares and Node 24 lacks: `ErrorEvent`, `EventSource`, `QuotaExceededError`, Web Storage |
| `isolatedDeclarations` (in both runtime programs) | exported types left to inference | |
| lint `no-restricted-imports` | `undici`, `node:*`, builtin modules | a dynamic `import()` |
| lint `no-restricted-globals` | globals of one runtime, also as `globalThis.<name>`; the globals Node 24 lacks | type positions, destructuring (`const { process } = globalThis`) |
| the `browser` test project | what a browser does differently at run time, in Chromium, Firefox and WebKit, for the tests that need no Node | the `*.node.test.ts` tests; a browser's own `fetch`, since every test there stubs `fetchImpl`; browsers older than Playwright's builds |

`undici` is not installed in the package, so an import of it, static or dynamic, fails all three programs. The lint restriction stays: installed again, `undici` would bring `@types/node` into the browser program through its types, and hide every Node global from it. Its message is the preset's generic Node-only one: a later entry replaces a rule's options, so the package cannot add a message of its own, and the rule that Node transport settings go through `fetchImpl` is in *Two runtimes* above.

The list of globals, and the hand list of what Node 24 lacks, are in `@enardo/eslint-config`'s README (*`runtimeNeutral`*), where to check them again.

Tests run under vitest, in two projects (`vitest.config.ts`):
- **`node`** runs every test file.
- **`browser`** runs every file but `*.node.test.ts`, in Chromium, Firefox and WebKit, through the `playwright` service (`docker/README.md`).

This package is the example of the opt-in. Another package whose `src/` runs in browsers adds `@enardo/vitest-config` to its `devDependencies` and calls `browserProject()` in its `vitest.config.ts`; extends the two runtime presets of `@enardo/typescript-config` in `tsconfig.browser.json` and `tsconfig.node.json`, which hold `isolatedDeclarations`; and uses `runtimeNeutral` in `eslint.config.js`. Node-only tests go in `*.node.test.ts` files. Helpers that both kinds of test file use go in `__tests__/support/`, which imports nothing from `node:*`; a constant or a builder of a few lines may be repeated instead.

**What runs where:**
- **Stubs.** The tests that run in browsers stub `fetchImpl`.
- **Node only.** A test goes in a `*.node.test.ts` file when it needs Node. That covers:
  - Node's `fetch` and local `node:http` and `node:net` servers;
  - `util.inspect`, `node:vm` and `getEventListeners`;
  - what only Node or V8 puts on a value: `code: "ERR_INVALID_URL"`, undici's messages, a stack whose first line is the message.
- **Node's `fetch`.** What only it does, such as checking `duplex` on a stream body or the errors it rejects with, is tested against the real one. No test runs a browser's own `fetch`.

**Timers:**
- The timeout cases with a stub run under fake timers; those with Node's `fetch`, under real ones.
- A check that needs a real body to have been read, such as the log of an `HttpResponseError` with its body, waits for the request to settle: Firefox reads a body later than the other runtimes, after more than one real macrotask. A check of what has settled at an instant of the fake clock (`track`, `advanceTo`, `rejectionNow`) stays valid when nothing it checks waits on such a read.
- `errorsReachingProcess` listens on `process` on Node, and on the page in a browser. It waits with timers captured before any test fakes them.

Tests import from the entry point only (`~/index`), so the files of `src/` can move without touching them: internal helpers are tested through the public API, as `toHeaders` is through the `Headers` that `HttpClient` hands to `fetchImpl` (`header.test.ts`). `index.test.ts` lists the public surface, so a change to it changes that list too.

## Public API changes

- JSDoc on every export, and the README updated in the same commit.
- No consumer is in this repo: `pnpm verify` sees what a consumer sees through the package's own configs only. `tsconfig.browser.json` checks `src/` with the DOM and no Node types, as a browser consumer sees it, and `tsconfig.node.json` with the Node types and no DOM. A change reaches a consumer when it installs the new version.
