---
status: done
type: feature
tier: L
implementer: sonnet/medium
packages: ["@enardo/env", "@enardo/typescript-config", "@enardo/http-client"]
branch: feature/env/readers-only
---

# `@enardo/env` 2.0: strict readers bound to a source, on both runtimes

## Why

`@enardo/env` exists so that a monorepo's server and Vite client read one root `.env` through one interface: the same readers on `process.env` and on `import.meta.env`. Loading the file is the platform's job: Vite's `envDir`, Node 24's `process.loadEnvFile`. The architectural review of `@enardo/env` (2026-10-22, first *Queued* item of `docs/backlog.md`) found:

- `loadEnv` is a no-op in the browser and broken on Node: without options it loads nothing, it drops the error of a file it cannot read, and with a `target` the file still lands in `process.env`. Its options are dotenv's, so the package's types follow dotenv's.
- The readers fall back to the default on a malformed value (`envNumber` takes `" "` as 0, `"0x10"` as 16), cannot require a variable, assume string values (on `import.meta.env`, `envBool("PROD")` throws a `TypeError`, `envString("DEV")` returns a boolean), and read prototype keys (`toString`).
- `process.env` is the readers' default, which throws a `ReferenceError` in browsers.

The direction and most rules were taken with the user at intake (2026-10-22); the shape of the API and the `isolatedDeclarations` question in the intake discussion that followed. A major.

The spec of `feature/repo/runtime-neutral-presets` left one move to the task of the second package on the runtime presets, this one: `isolatedDeclarations`, an override of `@enardo/http-client`'s `tsconfig.json`. That makes the task L by the tier table: it changes `@enardo/typescript-config` and `@enardo/http-client` too.

## Probes

All in the dev container (Node 24.21.0), unless said otherwise.

- `git grep "@enardo/env"` outside specs → no package of this repo depends on it. Cambusa calls the 1.x readers and `loadEnv` (`packages/config/src/`, `apps/web/src/lib/config.ts`), and its `docs/backlog.md` has no item about env: this backlog item is the only record of Cambusa's side.
- `vite build` (Vite 8.2.2, from the lockfile) of a page logging `import.meta.env`, with a `.env` of `VITE_PORT=3000`, `VITE_EMPTY=`, `SECRET=x` → an object literal `{ BASE_URL: "/", DEV: false, MODE: "production", PROD: true, SSR: false, VITE_EMPTY: "", VITE_PORT: "3000" }`: `DEV`, `PROD`, `SSR` are booleans, the rest strings, `SECRET` is left out, an empty value is kept as `""`, and the object has `Object.prototype` (`Object.hasOwn(e, "toString")` is `false`).
- `vite build` with `define: { "import.meta.env.BUILD_TIME": 1700000000000, "import.meta.env.FLAG": true }` → both land in the `import.meta.env` object, as the number `17e11` and the boolean `true`.
- `process.env` → `Object.hasOwn(process.env, "PATH")` is `true`, `Object.hasOwn(process.env, "toString")` `false` while `"toString" in process.env` is `true`; assigning `3` or `undefined` stores the strings `"3"` and `"undefined"`.
- `Number(s)` and `/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/` on `"3000" "-1.5" "+2" ".5" "5." "1e3" "1E-2" "-0" "007"` → all match, with the expected numbers (`-0` gives `-0`); `"1e999"` matches but gives `Infinity`; `" 1" "0x10" "0b1" "1_000" "Infinity" "NaN" ""` do not match (`Number` takes `" 1"`, `"0x10"`, `"0b1"`, `""` as 1, 16, 1, 0).
- `tsc` with `vite/client` and `@types/node`, a parameter of `Readonly<Record<string, unknown>>` → accepts `import.meta.env` (with an augmented `interface ImportMetaEnv { readonly VITE_API_URL: string }`) and `process.env`; refuses an interface without an index signature (`TS2345`).
- `process.loadEnvFile("p.env")` with `A=file`, `B=file` and `A=shell` in the environment → `A` stays `shell`, `B` becomes `file`; a missing file throws an `Error` with `code: "ENOENT"`.
- `isolatedDeclarations`: a sketch of the API (`createEnv` with inferred return types, two errors over `BaseError`), placed in `packages/http-client/.probe-env/` for its `@enardo/errors`, built with `tsdown src/index.ts --format esm --dts` on `library.json` without the option → the `.d.mts` names only `string`, `number`, `undefined`, `Readonly<Record<string, unknown>>` and `BaseError`; it compiles in a consumer on `runtime-browser.json` and one on `runtime-node.json`, both with `skipLibCheck: false`; the sketch passes both runtime programs.
- The critic's first run, by an in-memory declaration emit on `packages/env/tsconfig.json` → `export const start = () => setTimeout(() => {}, 1)` is emitted as `() => NodeJS.Timeout`, a name of Node's types only, which no runtime program or lint rule reports. `tsc --noEmit --isolatedDeclarations` → 0 errors in `packages/env`; with the option on every package on `library.json`, 6 errors in 5 packages (`errors`, `http-status`, `logger`, `uow-repository`, `email-nodemailer`).
- The critic's third run, a program on the options of `packages/http-client/tsconfig.node.json` with a `src/` file holding that export → no error without `isolatedDeclarations`, TS9007 with it: the runtime program alone catches it.
- `tsdown src/index.ts --format esm --dts` in `packages/http-client`, after `pnpm exec turbo run build --filter=@enardo/http-client... --force`, with a tsconfig that drops `isolatedDeclarations` (so tsdown emits through tsc instead of Oxc) → `index.d.mts` identical to `dist/index.d.mts` once both go through `prettier --parser typescript` (415 lines each, no difference).
- The opt-in to the runtime checks → `packages/http-client/CLAUDE.md`, *Checks*, last paragraphs; its configs: `packages/http-client/{tsconfig.browser.json,tsconfig.node.json,eslint.config.js,vitest.config.ts}`.

