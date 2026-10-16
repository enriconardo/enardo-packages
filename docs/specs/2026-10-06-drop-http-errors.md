---
status: done
type: refactor
packages: ["@enardo/errors", "@cambusa/api-server", "@enardo/http-status", "@enardo/http-client"]
branch: refactor/errors/drop-http-errors
---

# `@enardo/errors`: drop the HTTP error classes

## Why

This is the first queued item of the backlog, from the architectural review of `@enardo/http` (2026-09-25). `@enardo/errors` still exports 14 HTTP error classes and `HttpErrorOptions`, and depends on `@enardo/http-status` only for them. They described a response that a client received. Since `feature/http/client-errors`, `@enardo/http-client` throws its own `HttpResponseError` and `NetworkError`, and no production code builds them. The package that every domain package imports keeps a protocol dependency for dead code.

Probed on `master` (`1ec0a68`) with `git grep` over tracked files, specs excluded. The classes and `HttpErrorOptions` are used by:

- `@enardo/errors` itself: `src/http/` (18 files), `__tests__/http/` (4 files), and the imports and *HTTP error types* block of `__tests__/types.test.ts`;
- two test files of the api-server (`__tests__/errors/authentication-required-error.test.ts`, `__tests__/middleware/error-handler.middleware.test.ts`);
- the api-server's `eslint.config.js`, whose temporary rule forbids importing them in `src/`;
- docs: the README and `CLAUDE.md` of `errors`, the README of `http-status` (an example and a sentence), the README of `http-client` (a sentence).

**Amended after review**: the `CLAUDE.md` of `http-status` too. Its *Leaf package* invariant gives `@enardo/errors` as the dependent that would make an import a cycle. The inventory came from a `git grep` of the class names, and that sentence names none; nor can the pattern of verification 6 find it.

No module reaches `@enardo/http-status` through `@enardo/errors`. Every package whose code imports it declares it: `@enardo/http-client`, the api-server, `@cambusa/web`, `@cambusa/api-contracts`, `@cambusa/error-codes`.

The whole change was prototyped in a clone of the repo, inside a throwaway container from the dev image, so the real `node_modules` were not touched. The facts marked *probed* below come from that clone.

## Changes

### 1. `@enardo/errors`

