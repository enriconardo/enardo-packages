---
status: draft
type: fix
tier: L
implementer: sonnet/high
packages: ["@enardo/database", "@enardo/database-mongo"]
branch: fix/database/error-contract-and-lifecycle
---

# Drop `DatabaseError`, and order the connection lifecycle of `MongoDatabase`

## Why

From two backlog items:

- *The error contract and the docs of `@enardo/database` and `@enardo/database-mongo`* (Queued; architectural review of the two packages, 2026-10-27). `DatabaseError` is thrown only when `MongoDatabase` has no connection (`getDb()`, `getClient()`, and so `syncSchema()` and `dropStaleIndexes()`): a misuse, which ADR 0012 point 6 gives to native errors, and the one exception to ADR 0012 point 4 (point 5), with a `code` the thrower picks. The JSDoc of `connect()` says it throws `DatabaseError`, which it never does; that of `isConnected()` says "still active", which it does not check; `IDatabase` allows a `connect()` with "initialization tasks", which 2.0.0 removed. `@enardo/database` has no README.
- *`MongoDatabase.connect()` around a closing client* (To evaluate, from the review of `feature/database-mongo/explicit-schema-sync`, 2026-10-29), taken into this branch by the user at intake, since it rewrites the same JSDoc, README section and tests, and `@enardo/database-mongo` 2.0.0 is unpublished. Root cause: `connect()` and `disconnect()` each look at the fields as they are when called, not at the call in progress: a `connect()` during a `disconnect()` sees a client about to close, and a `disconnect()` during a `connect()` sees none yet. And nothing clears the fields when the client is closed by hand.

## Probes

- `pnpm view <package> versions --registry https://npm.enriconardo.com` (host) → `@enardo/database`: `1.0.0`; `@enardo/database-mongo`: `1.0.0`. The manifest's `2.0.0` of `-mongo` is unpublished: this change ships in it, and `@enardo/database` goes to `2.0.0`.
- `git grep -n -e DatabaseError -e '@enardo/database"' -e 'IMongoDatabase\b' -- ':!docs/specs'` → outside the two packages: ADR 0012 point 5, ADR 0013's *Context* (an accepted ADR: not edited), the backlog. No other package depends on either (`git grep` over `packages/*/package.json`).
- A probe test in `packages/database-mongo/__tests__/` against the suite's replica set, removed after (driver `mongodb` 7.6.0):
  - **server down:** a `MongoDatabase` on a `MongoMemoryServer` of its own, connected, server stopped, 1.5 s later → `isConnected()` `true`, no `topologyClosed`, `close` or `serverClosed` event; a `ping` rejects with `MongoServerSelectionError`;
  - **`const p = db.disconnect(); await db.connect(); await p`** → `true` after the `connect()`, `false` after `p`;
  - **`const c = db.connect(); await db.disconnect(); await c`** → `false` after the `disconnect()`, `true` after `c`, and the `ping` succeeds: connected after a `disconnect()` that resolved;
  - **`await db.getClient().close(); await db.connect()`** → `isConnected()` `true` throughout, the same client after `connect()`, a `ping` rejects with `MongoNotConnectedError`;
  - **`connect()` rejections** → `"not-a-uri"`: `MongoParseError` (thrown by `new MongoClient`, inside the async `openConnection()`, so a rejection); an unreachable port: `MongoServerSelectionError`.
- The client's `topologyClosed` event, probed on a bare `MongoClient`:
  - a listener attached after `new MongoClient` and before `connect()` gets it on `close()`; it is not yet emitted when `close()` returns its promise, and is when the promise resolves;
  - a `connect()` that rejects (unreachable) emits it too;
  - `close()` twice, concurrent then again → one event;
  - `connect()` on a closed client resolves, and a `ping` then succeeds.
