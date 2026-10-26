# Backlog

Work that is queued or proposed but not started. Each item becomes a branch, which follows the workflow of its tier (*Workflow* in the root `CLAUDE.md`).

- **Adding items.** An item enters *To evaluate* when a review or an analysis finds it. It moves to *Queued* when the user approves it.
- **Removing items.** A branch removes its own item, in a commit of its own before the merge, so the item leaves this file with the merge: the spec and the git history keep the record. A dropped item moves to *Dropped*, with the reason.
- **Format.** Every item takes a few lines, and says what, why, and where it comes from; the probes of its work go in its branch's spec. It names its source in full, never as "the same review": the item that named the review may leave the file first. Items refer to each other by branch name, not by number: numbers change as the queue moves.

## Queued

In the order approved.

- **`@enardo/http-client`'s `request()` accepts a body with `GET` and `HEAD`.** `fetch` rejects it (`Request with GET/HEAD method cannot have body.`, probed), so the client reports a `NetworkError` for a request that never went out. Since `fix/http-client/redact-cause`, that error no longer says why: Node's rejection has no `code`, and its `cause` is `{ name: "TypeError" }`. The types of `RequestOptions` could refuse it. From the spec of `feature/http/client-errors` (2026-10-05); the lost reason from the spec of `fix/http-client/redact-cause` (2026-10-06).
- **The `node-app` and `library` presets set no `lib`**, so Node code sees the DOM types: in a Node app, `document.title` compiles. `fix/http/runtime-neutral-types` removed what blocked tightening them: `@enardo/http-client`'s body type no longer needs the DOM lib. Without the DOM, the `fetch` of npm `undici` would also fit `@enardo/http-client`'s `FetchImpl` with no cast (probed in the spec of `feature/http/client-errors`). From the architectural review of `@enardo/http` (2026-09-25).
  - An app gets a fixed preset when it installs its new version.

## To evaluate

- **pnpm 12** (12.15.0 on 2026-10-23), deferred while 11 gets fixes: nothing here needs it yet. Tier L. Found in a throwaway clone:
  - it ignores `npm_config_store_dir`, so the store moves into `node_modules/` and the first install downloads everything again: `pnpm_config_store_dir`, which 11 reads too, goes in `docker/docker-compose.yml` and `docker/README.md`, with the dev container recreated;
  - the lockfile gains a leading `packageManagerDependencies` document (+158 lines), and `audit --json` counts its entries;
  - every fresh container downloads a 58 MB native binary, and each install runs a supply-chain check over the network (about 5 s);
  - `verify:all` and `pack` manifests match 11; turbo's key does not hold the pnpm version, so the checks run with `--force`.
  - From the intake of `chore/repo/upgrade-pnpm-11-28` and its `critic` run (2026-10-23).
- **Review the `BaseError`s that report misuse or misconfiguration.** Against ADR 0012 point 6: `UOW_ALREADY_USED`, `MISSING_COLLECTION_CHANGES`, `UNSUPPORTED_IDENTITY`, `INVALID_DATA_STORE_OPTIONS`, `INVALID_EMAIL_SENDER_OPTIONS`, perhaps `ENV_MISSING` and `ENV_MALFORMED`. One branch per package, each a breaking change. The native throws of `src/` (`@enardo/logger`, `retryOnConflict`, `@enardo/http-client`) are consistent with the rule and need nothing. From the spec of `feature/errors/brand-recognition` (2026-10-23).
- **Architectural review of `@enardo/database` and `@enardo/database-mongo`**, starting from `DatabaseError`'s free `code`, the one exception to point 4 of ADR 0012. From the spec of `feature/errors/brand-recognition` (2026-10-23).
- **The vitest `test` block of the Mongo adapters**, identical in `@enardo/transaction-manager-mongo` and `@enardo/uow-repository-mongo` (`globalSetup`, `include`, `hookTimeout`, `testTimeout`): under ADR 0010 and ADR 0011 it moves into `@enardo/vitest-config`. From the `critic`'s run on the spec of `docs/repo/narrow-preset-rule` (2026-10-22).
- **The M trigger of the `critic` is worded for the main agent to judge.** "A decision comes from a discussion with the user" covers, read as written, every M spec with a decision taken with the user, as the template defines *Decisions*; the main agent, whom ADR 0007 deems unable to tell when it has drifted, decides which qualify. Options: a condition it does not judge, such as the user saying at intake whether the spec gets a run, or every M spec with a decision marked as the user's. From the `critic`'s run on the spec of `chore/repo/evaluate-critic` (2026-10-22).
- **Runtime checks for `@enardo/errors` and `@enardo/http-status`.**
  - Both run in browsers and on Node: a web app imports `http-status`, and gets `errors` through `@enardo/http-client`; a server imports both.
  - Neither has the checks `fix/http/runtime-neutral-types` gave `@enardo/http-client`: one typecheck of `src/` per runtime, `isolatedDeclarations`, lint rules against one runtime's imports and globals.
  - Their `src/` passes both runtime typechecks only after types are written out: the runtime presets now hold `isolatedDeclarations` (`feature/env/readers-only`), and opting in, `@enardo/errors` fails it at `src/base/serialize-error.ts:15` (TS9011) and `@enardo/http-status` at `src/reason-phrases.ts:11` and `src/registry.ts:14` (TS9010, two `Object.freeze({...})` exports). Found with `tsc --noEmit --isolatedDeclarations` in each (2026-10-22).
  - Giving them the same checks is a matter of opting in to the presets of `feature/repo/runtime-neutral-presets`: `runtime-browser.json` and `runtime-node.json`, `runtimeNeutral`, and `browserProject()` for their tests (root `CLAUDE.md`, *Testing*), after those types are written out.
  - From the spec of `fix/http/runtime-neutral-types`; the browser tests from the spec of `chore/repo/browser-tests` (2026-10-07).
