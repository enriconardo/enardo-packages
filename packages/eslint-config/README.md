# @enardo/eslint-config

The ESLint flat-config presets every `@enardo/*` package uses, and the projects built on them. The package ships `index.js` as it is and carries the lint plugins, so packages only depend on `eslint` itself.

## Presets

| Preset                    | For                                                | Globals, files                                                                      |
| ------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `node(rootDir)`           | shared packages, project packages, `api-server`    | Node globals, `**/*.ts`                                                             |
| `react(rootDir)`          | `web`                                              | browser globals, `**/*.{ts,tsx}`, JSX                                               |
| `runtimeNeutral(rootDir)` | packages whose `src/` runs in browsers and on Node | `node(rootDir)`, plus the restrictions of _`runtimeNeutral`_ below on `src/**/*.ts` |

All three start from `eslint.configs.recommended`, typescript-eslint's `recommendedTypeChecked` and `stylisticTypeChecked`, then `eslint-config-prettier`. Type information comes from `projectService`, so the package's own `tsconfig.json` decides what is linted with which types.

## Usage

```js
// eslint.config.js
import { node } from "@enardo/eslint-config";

export default node(import.meta.dirname);
```

Install it from the `@enardo` registry (`https://npm.enriconardo.com`, which needs a token to read), with `eslint`, its peer:

```sh
pnpm add -D @enardo/eslint-config eslint
```

## `runtimeNeutral`

`src/` may use only what browsers and Node both have. On `src/**/*.ts` (tests are not restricted):

| Rule                    | Catches                                                                                                                                          | Misses                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `no-restricted-imports` | `undici`, `node:*`, builtin modules                                                                                                              | a dynamic `import()`                                             |
| `no-restricted-globals` | the globals of one runtime, also as `globalThis.<name>`; the globals Node 24 lacks (`ErrorEvent`, `QuotaExceededError`, `Temporal`, Web Storage) | type positions, destructuring (`const { process } = globalThis`) |

The lists of browser-only and Node-only globals are computed from the `globals` package. The keys of `globals.node` that Node 24 does not define are listed by hand (`missingOnNode`): `@types/node` declares some of them, so a Node typecheck passes them. Check that list again when Node, `globals` or `@types/node` change.

A package's own typechecks of `src/` as each runtime sees it catch the rest, and the lint stays for `undici` too: installed, it would bring `@types/node` into the browser program through its types. Each rule's options are set whole: an entry added after the preset replaces them, it does not merge with them.

## Rule choices

| Rule                                                     | Setting                            | Why                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `consistent-type-imports`, `no-import-type-side-effects` | error                              | with `verbatimModuleSyntax`, only `import type` is erased from the output                                                                                                                                                                                                                                                                                                                    |
| `prefer-nullish-coalescing`                              | ignores strings                    | `value.trim() \|\| undefined` relies on `""` falling through; `??` would keep it                                                                                                                                                                                                                                                                                                             |
| `require-await`                                          | off                                | `async` on a method with nothing to await keeps errors as rejections, which callers of a Promise-returning interface expect                                                                                                                                                                                                                                                                  |
| `no-restricted-syntax`                                   | `instanceof BaseError` in `src/**` | an error built by another copy of the package that defines `BaseError` fails it silently; recognize it with `isBaseErrorLike` and its `code`. Matches any class named `BaseError`, whatever it is imported from; misses an aliased import (`import { BaseError as B }`), which is also the way around it; `__tests__/` is not restricted; an entry that sets `no-restricted-syntax` after the preset replaces it |
| `no-unsafe-assignment`, `unbound-method`                 | off in `__tests__/**`              | asymmetric matchers (`expect.any`) are typed `any`, and `expect(mock.method)` passes a method unbound by design                                                                                                                                                                                                                                                                              |

## Known limit

`no-unnecessary-type-assertion` reports casts that steer generic inference, such as `Aggregate.rehydrate({ … } as Attributes)`. Its autofix removes them and breaks the build. Write explicit type arguments instead (`Aggregate.rehydrate<Attributes, Aggregate>({ … })`), and never apply that autofix without running `typecheck` afterwards.

## Overrides

A package may extend the preset array with its own entries, with a comment saying why. Entries that a second package needs move into the preset, unless they set a single scalar option, which is repeated with its comment unless it fits every package on the preset; when the preset gets stricter, a package may keep the old behavior through a temporary override.

Type-aware rules read the declarations of the packages a package depends on, so turbo's `lint` task depends on `^build`.