- Where the driver closes a topology, every site (`grep -rn "topology.close()\|topology?.close()" lib/`): `mongo_client.js:260`, a `connect()` that fails, and `:359`, in `close()`. `TOPOLOGY_CLOSED` is emitted only by `Topology.close()` (`sdam/topology.js:263`), and the client forwards it (`mongo_client.js:252`). So `topologyClosed` on a client means its `close()` or a failed `connect()`, never a server down.
- `MongoClient`'s public declarations (`mongodb.d.ts`) → no getter tells a closed client: `topology` and `s.hasBeenClosed` are internal.
- A contract package with no tests → `@enardo/password-hasher`: scripts on `src` only, no `vitest`, no `test` script, no `@types/node`; its README says why it has no tests.
- The code to change → `MongoDatabase.connect()` `src/mongo.database.ts:84`, `disconnect()` `:110`, `isConnected()` `:123`, `getDb()` `:133`, `getClient()` `:151`; `IMongoDatabase` `src/mongo.database.types.ts:29`; the helper `expectNotConnected` `__tests__/mongo.database.test.ts:73`.

## Decisions

1. **No connection: a native `Error`.** `getDb()` and `getClient()` throw `new Error("MongoDatabase is not connected: await connect() before <method>().")`, `<method>` being the method called (ADR 0012 point 6). `syncSchema()` and `dropStaleIndexes()` reject with the same, naming themselves, before any call to the server. Not taken: a `connect()` inside them, which hides the lifecycle that is the caller's.
2. **`DatabaseError` goes**, from `@enardo/database` with its dependency on `@enardo/errors`: `@enardo/database` 2.0.0 holds `IDatabase` alone, as `@enardo/password-hasher` holds its interface. ADR 0012 gets no new ADR: point 6 already decides the case, so its status records that point 5 is settled by this spec.
3. **`IMongoDatabase` keeps its name** (without the prefix it would be the class's; the `I` prefix item renames the package's types together), **and declares `getDb()` and `getClient()`**: they are how an app uses the database, and a fake of the interface without them cannot stand in where the app calls `getDb()`.
4. **The calls take effect in the order made, one at a time; the last one wins.** A `connect()` made while a `disconnect()` is in progress waits for it, then connects with a new client; a `disconnect()` made while a `connect()` is in progress waits for it to settle, then closes what it opened. A call made while the last in line is a call of the same kind shares its promise: two `connect()`s share one attempt, and its rejection, as today; two `disconnect()`s share one `close()`. A queued call runs whether the one before resolved or rejected. Not taken: leaving the reverse case (a `disconnect()` during a `connect()`) out, as the spec of `feature/database-mongo/explicit-schema-sync` did: the rule that fixes one fixes both, and without it a resolved `disconnect()` can leave the instance connected.
5. **A client closed by hand counts as closed.** `MongoDatabase` listens to `topologyClosed` on each client it creates; when it fires for the client the instance holds, the instance drops it, and the next `connect()` creates a new one, as 1.x did on every `connect()`. The event is the driver's one public signal of a closed client (probes), and it never fires for a server down. Not taken: only documenting that a hand close is not the way to close; reconnecting the same client, which keeps the instance on a client the app closed on purpose.
6. **`isConnected()` means "from the resolution of `connect()` until the client closes"**, through `disconnect()` or `getClient().close()`. It never checks the server: with the server down it stays `true`, and an operation rejects with the driver's error. `connect()` rejects with the driver's error as it is (`MongoParseError`, `MongoServerSelectionError`, …).
7. **`IDatabase`'s contract** (JSDoc and README): `connect()` resolves when the database can be used and rejects with an error its implementation documents; `disconnect()` releases the resources and resolves at once when not connected; `isConnected()` is `true` between a `connect()` that resolved and the close of the connection, and checks no server. Its JSDoc loses the "initialization tasks". How concurrent calls behave is each implementation's to document.

## Open questions

- **Decision 4 takes the reverse case in** (a `disconnect()` during a `connect()`), which the intake left to the spec: one rule fixes both. Confirm, or leave it out.
- **Decision 5 takes option (b)**, detecting a hand close, which the intake recommended only if the probe found a public signal of a closed client: it found `topologyClosed`. Confirm, or keep option (a), documenting it.

## Changes