- **`@types/node` is ahead of the runtime.**
  - The catalog has `@types/node: ^26.4.0`; the dev container runs Node 24 (`docker/dev/Dockerfile`).
  - `@types/node` 26.4.0 declares globals that Node 24.21.0 does not define: `ErrorEvent`, `QuotaExceededError`, `EventSource`, `Storage`, `localStorage`, `sessionStorage`. A program with the Node types and no DOM lib compiles code that throws a `ReferenceError` at runtime.
  - Today that program is `tsconfig.node.json` of `@enardo/http-client`, on the `runtime-node.json` preset, and the lint of `runtimeNeutral` covers the gap: `EventSource` through the computed list of browser-only globals, the others through a hand list (`missingOnNode`, in `@enardo/eslint-config`). The other Node packages also get the DOM lib by default: see the item on the presets' `lib`.
  - Aligning `@types/node` with Node 24 would let the typecheck catch these names. Whether `@types/node` 24 declares them is not probed.
  - From the review of `fix/http/runtime-neutral-types`.
- **The logger drops some errors' content:**
  - `AggregateError.errors` is not enumerable, so it is lost;
  - an error from another realm (`vm`) is not recognized; `Error.isError` would recognize it.
  - From the review of `fix/logger/serialize-nested-errors`.
- **Default exports in `@enardo/database` and `@enardo/database-mongo`** (`DatabaseError`, `MongoDatabase`): the only ones left in `packages/*/src` after `chore/http/package-hygiene`. `no-restricted-exports` with `restrictDefaultExports`, on `src/` in the presets, would keep them out. From the spec of `chore/http/package-hygiene`.
- **A `/// <reference types="node" />` in a `src/` hides every Node global from the browser program** (`@enardo/http-client`'s `tsconfig.browser.json`, or any package's on `runtime-browser.json`), and no check reports it: `@types/node` is a devDependency, and `@typescript-eslint/triple-slash-reference` with its defaults lets the directive through. `"@typescript-eslint/triple-slash-reference": ["error", { types: "never" }]` on `src/**` would close it, in `runtimeNeutral`. From the review of `chore/http/package-hygiene`.
- **`@enardo/http-client` reads an error body whole, with no size limit.** With `throwOnError`, an upstream that sends a large error body fills the caller's memory. The `res.json()` before `feature/http/client-errors` did the same. From the spec of `feature/http/client-errors` (2026-10-05).
- **`serializeError` of `@enardo/errors` never calls a nested cause's `toJSON()`.** It walks the `cause` chain with its own rules, so an error class that controls its serialized form through `toJSON()` loses that control once another error wraps it. `@enardo/logger` calls the `toJSON()` of every value it reaches, but under a wrapping `BaseError` it gets the chain that the wrapper's `toJSON()` already serialized, so the cause's `toJSON()` is never called there either (probed on 2026-10-06). Latent: no error class in the monorepo overrides `toJSON()` today, and `NetworkError` of `@enardo/http-client` reduces its `cause` in its constructor because of it. From the spec of `fix/http-client/redact-cause` (2026-10-06).
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
- **`BcryptPasswordHasher` reads only the first 72 bytes of a password.**
  - bcrypt 6.0.0 ignores what follows them, counted in UTF-8: two passwords that share their first 72 bytes match the same hash. `@enardo/password-hasher-bcrypt`'s README documents it, and its tests pin it.
  - An app that caps no password length, such as one whose routes take `z.string().min(1)`, passes it whatever the user types.
  - It also encodes each lone surrogate as U+FFFD, so `"pw\uD800"`, `"pw\uDC00"` and `"pw�"` match the same hash (probed by the review of `refactor/repo/split-contracts-from-adapters`). The README documents it, and a test pins it.
  - Options: the adapter rejects a longer password, and one that is not well-formed (`String.prototype.isWellFormed`): a behavior change, and a new major. Or each app caps the length and refuses such strings, in its own repo.
  - From the `critic`'s run on the spec of `refactor/repo/split-contracts-from-adapters` (2026-10-20), and its review.
