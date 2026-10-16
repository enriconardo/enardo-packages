---
status: done
type: chore
packages: ["@enardo/email-nodemailer", "@cambusa/api-server", repo]
branch: chore/repo/adapter-drivers
---

# The adapters' drivers: peer dependencies, provided by the app

## Why

An item of *To evaluate* in `docs/backlog.md`, from the spec of `chore/http/package-hygiene`, chosen by the user on 2026-10-13: `nodemailer` is a dependency of `@enardo/email-nodemailer`, while the root `CLAUDE.md` says that "Third-party drivers (`mongodb`, `bcrypt`) are `peerDependencies` of the adapter".

The other adapters follow the rule. `database-mongo`, `id-generator`, `transaction-manager-mongo` and `uow-repository-mongo` list `mongodb` under `peerDependencies`, and `password-hasher` lists `bcrypt` there; each lists its driver under `devDependencies` too, so that it builds and tests on its own (corrected in *The workspace*: so that it builds, tests and runs in the workspace).

For `nodemailer`, the rule matters because the adapter's public types are nodemailer's: `NodemailerEmailSenderOptions` takes `transport?: SMTPTransport.Options` and `transporter?: Transporter`, and `dist/index.d.mts` imports both from `nodemailer`. An app that passes its own `Transporter` creates it with its own nodemailer. With a regular dependency, the app and the adapter each choose a version, and two copies are installed when the two choices differ. With a peer dependency, the app chooses, and there is one copy.

**The user's model, at checkpoint 1 (2026-10-13)**: a shared package is developed and tested as if it lived in a repository of its own, so its manifest must be right for a consumer that installs it from a registry. The adapter lists its driver under `devDependencies` and `peerDependencies`; the app that uses it lists the driver in its own `dependencies`.

The api-server lists none of the drivers. It uses `email-nodemailer`, `password-hasher`, `database-mongo`, `transaction-manager-mongo` and `id-generator` directly, and `uow-repository-mongo` through the bounded contexts, and lists neither `nodemailer`, `mongodb` nor `bcrypt`. It works in the workspace because each adapter is a link to its source folder, where its own dependencies install the driver.

## Probes

They ran on `master` (`448db8a`), or on a commit of this spec on top of it, which changes docs only, in throwaway containers of the dev image (`en-monorepo-dev`: Node 24.21.0, pnpm 11.1.3), with the repo mounted read-only and the clones in the `en-probe` volume, so the dev container's `node_modules` was never touched:
- **A**: `master` as it is;
- **B**: the adapter only: `nodemailer` moves from its `dependencies` to `peerDependencies` and `devDependencies`, both `^6.10.1`;
- **C**: B, plus `nodemailer: ^6.10.1` in the api-server's `dependencies`;
- **D**: C, plus `mongodb: ^7.6.0` and `bcrypt: ^5.1.1` in the api-server's `dependencies`. This clone ran its install scripts, so `bcrypt` was built; A, B and C ran with `--ignore-scripts`.

Each clone ran `pnpm install`, then `turbo run build --filter=@cambusa/api-server... --force`.

### The workspace

| | A | B | C | D |
| --- | --- | --- | --- | --- |
| The api-server resolves `nodemailer` | no (`MODULE_NOT_FOUND`) | no | yes, to the adapter's copy | yes, to the adapter's copy |
| The api-server resolves `mongodb` and `bcrypt` | no | no | no | yes, to the copies of the adapters and the bounded contexts |
| Imports from the api-server's folder | `email-nodemailer` loads | the same | the same | the five adapters it lists load; `BcryptPasswordHasher` hashes and compares |
| `pnpm peers check` | one unmet peer: `express` for `@ts-rest/express` (the ts-rest item of the backlog) | the same | the same | the same |

