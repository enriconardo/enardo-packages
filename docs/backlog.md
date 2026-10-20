# Backlog

Work that is queued or proposed but not started. Each item becomes a branch, which follows the workflow of its tier (*Workflow* in the root `CLAUDE.md`).

- **Adding items.** An item enters *To evaluate* when a review or an analysis finds it. It moves to *Queued* when the user approves it.
- **Removing items.** A branch removes its own item, in a commit of its own before the merge, so the item leaves this file with the merge: the spec and the git history keep the record. A dropped item moves to *Dropped*, with the reason.
- **Format.** Every item takes a few lines, and says what, why, and where it comes from; the probes of its work go in its branch's spec. It names its source in full, never as "the same review": the item that named the review may leave the file first. Items refer to each other by branch name, not by number: numbers change as the queue moves.

## Queued

In the order approved.

1. **`feature/email/send-errors`**
   - **What:** an error type in `@enardo/email` for a failed send, extending `BaseError` (a dependency on `@enardo/errors` only), which adapters throw in place of their driver's errors, with the driver's error as `cause`. The README states what `send` rejects with.
     - The spec decides whether a retryable failure is told apart from a permanent one, and probes what the cause carries into a serialized error.
     - Since `refactor/email/contract-docs`, `send` rejects when the relay refuses any recipient, although the others may have received the message. The spec decides whether the error names the refused recipients, so that a caller can retry those only.
     - nodemailer 10.1.0's errors keep the shape of 6.10.1's: a plain `Error`, with the same `message`, `code` and `command` for a refused connection (`ESOCKET`, `CONN`), a host that does not resolve (`EDNS`, `CONN`), a `535` on `AUTH` (`EAUTH`, `AUTH PLAIN`) and a missing password (`EAUTH`, `API`). 10.1.0 adds an own field `originalCode` (`ECONNREFUSED`, `ENOTFOUND`) on the socket and DNS errors (probed by the review of `chore/email-nodemailer/nodemailer-10`, 2026-10-14, and again).
     - Since `fix/email-nodemailer/contract-compliance`, `@enardo/email-nodemailer` throws three errors of its own: `InvalidEmailSenderOptionsError`, `InvalidEmailMessageError` and `EmailRecipientsRefusedError`. They are interim: the contract's errors replace them, or absorb them. The user asked at that branch's checkpoint 1 (2026-10-14) that their replacement be recorded here.
     - That adapter rejects with nodemailer's own error (`EENVELOPE`, `command: "RCPT TO"`) when the relay refuses every recipient, and with `EmailRecipientsRefusedError` when it refuses some: the contract's error makes them one.
     - nodemailer's errors carry the addresses the server echoed, in `message`, `response`, `rejected`, and the `recipient` of each of `rejectedErrors`: a `cause` keeps them in a serialized error (probed by the spec of `fix/email-nodemailer/contract-compliance`, 2026-10-14).
     - Test-first, as public API of an `@enardo/*` package.
   - **Why:** the contract says nothing of what `send` rejects with, and the adapter lets nodemailer's own `Error` through (`code: "ESOCKET"`, `"EDNS"`, `command: "CONN"`, probed on 2026-10-14). A caller that retries must know the driver's codes, the technology the port hides. The native error also reaches the HTTP client: with the SMTP server unreachable, the unprotected `POST /resend-verification-email` answers `getaddrinfo ENOTFOUND smtp.internal.corp.test` (probed through identity's handler and `CommandHandler` on 2026-10-14). This item closes the email path only: `@enardo/cqrs` turns the message of any native error into the client's error code. `@enardo/database` and `@enardo/uow-repository` already give their adapters contract errors.
   - **From:** the architectural review of `@enardo/email` (2026-10-14); queued by the user (2026-10-14).
2. **`fix/email-nodemailer/non-string-content`**
   - **What:** `@enardo/email-nodemailer` stops passing a `subject`, `text` or `html` that is not a string to nodemailer as it is.
     - nodemailer reads an object body as content to resolve: `{ path }` reads a file into the message, `{ href }` fetches a URL. Through the adapter, `html: { path: "/etc/hostname" }` and `text: { path: "/etc/os-release" }` put those files into the message (probed by the first review of `fix/email-nodemailer/contract-compliance`, 2026-10-14, and again).
     - nodemailer writes an object header value with `prepared: true` as raw text, for every header but those it formats (`FORMATTED_HEADERS`), and `Subject` is not one of them. Through the adapter, `subject: { prepared: true, value: "Hi\r\nBcc: attacker@evil.test\r\nReply-To: attacker@evil.test\r\n…" }` puts a `Bcc` and a `Reply-To` header into the message, and a body of the attacker's; the envelope does not change (probed by the second review of `fix/email-nodemailer/contract-compliance`, 2026-10-15, and again).
     - The types of `@enardo/email` refuse all three: only a caller the types do not reach can pass them. No caller does today: Cambusa's subjects are constant strings.
     - Options: refuse a `subject`, `text` or `html` that is not a string, as the adapter already refuses a recipient that is not an object, which closes both paths; or set `disableFileAccess` and `disableUrlAccess` in each message's data, which makes a body with `path` or `href` reject with `EFILEACCESS` or `EURLACCESS` (probed), unless the transporter's own options set them, and leaves the subject open.
   - **Why:** a value the types refuse reads a file into the message, or writes raw headers (`Bcc`, `Reply-To`), through the adapter.
   - **From:** the first and second reviews of `fix/email-nodemailer/contract-compliance` (2026-10-14 and 2026-10-15); queued by the user at its checkpoint 2 (2026-10-15).
3. **`chore/repo/evaluate-critic`**
   - **When:** once `docs/critic-runs.md` logs five L specs. Until then, the next item goes first.
   - **What:** count the `critic`'s runs by trigger, and remove each trigger none of whose runs changed a decision; a trigger that had no run goes to the user. The critic goes when no trigger is left. The text-only count goes to the user with it.
   - **Why:** the critic guards against a drift seen twice, both times on an L spec of the workflow (ADR 0007), and a rule that is only ever added grew the workflow before (ADR 0005).
   - **From:** the critic's first run on the spec of `chore/repo/spec-critic` (2026-10-16); queued by the user (2026-10-16).

## To evaluate

- **The `node-app` and `library` presets set no `lib`**, so Node code sees the DOM types: in a Node app, `document.title` compiles. `fix/http/runtime-neutral-types` removed what blocked tightening them: `@enardo/http-client`'s body type no longer needs the DOM lib. Without the DOM, the `fetch` of npm `undici` would also fit `@enardo/http-client`'s `FetchImpl` with no cast (probed in the spec of `feature/http/client-errors`). From the architectural review of `@enardo/http` (2026-09-25).
  - Since the split of `en-monorepo` (`chore/repo/split-repos`, 2026-10-16), Cambusa's apps get a fixed preset when they install its new version.
- **Runtime checks for `@enardo/errors` and `@enardo/http-status`.**
  - Both run in browsers and on Node. `@cambusa/web` imports `http-status`, and gets `errors` through `@enardo/http-client` and `@cambusa/shared`; the api-server imports both.
  - Neither has the checks `fix/http/runtime-neutral-types` gave `@enardo/http-client`: one typecheck of `src/` per runtime, `isolatedDeclarations`, lint rules against one runtime's imports and globals.
  - Their `src/` passes both runtime typechecks today (probed on 2026-10-05).
  - Giving them the same checks moves the lint override into a preset of `@enardo/eslint-config`.
  - Their tests could also run in browsers, as `@enardo/http-client`'s do since `chore/repo/browser-tests` (root `CLAUDE.md`, *Testing*). The first of them to opt in moves the `browser` project of `vitest.config.ts` into a shared preset.
  - From the spec of `fix/http/runtime-neutral-types`; the browser tests from the spec of `chore/repo/browser-tests` (2026-10-07).
- **`@types/node` is ahead of the runtime.**
  - The catalog has `@types/node: ^26.4.0`; the dev container runs Node 24 (`docker/dev/Dockerfile`).
  - `@types/node` 26.4.0 declares globals that Node 24.21.0 does not define: `ErrorEvent`, `QuotaExceededError`, `EventSource`, `Storage`, `localStorage`, `sessionStorage`. A program with the Node types and no DOM lib compiles code that throws a `ReferenceError` at runtime.
  - Today that program is `@enardo/http-client`'s `tsconfig.node.json`, and its lint covers the gap: `EventSource` through the computed list of browser-only globals, the others through a hand list (`missingOnNode`). The other Node packages also get the DOM lib by default: see the item on the presets' `lib`.
  - Aligning `@types/node` with Node 24 would let the typecheck catch these names. Whether `@types/node` 24 declares them is not probed.
  - From the review of `fix/http/runtime-neutral-types`.
  - Since the split of `en-monorepo` (`chore/repo/split-repos`, 2026-10-16), Cambusa's catalog has an `@types/node` of its own: aligning it there is Cambusa's change.
- **A sync `Iterable<Uint8Array>` body is sent as a string on Node.**
  - `HttpBody` accepts it on Node because undici's types declare it: `undici-types` 7.24.6, the top of the range the latest `@types/node` 24 depends on, and 8.3.0, the one the catalog's `@types/node` 26.4.0 installs.
  - Node 24.21.0's `fetch` sends a generator as `[object Generator]`, and an array of `Uint8Array` as `104,105` (probed on 2026-10-05).
  - `duplex` does not change it. Options: leave it out of `HttpBody`, or reject it at runtime.
  - From the spec of `fix/http/stream-body-duplex`.
- **Split `@enardo/logger`** into a contract (the interface and the noop logger, no dependencies) and a winston adapter, following the ports-and-adapters rule. It would remove the local copies of the `Logger` interface in `cqrs`, `http-client`, `database-mongo` and `email-nodemailer`. Worth it when one more package needs a logger. From the architectural review of `@enardo/http` (2026-09-25).
- **The logger drops some errors' content:**
  - `AggregateError.errors` is not enumerable, so it is lost;
  - an error from another realm (`vm`) is not recognized; `Error.isError` would recognize it.
  - From the review of `fix/logger/serialize-nested-errors`.
- **Default exports in `@enardo/database` and `@enardo/database-mongo`** (`DatabaseError`, `MongoDatabase`): the only ones left in `packages/*/src` after `chore/http/package-hygiene`. `no-restricted-exports` with `restrictDefaultExports`, on `src/` in the presets, would keep them out. From the spec of `chore/http/package-hygiene`.
- **A `/// <reference types="node" />` in `@enardo/http-client`'s `src/` hides every Node global from `tsconfig.browser.json`**, and no check reports it: `@types/node` is a devDependency, and `@typescript-eslint/triple-slash-reference` with its defaults lets the directive through. `"@typescript-eslint/triple-slash-reference": ["error", { types: "never" }]` on `src/**` would close it. From the review of `chore/http/package-hygiene`.
- **Zombies pile up in the dev container.** Its PID 1 is `sleep infinity`, which never reaps orphaned processes: 81 zombies were counted after an afternoon of probes. They hold only PIDs, but every stopped `./dev.sh exec` session adds more. `init: true` on the `dev` service would make docker's init PID 1. Applying it recreates the container, which stops whatever runs in it. From the spec of `fix/repo/dev-exec-signals` (2026-10-02).
  - Since the split of `en-monorepo` (`chore/repo/split-repos`, 2026-10-16), `cambusa`'s dev container has the same PID 1, and the same item in its own backlog.
- **`@enardo/http-client` reads an error body whole, with no size limit.** With `throwOnError`, an upstream that sends a large error body fills the caller's memory. The `res.json()` before `feature/http/client-errors` did the same. From the spec of `feature/http/client-errors` (2026-10-05).
- **`@enardo/http-client`'s `request()` accepts a body with `GET` and `HEAD`.** `fetch` rejects it (`Request with GET/HEAD method cannot have body.`, probed), so the client reports a `NetworkError` for a request that never went out. Since `fix/http-client/redact-cause`, that error no longer says why: Node's rejection has no `code`, and its `cause` is `{ name: "TypeError" }`. The types of `RequestOptions` could refuse it. From the spec of `feature/http/client-errors` (2026-10-05); the lost reason from the spec of `fix/http-client/redact-cause` (2026-10-06).
- **`serializeError` of `@enardo/errors` never calls a nested cause's `toJSON()`.** It walks the `cause` chain with its own rules, so an error class that controls its serialized form through `toJSON()` loses that control once another error wraps it. `@enardo/logger` calls the `toJSON()` of every value it reaches, but under a wrapping `BaseError` it gets the chain that the wrapper's `toJSON()` already serialized, so the cause's `toJSON()` is never called there either (probed on 2026-10-06). Latent: no error class in the monorepo overrides `toJSON()` today, and `NetworkError` of `@enardo/http-client` reduces its `cause` in its constructor because of it. From the spec of `fix/http-client/redact-cause` (2026-10-06).
- **Native errors thrown on purpose.**
  - The root `CLAUDE.md` says that the errors of shared packages extend `BaseError`; the `@enardo/errors` README, that every error the monorepo throws on purpose does; its `CLAUDE.md`, that every other package's errors do.
  - Twelve throws in `src/` use a native class instead (thirteen until `fix/email-nodemailer/contract-compliance` gave `@enardo/email-nodemailer`'s constructor an error of its own; counted with `git grep -nE "throw new (Error|TypeError|RangeError)" -- '**/src/**'`):
    - `@enardo/logger`: an unsupported transport type;
    - `@enardo/uow-repository`: a `RangeError` for `attempts` in `retryOnConflict`;
    - `@enardo/http-client`: no `fetch` available, and `TypeError`s for a malformed header pair, a URL with credentials, three for a `baseUrl` it cannot use (since `fix/http-client/base-url`), and one for a timeout it cannot use (`toTimeout`, since `feature/http-client/timeouts-and-abort`; missing from this list until the first review of `fix/email-nodemailer/contract-compliance`). Its `CLAUDE.md` keeps a caller's errors native `TypeError`s on purpose;
    - `@cambusa/config`: `CORS_ORIGIN` missing in production, an invalid `LOG_LEVEL`;
    - `@cambusa/web`: `useAuth` outside its provider.
  - Each reports misuse or misconfiguration, which no caller handles by `code`. Options: say so in the rule (an error a caller handles extends `BaseError`, misuse stays native), or convert them.
  - From the review of `refactor/errors/drop-http-errors` (2026-10-06).
  - Since the split of `en-monorepo` (`chore/repo/split-repos`, 2026-10-16), the `@cambusa/*` throws are in Cambusa's repo: the rule is decided here, and Cambusa follows it.
- **A path can climb above the path of `@enardo/http-client`'s `baseUrl`.**
  - The URL parser resolves dot segments: `../admin` and `%2e%2e/admin` against `https://api.example.com/v2/` give `https://api.example.com/admin` (probed on 2026-10-06). `new URL(resource, baseUrl)`, which the client used before `fix/http-client/base-url`, resolves them the same way.
  - A path built from untrusted input, such as `/users/${id}` with `id` set to `..`, reaches another endpoint of the same origin. `encodeURIComponent` leaves dots as they are.
  - Options: reject a URL whose path ends above the base's path, or leave it to callers. A check would have its own questions, such as encoded slashes (`%2F`), which the client leaves as they are and the upstream may decode.
  - From the spec of `fix/http-client/base-url` (2026-10-06).
- **No test runs a browser's own `fetch`.**
  - Every test of `@enardo/http-client` that runs in a browser stubs `fetchImpl`. What only a real `fetch` does in a browser stays untested there: CORS, a stream body and `duplex`, redirects, its rejections. Node's `fetch` is tested against local servers.
  - A page would need a server it can reach: Vitest's own, or one in the dev container exposed through Playwright's `exposeNetwork`.
  - From the spec of `chore/repo/browser-tests` (2026-10-07).
- **A change to `docker/dev/Dockerfile` alone re-checks nothing.**
  - That Dockerfile sets the Node version that every test runs on. Under `--filter=...[main]` (`[master]` in `en-monorepo`, where it was probed), a branch that changes only it selects no package (probed), so `pnpm verify` stays green on cached results.
  - `docker/playwright/Dockerfile` had the same blind spot, and `chore/repo/browser-tests` made it a `globalDependencies` entry of `turbo.json`. That alone is not enough: the tests run in the container that is running, so the image has to be rebuilt before the re-check.
  - From the second review of `chore/repo/browser-tests` (2026-10-07).
  - Since the split of `en-monorepo` (`chore/repo/split-repos`, 2026-10-16), `cambusa` has a dev Dockerfile of its own, with the same gap and the same item in its own backlog.
- **`pnpm audit` reports 23 advisories over the lockfile** (7 moderate, 14 high, 2 critical), on 2026-10-14, after `chore/email-nodemailer/nodemailer-10`. By package, with a path that reaches it:
  - `proxy-addr` 2.0.7, critical, patched in 2.0.8: `api-server>@ts-rest/express>express>proxy-addr`;
  - `tar` 6.2.1, twelve advisories (1 critical, 8 high, 3 moderate), all closed from 7.5.21 (the critical one, `GHSA-23hp-3jrh-7fpw`, from 7.5.19): `password-hasher>bcrypt>@mapbox/node-pre-gyp>tar`;
  - `react-router` 8.1.0, high, patched in 8.3.0: `@cambusa/web`;
  - `qs` 6.15.3, two moderate advisories, both closed from 6.16.0: `api-server>@ts-rest/express>express>body-parser>qs`;
  - `source-map-js` 1.2.1, and `brace-expansion` 1.1.18 and 5.0.9, through the dev tooling (`vitest`, `eslint`) and `bcrypt`'s build.

  `pnpm audit` ignores `--filter`: it always reports the whole lockfile (probed). A lockfile refresh within the current ranges cannot fix two of them: the web app pins `react-router` to exactly `8.1.0`, and `@mapbox/node-pre-gyp` 1.0.11 requires `tar ^6.1.11`, while every `tar` advisory covers all of 6.x. `proxy-addr` and `qs` are within range: express 5.2.1 asks for `proxy-addr ^2.0.7` and `qs ^6.14.0`, body-parser 2.3.0 for `qs ^6.15.2`. Whether `bcrypt` 6 drops `node-pre-gyp` is not probed. From the spec of `chore/repo/arch-review-skill` (2026-10-14), corrected by its review.
  - The counts are of `en-monorepo`'s lockfile, before the split of `en-monorepo` (`chore/repo/split-repos`, 2026-10-16). Each repo has its own lockfile now, and re-runs `pnpm audit` on it: here, the paths through `password-hasher-bcrypt` and the dev tooling.
- **Six READMEs name packages they do not depend on.**
  - Since `refactor/email/contract-docs`, the root `CLAUDE.md` says that a package's README never names a package it does not depend on: a README describes its own package, as if published alone.
  - `http-client` names `@enardo/logger`; `http-status`, `@enardo/http-client`; `transaction-manager`, `@enardo/transaction-manager-mongo`; `transaction-manager-mongo`, `@enardo/database-mongo`; `uow-repository`, `@enardo/transaction-manager-mongo` and `@enardo/uow-repository-mongo`; `uow-repository-mongo`, `@enardo/database-mongo`. Found on 2026-10-14 by a lookup of every `@enardo/*` and `@cambusa/*` name in a README against its package's `dependencies`, `devDependencies` and `peerDependencies`.
  - The fix rewrites each mention without the name, or moves it to the README of a package that depends on the one named: an adapter's README can name its contract.
  - From checkpoint 2 of `refactor/email/contract-docs` (2026-10-14).
- **A manifest and README check in `pnpm verify`.** A script that checks each library package for `"files": ["dist"]`, `"sideEffects": false`, the standard scripts, `publishConfig.registry`, `catalog:` for the shared tooling, and a README that names only packages its package depends on. Today these are rules of the root `CLAUDE.md` that only a review checks. It would fail on the READMEs of *Six READMEs name packages they do not depend on*, so it lands with that item or after it. From the spec of `chore/repo/lean-workflow` (2026-10-16).
- **The `critic`'s first run on an L task does not see its ADR.** The critic runs after the spec's commit, and the ADRs of this repo come later in the plan: ADR 0006 after its checkpoint 1, ADR 0007 in step 3 of its plan. ADR 0007's first version overstated what the user had said; the critic caught it only because, not existing yet at the spec's commit, it first ran after the ADR (93ade53). Drafting the ADR with the spec, or a run on the ADR, would close it. From the first review of `chore/repo/spec-critic` (2026-10-16).
- **`BcryptPasswordHasher` reads only the first 72 bytes of a password.**
  - bcrypt 5.1.1 ignores what follows them, counted in UTF-8: two passwords that share their first 72 bytes match the same hash. `@enardo/password-hasher-bcrypt`'s README documents it, and its tests pin it.
  - Cambusa caps no password length: its routes take `z.string().min(1)` (`packages/api-contracts/src/routes/auth/register-user.route.ts`, `authenticate-user.route.ts`), and identity has no password policy.
  - It also encodes each lone surrogate as U+FFFD, so `"pw\uD800"`, `"pw\uDC00"` and `"pw�"` match the same hash (probed by the review of `refactor/repo/split-contracts-from-adapters`). The README documents it; no test pins it.
  - Options: the adapter rejects a longer password, and one that is not well-formed (`String.prototype.isWellFormed`): a behavior change, and a new major. Or Cambusa caps the length and refuses such strings, in its own repo.
  - From the `critic`'s run on the spec of `refactor/repo/split-contracts-from-adapters` (2026-10-20), and its review.

## Dropped

- **`fix/errors/proto-key-in-serialize`** (2026-10-02). `serializeError` drops an own `__proto__` field of an error. Such a field can only be created on purpose, with `Object.defineProperty` or a computed class field. Untrusted input belongs in `details`, which already keeps the key. Copying parsed input onto an error with `Object.assign` replaces its prototype instead, and no code in the monorepo does that.
