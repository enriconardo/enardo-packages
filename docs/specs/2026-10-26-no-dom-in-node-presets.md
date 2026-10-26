---
status: draft
type: fix
tier: M
implementer: sonnet/medium
packages: ["@enardo/typescript-config"]
branch: fix/typescript-config/no-dom-in-node-presets
---

# Leave the DOM libs out of the `library` and `node-app` presets

## Why

`base.json`, `library.json` and `node-app.json` set no `lib`, so TypeScript takes the default of `target: es2022`, which includes the DOM: in a Node app or package, `document.title` compiles and throws a `ReferenceError` at runtime. `fix/http/runtime-neutral-types` removed what kept the presets from being tightened: `@enardo/http-client`'s body type no longer needs the DOM lib. From the backlog, queued; the item comes from the architectural review of `@enardo/http` (2026-09-25).

## Probes

- A file `export const t: string = document.title;` in `packages/logger/src/`, `tsc --noEmit -p tsconfig.json` in the dev container → compiles today; with `--lib ES2022` → `TS2584: Cannot find name 'document'`.
- `tsc --noEmit -p tsconfig.json --lib ES2022` in each of the 20 packages on `library.json`, `src/` and `__tests__/` → 0 errors in 19. `@enardo/http-client` gives 5 (`PromiseRejectionEvent` and DOM globals in `__tests__/support/http-client.ts`), but its `tsconfig.json` already overrides `lib` with `["ES2022", "DOM", "DOM.Iterable"]`, with its comment, so the preset does not reach it.
- No package of the repo extends `node-app.json` (`git grep node-app`): only apps outside the repo do.
- `react-app.json` sets its own `lib` (`es2022`, `dom`, `dom.iterable`) → `packages/typescript-config/react-app.json:7`; `runtime-browser.json` and `runtime-node.json` too.
- The backlog item on `@types/node` says the other Node packages "get the DOM lib by default: see the item on the presets' `lib`" → `docs/backlog.md:38`: stale after this change.

## Decisions

- `lib: ["ES2022"]`, matching `target`, in `library.json` and `node-app.json`. Not in `base.json`: it stays the neutral base of all three presets, and a package that extends it directly keeps the default.
- A new major, `@enardo/typescript-config` 2.0.0: code that uses DOM types on these presets stops compiling. An app gets the fix when it installs 2.0.0.
- `types` stays as it is: `library.json` still includes every installed `@types` package. Another question.

## Open questions

None.

## Changes

- `packages/typescript-config/library.json`, `node-app.json`: `"lib": ["ES2022"]` in `compilerOptions`.
- `packages/typescript-config/README.md`: the two rows of the table say `lib` ES2022, no DOM; a line that a library whose `src/` runs in browsers overrides `lib` with the DOM, as the *Overrides* example shows.
- `packages/typescript-config/package.json`: version 2.0.0.
- `docs/backlog.md`: the item removed; the `@types/node` item no longer says the Node packages get the DOM lib.

## Test cases

The package has no tests; each case is a check run in the dev container, with a scratch file removed afterwards.

1. A file using `document.title` in a package on `library.json` → `TS2584`.
2. A scratch `tsconfig.json` extending `node-app.json`, with the same file → `TS2584`.
3. A scratch `tsconfig.json` extending `react-app.json`, with the same file → compiles.
4. `@enardo/http-client`'s three typechecks (`pnpm --filter @enardo/http-client typecheck`) → green: its override keeps the DOM in `tsconfig.json`.
5. `pnpm verify:all` → green.

## Risks

An app on `node-app.json` or a library on `library.json` that uses a DOM type (a `fetch` typed through `RequestInit`, a `BodyInit`) fails to compile on 2.0.0. That is the point, and the major says it; the error names the `lib` option, and the README shows the override.

## Out of scope

- `types` in the presets.
- Aligning `@types/node` with Node 24 (its own backlog item).
- A permanent check of the presets' `lib`.

## Plan

1. The two presets and the README, with cases 1–5. One commit.
2. The version bump to 2.0.0. One commit.
3. The backlog: the item removed, the `@types/node` item's line fixed. One commit.