- **One copy of each driver.** In D, the api-server, the adapters' `dist/index.mjs` and `@cambusa/catalog` resolve each driver to one real path: `.pnpm/nodemailer@6.10.1`, `.pnpm/mongodb@7.6.0`, `.pnpm/bcrypt@5.1.1`.
- **The built files do not change.** The adapter's `dist/index.mjs` and `dist/index.d.mts`, and the api-server's `dist/main.mjs`, have the same SHA-256 in A, B, C and D, and in a second build of A. `nodemailer` stays external: `dist/index.mjs` starts with `import nodemailer from "nodemailer"`.
- **The lockfile diff of D** touches two importers only. `packages/email-nodemailer` moves `nodemailer` from `dependencies` to `devDependencies`. `projects/cambusa/apps/api-server` gains `bcrypt` (`5.1.1`), `mongodb` (`7.6.0`) and `nodemailer` (`6.10.1`), the versions the lockfile already holds. No package entry is added or removed.
- **`bcrypt` is not built again.** Installing D over an installed C runs no install script: the api-server links the copy that is already built.
- **`^6.10.1` can only resolve to 6.10.1**: the registry's 6.x line ends there (checked on 2026-10-13; `latest` is 10.1.0).
- **pnpm does not report an app that leaves an adapter's driver out.** A, B and C are quiet about the drivers. **Corrected after review**: the reason is not that the adapter's `devDependencies` fill its peer, as first written here. In a workspace install, pnpm checks no peer of a workspace project. On `master`, with the adapter's `nodemailer` declared as a peer only, and no devDependency, `pnpm peers check` lists the `express` peer only:
  - with `autoInstallPeers` on, pnpm installs `nodemailer` into the adapter's own folder anyway, and records it under the importer's `dependencies` in the lockfile;
  - with it off, nothing installs it.

  Probed by the first review, and again before this amendment. The first amendment concluded from it that the devDependency is what lets the adapter build and test without relying on `autoInstallPeers`.

  **Corrected after the second review**: for `email-nodemailer`, the devDependency is not what lets the adapter build. On the branch, with `nodemailer` removed from its `devDependencies` and `autoInstallPeers` off, the adapter's `tsc --noEmit` and `tsdown` pass: its types come from `@types/nodemailer`, and `nodemailer` stays external. But the api-server cannot load it: `import("@enardo/email-nodemailer")` from the api-server's folder fails with `Cannot find package 'nodemailer' imported from …/packages/email-nodemailer/dist/index.mjs`, although the api-server lists `nodemailer` and resolves it itself. A workspace app loads the adapter from its source folder, and the driver resolves from there, not from the app's `dependencies` (the mechanism of *Why*). So the devDependency is what lets the adapter build, test and run in the workspace without relying on `autoInstallPeers`; it also keeps the driver out of the importer's `dependencies`. Probed by the second review, and again before this amendment.
  - A deploy differs (probed by the second review, with pnpm's ndjson reporter): with `autoInstallPeers` off, `pnpm deploy --legacy` does check the peers of the packages it installs. It reports the api-server missing `nodemailer` when the api-server does not list it, and `@cambusa/identity` missing `bcrypt` (through `password-hasher`) on this branch. Both hide behind the general warning that the `express` peer already causes. With `autoInstallPeers` on, neither is reported.

### A production install

The repo has no production install: the api-server runs `node dist/main.mjs` in the workspace. pnpm offers two ways, both probed.

`pnpm deploy` builds a self-contained folder for one workspace project: it copies the project in, and installs its production dependencies there. The workspace packages it uses are installed as packages, not linked, and their peers are resolved from the app's dependencies, as a registry install would resolve them.

| | A | B | C | D |
| --- | --- | --- | --- | --- |
| `pnpm --filter @cambusa/api-server deploy --prod` | refused: `ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE` (pnpm 10+ deploys only with `inject-workspace-packages=true`) | the same | the same | the same |
| `… deploy --legacy --prod`, `autoInstallPeers` on (the default, as in the lockfile) | `email-nodemailer` loads | loads: pnpm installs the missing peer | loads | every adapter is linked to a driver; the same four adapters load as with `autoInstallPeers` off |
| `… deploy --legacy --prod`, `autoInstallPeers` off | `email-nodemailer` loads; `password-hasher` misses `bcrypt` | `email-nodemailer` misses `nodemailer` | `email-nodemailer` loads, with the api-server's copy | every adapter is linked to the api-server's driver (`…_nodemailer@6.10.1`, `…_mongodb@7.6.0`, `…_bcrypt@5.1.1`); `email-nodemailer`, `password-hasher` (it hashes), `transaction-manager-mongo` and `id-generator` load |
| `pnpm install --prod` in the workspace | `email-nodemailer` loads; `database-mongo` misses `mongodb`, `password-hasher` misses `bcrypt` | `email-nodemailer` misses `nodemailer` | the same as B | not probed: the same mechanism as C |

- **What the app's dependencies do**: a deploy links each adapter to the app's driver, without relying on `autoInstallPeers`.
- **What they do not do**: they do not make `pnpm install --prod` in the workspace work. There each adapter is a link to its source folder, resolves its driver from there, and loses it with its `devDependencies`. In the user's model, that install is not a production install: a shared package reaches production as a package, which is what `pnpm deploy` does.
- **A deploy of the api-server does not start today, for another reason.** `database-mongo` fails to load in every deploy: it is deployed without `dist/`. pnpm packs each workspace package with npm's rules, and five packages that the api-server uses have a `.gitignore` of their own that lists `dist/`, and no `files` field: `database`, `database-mongo`, `env`, `errors`, `http-status`. All five are deployed without `dist/` (seen in D). `http-client` has the same `.gitignore`; the api-server does not use it.

## Changes

1. **`packages/email-nodemailer/package.json`**: `nodemailer` leaves `dependencies` for `peerDependencies` (`^6.10.1`), and joins `devDependencies` with the same range. The key order follows `database-mongo`: `dependencies`, `devDependencies`, `peerDependencies`. `@types/nodemailer` stays a devDependency.

   **Corrected after review**: the first version of this spec said "as `@types/bcrypt` does in `password-hasher`". The two differ. `password-hasher`'s declarations reference no `bcrypt` type, while this adapter's `dist/index.d.mts` imports `Transporter` and `SMTPTransport` from `nodemailer`, and nodemailer 6 has no types of its own: they come from `@types/nodemailer`. A consumer that installs the adapter from a registry gets no `@types/nodemailer`.
   - With `skipLibCheck`, the adapter's nodemailer types are `any`, and a typo in the `transport` options compiles.
   - Without `skipLibCheck`, the build fails with TS7016.

   Probed by the review, in a throwaway consumer. The gap is older than this branch: on `master`, `@types/nodemailer` is a devDependency too. In the workspace the types resolve from the adapter's folder. It is left to the upgrade: decision 7.
2. **`projects/cambusa/apps/api-server/package.json`**: `bcrypt: ^5.1.1`, `mongodb: ^7.6.0` and `nodemailer: ^6.10.1` in `dependencies`. `bcrypt` and `nodemailer` take their adapter's range. `mongodb` takes the range of the bounded contexts and of the adapters' `devDependencies`, inside the peers' `^7.5.0`.
3. **`pnpm-lock.yaml`**: from `./dev.sh exec pnpm install`.
4. **Root `CLAUDE.md`**, *Shared packages*: "Third-party drivers (`mongodb`, `bcrypt`) are `peerDependencies` of the adapter" becomes:
   > Third-party drivers (`mongodb`, `bcrypt`, `nodemailer`) are `peerDependencies` of the adapter, and `devDependencies` too, so that it builds and tests on its own. An app lists in its own `dependencies` the driver of every adapter it runs, directly or through other packages: pnpm reports nothing when one is missing.

   **Corrected after review**, with the mechanism above, and with the criterion of decision 4, which the rule did not state:
   > Third-party drivers (`mongodb`, `bcrypt`, `nodemailer`) are `peerDependencies` of the adapter, and `devDependencies` too, so that it builds and tests without relying on `autoInstallPeers`. An app lists in its own `dependencies` the driver of every adapter it runs, directly or through other packages: pnpm reports nothing when one is missing. Any other package lists a driver only when its own code runs it.

   **Corrected after the second review**, with the devDependency's role found in *The workspace*:
   > Third-party drivers (`mongodb`, `bcrypt`, `nodemailer`) are `peerDependencies` of the adapter, and `devDependencies` too, so that it builds, tests and runs in the workspace without relying on `autoInstallPeers`: a workspace app loads the adapter from its source folder, and the driver resolves from there, not from the app's `dependencies`. An app lists in its own `dependencies` the driver of every adapter it runs, directly or through other packages, which the adapter gets once installed as a package (`pnpm deploy`, a registry): pnpm reports nothing when one is missing. Any other package lists a driver only when its own code runs it.

   **Added after review**: the rule covers adapters, whether their contract has a package of its own or shares theirs (`password-hasher`, `id-generator`). `@enardo/env` (`dotenv`) and `@enardo/logger` (`winston`) are not adapters, and keep their library as a regular dependency, which also provides the `dotenv` types that `env`'s declarations import.

`src/` does not change anywhere.

## Decisions (to confirm at checkpoint 1)

1. **The app lists every driver its adapters need.** Chosen by the user on 2026-10-13, for `nodemailer` first, then for every driver. An explicit dependency, rather than `autoInstallPeers`: the manifest names what runs in production, the result does not depend on a package manager's setting, and pnpm says nothing when a driver is missing. `autoInstallPeers` stays at its default (on).
2. **`pnpm install --prod` in the workspace stays out.** It is not a production install in the user's model (*A production install*). The first item of *Found while exploring* records that a production install goes through `pnpm deploy`.
3. **The ranges do not change.** Upgrading `nodemailer` belongs to the architectural assessment of the package (the user, 2026-10-13): the second item of *Found while exploring*.
4. **The project packages do not change.** Each one already lists the drivers its own code runs, and only those:
   - **The six bounded contexts need `mongodb`, and list it** in their `dependencies` (`^7.6.0`). Their repositories and `mongo-filters.ts` create `ObjectId` values at runtime (`new ObjectId(…)`, `ObjectId.isValid(…)`), and hand them to the adapters, which hand them to the driver. In the app's repository, one lockfile gives one copy: in D, `@cambusa/catalog` and the api-server resolve `mongodb` to the same real path. **Corrected after review**: this said that the values must come from the driver's copy of `mongodb`. They need the driver's `bson` major: the driver's `bson` 7 serializes an `ObjectId` of another copy of `bson` 7, and refuses one of `bson` 6 (`BSONVersionError`). `instanceof` does fail across copies, and no `src/` uses it (probed by the review).
   - **`@cambusa/identity` does not need `bcrypt`.** It imports only the `IPasswordHasher` interface, with `import type`, which the compiler erases; no code of it, in `src/` or in its tests, calls `bcrypt`. The api-server's composition root creates `BcryptPasswordHasher` (and `ObjectIdGenerator`), so the api-server is what runs `bcrypt`, and lists it after this branch. The bounded context depends on the port, and the app chooses the adapter, and with it the driver. In D's deploys, the only copy of `password-hasher` is `…_bcrypt@5.1.1`.
5. **No test.** The change is to package manifests: no behavior changes, and no test in the repo reads a manifest. The verification steps repeat the probes on the branch.
6. **Three commits for the change**: the adapter (state B, which is green), the api-server (state D), and the rule in the root `CLAUDE.md`.
7. **Added after review: `@types/nodemailer` is left to the upgrade.** Chosen by the user on 2026-10-13. nodemailer ships declaration files of its own from 10.0.0; 6 to 9 have none.
   - Probed with 10.1.0, TypeScript 5.9.3, `moduleResolution: bundler`, `skipLibCheck: false`, and no `@types/nodemailer`. TypeScript resolves `nodemailer` and `nodemailer/lib/smtp-transport` to them, the adapter's imports compile unchanged, and a typo in the transport options is an error.
   - The upgrade removes `@types/nodemailer`, and the gap with it. An optional peer added now would be removed by it.

## Found while exploring

To add to *To evaluate* in `docs/backlog.md`, in a commit of their own, if approved:

**At checkpoint 2** (2026-10-13), the user queued the second, third and fourth items, in that order, as `chore/email-nodemailer/architectural-assessment`, `refactor/repo/split-contracts-from-adapters` and `chore/cambusa/unused-types-packages`. The first stays in *To evaluate*.

- **A production install of the api-server.**
  - The repo has none: the api-server runs `node dist/main.mjs` in the workspace.
  - `pnpm deploy` installs the shared packages as packages, and links each adapter to the app's driver (probed on 2026-10-13). pnpm 11 refuses its default implementation unless `inject-workspace-packages=true`; `--legacy` works without it.
  - A deploy of the api-server does not start today. Five packages it uses have a `.gitignore` of their own that lists `dist/`, and no `files` field (`database`, `database-mongo`, `env`, `errors`, `http-status`), and pnpm packs them without `dist/`. A `files` field is the usual fix (not probed).
  - `pnpm install --prod` in the workspace is not a production install: it leaves each adapter without its driver, because the adapter is a link to its source folder, where only its `devDependencies` installed the driver.
  - From the spec of `chore/repo/adapter-drivers` (2026-10-13).
- **Architectural assessment of `@enardo/email-nodemailer`.**
  - It starts with upgrading `nodemailer` (the user, 2026-10-13). `npm audit` reports 6.10.1 as high severity, through 15 advisories, among them SMTP command injection (`GHSA-c7w3-x93f-qmm8`), mail to an unintended domain (`GHSA-mm7p-fcc7-pg87`, `GHSA-cc9r-2j5m-2m83`) and denial of service in the address parser (`GHSA-rcmh-qjqh-p98v`, `GHSA-v53p-9fqp-m79j`). The last of them affects versions up to 10.0.5; `latest` is 10.1.0 (checked on 2026-10-13).
  - The upgrade crosses four majors (7 to 10). Their breaking changes are not probed. The range is written three times: the adapter's `peerDependencies` and `devDependencies`, and the api-server's `dependencies`.
  - **Added after review**: the adapter's published types need nodemailer's.
    - 6.x has none: they come from `@types/nodemailer`, a devDependency, so a consumer that installs the adapter from a registry gets `any`, and a typo in the `transport` options compiles (probed by the first review of `chore/repo/adapter-drivers`).
    - 10.x ships its own declaration files. With 10.1.0 and no `@types/nodemailer`, the adapter's imports compile unchanged, and the typo is an error (probed on 2026-10-13).
    - The upgrade drops `@types/nodemailer` from the adapter, and closes the gap.
  - The package has no tests and no README.
  - From the spec of `chore/repo/adapter-drivers` (2026-10-13).
- **`@enardo/password-hasher` and `@enardo/id-generator` each hold a contract and an adapter.**
  - `IPasswordHasher` and `BcryptPasswordHasher` share `password-hasher`, whose peer is `bcrypt`; `IdGenerator` and `ObjectIdGenerator` share `id-generator`, whose peer is `mongodb`.
  - The bounded contexts import only the interfaces, with `import type`, and still depend on packages that require a driver. An app that hashed passwords another way would still have to provide `bcrypt` for `@cambusa/identity`'s `password-hasher`, or let pnpm install it (not probed). **Added after the second review**: a deploy of the api-server with `autoInstallPeers` off already reports `@cambusa/identity` missing `bcrypt`, through `password-hasher`, although identity runs no `bcrypt` code.
  - The ports-and-adapters rule of the root `CLAUDE.md` would split each: a contract package and a `<name>-<technology>` adapter (`password-hasher-bcrypt`, `id-generator-mongo`).
  - The user keeps them together for simplicity, because both are tiny, and asked for the best practice (2026-10-13). The recommendation is to split them, as `email` and `email-nodemailer` are split, although they are as small: the bounded contexts stop depending on a native module (`bcrypt`) for an interface, and contract and adapter can be developed and tested apart, as packages of their own repositories would be. It costs two small packages.
  - Alternatives: an optional peer (`peerDependenciesMeta`), which keeps a technology in a contract package, against the rule; or a port owned by each bounded context, which structural typing allows, without a shared contract.
  - From the spec of `chore/repo/adapter-drivers` (2026-10-13).
- **Unused `@types` packages in the cambusa packages** (renamed after review; first "`@types/bcrypt` in project packages that do not use `bcrypt`").
  - Eight project packages list `@types/bcrypt` under `devDependencies` (`catalog`, `collaboration`, `config`, `culinary`, `identity`, `planning`, `shared`, `shopping`), and none of them imports `bcrypt`. Probably leftovers (the user, 2026-10-13).
  - **Added after review**: the api-server lists `@types/jsonwebtoken` under `devDependencies`, and imports no `jsonwebtoken`.
  - From the spec of `chore/repo/adapter-drivers` (2026-10-13); `@types/jsonwebtoken` from its first review.

## Out of scope

- **`pnpm install --prod` in the workspace**: decision 2.
- **The `dist/` that a deploy leaves out**, and a production install in general: the first item above.
- **Upgrading `nodemailer`**, and with it **`@types/nodemailer`** (decision 7): the second item above.
- **Peer dependencies in the project packages**: decision 4.
- **Splitting `password-hasher` and `id-generator`**, and **the unused `@types` packages**: the third and fourth items above.
- **A check that enforces the rule**: nothing enforces it today, and five adapters follow it by hand.

## Verification

1. **The lockfile diff** is the probe's diff of D: two importers change, and no package entry is added or removed.
2. **The built files**: after `turbo run build --filter=@cambusa/api-server... --force`, the adapter's `dist/index.mjs` and `dist/index.d.mts` and the api-server's `dist/main.mjs` have the same SHA-256 as a build of the spec's commit, run in the dev container before the change.
3. **One copy of each driver**: the api-server and the adapters resolve `nodemailer`, `mongodb` and `bcrypt` to the same real paths; from the api-server's folder, the five adapters it lists load, and `BcryptPasswordHasher` hashes and compares.
4. **`pnpm peers check`** lists the `express` peer only, as on `master`.
5. **`pnpm verify`**: `@enardo/email-nodemailer`, `@cambusa/api-server`, and whatever else turbo selects.
6. **The deploy**: the legacy deploy with `autoInstallPeers` off, re-run on the branch's commit in a throwaway container: every adapter is linked to the api-server's driver, and the four adapters whose `dist/` is deployed load.

## Plan

Each step ends with `pnpm verify` green and one commit.

1. **Spec** (this file).
2. **The adapter**: its `package.json`, the lockfile. Verification 2 (the adapter's files), 5.
3. **The api-server**: its `package.json`, the lockfile. Verification 1 to 6.
4. **The rule** in the root `CLAUDE.md`.
5. **Backlog**: the four items of *Found while exploring*, in a commit of their own.
6. **Review**, checkpoint 2, integration. This item leaves `docs/backlog.md` in a commit of its own, before the merge.
   - **Added after review**: the follow-up of the first review is three commits: this spec, the rule in the root `CLAUDE.md`, and the backlog items. Then a second review.
   - **Added after the second review**: its follow-up is three commits too, on the same three files.