`@enardo/database` → 2.0.0:
- `src/errors/` and `__tests__/` deleted, `DatabaseError` out of `src/index.ts`; `vitest.config.ts` deleted.
- `package.json`: `version` `2.0.0`; `description` "The contract of a database connection's lifecycle."; no `dependencies`; `vitest` and `@types/node` out of `devDependencies`; the scripts on `src` only, without `test` and `test:watch`, as `@enardo/password-hasher`.
- `src/database.types.ts`: the JSDoc of decision 7.
- `README.md`, new, in the form of `@enardo/password-hasher`'s: what the package holds, an example of a caller typed on `IDatabase`, *Contract* (decision 7), *Contributing* (no tests: an interface has no runtime, each implementation checks it with `implements`). It names no implementation.

`@enardo/database-mongo` (2.0.0, unpublished):
- `src/mongo.database.ts`: decisions 1, 4, 5, 6; the import of `DatabaseError` goes; the JSDoc of `connect()` (`@throws` the driver's error; the order of the calls), `disconnect()` (the order), `isConnected()` (decision 6), `getDb()` and `getClient()` (`@throws {Error}` when not connected), `syncSchema()` and `dropStaleIndexes()` (`@throws {Error}` when not connected; the rejection "before `connect()`" becomes "when not connected").
- `src/mongo.database.types.ts`: `IMongoDatabase` declares `getDb(): Db` and `getClient(): MongoClient`, with JSDoc; its JSDoc drops `DatabaseError`.
- `README.md`: the paragraph on `connect()` (line 24) becomes a section *The connection*: decisions 4, 5, 6, and what "not connected" means (never connected, a `connect()` in progress or rejected, after the close); line 35 names the native `Error`; *Upgrading from 1.x* adds: `getDb()` and `getClient()` throw a native `Error` where they threw `DatabaseError`, and `@enardo/database` `^2.0.0` is the peer; `IMongoDatabase` declares `getDb()` and `getClient()` too, so a fake adds them.
- `CLAUDE.md`: a section *The connection*, with the rules of decisions 4 and 5 and their reasons: the order of the calls, the shared call of the same kind, the `topologyClosed` listener with its identity check and the driver sites that emit it.

Repo:
- `docs/adr/0012-errors-recognized-by-a-brand.md`: status `accepted; point 3's open question settled by 0013; point 5 settled by docs/specs/2026-10-29-error-contract-and-lifecycle.md (DatabaseError removed)`; the same in the index of `docs/adr/README.md`.
- `docs/backlog.md`: the two items of *Why* removed; *Default exports in `src/`* names `MongoDatabase` alone; *The `I` prefix of exported types* drops "`IMongoDatabase` goes with the error contract item, which reconsiders it".

## Test cases

In `packages/database-mongo/__tests__/mongo.database.test.ts`. "The not-connected error" is an `Error` whose `name` is `"Error"`, with no own `code`, whose message contains `"connect()"` and the method's name followed by `()`.

Not connected:
1. `getDb()` on a new instance → throws the not-connected error, naming `getDb`.
2. `getClient()` on a new instance → throws the not-connected error, naming `getClient`.
3. `syncSchema([testSchema])` on a new instance → rejects (does not throw synchronously) with the not-connected error naming `syncSchema`; the test's database then has no collection.
4. `dropStaleIndexes([testSchema])` on a new instance → rejects with the not-connected error naming `dropStaleIndexes`.
5. `getDb()` after `connect()` then `disconnect()` → throws the not-connected error.
6. `getDb()` while a `connect()` is in progress (called, not awaited) → throws the not-connected error; the `connect()` then resolves.
7. `connect()` with `dbUri: "not-a-uri"` → rejects with `name` `"MongoParseError"`, not synchronously; `isConnected()` `false`.

The order of the calls:
8. Connected; `const p = db.disconnect(); await db.connect(); await p` → `isConnected()` `true`, a `ping` through `getDb()` succeeds, and a `ping` through the client held before rejects.
9. `const c = db.connect(); const d = db.disconnect(); await c; await d` → `isConnected()` `false`, `getDb()` throws the not-connected error, and a `ping` through the client that `connect()` opened (the instance of the `MongoClient.prototype.connect` spy's first call) rejects.
10. `connect()`, `disconnect()`, `connect()`, called in a row and awaited together → `isConnected()` `true`, `MongoClient.prototype.connect` called twice, and a `ping` through the first client rejects.
11. Two `connect()`s at once on an unreachable server (`mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=200`) → both reject with `MongoServerSelectionError`, and `MongoClient.prototype.connect` is called once.
12. Connected; two `disconnect()`s at once → both resolve, `MongoClient.prototype.close` called once, `isConnected()` `false`.
13. On an unreachable server, `const c = db.connect(); const d = db.disconnect()` → `c` rejects with `MongoServerSelectionError`, `d` resolves, `isConnected()` `false`.

A client closed by hand:
14. Connected; `await db.getClient().close()` → `isConnected()` `false`, `getDb()` throws the not-connected error.
15. Then `await db.connect()` → `getClient()` is a new client, and a `ping` through `getDb()` succeeds.
16. `await db.disconnect()` after a hand close (no `connect()`) → resolves, `MongoClient.prototype.close` not called again by it.

Types:
17. `expectTypeOf<IMongoDatabase["getDb"]>().returns.toEqualTypeOf<Db>()`, and the same for `getClient` and `MongoClient`.

No case for:
- `isConnected()` with the server down: the suite's replica set is shared and cannot be stopped, and a server of its own leaves the package's test rule for a behavior that is the driver's; decision 6 rests on the probe and on decision 5's one listener.
- The identity check of the `topologyClosed` listener: under decision 4 no client is created while another is open or closing, and a second `close()` emits nothing (probes), so no sequence of the public API delivers the event of a client the instance no longer holds. It stays as a guard; the package `CLAUDE.md` says why.

Existing tests that change, all sending a call with no connection or asserting `DatabaseError`:
- the helper `expectNotConnected` (`:73`) and the import of `DatabaseError` (`:9`): the helper asserts the not-connected error and takes the method's name;
- *syncSchema › should reject with NOT_CONNECTED before connect* (`:290`) and *dropStaleIndexes › …* (`:604`): become cases 3 and 4;
- *getDb › should throw DatabaseError when not connected* and *should throw with code NOT_CONNECTED* (`:869`, `:875`): become case 1; the same for *getClient* (`:896`, `:902`): case 2;
- `packages/database/__tests__/database-error.test.ts`: deleted with the class.

The other tests of *connect*, *disconnect* and *isConnected* stay as they are and green.

## Risks

- **A regression of the shared attempt or of the retry** under the new order: the existing *a repeated connect* tests and cases 10–13 show it.
- **A `disconnect()` whose `close()` rejects** leaves the fields as they are today; the queue then goes on with the next call. Not tested: the driver's `close()` does not reject on a reachable or unreachable server in the probes.

## Out of scope

- The `I` prefix of the types, and the default export of `MongoDatabase`: their backlog items.
- `isConnected()` checking the server (a `ping`, the heartbeat events): decision 6 documents that it does not.
- ADR 0013's *Context*, which names `DatabaseError`: an accepted ADR is not edited.

## Plan

1. This spec, commit `[repo] docs: spec the database error contract and lifecycle`; the `critic`'s run.
2. Test-first (`test-author`): cases 1–7 and 17, the existing tests changed as listed. Then decisions 1 and 3 in `@enardo/database-mongo`, with the JSDoc of the methods they touch; the suite and `typecheck` green. Commit `[@enardo/database-mongo] fix: throw a native error when not connected`.
3. Test-first (`test-author`): cases 8–16. Then decisions 4, 5 and 6, with the JSDoc of `connect()`, `disconnect()` and `isConnected()`; the suite green. Commit `[@enardo/database-mongo] fix: order the connect and disconnect calls`.
4. `@enardo/database` 2.0.0: `DatabaseError` and its test removed, the manifest and configs as in *Changes*, `IDatabase`'s JSDoc, the README; build, lint and typecheck of both packages green. Commit `[@enardo/database] feat: keep the IDatabase contract alone` (body: the breaking change).
5. Docs: the README and `CLAUDE.md` of `@enardo/database-mongo`, ADR 0012's status and the ADR index. Commit `[@enardo/database-mongo] docs: document the connection lifecycle`.
6. `pnpm verify`; the backlog changes, commit `[repo] docs: update the backlog after the database error contract`.
