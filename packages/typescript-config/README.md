# @enardo/typescript-config

The tsconfig presets every `@enardo/*` package extends, and the projects built on them. JSON only: there is nothing to build.

## Presets

| Preset | For | Adds (to `base.json`, except the two `runtime-*` presets, which extend nothing) |
| --- | --- | --- |
| `base.json` | every preset | ES2022, ESM, `moduleResolution: bundler`, `strict`, `isolatedModules`, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch` |
| `library.json` | packages built with tsdown | `lib` ES2022 (no DOM), `~/*` alias, `src` and `__tests__` included, `dist` as output |
| `node-app.json` | Node apps (`api-server`), bundled by tsdown; `tsc` only typechecks | `lib` ES2022 (no DOM), `~/*` alias, `src` and `__tests__` included, no declarations |
| `react-app.json` | Vite apps (`web`) | JSX, DOM libs, `vite/client` types, `~/*` alias |
| `runtime-browser.json` | the browser program of a package whose `src/` runs in browsers and on Node | `lib` ES2022 with the DOM, no types, `src` alone included, `isolatedDeclarations` |
| `runtime-node.json` | the Node program of the same package | `lib` ES2022, the `node` types, `src` alone included, `isolatedDeclarations` |

A library whose `src/` runs in browsers overrides `lib` with the DOM, as the *Overrides* example shows.

The two runtime presets extend nothing: they are laid over a package's own `tsconfig.json`, through an `extends` array, so the package keeps its overrides and its `paths`.

Paths use `${configDir}` (TypeScript 5.5+), which resolves against the `tsconfig.json` that extends the preset, not against this package. A preset can therefore carry `outDir`, `paths` and `include` for every package.

## Usage

```json
{
  "extends": "@enardo/typescript-config/library.json"
}
```

Install it from the `@enardo` registry (`https://npm.enriconardo.com`, which needs a token to read):

```sh
pnpm add -D @enardo/typescript-config
```

## Runtime programs

A package whose `src/` runs in browsers and on Node checks `src/` as each runtime sees it, in two more programs next to its own `tsconfig.json`:

```jsonc
// tsconfig.browser.json
{
  // src/ alone, as a browser sees it: the DOM libs and no Node types.
  "extends": ["./tsconfig.json", "@enardo/typescript-config/runtime-browser.json"]
}
```

`tsconfig.node.json` is the same with `runtime-node.json`. The package's `typecheck` script runs all three:

```json
"typecheck": "tsc --noEmit && tsc --noEmit -p tsconfig.browser.json && tsc --noEmit -p tsconfig.node.json"
```

What they miss, which lint rules on imports and globals cover in part:

- every Node global, from the browser program, after a `/// <reference types="node" />` in `src/`: `@types/node` is installed, so the reference resolves;
- the names `@types/node` declares that Node 24 lacks (`ErrorEvent`, Web Storage), from the Node program.

`runtime-node.json` needs `@types/node` installed in the package: without it, `tsc` fails with TS2688. They check `src/` as written, not the declarations the build emits.

Both hold `isolatedDeclarations`, which requires every exported type to be written out, so that an inferred type cannot name what only one runtime's types declare: `BodyInit` of the DOM, `NodeJS.Timeout` of Node. Neither program reports such a name by itself, and a consumer on the other runtime would see it as `any` under `skipLibCheck`. Once the types are written out, the build emits the same names, so the package's own `tsconfig.json` needs no option. The option needs a program that sets `declaration` (or `composite`), or `tsc` fails with TS5069: `library.json` sets it, so a package whose `tsconfig.json` extends another preset must set it.

## Overrides

The presets are defaults. A package may override an option in its own `tsconfig.json`, with a comment saying why:

```jsonc
{
  "extends": "@enardo/typescript-config/library.json",
  "compilerOptions": {
    // The client runs in browsers too: fetch, Headers and Response come from the DOM libs.
    "lib": ["ES2022", "DOM", "DOM.Iterable"]
  }
}
```

- An override whose value is a list or an object, or that sets several options, moves into a preset when a second package needs it; a scalar is repeated in each package, with its comment, unless it fits every package on a preset.
- When a preset gets stricter, a package may keep the old behavior through a temporary override instead of blocking the change.
- `include` in a package replaces the preset's `include` entirely: list `src/**/*` again when adding files (see `web`).

## Left out, deliberately

- `exactOptionalPropertyTypes`: about 80 errors spread across domain types, where "missing" and "`undefined`" rarely need to differ.
- `noPropertyAccessFromIndexSignature`: style only.

Changing `base.json` re-runs `typecheck` on every package: turbo sees the presets as a dependency.
