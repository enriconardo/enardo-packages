---
status: done
type: fix
packages: ["@enardo/http"]
branch: fix/http/runtime-neutral-types
---

# `@enardo/http`: public types that resolve on Node without the DOM lib

## Report

`@enardo/http` is meant for browser apps and Node servers alike. Its public types name `BodyInit`, which exists only in the DOM lib. A Node consumer without the DOM lib gets a body typed `any`, and no error.

Probed on `master` (`eea05be`), with a consumer that imports the built `dist/` and calls `client.post(url, 42)` and `client.request(url, { body: { a: 1 } })`:

| Consumer `lib` / `types` | `skipLibCheck` | Result |
| --- | --- | --- |
| `es2022` / `node` | `true` | `RequestOptions["body"]` is `any`, **both calls compile** |
| `es2022` / `node` | `false` | 5 × TS2304 `Cannot find name 'BodyInit'` in `dist/index.d.mts` |
| `es2022, dom, dom.iterable` / none | `true` | both calls rejected |
| `es2022, dom, dom.iterable` / `node` | `true` | both calls rejected |
| no `lib` (the default) / `node` | `true` | both calls rejected: the default lib of `es2022` includes the DOM |

Every consumer in the monorepo has `skipLibCheck` (it is in `base.json`). No consumer is affected today:
- `@cambusa/web` has the DOM lib;
- a Node package on the `library` or `node-app` preset sets no `lib`, so it gets the default lib, DOM included.

The bug bites a Node consumer that sets `lib` without the DOM. That is what the *To evaluate* item on the presets' `lib` proposes, and why it waits for this branch.

`BodyInit` appears five times in `src/`:
- `RequestOptions.body` (`http-client.types.ts`);
- the `body` parameter of `post`, `put` and `patch` (`http-client.ts`);
- the `body` parameter of the `HttpResponse` constructor (`http-response.ts`).

Nothing reports it: the package's only `typecheck` uses `tsconfig.json`, which has the DOM lib and, with no `types` option, includes `@types/node` from the devDependencies too. It sees both runtimes at once.

## Root cause

`@types/node` 26.4.0 declares `fetch`, `Request`, `RequestInit`, `Response`, `ResponseInit`, `Headers` and `FormData` as globals (`web-globals/fetch.d.ts`), but none of the DOM's type aliases: no `BodyInit`, `HeadersInit` or `RequestInfo` (checked with `grep` over the package). In a declaration file, an unresolved name is an error that `skipLibCheck` hides, and the type becomes `any`.

## Fix

### 1. The body type

The five sites use `NonNullable<RequestInit["body"]>`, through one alias in `http-client.types.ts`:

```ts
export type HttpBody = NonNullable<RequestInit["body"]>;
```

with a comment saying why it is not `BodyInit`. `RequestInit` is a global in both runtimes. The alias is not exported from `src/index.ts`: see *Decisions*.

Probed on a copy of `dist/index.d.mts` with the five `BodyInit` replaced, and the consumer above:

| Consumer `lib` / `types` | `skipLibCheck` | Result |
| --- | --- | --- |
| `es2022` / `node` | `true` | both calls rejected; the body is undici's `BodyInit` (`ArrayBuffer`, `AsyncIterable<Uint8Array>`, `Blob`, `FormData`, `Iterable<Uint8Array>`, the typed arrays, `URLSearchParams`, `string`, …) |
| `es2022` / `node` | `false` | no error in the declarations |
| `es2022, dom, dom.iterable` / none | `true` | both calls rejected; the same union as today |
| `es2022, dom, dom.iterable` / `node` | `true` | the same |

### 2. Typecheck `src/` once per runtime

Two new configs, next to `tsconfig.json`, both extending it with `include: ["src/**/*"]`:

| File | `lib` | `types` |
| --- | --- | --- |
| `tsconfig.browser.json` | `ES2022`, `DOM`, `DOM.Iterable` | `[]` |
| `tsconfig.node.json` | `ES2022` | `["node"]` |

`typecheck` becomes `tsc --noEmit && tsc --noEmit -p tsconfig.browser.json && tsc --noEmit -p tsconfig.node.json`. `tsconfig.json` stays as it is: it is the program of the editor, of the build, and of the typecheck of `__tests__/`.

