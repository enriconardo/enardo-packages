---
status: done
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
- One client reopened, probed on a bare `MongoClient` against the replica set:
  - `connect()`, `close()`, `connect()`, twice → `withSession` + `withTransaction`, and `startSession` + `startTransaction` + `commitTransaction`, succeed after each reopen; a `Db` taken before the first `close()` inserts after it;
  - a `connect()` that rejects (unreachable), then `connect()` again on the same client → a second server selection, the same `MongoServerSelectionError`;
  - `close()` called during `connect()` on the replica set, at once, after a microtask, after `setImmediate` → the `connect()` rejects with `MongoTopologyClosedError`; after 5 ms → the `connect()` had resolved. Every time the client ends closed (`ping` → `MongoNotConnectedError`), and a `connect()` after it succeeds;
  - a client never connected runs a `ping` (the driver connects it); after a `close()` it does not: `autoConnect` throws `MongoNotConnectedError` on `s.hasBeenClosed` (`lib/operations/execute_operation.js:104`), until a `connect()`.
- The `critic`'s probe (dev container): `close()` 200 ms into a `connect()` on an unreachable host with `serverSelectionTimeoutMS=5000` → `close()` resolves at 210 ms, `connect()` rejects with `MongoTopologyClosedError` at 211 ms. `serverSelectionTimeoutMS` defaults to 30000 (`lib/connection_string.js:902`).
- The `critic`'s second run (dev container, 7.6.0; its probes, not re-run here): `_connect()` awaits before it creates the topology, for `tlsCAFile`, `tlsCRLFile`, `tlsCertificateKeyFile` (`lib/mongo_client.js:216`, `:219`, `:223`) and an SRV lookup (`:230`), and `_close()` returns at once with no topology (`:348`). A `close()` in that window closes nothing: with `mongodb+srv://`, the `connect()` resolves and a `ping` succeeds; with a `tlsCAFile`, it runs to `MongoServerSelectionError`.
- `mongodb` 7.5.0, the peer range's floor, in a throwaway container → the same two `topology.close()` sites (`mongo_client.js:260`, `:359`), the one `TOPOLOGY_CLOSED` emit (`sdam/topology.js:263`), the forwarding (`mongo_client.js:252`) and the `hasBeenClosed` check of `autoConnect`; `_close()` ends the cursors and the sessions before it closes the topology, as 7.6.0 does.
- Projects outside this repo importing `DatabaseError` or reading `code` `NOT_CONNECTED` → none known to the user (2026-10-29); not probed, their repos are elsewhere.
- Clients captured at construction → `MongoTransactionManager` (`packages/transaction-manager-mongo/src/mongo-transaction-manager.ts:29`) and `MongoDataStore` (`packages/uow-repository-mongo/src/mongo-data-store.ts:63`) take a `MongoClient` and keep it: an app passes them `db.getClient()`.
- A contract package with no tests → `@enardo/password-hasher`: scripts on `src` only, no `vitest`, no `test` script, no `@types/node`; its README says why it has no tests.
- The code to change → `MongoDatabase.connect()` `src/mongo.database.ts:84`, `disconnect()` `:110`, `isConnected()` `:123`, `getDb()` `:133`, `getClient()` `:151`; `IMongoDatabase` `src/mongo.database.types.ts:29`; the helper `expectNotConnected` `__tests__/mongo.database.test.ts:73`.

## Decisions

