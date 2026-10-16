# @enardo/typescript-config

The tsconfig presets every `@enardo/*` package extends, and the projects built on them. JSON only: there is nothing to build.

## Presets

| Preset | For | Adds to `base.json` |
| --- | --- | --- |
| `base.json` | every preset | ES2022, ESM, `moduleResolution: bundler`, `strict`, `isolatedModules`, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch` |
| `library.json` | packages built with tsdown | `~/*` alias, `src` and `__tests__` included, `dist` as output |
| `node-app.json` | Node apps (`api-server`), bundled by tsdown; `tsc` only typechecks | `~/*` alias, `src` and `__tests__` included, no declarations |
| `react-app.json` | Vite apps (`web`) | JSX, DOM libs, `vite/client` types, `~/*` alias |

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

- An override needed by two or more packages moves into a preset.
- When a preset gets stricter, a package may keep the old behavior through a temporary override instead of blocking the change.
- `include` in a package replaces the preset's `include` entirely: list `src/**/*` again when adding files (see `web`).

## Left out, deliberately

- `exactOptionalPropertyTypes`: about 80 errors spread across domain types, where "missing" and "`undefined`" rarely need to differ.
- `noPropertyAccessFromIndexSignature`: style only.

Changing `base.json` re-runs `typecheck` on every package: turbo sees the presets as a dependency.