## Decisions

Taken with the user:

- **Readers bound to a source the caller always passes**, with no default: `createEnv(source)` returns an `EnvReader`. `source` is an `EnvSource`, `Readonly<Record<string, unknown>>`.
- **Separate methods for a required variable**: `string`, `number`, `bool` return the value or `undefined`; `requireString`, `requireNumber`, `requireBool` return the value or throw. No default parameter and no overloads: the caller writes `env.number("PORT") ?? 3000`. `undefined`, not 1.x's `null`, so that `??` and optional fields take it as it is. Not taken: an options argument (`{ required: true }`, `{ default: 3000 }`), which needs overloads for the return type, and leaves `{ required: true, default: 3 }` to define.
- **A malformed value throws**, in both variants: `EnvMalformedError`, code `ENV_MALFORMED`, `details: { key, expected }`, `expected` being `"string"`, `"number"` or `"boolean"`. **A missing required one throws** `EnvMissingError`, code `ENV_MISSING`, `details: { key }`. Neither holds the value, in its message, `details` or anywhere in its `toJSON()`: it can be a secret. Two sibling classes over `BaseError`, no `cause`.
- **Unset** is a key that is not an own key of the source, or whose value is `undefined` or `""`.
- **Values that are not strings**: `bool` takes a boolean as it is (Vite's `DEV`, `PROD`, `SSR`), and `number` a finite number as it is (Vite's `define` of `import.meta.env.*`, *Probes*); any other value that is not a string is malformed (`NaN`, `Infinity`, `null`, an object; a number for `string` and `bool`, a boolean for `string` and `number`). Taken with the user after the critic's first run; at intake every non-string but a boolean was malformed.
- **Numbers in decimal notation only**: the regex of *Probes* (sign, fraction, exponent) and a finite result; no whitespace, `0x`, `0b`, `0o`, `_`, `Infinity`, `NaN`.
- **Remove** `loadEnv`, `LoadEnvOptions`, `env()`, `EnvValueType`, the 1.x `EnvSource` (`"node" | "vite"`) and dotenv, as if they had never been there (no deprecation, no absence test).
- **Tests in browsers too**, through the presets of `feature/repo/runtime-neutral-presets`; a README with the one-file pattern and the `VITE_` prefix as the boundary of secrets; a package `CLAUDE.md`.
- **`isolatedDeclarations` in the runtime overlays** (`runtime-browser.json`, `runtime-node.json` of `@enardo/typescript-config`): the option is a check that every export's type is written out, so an inferred type cannot name what only one runtime's types declare (`BodyInit` of the DOM, `NodeJS.Timeout` of Node, *Probes*). The runtime programs check `src/` alone, so tests are not held to it. Once the types are written out, the build's emitter writes the same names (*Probes*): `tsconfig.json` no longer needs it. `@enardo/http-client` drops its local override, and `@enardo/env` never adds one. Taken with the user after the critic's runs: the intake's choice of no option, then a local override, then this; the move was the one `feature/repo/runtime-neutral-presets` left to this task.