1. **No connection: a native `Error`.** `getDb()` and `getClient()` throw `new Error("MongoDatabase is not connected: await connect() before <method>().")`, `<method>` being the method called (ADR 0012 point 6). `syncSchema()` and `dropStaleIndexes()` reject with the same, naming themselves, before any call to the server. Not taken: a `connect()` inside them, which hides the lifecycle that is the caller's.
2. **`DatabaseError` goes**, from `@enardo/database` with its dependency on `@enardo/errors`: `@enardo/database` 2.0.0 holds `IDatabase` alone, as `@enardo/password-hasher` holds its interface. ADR 0012 gets no new ADR: point 6 already decides the case, so its status records that point 5 is settled by this branch, named by the branch, since a spec's path leaves the tree.
3. **`IMongoDatabase` keeps its name** (without the prefix it would be the class's; the `I` prefix item renames the package's types together), and its methods stay as they are, `IDatabase`'s and the sync's (the user's call). Not taken: declaring `getDb()` and `getClient()` on it, for a fake to stand in where the app calls `getDb()`: no app is known to type on `IMongoDatabase`, and a fake's `getDb()` needs a real `Db` anyway.
4. **One client per instance.** The first `connect()` creates the `MongoClient`; `disconnect()` closes it, and a later `connect()` reopens that same client. `getClient()` returns it across reconnects, and so whatever an app built on it (`MongoTransactionManager`, `MongoDataStore`, a `Db`) works again after `connect()`; between `disconnect()` and the next `connect()` it rejects with `MongoNotConnectedError` (probes). A `new MongoClient` that throws (an unparseable URI) creates nothing, and the next `connect()` tries again. Not taken: a new client per `connect()`, as 2.0.0 does after a `disconnect()` and 1.x on every `connect()`, which leaves what the app built on the old client on a closed one while `isConnected()` is `true`.
5. **The calls run one at a time, in the order made; the last one wins.**
   - Each `connect()` and `disconnect()` waits for the call before it to settle, resolved or rejected, then runs: a `connect()` opens the client when the instance is not connected, a `disconnect()` closes it when it is open. Connected with nothing in line, a `connect()` resolves at once, as today.
   - A call made while the last in line is a call of the same kind shares its promise: two `connect()`s share one attempt, and its rejection, as today; two `disconnect()`s share one `close()`. `disconnect(); connect(); disconnect()` so ends disconnected.
   - A `disconnect()` made during a `connect()` waits for it: on an unreachable server, up to `serverSelectionTimeoutMS`, 30 s by default, which the app sets in the URI. The README says so.
   - Not taken (the user's call, 2026-10-29): closing the client at once, then again once the `connect()` settles, since a `close()` made before the driver creates its topology closes nothing (`mongodb+srv://`, TLS files: probes); a shutdown during startup would then be quick on a plain URI. The queue's merit: the driver never sees a `connect()` and a `close()` overlap on one client. Its cost, the wait, is accepted.
   - Not taken: leaving the reverse case (a `disconnect()` during a `connect()`) out, as the spec of `feature/database-mongo/explicit-schema-sync` did: without it a resolved `disconnect()` can leave the instance connected.
6. **A client closed by hand counts as closed.** `MongoDatabase` listens to `topologyClosed` on its client, attached once when it creates it; the event sets the instance not connected, and the next `connect()` reopens the client. It is the driver's one public signal of a closed client, emitted by `close()` and by a failed `connect()`, never for a server down, in 7.5.0 and 7.6.0 (probes). With one client, an event always concerns the client the instance holds. A hand close counts from its end: the driver emits the event after it has ended the sessions, so a `connect()` made during a hand `close()` not yet awaited resolves on the closing client, and the instance is not connected once the close ends. Not taken: only documenting that a hand close is not the way to close.
7. **`isConnected()` means "from the resolution of `connect()` until the client closes"**, through `disconnect()` or `getClient().close()`. It never checks the server: with the server down it stays `true`, and an operation rejects with the driver's error. `connect()` rejects with the driver's error as it is: `MongoParseError`, `MongoServerSelectionError`, and the others the driver throws.
8. **`IDatabase`'s contract** (JSDoc and README): `connect()` resolves when the database can be used and rejects with an error its implementation documents; `disconnect()` releases the resources, and resolves at once when there is nothing to release; `isConnected()` is `true` between a `connect()` that resolved and the close of the connection, and checks no server. Its JSDoc loses the "initialization tasks". How calls made while another is in progress behave is each implementation's to document.

## Open questions

None.

## Changes

`@enardo/database` → 2.0.0:
- `src/errors/` and `__tests__/` deleted, `DatabaseError` out of `src/index.ts`; `vitest.config.ts` deleted.
- `package.json`: `version` `2.0.0`; `description` "The contract of a database connection's lifecycle."; no `dependencies`; `vitest` and `@types/node` out of `devDependencies`; the scripts on `src` only, without `test` and `test:watch`, as `@enardo/password-hasher`.
- `src/database.types.ts`: the JSDoc of decision 8.
- `README.md`, new, in the form of `@enardo/password-hasher`'s: what the package holds, an example of a caller typed on `IDatabase`, *Contract* (decision 8), *Contributing* (no tests: an interface has no runtime, each implementation checks it with `implements`). It names no implementation.

`@enardo/database-mongo` (2.0.0, unpublished):
- `src/mongo.database.ts`: decisions 1, 4, 5, 6, 7; the import of `DatabaseError` goes; the JSDoc of `connect()` (`@throws` the driver's error; the order of the calls; the client reopened), `disconnect()` (the order), `isConnected()` (decision 7), `getDb()` and `getClient()` (`@throws {Error}` when not connected; the same client and `Db` across reconnects), `syncSchema()` and `dropStaleIndexes()` (`@throws {Error}` when not connected; the rejection "before `connect()`" becomes "when not connected").
- `src/mongo.database.types.ts`: `IMongoDatabase`'s JSDoc drops `DatabaseError` and says "when not connected".
- `README.md`: the paragraph on `connect()` (line 24) becomes a section *The connection*: decisions 4 to 7, that what an app builds on `getClient()` or `getDb()` lasts across reconnects, that a `disconnect()` during a `connect()` waits up to `serverSelectionTimeoutMS`, and that an app that needs a quick shutdown during startup lowers it in the URI, and what "not connected" means (never connected, a `connect()` in progress or rejected, after the close); line 35 names the native `Error`; *Upgrading from 1.x* adds: `getDb()` and `getClient()` throw a native `Error` where they threw `DatabaseError`, and `@enardo/database` `^2.0.0` is the peer.
- `CLAUDE.md`: a section *The connection*, with the rules of decisions 4 to 6 and their reasons: one client, for what the app captures; the order of the calls, and why a `disconnect()` waits for a `connect()` (the driver never sees the two overlap; a `close()` made before the driver creates its topology closes nothing), as a mechanism, without the driver's line numbers; the shared call of the same kind; the `topologyClosed` listener and what emits it (a `close()`, a failed `connect()`), to re-check on a driver upgrade.

Repo:
- `docs/adr/0012-errors-recognized-by-a-brand.md`: status `accepted; point 3's open question settled by 0013; point 5 settled by fix/database/error-contract-and-lifecycle (DatabaseError removed)`; the same in the index of `docs/adr/README.md`.
- `pnpm-lock.yaml`: `@enardo/database`'s importer without `@enardo/errors`, `vitest` and `@types/node`, through `./dev.sh exec pnpm install`.
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
8. Connected; `const p = db.disconnect(); await db.connect(); await p` → `isConnected()` `true`, a `ping` through `getDb()` succeeds, and `getClient()` is the client held before.
9. On the suite's URI, `const c = db.connect(); const d = db.disconnect()` → `c` resolves, then `d` resolves; `isConnected()` `false`, `getDb()` throws the not-connected error, and a `ping` through the client (the instance of the `MongoClient.prototype.connect` spy's first call) rejects.
10. On an unreachable server (`mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=200`), `const c = db.connect(); const d = db.disconnect()` → `c` rejects with `MongoServerSelectionError`, `d` resolves, `isConnected()` `false`.
11. `connect()`, `disconnect()`, `connect()`, called in a row and awaited together → `isConnected()` `true`, a `ping` through `getDb()` succeeds, one client (`getClient()` is the instance of every call of the `MongoClient.prototype.connect` spy).
12. Connected; `disconnect()`, `connect()`, `disconnect()`, called in a row and awaited together → `isConnected()` `false`, `getDb()` throws the not-connected error, and a `ping` through the client rejects.
13. Two `connect()`s at once on an unreachable server (`mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=200`) → both reject with `MongoServerSelectionError`, and `MongoClient.prototype.connect` is called once.
14. Connected; two `disconnect()`s at once → both resolve, `MongoClient.prototype.close` called once, `isConnected()` `false`.

One client:
15. A client and a `Db` held from `getClient()` and `getDb()` before `disconnect()` → after it, a `ping` through the client rejects with `MongoNotConnectedError`; after `connect()`, `getClient()` is the same client, and a `ping` through it and an `insertOne` through the held `Db` succeed.
16. On `"not-a-uri"`, two `connect()`s in a row → both reject with `MongoParseError` (the second tries again: no client was created).

A client closed by hand:
17. Connected; `await db.getClient().close()` → `isConnected()` `false`, `getDb()` throws the not-connected error.
18. Then `await db.connect()` → `isConnected()` `true`, `getClient()` is the same client, and a `ping` through `getDb()` succeeds.
19. `await db.disconnect()` after a hand close (no `connect()`) → resolves, and `MongoClient.prototype.close` is not called by it.

No case for `isConnected()` with the server down: the suite's replica set is shared and cannot be stopped, and a server of its own leaves the package's test rule for a behavior that is the driver's; decision 7 rests on the probe, and on decision 6's one listener, whose emit sites the package `CLAUDE.md` lists for a driver upgrade. Cases 17 and 18 show a driver that stops emitting `topologyClosed` on `close()`.

Existing tests that change, all sending a call with no connection or asserting `DatabaseError`:
- the helper `expectNotConnected` (`:73`) and the import of `DatabaseError` (`:9`): the helper asserts the not-connected error and takes the method's name;
- *syncSchema › should reject with NOT_CONNECTED before connect* (`:290`) and *dropStaleIndexes › …* (`:604`): become cases 3 and 4;
- *getDb › should throw DatabaseError when not connected* and *should throw with code NOT_CONNECTED* (`:869`, `:875`): become case 1; the same for *getClient* (`:896`, `:902`): case 2;
- `packages/database/__tests__/database-error.test.ts`: deleted with the class.

The other tests of *connect*, *disconnect* and *isConnected* stay as they are and green: *should keep one client when called again once connected* still holds (its `ping` through the first client after `disconnect()` rejects), and *should try again after a rejected connect* now retries on the same client (probed).

## Risks

- **A regression of the shared attempt or of the retry** under the new order: the existing *a repeated connect* tests and cases 9–14 and 16 show it.
- **A reopened client** rests on the driver: it reopens a closed client, sessions and transactions included, in 7.6.0 (probes); not probed on 7.5.0 at runtime, only its code paths. Cases 15 and 18 show a driver that stops.
- **A `disconnect()` whose `close()` rejects** leaves the instance as it is; the queue then goes on with the next call. Not tested: the driver's `close()` rejected in no probe.

## Out of scope

- The `I` prefix of the types, and the default export of `MongoDatabase`: their backlog items.
- `isConnected()` checking the server (a `ping`, the heartbeat events): decision 7 documents that it does not.
- ADR 0013's *Context*, which names `DatabaseError`: an accepted ADR is not edited.

## Plan

1. This spec, commit `[repo] docs: spec the database error contract and lifecycle`; the `critic`'s run.
2. Test-first (`test-author`): cases 1–7, the existing tests changed as listed. Then decision 1 in `@enardo/database-mongo`, with the JSDoc of the methods they touch; the suite and `typecheck` green. Commit `[@enardo/database-mongo] fix: throw a native error when not connected`.
3. Test-first (`test-author`): cases 8–19. Then decisions 4 to 7, with the JSDoc of `connect()`, `disconnect()` and `isConnected()`; the suite green. Commit `[@enardo/database-mongo] fix: order the connect and disconnect calls`.
4. `@enardo/database` 2.0.0: `DatabaseError` and its test removed, the manifest and configs as in *Changes*, `IDatabase`'s JSDoc, the README; `./dev.sh exec pnpm install` for the lockfile; build, lint and typecheck of both packages green. Commit `[@enardo/database] feat: keep the IDatabase contract alone` (body: the breaking change).
5. Docs: the README and `CLAUDE.md` of `@enardo/database-mongo`, ADR 0012's status and the ADR index. Commit `[@enardo/database-mongo] docs: document the connection lifecycle`.
6. `pnpm verify`; the backlog changes, commit `[repo] docs: update the backlog after the database error contract`.
