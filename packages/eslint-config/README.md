# @enardo/eslint-config

The ESLint flat-config presets every `@enardo/*` package uses, and the projects built on them. The package ships `index.js` as it is and carries the lint plugins, so packages only depend on `eslint` itself.

## Presets

| Preset | For | Globals, files |
| --- | --- | --- |
| `node(rootDir)` | shared packages, project packages, `api-server` | Node globals, `**/*.ts` |
| `react(rootDir)` | `web` | browser globals, `**/*.{ts,tsx}`, JSX |

Both start from `eslint.configs.recommended`, typescript-eslint's `recommendedTypeChecked` and `stylisticTypeChecked`, then `eslint-config-prettier`. Type information comes from `projectService`, so the package's own `tsconfig.json` decides what is linted with which types.

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

## Rule choices

| Rule | Setting | Why |
| --- | --- | --- |
| `consistent-type-imports`, `no-import-type-side-effects` | error | with `verbatimModuleSyntax`, only `import type` is erased from the output |
| `prefer-nullish-coalescing` | ignores strings | `value.trim() \|\| undefined` relies on `""` falling through; `??` would keep it |
| `require-await` | off | `async` on a method with nothing to await keeps errors as rejections, which callers of a Promise-returning interface expect |
| `no-unsafe-assignment`, `unbound-method` | off in `__tests__/**` | asymmetric matchers (`expect.any`) are typed `any`, and `expect(mock.method)` passes a method unbound by design |

## Known limit

`no-unnecessary-type-assertion` reports casts that steer generic inference, such as `Aggregate.rehydrate({ … } as Attributes)`. Its autofix removes them and breaks the build. Write explicit type arguments instead (`Aggregate.rehydrate<Attributes, Aggregate>({ … })`), and never apply that autofix without running `typecheck` afterwards.

## Overrides

A package may extend the preset array with its own entries, with a comment saying why. An override needed by two or more packages moves into the preset; when the preset gets stricter, a package may keep the old behavior through a temporary override.

Type-aware rules read the declarations of the packages a package depends on, so turbo's `lint` task depends on `^build`.
