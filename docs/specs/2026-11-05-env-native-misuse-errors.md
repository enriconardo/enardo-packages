---
status: draft
type: fix
tier: M
implementer: sonnet/medium
packages: ["@enardo/env"]
branch: fix/env/native-misuse-errors
---

# Report unset and malformed variables with native errors

## Why

From the backlog item *`ENV_MISSING` and `ENV_MALFORMED` of `@enardo/env` become native errors*, which applies the verdict of ADR 0018, and from a discussion with the user at intake, which settled the decisions below.

A variable comes from the deploy: the configuration has to change, and no branch on a `code` helps. Every `code` is public API (ADR 0012 point 4), and these two have no reader. The moment is what counts: `cambusa` is on 1.0.0, so no project has to migrate from 2.x.

## Probes

- `pnpm view @enardo/env versions --registry https://npm.enriconardo.com` (host) → `1.0.0`, `2.0.0`. The manifest's `2.0.0` is published, so this change ships as `3.0.0`.
- The throw sites, every one → `src/create-env.ts:60` (malformed) and `:71` (missing), both inside `createEnv`. The six readers go through them.
- `grep -l '"@enardo/env"'` over `~/Projects/*`, its `packages/*` and `apps/*` manifests → `cambusa/packages/config`, and `en-monorepo/packages/env`, that repo's own copy.
- `grep -r` for the classes and the codes in `~/Projects/cambusa`, without `node_modules` and `dist` → `docs/backlog.md` alone, in the item `chore/cambusa/env-2`. It runs `@enardo/env@1.0.0` (`node_modules/.pnpm`), whose `package.json` range is `^1.0.0`.
- `git grep` for the classes and the codes, outside `packages/env` and `docs/specs` → `docs/adr/0018-where-the-refused-value-comes-from.md:28`, and `docs/backlog.md:14`, this item.
- `git grep` for `errors` in `packages/env`, outside `src/errors` and `__tests__/errors` → `CLAUDE.md:10`, `README.md:17`, `package.json:45`, `src/create-env.ts:1`, `src/index.ts:3`. No config names `@enardo/errors`.
- The messages, after `./dev.sh exec pnpm exec turbo run build --filter=@enardo/env... --filter=@enardo/logger... --force`, on `main`'s code, from `dist/`, with the secret `s3cr3t` as the value → `Environment variable "API_TOKEN" is required but not set`; `Environment variable "API_TOKEN" is not a valid number` (and `string`, `boolean`). None holds the value.
- What the errors expose, same build, through `createLogger("console", { format: "json" })` of `@enardo/logger` → today `code`, `details`, `message`, `name`, `stack`. A `TypeError` or an `Error` with the same message → `message`, `name`, `stack`, the message holding the key and the expected type. So the log loses nothing a reader of it needs. No throw site sets a `cause`.
- Node 24.21.0 → `JSON.stringify(new TypeError("m"))` is `{}`, `Object.keys` of it `[]`. `isBaseErrorLike` of a `TypeError` and of an `Error` → `false`.
- Removing `@enardo/errors` from the manifest, with `src/errors/` and the two throws of *Changes*, in a throwaway clone, in a throwaway container of the dev image, after `pnpm install --no-frozen-lockfile --ignore-scripts` → the lockfile loses four lines, the importer's `dependencies`; `turbo run build --filter=@enardo/env...` passes on one task; `tsc --noEmit` passes on `tsconfig.browser.json` and `tsconfig.node.json`.
- The usage of 2.x against those types, same clone → `import { EnvMissingError }` gives `TS2305`. `(error as { code?: string }).code === "ENV_MISSING"` compiles, and is never true.
- The tests today, `./dev.sh exec pnpm --filter @enardo/env test` → 493 pass, on Node and three browsers. `__tests__/create-env.node.test.ts` names no error class.

## Decisions

Taken with the user at intake.

1. **Unset: a native `Error`.** No value is wrong: one is absent. Nothing here is an argument of the wrong type.
2. **Malformed: a native `TypeError`.** The value is not of the type the reader expects, as with `UNSUPPORTED_IDENTITY` of `@enardo/uow-repository`.
3. **The two classes go**, with their codes, `details` and `src/errors/`. No class is kept over a native base: a class of the package's own would invite the `instanceof` that the rule means to remove the need for, as in the three earlier misuse tasks.
4. **`@enardo/errors` leaves the manifest.** Nothing else in `src/` uses it, and the package then has no dependency.
5. **The messages stay word for word.** They hold the key, and the expected type where one applies, which is what `details` gave; never the value.
6. **No `code` on the native errors** (ADR 0018 point 4). One can be added later in a minor.