Probed with both configs on the current `src/`:
- browser: passes. Its program has no file of `@types/node`.
- Node: fails with exactly the five TS2304 on `BodyInit`; passes once they are replaced.

Probed with temporary files in `src/`:
- the Node program reports `window` and `document`;
- the browser program reports `import … from "node:fs"`, `process` and `Buffer`;
- **but an `import … from "undici"` hides all three from the browser program.** undici's types carry `/// <reference types="node" />`, so they pull `@types/node` in. `undici` is in the package's `node_modules` as a peer dependency.

### 3. `isolatedDeclarations`

`tsconfig.json` gets `"isolatedDeclarations": true`, so every exported type is written out in `src/`, and the declarations repeat it.

Why: the two programs check the names written in `src/`, not the declarations the build emits. The build runs on `tsconfig.json`, which has the DOM, and declaration emit writes an inferred type with its DOM name. Probed: a temporary export `function bodyOf(init: RequestInit) { return init.body; }` passes both programs, and the build emits `declare function bodyOf(init: RequestInit): BodyInit | null | undefined`. With `isolatedDeclarations`, `tsc` rejects it with TS9007 (an explicit return type is required).

Probed on the current code: `src/` and `__tests__/` pass with it. The build's `index.mjs` is identical. `index.d.mts` has the same types, and only the indentation of its JSDoc comments changes.

### 4. Lint rules on `src/**`

In the package's `eslint.config.js`, as an override after the `node` preset:

- **`no-restricted-imports`**:
  - `undici` and `undici/*`;
  - `node:*`;
  - every name in `builtinModules` from `node:module`, which covers `path` and `fs/promises`.
- **`no-restricted-globals`**, with `checkGlobalObject: true`. The list is computed from the `globals` package:
  - the keys of `globals.browser` that are not in `globals.node`: 1125 names in `globals` 17.11.0;
  - the keys of `globals.node` that are not in `globals.browser`: `__dirname`, `__filename`, `Buffer`, `clearImmediate`, `exports`, `global`, `module`, `process`, `require`, `setImmediate`;
  - plus `localStorage`, `sessionStorage` and `Storage`. `globals.node` lists them, and `@types/node` declares all three (corrected after review: the first draft said only the first two), but Node 24.21.0 defines none of them (probed with `typeof`). Without this, they would pass the lint and both programs, and fail at runtime on Node.
  - **Added after review**: plus `ErrorEvent`, `QuotaExceededError` and `Temporal`, with Web Storage the whole list of the `globals.node` keys that Node 24.21.0 does not define, apart from the CommonJS module-scope names (probed: `!(name in globalThis)`). The review found that `new ErrorEvent("error")` passes the lint and both programs, as `@types/node` 26.4.0 declares it, and throws a `ReferenceError` on Node 24. Probed with the two programs: the browser program catches `QuotaExceededError` today, as TS 5.9's DOM lib lacks it, while `@types/node` declares it; both programs catch `Temporal`. They join the list so that a TypeScript or `@types/node` upgrade cannot open the same hole. These six names get their own message: Node 24 does not define them.
- Each restriction carries a message that says why: `src/` runs in browsers and on Node.
- `globals` joins the devDependencies as `catalog:`: the config imports it. It is already in the catalog, for `@enardo/eslint-config`.

Probed with these rules on a temporary file in `src/`:
- reported:
  - `import type { Dispatcher } from "undici"`;
  - `export { fetch as undiciFetch } from "undici"`;
  - `import … from "node:fs"`, `"path"` and `"fs/promises"`;
  - `export * from "node:url"`;
  - `window`, `document`, `process` and `Buffer`;
  - `globalThis.process` and `globalThis.document`;
- not reported:
  - a parameter named `status`;
  - `fetch`, `Headers`, `Response`, `URL`, `AbortController`, `setTimeout` and `navigator`;
  - a dynamic `import("node:os")`;
  - a type position (`type T = Document`): the rule skips types by design.

The lint covers the typecheck's blind spot (`undici`) and gives a message in the editor. The typechecks cover the lint's blind spots: types and dynamic imports.

### 5. The package's `CLAUDE.md`