- **Some transient failures on the way to the relay come out `retryable: false`** in `@enardo/email-nodemailer`.
  - The rule of `feature/email/send-errors` counts as retryable, without a reply code, a connection that failed, timed out or was lost: to the relay, a proxy or an OAuth2 token endpoint. An answer that a retry may change is left out. A token endpoint that answers `503` gives `EAUTH`, `AUTH XOAUTH2`, with no `originalCode` for an HTML body (nodemailer's `JSON.parse` throws), and with `originalCode: "EOAUTH2"` for RFC 6749's `temporarily_unavailable`. A proxy that accepts the connection and closes it before the tunnel gives `EPROXY`.
  - Each of these codes also covers misconfigurations, a proxy that refuses its credentials or a token answer nodemailer cannot use, which is why the user kept them permanent. Telling the two apart needs what the sender keeps out of its identifiers: the HTTP status, or the proxy's answer.
  - From the second review of `feature/email/send-errors` (2026-10-20), which probed them.
- **What a package logs.** A decision for every package, with an ADR.
  - Four packages take an optional `Logger`, a no-op by default: `@enardo/cqrs`, `@enardo/database-mongo`, `@enardo/email-nodemailer`, `@enardo/http-client`. (`cqrs` logs at `debug` only since `fix/cqrs/expected-failures-as-values`: it rethrows what it does not expect.) The mechanism matches common practice (Fastify, AWS SDK v3's `logger`, KafkaJS's `logCreator`, Prisma's `log`), as do the local structural copies of `Logger`. What they log, and at what level, has no rule.
  - Each of the other three logs a failure that it also throws or returns: `database-mongo` at `error` (`mongo.database.ts:82`), `email-nodemailer` and `http-client` at `warn`. The caller gets the error and logs it again; the package decides a level it cannot know. `email-nodemailer` also logs at `info` the success the caller awaits (`nodemailer-email-sender.ts:136`).
  - The common rule for a library: log only what the caller cannot see (a retry, a fallback, a reconnection, a timeout before giving up, an error swallowed in a background task or a cleanup), at `debug` or `warn`; never both log and throw an error ("log or throw"), and leave `error` to the app. Fewer log points are also fewer places for personal data or secrets to leak.
  - Alternatives to weigh for observability: hooks the app subscribes to (`onRetry`, `onResponse`), which run in browsers too; Node's `diagnostics_channel`, which undici uses and OpenTelemetry reads, Node only; a decorator or middleware around a component, such as `cqrs`' handlers, so that logging is the app's choice, not a base class's.
  - Each package's log points are then judged against the rule, in its own branch.
  - From the architectural review of `@enardo/cqrs` (2026-10-23), and the discussion that followed it.

## Dropped

- **`fix/errors/proto-key-in-serialize`** (2026-10-02). `serializeError` drops an own `__proto__` field of an error. Such a field can only be created on purpose, with `Object.defineProperty` or a computed class field. Untrusted input belongs in `details`, which already keeps the key. Copying parsed input onto an error with `Object.assign` replaces its prototype instead, and no code in the monorepo does that.
- **A sync `Iterable<Uint8Array>` body is sent as a string on Node** (2026-10-22). `HttpBody` accepts it with the Node types, and Node's `fetch` sends it as `[object Generator]` or `104,105`. `@enardo/http-client`'s README already documents it. Leaving it out of `HttpBody` is a new major for a case no consumer has; rejecting it at runtime needs a list of the iterable bodies `fetch` takes (`URLSearchParams`, `FormData`). From the spec of `fix/http/stream-body-duplex`.
- **Split `@enardo/logger`** (2026-10-22) into a contract and a winston adapter. Winston is a detail the app never picks: it chooses a transport, not an engine, so the package stays opaque (root `CLAUDE.md`, *Architecture conventions*). The local copies of `Logger` in `cqrs`, `database-mongo`, `email-nodemailer` and `http-client` are on purpose: each holds the part it uses, and `Logger` is assignable to all of them. Decided after the architectural review of `@enardo/logger` (2026-10-22).
- **A check of the codes' uniqueness in `pnpm verify`** (2026-10-23). ADR 0012 already records it as an alternative set aside until a first collision, with the reasons: it covers this repo only, misses the value passed to `super`, and adds time to every verify and a script to maintain. The likelier collision, between a project's code and a package's, is outside its reach. From the spec of `feature/errors/brand-recognition`.
- **A manifest and README check in `pnpm verify`** (2026-10-26). A script checking each library package's manifest and README against the rules of the root `CLAUDE.md` (`files`, `sideEffects`, the standard scripts, `publishConfig.registry`, `catalog:`, the packages a README names, the contract as a peer and a dev dependency). Excess zeal: it adds a script to maintain for rules that a review already checks. From the spec of `chore/repo/lean-workflow` (2026-10-16).
