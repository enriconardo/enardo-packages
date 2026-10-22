# @enardo/env

Strict readers of environment variables, bound to a source the caller passes: `process.env` on Node, `import.meta.env` in Vite. The public contract is in [README.md](./README.md); this file holds the rules for changing the package.

## Layout

```
src/create-env.ts           createEnv: the read of a key and the three conversions
src/env.types.ts            EnvSource, EnvReader
src/errors/                 EnvMissingError, EnvMalformedError
tsconfig.json               editor, build and __tests__ (library.json, no override)
tsconfig.browser.json       src/ alone, as a browser sees it (runtime-browser.json)
tsconfig.node.json          src/ alone, as Node sees it (runtime-node.json)
eslint.config.js            runtimeNeutral of @enardo/eslint-config
vitest.config.ts            the test projects: node (every file), browser (all but *.node.test.ts)
```

## Strictness

- **A malformed value throws, never falls back.** A default hides a typo in the configuration until it costs something. The caller who wants a default writes `?? default` on an unset variable only.
- **Numbers are decimal only**, matched by a regex and checked finite: `Number()` takes `" "` as 0 and `"0x10"` as 16.
- **Non-string values are accepted only where `import.meta.env` produces them**: a boolean for `bool`, a finite number for `number`. Anything else is malformed, so a reader never converts silently.
- **Keys are read with `Object.hasOwn`**: `"toString" in process.env` is true.
- **Unset includes `""`**: a `.env` line `KEY=` means no value.
- **The source is read at each call**, so what is assigned to `process.env` later is seen. A throwing read propagates untouched: it is the caller's configuration.

## Errors

- **An error never holds the value**, not in its message, `details`, `cause` or `toJSON()`: it can be a secret. They take the key and the type expected, nothing else, and have no `cause`. Tests check the serialized form.
- Two siblings over `BaseError`, each with a `code`, as the root `CLAUDE.md` asks.

## Two runtimes

- `src/` runs unchanged in browsers and on Node: no `process`, no `node:*` import. `process.env` appears only as the argument of a test in a `*.node.test.ts`.
- Exported types are written out (`isolatedDeclarations`, held by the two runtime programs): an inferred type could name what only one runtime declares. `tsconfig.json` has no override.
- The checks are those of `@enardo/http-client`, which is the example: see its `CLAUDE.md` (*Checks*) and the READMEs of `@enardo/typescript-config`, `@enardo/eslint-config` and `@enardo/vitest-config`.

## Out of scope

Loading a `.env` file (Vite's `envDir`, Node's `process.loadEnvFile`), other shapes (enums, URLs, lists) and schema validation.