Taken here, approved by the user at checkpoint 1:

- **The booleans of 1.x stay**: `true`, `1`, `yes` and `false`, `0`, `no`, case-insensitive, with no whitespace.
- **A string is returned as it is**: `string` does not trim `" "`.
- **The reader reads the source at each call**, never a copy: what is assigned to `process.env` after `createEnv` is seen. A read that throws (a getter, a Proxy trap) propagates as it is: the source is the caller's configuration, and no error of the package is being reported at that point.

## Open questions

None.

## Changes

### `@enardo/env`

- **`src/`**: `createEnv`, `EnvReader`, `EnvSource`, and the two errors (in `src/errors/`, as `@enardo/http-client` places its own); `load-env.ts` and the 1.x readers go. Reads use `Object.hasOwn`. JSDoc on every export.
- **`package.json`**: version `2.0.0`; description "Strict readers of environment variables, over `process.env` or `import.meta.env`"; `dotenv` removed, `@enardo/errors: workspace:^` added to `dependencies`, `@enardo/vitest-config: workspace:^` to `devDependencies`; `typecheck` runs `tsconfig.json`, `tsconfig.browser.json`, `tsconfig.node.json`, as `@enardo/http-client` does. The lockfile follows.
- **Configs**: `tsconfig.browser.json` and `tsconfig.node.json` on the runtime presets; `eslint.config.js` on `runtimeNeutral`; `vitest.config.ts` with a `node` project and `browserProject()`. `tsconfig.json` stays on `library.json`, with no override.
- **`__tests__/`**: the 1.x test files go; the new ones mirror `src/`, import from `~/index`, and run in both projects; the cases that need `process.env` go in `*.node.test.ts`.
- **`README.md`** (new): the exports; the rules of *Decisions*; the one-file pattern: on Node, `process.loadEnvFile(<root>/.env)` before reading (the shell's values win, a missing file throws `ENOENT`), in Vite, `envDir` at the root and `createEnv(import.meta.env)`; only `VITE_`-prefixed variables reach the client bundle, so the prefix is the boundary of secrets; a source must have an index signature (`ImportMetaEnv` and `process.env` have one). It describes 2.0 only: the changes from 1.x go in the handover item (*Repo*).
- **`CLAUDE.md`** (new): layout, the strictness rules and the reason for each, the never-the-value rule for errors, the two runtimes and the checks (by reference to the presets' READMEs), the explicit types that the runtime programs require (`isolatedDeclarations`).

### `@enardo/typescript-config`

- **`runtime-browser.json`, `runtime-node.json`**: `"isolatedDeclarations": true`.
- **`README.md`**: the runtime presets' description says they hold `isolatedDeclarations`, and why, in both directions (`BodyInit`, `NodeJS.Timeout`); the sentence at `:57` that asks a package to add it goes. The presets now need a program that sets `declaration` (or `composite`): without it, `tsc` fails with TS5069 (probed by the critic's fourth run); `library.json` sets it, and the README says so.
- **`package.json`**: a minor above the version on the registry (a stricter preset); none if 1.1.0, from `feature/repo/runtime-neutral-presets`, is not published yet.

### `@enardo/http-client`

- **`tsconfig.json`**: `isolatedDeclarations` and its comment go; `lib` stays.
- **`CLAUDE.md`**: *Two runtimes*' "Exported types are written out" says the runtime programs require it, and that the build then emits the same names; the *Checks* table's `isolatedDeclarations` row names the runtime programs; the opt-in paragraph loses the step that adds the option; the layout's `tsconfig.json` line follows.
- No version bump: its `dist/` does not change (*Probes*).

### Repo

- `docs/backlog.md`, in a commit of its own:
  - the item leaves;
  - a *Queued* item enters, **Hand over `@enardo/env` 2.0 to Cambusa**: once 2.0.0 is published, a session of its own adds an item to Cambusa's backlog, on a branch as Cambusa's workflow wants, in the form of its `d7cb78a` (an item of its own, *From:* naming this branch). It lists the changes of behavior from 1.x (`createEnv` and the source passed, `undefined` for `null`, `?? default`, the throws on a malformed value, `loadEnv` replaced by `process.loadEnvFile` and `envDir`), and Cambusa's side of the old item (`import.meta.env` passed to the readers, a check of the public config in `vite.config.ts`). The list is in this repo's diff, so the reviewer checks it against *Decisions*;
  - the item on the runtime checks of `@enardo/errors` and `@enardo/http-status` no longer lists `isolatedDeclarations` as a move left: the runtime overlays bring it. In its place, the cost: opting in, `@enardo/errors` fails it at `src/base/serialize-error.ts:15` (TS9011) and `@enardo/http-status` at `src/reason-phrases.ts:11` and `src/registry.ts:14` (TS9010, two `Object.freeze({...})` exports), whose types are to be written out (`tsc --noEmit --isolatedDeclarations` in each, by the critic's fourth run); "their `src/` passes both runtime typechecks today" becomes true only after that.

## Test cases

`env(src)` stands for `createEnv(src)`. Each error case asserts the class, `code` and `details`.

**Reading**

1. `env({ A: "abc" }).string("A")` → `"abc"`.
2. `string("A")` on `{}`, on `{ A: "" }`, on `{ A: undefined }` → `undefined`, each.
3. `env({ A: " " }).string("A")` → `" "`.
4. `env({}).string("toString")` → `undefined`; `env(Object.create({ A: "x" })).string("A")` → `undefined` (an inherited key is not read).
5. `env(Object.assign(Object.create(null), { A: "x" })).string("A")` → `"x"`.
6. The source is read at each call: `const s = { A: "1" }; const e = env(s); s.A = "2"` → `e.string("A")` is `"2"`.
7. A getter that throws `new RangeError("boom")` on key `A` → `string("A")` throws that same error (identity).

**`string`**

8. `env({ DEV: true }).string("DEV")`, and `{ A: 1 }`, `{ A: null }`, `{ A: {} }` → `EnvMalformedError`, `ENV_MALFORMED`, `{ key, expected: "string" }`.

**`number`**

9. `"3000" "-1.5" "+2" ".5" "5." "1e3" "1E-2" "007" "0"` → `3000 -1.5 2 0.5 5 1000 0.01 7 0`; the values `3`, `-1.5`, `0` → themselves.
10. `" 1" "1 " "0x10" "0b1" "0o7" "1_000" "Infinity" "-Infinity" "NaN" "1e999" "abc" "1.2.3" "e3" "." "+" "1e"`, and the values `NaN`, `Infinity`, `true`, `null`, `{}` → `EnvMalformedError`, `{ key, expected: "number" }`, each.
11. `number` on unset (`{}`, `""`) → `undefined`.

**`bool`**

12. `"true" "TRUE" "1" "yes" "Yes"` → `true`; `"false" "False" "0" "no" "NO"` → `false`.
13. The values `true` and `false` → themselves.
14. `" true" "true " "on" "2" "y"`, and the values `1`, `null` → `EnvMalformedError`, `{ key, expected: "boolean" }`.
15. `bool` on unset → `undefined`.

**Required**

16. `requireString`, `requireNumber`, `requireBool` on `{}` and on `{ A: "" }` → `EnvMissingError`, `ENV_MISSING`, `{ key: "A" }`.
17. Each `require*` on a malformed value (`{ A: 1 }` for `requireString`, `"x"` for the others) → `EnvMalformedError`, not `EnvMissingError`.
18. `requireBool` on `"false"` → `false`, and on `false` → `false`; `requireNumber` on `"0"` → `0`; `requireString` on `" "` → `" "` (a falsy result is not missing).

**Errors**

19. A malformed number holding `"s3cr3t-value"`: neither `message`, `JSON.stringify(error)` nor `details` contains `s3cr3t-value`; `details` equals `{ key, expected }` exactly; `cause` is `undefined`. The same for a malformed boolean and a malformed string (a non-string value whose `String()` is `"s3cr3t-value"`, an object with that `toString`).
20. Both errors are `instanceof BaseError`, with `name` `"EnvMissingError"` and `"EnvMalformedError"`; their messages name the key.

**Types and surface**

21. `expectTypeOf`: `string`, `number`, `bool` return `T | undefined`; `require*` return `T`; `createEnv()` without a source is a type error (`@ts-expect-error`); an interface without an index signature is refused.
22. `index.test.ts`: the runtime exports are exactly `createEnv`, `EnvMalformedError`, `EnvMissingError`.
23. `*.node.test.ts`: `createEnv(process.env)` compiles, and reads a variable set on `process.env` in the test.

## Risks

- **An app that started on defaults now fails at startup** on a malformed value. Intended; Cambusa's handover entry lists each change of behavior.
- **A stricter preset**: a package on the runtime overlays with an inferred export type fails `typecheck`. Today only `@enardo/http-client` and `@enardo/env` are on them, and both pass.
- **A secret in an error**: case 19 checks the serialized form.
- **A check that sees only one runtime**: the tests run in the `browser` project too, and `src/` passes both runtime programs and `runtimeNeutral`.

## Out of scope

- Cambusa's migration.
- Loading a `.env` file, in any form.
- Readers of other shapes (enums, URLs, lists) and schema validation.
- The runtime checks of `@enardo/errors` and `@enardo/http-status` (backlog, *To evaluate*).
- Publishing 2.0.0 (the `publish` skill, a session of its own).

## Plan

1. **`createEnv`, `EnvReader`, `EnvSource` and the two errors**, test-first (cases 1–22), replacing the whole 1.x API and dotenv with their tests in the same commit: the 1.x readers are typed with dotenv's `DotenvPopulateInput`, so neither can go first alone.
2. **`isolatedDeclarations` into the runtime overlays**: `@enardo/typescript-config`'s two presets, README and version; `@enardo/http-client`'s `tsconfig.json` and `CLAUDE.md`. `typecheck` of `@enardo/http-client` stays green, and its `dist/index.d.mts` is unchanged.
3. **The runtime checks of `@enardo/env`**: the two programs, `runtimeNeutral`, the `browser` project, `@enardo/vitest-config`; case 23 in a `*.node.test.ts`.
4. **`README.md`, `CLAUDE.md`, version and description of `@enardo/env`.**
5. **The backlog**: the item leaves; the handover item enters; the item on `@enardo/errors` and `@enardo/http-status` is rewritten.