A first `packages/http/CLAUDE.md`, shaped like the ones of `errors` and `http-status`:
- **role**: an HTTP client over the Fetch API, for browser apps and Node servers. `@cambusa/web` is its only consumer today. Server needs are requirements, not extras: timeouts, a `baseUrl` with a path, logs without bodies or query strings. They are queued in `docs/backlog.md`;
- **layout**: the source files, and the three tsconfigs;
- **the two runtimes**:
  - what `src/` may use: what both runtimes have (`fetch`, `Request`, `Response`, `Headers`, `URL`, `AbortController`, streams);
  - public types: no DOM-only alias (`BodyInit`, `HeadersInit`, `RequestInfo`); derive from a global both have, as `RequestInit["body"]`;
  - Node transport settings (dispatcher, proxy) go through `fetchImpl`;
  - wording: "browser/Node" for runtimes, "caller/responder" for the roles in an exchange;
- **checks**: what each of the three programs and the lint rules catches, and what each misses;
- **public API changes**: JSDoc on exports. The package has no README yet; `feature/http/client-errors` writes it.

## Decisions (to confirm at checkpoint 1)

1. **`isolatedDeclarations` is in scope**, though the backlog item does not list it. Without it, the two programs do not prove that the declarations resolve: probed above. It needs no change to the code.
2. **The lint override stays in the package**, not in a preset: only one package needs it, as `CLAUDE.md` asks. That costs `globals` as a devDependency of `@enardo/http`; the `eslint-config` README says packages depend only on `eslint`, but that is about lint plugins. `@enardo/errors` and `@enardo/http-status` are imported by `@cambusa/web` and by the api-server too, and they pass both programs today (probed). Giving them the same checks would move the override into a preset. That goes to *To evaluate*, not here.
3. **The lint also restricts Node-only globals and imports**, not only the DOM-only globals the backlog item names. The browser program catches them, but not after an `undici` import.
4. **`HttpBody` is not exported.** A fix adds no public API. A consumer can name the type as `RequestOptions["body"]`. `feature/http/client-errors` can decide to export it.
5. **No `test-author` run.** The reproduction is a compiler program, not a test file: `tsconfig.node.json` is seen failing on the five `BodyInit` before the fix, as a bug fix requires. No runtime behavior changes, so no vitest test can fail before the fix. The lint rules and `isolatedDeclarations` are checked by mutation (see *Verification*).

## Out of scope

- **The `undici` peer dependency, `isIterable` and the other package hygiene**: `chore/http/package-hygiene`, next in the queue.
- **The presets' `lib`**: the *To evaluate* item, which this branch unblocks.
- **Checking the built `dist/` against each runtime.** `isolatedDeclarations` makes the declarations repeat `src/`, so the two programs cover them.
- **A dynamic `import("undici")`**: neither the lint nor the browser program catches it while `undici` is installed in the package. Not probed: inferred from the dynamic `import("node:os")` the lint skips, and from the static `undici` import the browser program resolves. The next branch removes the peer dependency.

## Verification

1. **The reproduction**: with the two configs and the new `typecheck`, before the type change, `typecheck` fails with exactly five TS2304 `Cannot find name 'BodyInit'`, at the five sites above. After the change it passes.
2. **Mutation checks**, each on a temporary file or edit, removed afterwards and never committed:
   - `isolatedDeclarations`: the temporary `bodyOf` export fails `typecheck` with TS9007;
   - lint: each case of the probe above is reported, or not, as listed. Add `localStorage` to the reported cases, and, after review, `ErrorEvent`, `QuotaExceededError` and `Temporal`;
   - the Node program: `window.location.href` fails it; the browser program: `process.env` fails it.
3. **`pnpm verify`**: `@enardo/http` and `@cambusa/web`, its only dependent.
4. **Manual check**: the consumer probe of the *Report*, against the rebuilt `dist/`. Expected: the results of the table in *Fix § 1*. `dist/index.d.mts` has no `BodyInit`.

## Plan

1. **Spec** (this file).
2. **Fix**, one commit:
   - the two configs and the new `typecheck` script, seen failing (verification 1);
   - the `HttpBody` alias at the five sites, and `typecheck` passes.
3. **`isolatedDeclarations`**, one commit, with its mutation check.
4. **Lint rules** and the `globals` devDependency, one commit, with their mutation check.
5. **`CLAUDE.md`**, one commit. Add the *To evaluate* item of decision 2 to `docs/backlog.md`, in a commit of its own.
6. **Manual check**, review, checkpoint 2, integration. The backlog item leaves `docs/backlog.md` in a commit of its own, before the merge.