- **Delete `src/http/`**: `HttpError`, `NetworkError`, `ClientHttpError`, `ServerHttpError`, the 10 concrete classes, `HttpErrorOptions` and their index files.
- **`src/index.ts`** exports `BaseError` and the types `BaseErrorOptions`, `ErrorDetails` and `SerializedError`, as today, and nothing else.
- **`package.json`** loses its `dependencies` key: `@enardo/http-status` was its only entry. `@enardo/http-status`'s own `package.json` has no such key either.
- **The lockfile** loses 4 lines and nothing else: the `dependencies` block of the `packages/errors` importer (probed: `pnpm install --lockfile-only`).
- **`packages/errors/node_modules/@enardo/`** holds `eslint-config` and `typescript-config` after `pnpm install`, and no `http-status` (probed).
- **The tests**: see [Test cases](#test-cases).

### 2. The api-server

- **`eslint.config.js`** loses the `no-restricted-imports` entry and its comment, and becomes the call to the preset alone, as in `packages/errors/eslint.config.js` (lint passes on the prototype). The rule was temporary: once the classes are gone, an import of one fails to compile.
- **`__tests__/errors/authentication-required-error.test.ts`**: the case *"is a BaseError, not an HttpError"* becomes *"is a BaseError"*, and loses its `not.toBeInstanceOf(HttpError)` assertion. That assertion said that the error that replaced `UnauthorizedHttpError` carries no status of its own. With no `HttpError` left, there is nothing to compare against, and the handler ignores any status an error carries (next point).
- **`__tests__/middleware/error-handler.middleware.test.ts`**. Two cases build a `NotFoundHttpError` to pin the rule of the handler: the status comes from the code registry only, never from the error. They get a stand-in defined in the test file:

  ```ts
  /**
   * An upstream failure: it carries the upstream's status wherever a handler
   * could read one. Express's own handler reads `status`, then `statusCode`;
   * `HttpResponseError` of `@enardo/http-client` keeps it in `details.status`.
   */
  class UpstreamError extends BaseError {
    override readonly name = "UpstreamError";
    readonly status = 404;
    readonly statusCode = 404;

    constructor(code: string) {
      super("Status 404 in response to GET https://upstream.example/x", {
        code,
        details: { status: 404 },
      });
    }
  }
  ```

  - The route `/upstream-not-found` passes `new UpstreamError("HTTP_RESPONSE_ERROR")`: `HttpResponseError`'s code, which the registry does not hold. The case expects 500 `INTERNAL_ERROR` and the `"Unhandled error."` log, as today.
  - The route `/not-found-with-conflict-code` passes `new UpstreamError("CONFLICT")`. The case expects the registry's 409, as today.
  - The two case names say "an error" instead of "an HttpError".
  - The comment that says `HttpClient` of `@enardo/http` builds these errors goes: it has been wrong since `feature/http/client-errors`. The JSDoc of `MissingCredentialsError` becomes *"A domain-style error: a `BaseError` with a registered code."*
  - Where express's handler reads a status: `getErrorStatusCode` of `finalhandler` 2.1.1, the version express 5.2.1 installs here, reads `err.status`, then `err.statusCode`, each when it is a number from 400 to 599 (read in the installed source).
  - Both changed files pass on `master`'s handler (probed). They also catch a handler that answers with the carried status, read from any of the three places: verification 3, probed in the prototype.
  - Today's cases catch none of those three handlers (probed on `master`): `NotFoundHttpError` carries its status in `httpStatus` only, a field that neither express nor `@enardo/http-client` uses.

### 3. Docs

- **`packages/errors/README.md`**:
  - the intro's second paragraph, the two export rows of the HTTP classes and `HttpErrorOptions`, and the *HTTP errors* section go;
  - in *Logging*, "fields a subclass adds, such as `httpStatus`" loses its example, and "Never send it in an HTTP response: it carries `details`, the stack and, for an `HttpError`, the upstream response body" ends after "the stack", as the JSDoc of `toJSON` says.
  - The section's last paragraph, "Don't throw them from a server to choose a response status", goes with the classes. The rule it gives the api-server stays in the comment above `createErrorHandlerMiddleware`.
- **`packages/errors/CLAUDE.md`**:
  - the layout line of `src/http/` goes;
  - the invariant *No technology dependency* becomes *No dependencies* (decision 2);
  - "`toJSON` is for logs, never for responses. It carries `details`, the stack and upstream response bodies" ends after "the stack".
- **`packages/http-status/README.md`**:
  - the intro's "anything can depend on it: `@enardo/errors`, `@enardo/http-client`, API contracts and servers" loses `@enardo/errors`;
  - the client half of the example stops throwing `ClientHttpError`, and classifies instead:

    ```ts
    // A client: classify whatever the server sent, 499 included.
    if (isClientErrorStatus(res.status)) {
      // The server says the client seems to have erred (RFC 9110 §15.5).
    }
    ```

    **Amended after review**: the comment first said "The request itself is wrong: sent again as it is, it gets the same answer". That is false for 408, 421, 425 and 429, which a client may send again (RFC 9110 §15.5.9 and §15.5.20, RFC 8470, RFC 6585). The comment now gives the class's meaning, in the words of RFC 9110.

- **`packages/http-status/CLAUDE.md`** (**amended after review**): the *Leaf package* invariant names `@enardo/http-client` as the dependent that would make an import a cycle, instead of `@enardo/errors`.
- **`packages/http-client/README.md`**: the sentence "`@enardo/errors` still exports a `NetworkError` and HTTP error classes of its own, which this package no longer throws. Import the errors from `@enardo/http-client`." goes.
- **`docs/backlog.md`**: the item leaves the queue, in a commit of its own before the merge.

Specs and ADRs keep the old names: they are records.

## Test cases

### `@enardo/errors`: one `test-author` run, test-first

The public API of a shared package changes, so its tests come first and are seen failing before `src/http/` is deleted.

**`__tests__/index.test.ts`**

1. The runtime exports of the entry point are exactly `BaseError`. Fails today: the 14 classes are exported too.
2. `HttpErrorOptions` is not exported: a `@ts-expect-error` on its type import, and `expectTypeOf<HttpErrorOptions>().toBeAny()`, the pattern of the `IBaseError` case. Fails today: `typecheck` reports the unused directive.
3. The case on `IBaseError` and `IHttpError` stays as it is.

**Deleted with the classes**, in the same run:

4. `__tests__/http/`, its 4 files.
5. The *HTTP error types* block of `__tests__/types.test.ts`, and the HTTP names in its two imports. Every other case of `types.test.ts`, and `__tests__/base/`, stays unchanged.

### `@cambusa/api-server`: before the removal, not test-first

The changes of §2 to the two test files. The handler does not change, so they pass before and after the removal.

## Decisions (to confirm at checkpoint 1)

1. **Remove, with no deprecation step.** The monorepo is the only consumer, no production code imports the classes, and `@enardo/http-client` has replaced them. Nothing moves anywhere.
2. **`@enardo/errors` has no dependencies, and its `CLAUDE.md` says so as an invariant.** Most packages of the monorepo import it, directly or not, on Node and in browsers (`@cambusa/web` through `@enardo/http-client` and `@cambusa/shared`), so a dependency of its own would reach them all. An error tied to a protocol or a technology lives in the package that speaks it, as `@enardo/http-client`'s errors do. Today's invariant forbids only a technology dependency, which `http-status`, a package of pure helpers, is not; a protocol dependency is just as out of place here. **Amended after review**: the first sentence first said "every package that throws an error imports it", which `@enardo/email-nodemailer` and `@cambusa/config` contradict: they throw native `Error`s and do not depend on it. The second review added the path through `@cambusa/shared`.
3. **The handler tests get a local stand-in, not `HttpResponseError`.** Using the real class would make `@enardo/http-client` a devDependency of the api-server for one test, and its code is fixed to `HTTP_RESPONSE_ERROR`, so it cannot stand in for the case with a registered code. The stand-in carries its status in the three places a wrong handler could read: the two that express reads, and the one `HttpResponseError` uses.
4. **The api-server's tests are rewritten by the main agent, not by the `test-author`.** They pin behavior that does not change, so they cannot be seen failing against missing code. What shows that they still pin the rule is verification 3: they fail against handlers that read a carried status.
5. **Commits after the spec:**
   1. `[@cambusa/api-server] test:` the two test files, green on the current handler;
   2. `[@enardo/errors] refactor:` the `test-author`'s tests, the deletion of `src/http/`, `package.json`, the lockfile, the api-server's lint rule, and the docs of §3 except the backlog. The `errors` `CLAUDE.md` asks for the README in the same commit as a public API change; the `http-status` and `http-client` sentences describe `errors`; the lint rule guarded against the classes, and goes with them, as the prototype did;
   3. `[repo] docs:` the backlog item, before the merge.

## Found in review

- **Native errors thrown on purpose**: eight throws in `src/` use a native class, against the rule that errors extend `BaseError`. Added to *To evaluate* in `docs/backlog.md`, in a commit of its own.

## Out of scope

- **`serializeError` never calls a nested cause's `toJSON()`**, and **runtime checks for `@enardo/errors`**: their own items in *To evaluate*. This branch changes neither.
- **The branches of `toErrorCode` for objects that are not a `BaseError`**: unchanged, as decision 3 of `refactor/cambusa/api-server/status-from-error-codes` left them.

## Verification

1. **`pnpm verify`** after each step. In the prototype, with the code changes and no docs, it checked 19 packages, `@enardo/errors` and every package that depends on it, directly or not, and passed: 98 tasks, builds included. With the README edits of §3, a dry run lists 21: `@enardo/http-status` and `@cambusa/error-codes` join.
2. **The `test-author`'s cases 1 and 2 seen failing**, each for the reason given, before `src/http/` is deleted.
3. **The handler tests catch a carried status**, after step 1, as a temporary change to the handler, never committed. Three mutations, one at a time, each answering with the carried status when it is a number: `error.status`, `error.statusCode`, `error.details.status`. Each makes both upstream cases fail, and leaves the other two passing (probed in the prototype; on `master`'s tests, all four pass under each).
4. **The lockfile diff** is the 4 lines of §1, and `packages/errors/node_modules/@enardo/` holds no `http-status` after `./dev.sh exec pnpm install`.
5. **The built package**: `dist/index.mjs` exports only `BaseError`, and neither `dist/index.mjs` nor `dist/index.d.mts` mentions `@enardo/http-status` (probed in the prototype).
6. **No current reference left**: `git grep -nE '\b(HttpError|ClientHttpError|ServerHttpError|(BadRequest|Unauthorized|Forbidden|NotFound|Conflict|UnprocessableEntity|InternalServer|BadGateway|ServiceUnavailable|GatewayTimeout)HttpError|HttpErrorOptions|httpStatus|httpError|drop-http-errors)\b' -- ':!docs/specs'` finds only the `HttpErrorOptions` lines of case 2 in `index.test.ts`, and the source line of the backlog item that the review added (see [Found in review](#found-in-review)): a record, like the specs. **Amended after review**: the spec first expected the `index.test.ts` lines alone. `IHttpError` does not match, having no word boundary before its `H`. `NetworkError` is left out of the pattern: `@enardo/http-client` exports its own. The sentences of §3 that name no class (`http-status`'s intro, `http-client`'s README) are checked by reading them. On the prototype, before the docs, the pattern found the `errors` README and `CLAUDE.md` lines of §3 and the `http-status` example, and nothing in code (probed).

## Plan

Each step ends with `pnpm verify` green and one commit.

1. **Spec** (this file).
2. **The api-server's tests** (commit 5.1). Verification 3.
3. **The `test-author` run**, seen failing (verification 2); then the deletion, `package.json`, `./dev.sh exec pnpm install`, the lint rule and the docs (commit 5.2). Verification 4 and 5.
4. **Review**, checkpoint 2, integration: the spec marked done, the backlog item leaves `docs/backlog.md` in a commit of its own (commit 5.3), then verification 6, before the merge.
