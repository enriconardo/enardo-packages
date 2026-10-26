---
status: draft
type: feature
tier: L
implementer: sonnet/high
packages: ["@enardo/cqrs", "@enardo/http-client", "@enardo/email-nodemailer"]
branch: feature/repo/what-a-package-logs
---

# A package logs only what its caller cannot see; three packages lose their logger

## Why

The first Queued item of the backlog, *What a package logs*, from the architectural review of `@enardo/cqrs` (2026-10-23) and the discussion after it. Four packages take an optional `Logger`, and what they log has no rule. Each of `database-mongo`, `email-nodemailer` and `http-client` logs a failure that it also throws or returns, at a level it cannot know, and `email-nodemailer` logs at `info` the success the caller awaits. ADR 0014 (proposed with this spec) sets the rule. Under it, none of the log points of `cqrs`, `http-client` and `email-nodemailer` survives, and the three lose the whole of their logging code here. `database-mongo` keeps log points, and gets a branch of its own.

The rule and the mechanism were chosen with the user at intake (2026-10-26).

## Probes

- Every log call of the four packages, `git grep -nE '\.(debug|info|warn|error)\(' -- packages/{cqrs,database-mongo,email-nodemailer,http-client}/src`:
  - `cqrs`: `command-handler.ts:40,46,55`, `query-handler.ts:40,46,55`, all `debug`: start, success, expected failure of `execute()`;
  - `http-client`: `http-client.ts:199,222,254` (`warn`, each followed by the throw of the error it logs), `:231,263` (`debug`, a returned response, an abort);
  - `email-nodemailer`: `nodemailer-email-sender.ts:106` (`debug`, before the send), `:136` (`info`, sent), `:143,154` (`warn`, each before the rejection with the error);
  - `database-mongo`: `mongo.database.ts:82` (`error`, then a rethrow), the rest `debug` behind `this.debug`, including a collection created (`:179`), a validator updated (`:187`), an index dropped (`:216`).
- None of `http-client`'s swallowed failures is logged today: a `cancel` that throws or rejects (`cancelQuietly`, `http-client.ts:411-417`), a late rejection and an error of `onLate` (`deadline.ts:94-95`, `:131-133`), an error body that cannot be read (`readBody`, `http-client.ts:429-433`, which the caller gets as `undefined`). The grep above gives the five calls, nothing else. So `http-client` has no log point under the rule. Its swallowed failures are events the rule allows it to log, and none is logged, before or after this change (*Out of scope*).
- `cqrs`' base classes: `protected readonly logger` and `protected readonly options: TOptions`, with `TOptions extends CommandHandlerOptions = CommandHandlerOptions` and `CommandHandlerOptions` holding only `logger?` (`packages/cqrs/src/command-handler.ts:10-32`; `query-handler.ts` the same). The README shows a handler's dependencies in an options interface that extends `CommandHandlerOptions`, read through `this.options` (`packages/cqrs/README.md:20-36`).
- A type probe of the old usage against the new shape: a `CommandHandler<TCommand, TResult>` with no constructor, plus an options type without `logger`. `tsc` 5.9.3 on the `library.json` preset, dev container:
  - `extends CommandHandler<C, R, Opts>` → TS2314;
  - `this.options` and `this.logger` in a subclass → TS2339;
  - `new NoDeps({})` on a handler with no constructor of its own → TS2554;
  - a handler with `constructor(private readonly run: …) { super(); }` compiles;
  - `client({ baseUrl, logger })`, an object literal → TS2353;
  - `const opts = { baseUrl, logger }; client(opts)` compiles: a variable gets no excess-property check, so a consumer that builds its options apart loses its logs with no error.