Not taken:

- **`Error` for both**, as t3-env: simpler, and `default-from` of `@enardo/email-nodemailer` gives an `Error` on a string that fails a grammar. A `TypeError` says more about a value, and `requireNumber` on a number is the textbook case for it, at no cost.
- **`RangeError` for a malformed value:** every `RangeError` in `packages/*/src` is a numeric bound.
- **An upgrade note in the README:** the READMEs of the earlier tasks have none, and the only consumer learns it from its own backlog (*Out of scope*).

## Open questions

None.

## Changes

`packages/env`:

- `src/create-env.ts`: throws `new TypeError(<the message>)` and `new Error(<the message>)`; the import goes; the JSDoc names the native types.
- `src/env.types.ts`: the JSDoc names the native types.
- `src/index.ts`: the classes' export goes.
- `src/errors/`: removed.
- `package.json`: `version` `3.0.0`; `dependencies` goes. `pnpm-lock.yaml` follows, with `./dev.sh exec pnpm install`.
- `README.md`: the classes' rows and the *Both errors extend…* line go; the *Usage* bullets, and a line under *Exports*, say which native error each case throws and that it has no `code`.
- `CLAUDE.md`: the `src/errors/` row of *Layout* goes; *Errors* says native errors, why (ADR 0018), and that the messages hold the key and the expected type, never the value.
- `__tests__/errors/`: removed. What it checks that still applies moves to `__tests__/create-env.test.ts`, with the cases below. Its helpers `expectMalformed` and `expectMissing` assert the new outcome.
- `__tests__/index.test.ts`: the entry point exports exactly `createEnv`.

`docs/backlog.md`: the item goes, in a commit of its own.

## Test cases

1. Each of `requireString`, `requireNumber` and `requireBool`, on `{}`, `{ A: "" }` and `{ A: undefined }` → an error whose `constructor` is `Error` and whose `name` is `"Error"`, so a `TypeError` for both fails it. Message: `Environment variable "A" is required but not set`.
2. Every input the existing tests call malformed, on the reader they use → an error whose `constructor` is `TypeError`, `name` `"TypeError"`. Message: `Environment variable "A" is not a valid <string | number | boolean>`, with the type of the reader, so a message fixed to one type fails it.
3. `requireString` on `1`, `requireNumber` and `requireBool` on `"x"` → the `TypeError` of case 2, not the `Error` of case 1.
4. An unset and a malformed variable, one read each → the error has no own `code`, `details` or `cause` (`Object.hasOwn`), and `"code" in error` is false, so a subclass carrying a `code`, or a `{ cause: undefined }`, fails it.
5. Each of the six readers on a value holding a secret: the string `s3cr3t-value` for `number` and `bool` and their `require*`, and for `string` and `requireString` an object whose `toString()` returns it → `message`, `stack` and `JSON.stringify(error)` do not hold it. `stack` is new: it holds the message on every engine, and this is what a log prints.
6. A getter of the source that throws a `RangeError` → that very object: the existing test stays, with no change.
7. The entry point → `Object.keys` is exactly `["createEnv"]`, on Node and in browsers.

The other tests of `create-env.test.ts`, on what the readers return, stay unchanged.

## Risks

`low`. An app that matched on `EnvMissingError` or `EnvMalformedError` by import stops compiling; one that compares `code` as a string compiles and no longer matches, which case 4 pins and the major announces. No known project does either.

## Out of scope

- Publishing `3.0.0`: a session of its own, with the user's approval.
- `chore/cambusa/env-2` in `cambusa`'s backlog, which names `^2.0.0` and the classes: updated after the publish, in that repo.
- The other verdicts of ADR 0018: `@enardo/entities` and `@enardo/email`, each a branch of its own.

## Plan

1. **Test-first:** the `test-author` writes cases 1 to 5 and 7 from this spec, failing for the expected reason. Committed with the change of step 2, since a red state is never committed.
2. The throws, the removal of `src/errors/` and `__tests__/errors/`, the export, the JSDoc, the manifest and the lockfile. `./dev.sh exec pnpm --filter @enardo/env test`, `typecheck` and `lint` green.
3. README and `CLAUDE.md`.
4. The backlog item goes, in a commit of its own. `pnpm verify`.
