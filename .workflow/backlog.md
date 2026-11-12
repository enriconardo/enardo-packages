# Backlog

Work that is queued or proposed but not started. Each item becomes a branch, opened with `/overload`.

- **Adding items.** An item enters *To evaluate* when the user approves it at a checkpoint, from a review or an analysis. It moves to *Queued* when the user puts it in the queue.
- **Removing items.** A branch removes its own item, in a commit of its own before the merge, so the item leaves this file with the merge: its spec and the git history keep the record. A dropped item moves to *Dropped*, in a line or two.
- **Format.** Every item takes a few lines, and says what, why, and where it comes from; the probes of its work go in its branch's spec. It names its source in full, never as "the same review": the item that named the review may leave the file first. Items refer to each other by branch name, not by number: numbers change as the queue moves.

## Queued

In the order approved.

## To evaluate

- **pnpm 12** (12.15.0 on 2026-10-23), deferred while 11 gets fixes: nothing here needs it yet. Tier L. Found in a throwaway clone:
  - it ignores `npm_config_store_dir`, so the store moves into `node_modules/` and the first install downloads everything again: `pnpm_config_store_dir`, which 11 reads too, goes in `docker/docker-compose.yml` and `docker/README.md`, with the dev container recreated;
  - the lockfile gains a leading `packageManagerDependencies` document (+158 lines), and `audit --json` counts its entries;
  - every fresh container downloads a 58 MB native binary, and each install runs a supply-chain check over the network (about 5 s);
  - `verify:all` and `pack` manifests match 11; turbo's key does not hold the pnpm version, so the checks run with `--force`.
  - From the intake of `chore/repo/upgrade-pnpm-11-28` and its `critic` run (2026-10-23).
- **No test runs a browser's own `fetch`.**
  - Every test of `@enardo/http-client` that runs in a browser stubs `fetchImpl`. What only a real `fetch` does in a browser stays untested there: CORS, a stream body and `duplex`, redirects, its rejections. Node's `fetch` is tested against local servers.
  - A page would need a server it can reach: Vitest's own, or one in the dev container exposed through Playwright's `exposeNetwork`.
  - From the spec of `chore/repo/browser-tests` (2026-10-07).
- **`EPROXY` of `@enardo/email-nodemailer` comes out `retryable: false`, for an outage too.**
  - A proxy that answers `503`, or closes before the tunnel, gives `EPROXY`; so do a `407` and a missing socks module. The status is only in the `message`, so the code cannot tell them apart.
  - `retryable` says that the same send may succeed later, and the rule already counts a wrong host as retryable, since a caller bounds its retries while a transient failure taken for a permanent one loses the message. The same reasoning puts `EPROXY` in `CONNECTION_FAILURES`. Tier M: documented behavior changes.
  - To take up when a project configures a proxy: `cambusa`, the only consumer, does not (2026-11-09).
  - From the second review of `feature/email/send-errors` (2026-10-20), and the analysis of this item on nodemailer 10.1.0 and 10.4.0, source read, not run (2026-11-09).
- **The dev container's firewall accepts any UDP packet from port 53.**
  - `docker/dev/init-firewall.sh` keeps Anthropic's `INPUT -p udp --sport 53 -j ACCEPT` (and `OUTPUT --dport 53`), so a packet from any host that comes from port 53 gets in. Limiting both rules to the resolver of `/etc/resolv.conf`, or the input to established traffic, is tighter. Run H3 of the spec of `chore/repo/dev-container-environment` again after the change.
  - From the final review of `chore/repo/dev-container-environment` (2026-11-11).
- **`verify:all --force` fails about one run in three with packages in parallel.**
  - One run failed on `email-nodemailer`'s idle SMTP check (a connection reached a server no sender may reach), with `Port already in use` and a mongod invariant failure in the Mongo packages in the same log, neither in the two green runs. The cause suspected, port collisions across packages, is not proven.
  - From chunk 2 of `chore/repo/dev-container-environment` (2026-11-11).

- **`packages/events/src/index.ts` imports without the `.js` extension**, while the other files of its `src/` use it. Align it when the file is next touched.
  - From the final review of `feature/events/typed-dispatch` (2026-11-11).

## Dropped

What was decided against, so that it is not proposed again. One or two lines each: the reason, and where the decision lives when it lives elsewhere. The full analysis is in the history (`git log -S '<title>' -- .workflow/backlog.md docs/backlog.md`).

- **`feature/uow-repository/commit-change-set`, change notifications of a commit** (2026-11-10). The unit of work hands over the domain events instead (ADR 0021); created/updated/deleted notifications carry no intent, duplicate the store's change streams and have no consumer.
- **`INVALID_ENTITY_ID` as a native error** (2026-11-05). It stays a `BaseError`: the id comes from a request's parameters, outside the app (ADR 0018).
- **Removing `isBaseErrorLike`** (2026-11-05). The brand is the only namespace of the unprefixed codes (ADR 0012 points 4 and 7); removing it saves little and costs a major of `@enardo/errors`.
- **`fix/errors/proto-key-in-serialize`** (2026-10-02). An own `__proto__` field is only made on purpose; untrusted input belongs in `details`, which keeps the key.
- **A sync `Iterable<Uint8Array>` body on Node** (2026-10-22). Node's `fetch` sends it as a string; `@enardo/http-client`'s README documents it, and excluding it is a major for a case no consumer has.
- **Splitting `@enardo/logger`** (2026-10-22). The app picks a transport, not winston, so one opaque package (root `CLAUDE.md`, *Architecture conventions*); the local `Logger` copies in `cqrs` and `http-client` are on purpose.
- **A check of the codes' uniqueness in `pnpm verify`** (2026-10-23). Set aside until a first collision (ADR 0012, *Alternatives considered*).
- **A manifest and README check in `pnpm verify`** (2026-10-26). A script to maintain for rules a review already checks.
- **An error of another realm in the logger** (2026-10-26). No code meets one, and `Error.isError` is missing from Node 22 and the presets' `ES2022` lib.
- **A path climbing above `@enardo/http-client`'s `baseUrl`** (2026-11-02). The README says so; checking it belongs to the caller's input validation, and an opt-in helper would be a minor if a project needs it.
- **`no-restricted-exports` in the presets** (2026-11-02). It would prevent one rename that review catches, and costs a major of `@enardo/eslint-config`.
- **Patching `BcryptPasswordHasher`'s 72-byte limit** (2026-11-03). Replaced by Argon2id in `@enardo/password-hasher` 3.0.0 (ADR 0016).
- **`@typescript-eslint/naming-convention` against the `I` prefix** (2026-11-05). Review is enough once no type has it, and the rule misses re-exports (ADR 0017).
- **`serializeError` calling a nested cause's `toJSON()`** (2026-11-09). No class overrides `toJSON()`; the READMEs of `@enardo/errors` and `@enardo/logger` state the limit. To reopen at the first class that needs an override.
- **OAuth2 token endpoint outages as `retryable`** (2026-11-09). `EOAUTH2` is nearly always permanent, and the status never reaches the error; no project uses OAuth2.
- **Most failure tests of `@enardo/events` recognize `EventHandlersFailedError` by its class** (2026-11-12). Asserting `isBaseErrorLike` and `code` in each adds nothing: in a test, which shares one copy of the package, `toBeInstanceOf` with the class is reliable (ADR 0012 point 3) and the root `CLAUDE.md` lists the class among what a test asserts; the brand and code are asserted once on the class and once on the bus's rejection.