- No `@enardo/*` package depends on the three: `git grep -l -E '"@enardo/(cqrs|http-client|email-nodemailer)"' -- '*package.json'` gives their own manifests only.
- Versions in the repo: `cqrs` 2.0.0, `http-client` 1.0.0, `email-nodemailer` 5.0.0. On the registry (`GET https://npm.enriconardo.com/@enardo%2f<name>`, the user's token, 2026-10-26): `cqrs` 1.0.0; `http-client` 1.0.0; `email-nodemailer` 1.0.0 and 4.0.0. So `cqrs` 2.0.0 and `email-nodemailer` 5.0.0 are unpublished, and take this change in the same version; `http-client` 1.0.0 is published.
- The redaction of what reaches a log through an error is already tested on the errors themselves: `JSON.stringify` of each error class with markers (`packages/http-client/__tests__/errors/http-response-error.test.ts:79`, `network-error.test.ts:109`, `timeout-error.test.ts:63`), and of real Node rejections, wrapped and through `util.inspect` (`network-error.node.test.ts:63`).
- Tests that use a logger: `cqrs` `command-handler.test.ts` and `query-handler.test.ts` (one `describe` each, from line 222 and 218); `http-client` `http-client.test.ts` (134 lines, a `logs` describe from 2318, and log assertions in about 40 other tests), `http-client.node.test.ts` (36 lines, `expectNoMarkerLogged` at 461), `index.test.ts:11-12,44-45`, `support/http-client.ts:85-110,168-185`; `email-nodemailer` `logs.test.ts`, `support/logger.ts`, `content.test.ts:10-11,37-41,61-70`. Of `logs.test.ts`, case 40 (`:205-278`) is the only test of three readings of a rejection: a `code` getter that throws, a string, identifiers of other types (`git grep -n -E 'withThrowingGetter|fields of other types|"relay down"' -- packages/email-nodemailer/__tests__`, the `critic`'s run). Case 63's identifiers, `originalCode` included, are asserted on the `cause` in `send.test.ts:441`.
- Docs that name the logging of these packages, outside `docs/specs`: each package's README and `CLAUDE.md`, the JSDoc and comments of `src/` (`git grep -n -i 'log' -- packages/<name>/src`), and `packages/logger/CLAUDE.md:36`, which lists the four local copies. The backlog's *Dropped* entry on splitting `@enardo/logger` names them too, as a record.
- The root `CLAUDE.md` is 11 644 bytes, against a cap of 12 000 (`scripts/check-context-size.sh`).

## Decisions

- **The rule** (ADR 0014): log only what the caller cannot see, at `debug` or `warn`, never an error the package throws or returns; `info` and `error` are the app's.
- **The mechanism**: the optional `Logger`, as today. Hooks, `diagnostics_channel` and a decorator were weighed and not taken (ADR 0014, *Alternatives considered*).
- **A package with no log point left loses its logging code whole**: the option, the local `Logger`, `createNoopLogger`, `withLoggerContext`, the exported types. The user chose to do so in this branch, for the three packages.
- **`cqrs`' base classes lose `options` too**, with `TOptions`, `CommandHandlerOptions`, `QueryHandlerOptions` and their constructor: without the logger they would hold a bag that only the subclass reads. A handler takes its dependencies in its own constructor (the user's choice). Not taken: keeping `TOptions` and `this.options` unconstrained, a smaller break that keeps a bag the base does not use.
- **`database-mongo`** goes to a branch of its own, queued here: its `error` on `connect()`, its `debug` flag, its other log points against the rule.
- **The removal leaves no trace** outside `docs/specs` (code, types, tests, READMEs, `CLAUDE.md` files), and no test checks that `logger` is refused. The one exception is `cqrs`' README, whose *Migrating from 1.x* already lists what 2.0.0 removes: the removal joins it.
- **Versions**: `cqrs` stays 2.0.0 and `email-nodemailer` 5.0.0, neither published; `http-client` goes to 2.0.0.

## Open questions

None.

## Changes

**Repo**
- ADR 0014 to `accepted`, with its row in `docs/adr/README.md`.
- Root `CLAUDE.md`, *Architecture conventions*: one line that points to the ADR, about 125 bytes: "A package logs only what its caller cannot see, at `debug` or `warn`, and takes no `logger` without a log point (ADR 0014)."
- `packages/logger/CLAUDE.md:36`: only `database-mongo` keeps a local copy.
- `docs/backlog.md`: *What a package logs* removed. A Queued item for `database-mongo` added: its log points judged against ADR 0014; the `error` of a failed `connect()`; the `debug` flag, which duplicates the logger's level; the drop of an index, which the caller does not see.

**`@enardo/cqrs` 2.0.0**, unpublished
- `src/logger.ts` deleted. `index.ts` stops exporting `Logger` and `LoggerMetadata`.
- `CommandHandler<TCommand, TResult>` and `QueryHandler<TQuery, TResult>`: no `TOptions`, no `options`, no `logger`, no constructor. `CommandHandlerOptions` and `QueryHandlerOptions` removed. `execute()` behaves as before, without its logs.
- README: the example takes its dependency in a constructor. *Logger* removed. In *Migrating from 1.x*, the bullet on `Logger` is replaced by two: the dependencies move from `options` to the handler's constructor (TS2314 on the third type argument, TS2554 on `new` with options), and the shortest path is `constructor(protected readonly options: X) { super(); }`, which keeps every `this.options` read and every `new Handler({ … })`; `execute()` logs nothing, so a log of every command is the app's, around `execute()`.

**`@enardo/http-client` 2.0.0**
- `src/logger.ts` deleted. The `logger` option, its JSDoc, `this.logger`, and the five log calls removed. `endedEarly` loses its URL parameter and its log, and its JSDoc says what it returns only. `redactUrl` stays: the three errors use it. The class JSDoc and `request()`'s lose their sentences on logs.
- README: *Logs* removed, and the *Logged* column of the *Errors* table, with the sentences that refer to logs. The warning on paths moves to *What the errors keep out of the logs*: `details.url` and the message keep the path as it is, so a secret in a path reaches any log of the error. `HttpClientOptions` lists `baseUrl`, `fetchImpl`, `timeout`. The `Logger` row of *Exports* goes, and `logger` leaves the example.
- `CLAUDE.md`: the opening's server needs become "timeouts, a `baseUrl` with a path, errors whose `toJSON()` holds no response body or query string". *Errors and logs* becomes *Errors*: the bullet on what the client puts in a log covers the errors' `toJSON()` only, its known leak being the path; *One log per outcome* goes. *Layout* drops `src/logger.ts`. *Timers* says "the rejection of an `HttpResponseError` with its body" where it says its log.
- `package.json` to 2.0.0.

**`@enardo/email-nodemailer` 5.0.0**, unpublished
- `src/logger.ts` deleted. The `logger` option, `this.logger` and the four log calls removed: `refused()` and `failed()` keep what they compute, or fold into the call sites. The comments that name logs go or say what is left (`nodemailer-email-sender.ts:50`, `:105`, `:260`).
- README: *Logs* removed. Its last bullet moves under the options: nodemailer's own logger is off unless `transport` sets `logger`, and when it is on it logs the recipients and the server's text. The `cause` bullet points there instead of *Logs*. The *Logged* column goes. `logger` leaves the options table, the example and *Exports*.
- `CLAUDE.md`: *Layout* drops `src/logger.ts` and the recording logger. *Logs* becomes a bullet on the errors: they carry counts, flags and nodemailer's identifiers, never an address, a name, a subject, a body, or nodemailer's error. "Nothing is logged" and "read as the logs read them" go.

## Test cases

The change adds no behavior: its cases are the existing tests, changed so that none uses a logger. No behavior other than logging loses its test. In a test that also asserts something else, the log assertions go and the rest stays, and the title drops its log clause ("…, and log once, at warn" → "…"). A test whose only observation is the logger goes.

1. **`cqrs`.** Every handler of `command-handler.test.ts` and `query-handler.test.ts` takes `run` or `thrown` in its own constructor. The suites of `execute()` (payload, listed code, unlisted code, non-error, sync throw) pass unchanged in what they assert. The logger `describe` of each file goes.
2. **`http-client`, the redaction table.** `no marker reaches the logs` (`http-client.test.ts:2408`) becomes `no marker reaches the rejection's JSON`, for the three outcomes that reject with an error of the client: `answered 404 with throwOnError`, `rejected` and `timed out`. Each asserts `JSON.stringify` of the rejection, with the same markers, and `details.url` equal to `REDUCED_URL`. The `answered 200` and `aborted` rows go: the first resolves, and the second rejects with the caller's reason, as its own tests check.
3. **`http-client`, Node's real rejections.** The four cases at `http-client.node.test.ts:478-541` keep their `cause` assertions. `expectNoMarkerLogged(logger)` becomes a check of `JSON.stringify` of the rejected `NetworkError` against the same markers.
4. **`http-client`, the public surface.** `index.test.ts` no longer lists `Logger` and `LoggerMetadata`. `support/http-client.ts` loses `MockLogger`, `createMockLogger`, `logCallsOf`, `timedOutLog` and `ABORTED_LOG`. The comment on `MARKED_PATH` drops "logged as".
5. **`http-client`, the rest.** The `logs` describe goes (`:2318`, the redaction table excepted, as in case 2). In every other test, the log assertions go. "No call and no log" keeps the no-call check, and "log nothing more" keeps the check of `init.signal` or of the cancelled body.
6. **`email-nodemailer`.** Case 40 of `logs.test.ts` moves to `send.test.ts` without its `logger.calls` checks: the three rejections keep their class, `details`, `cause`, and for the last two no `cause` in `toJSON()`. The rest of `logs.test.ts` and `support/logger.ts` go. `content.test.ts`'s refusal helper keeps the rejection's class, `code` and `details` and the idle server's check that nothing was sent, without `logger.calls`. `senderOn` takes the server alone.

Each package's suite then passes in full, with `typecheck` and `lint`. `git grep -n -i 'logger' -- packages/{cqrs,http-client,email-nodemailer}` gives nothing, outside the README lines on nodemailer's own `logger` option and `cqrs`' migration section; `git grep -n -i -w -E 'logs?|logged' -- packages/{cqrs,http-client,email-nodemailer}` gives only what an error's `toJSON()` is for and nodemailer's own logger.

## Risks

`medium`.
- **An app loses logs it relied on**, such as `http-client`'s `warn` on a failure the app then swallows. The compile error shows only for an object literal (TS2353): options built apart compile, and log nothing. Only `cqrs`' migration section says so; `http-client` 2.0.0 and `email-nodemailer` 5.0.0 carry no notice beyond the version, as the removal decision wants. The publish of each is the user's, in a session of its own.
- **A test loses coverage of a behavior it observed through the logger.** The rule above the cases says what stays, and case 6 names the one file where it does not show in a title. The reviewer compares each changed test with its version on `main`.

## Out of scope

- `@enardo/database-mongo`, in its queued branch.
- A log or hook for `http-client`'s swallowed failures: none is logged today, and no app asks for one.
- Exporting `redactUrl`: an app that logs its requests in a wrapper redacts the URL it built itself. No app asks for it.
- Publishing the three packages.

## Plan

Not test-first: the change removes API and adds no behavior. The tests are changed through the `test-author`, from this spec, before the production code of each step, and each step's tests and code are committed together, green.

1. **Repo.** ADR 0014 accepted and indexed, the pointer in the root `CLAUDE.md`, `packages/logger/CLAUDE.md`, the backlog's new item for `database-mongo`. `scripts/check-context-size.sh` passes.
2. **`cqrs`** (case 1), with its README; its version stays.
3. **`http-client`** (cases 2–5), with its README, `CLAUDE.md` and version. Its browser project runs too (`docker/README.md`).
4. **`email-nodemailer`** (case 6), with its README and `CLAUDE.md`; its version stays.
5. **Backlog.** *What a package logs* removed, in a commit of its own.
6. `pnpm verify`.
