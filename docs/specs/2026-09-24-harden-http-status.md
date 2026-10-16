---
status: done
type: fix
packages: ["@enardo/http-status", "@enardo/http", "@enardo/errors", "@cambusa/error-codes", "@cambusa/api-contracts", "@cambusa/api-server", "@cambusa/web"]
branch: fix/http-status/harden-status-registry
---

# Harden `@enardo/http-status`

## Goal

Make `@enardo/http-status` a sound foundation: type guards that never claim more than they check, one source of truth for the registry, a documented contract, and a single import path for its consumers.

## Problem

An architectural review of the package found ten issues, ranked by severity:

1. **Unsound class guards (bug).** `isClientErrorStatus(status): status is ClientErrorHttpStatus` checks only `400 <= status < 500`, but `ClientErrorHttpStatus` is the closed union of *registered* codes. `isClientErrorStatus(499)` is `true`, so `HTTP_STATUS_DEFAULT_MESSAGES[499]` is typed `string` and is `undefined` at runtime; `isSuccessStatus(250.5)` is `true`. The same holds for all five class guards. `normalizeStatusCode` in the api-server error handler already lets 499 through typed as `ClientErrorHttpStatus`.
2. **Three hand-synchronized lists.** `HTTP_STATUS`, the message map and five class arrays repeat the same 63 codes. Only the message map is compiler-checked (`satisfies`); a code missing from a class array silently drops out of its class type. The arrays have no runtime consumer: they exist only to produce the class types.
3. **Tests do not describe the contract.** No boundary cases (99/100 … 599/600), no non-integers, `isInformationalStatus` and `isRedirectionStatus` untested, no type-level tests. One assertion compares the count of *names* in `HTTP_STATUS` with the count of *codes* in the message map, which is redundant with `satisfies` and forbids aliases by accident.
4. **Duplicated, already diverged public surface.** `@enardo/http` re-exports the package "for convenience", minus `HTTP_STATUS_DEFAULT_MESSAGES` and `getHttpStatusDefaultMessage`. The web app imports `HTTP_STATUS` from `@enardo/http`, the server from `@enardo/http-status`.
5. **No JSDoc and no README**, against the monorepo convention for shared packages.
6. **Missing "error status" abstraction.** `http-client.ts`, the api-server error handler and `@cambusa/error-codes` each rebuild "4xx or 5xx"; `sendErrorResponse` uses `Exclude<…, SuccessHttpStatus>`, which counts 1xx and 3xx as error statuses.
7. **Registry content decided implicitly.** 306 (`UNUSED`) and 418 (`IM_A_TEAPOT`) are reserved as "(Unused)" by RFC 9110 §15.4.7 and §15.5.19, yet they are valid `HttpStatus` values. 413 and 422 use the RFC 7231/4918 names, which RFC 9110 renamed "Content Too Large" and "Unprocessable Content". 305 is deprecated (RFC 9110 §15.4.6) with nothing marking it.
8. **Compile-time-only immutability.** `as const` does not exist at runtime: `HTTP_STATUS` and the arrays can be mutated, and the lookup `Set` is built once at load time, so a mutation desynchronizes it.
9. **Ergonomics.** `getHttpStatusDefaultMessage` returns `string | undefined` even for an `HttpStatus`; `isHttpStatus` takes `number`, so it cannot validate untrusted input; naming is inconsistent and "default message" is not the RFC term ("reason phrase").
10. **Repo-wide tooling.** `npm run clean` in 18 `build` scripts, ESLint not type-aware, duplicated tsconfigs without a shared base, unused vitest `globals`, no `sideEffects` field.

## Design

### Two concepts, two families of guards

RFC 9110 §15 defines the *class* of any status code by its first digit, and requires a client to treat an unrecognized code as the x00 of its class. That is a different question from *membership* in the registry of known codes. The package answers both, with different signatures:

| Question | Functions | Input | Result |
| --- | --- | --- | --- |
| Which class is this code in? Works for 499, 599… | `isInformationalStatus`, `isSuccessStatus`, `isRedirectionStatus`, `isClientErrorStatus`, `isServerErrorStatus`, `isErrorStatus` | `number` | `boolean`, no type predicate |
| Is this a registered code of that class? | `isHttpStatus`, `isKnownInformationalStatus`, `isKnownSuccessStatus`, `isKnownRedirectionStatus`, `isKnownClientErrorStatus`, `isKnownServerErrorStatus`, `isKnownErrorStatus` | `unknown` | type predicate on the closed union |

Class guards return `true` only for integers in the class range (`c00`–`c99`; `isErrorStatus`: 400–599). A known guard is `isHttpStatus(value) && <class guard>(value)`. The rule the package enforces: **a type predicate never claims more than its runtime check proves**.

### Single source of truth

`HTTP_STATUS` is the only list of codes. The class types are derived from `HttpStatus` by their first digit:

```ts
type StatusOfClass<C extends 1 | 2 | 3 | 4 | 5, S extends HttpStatus = HttpStatus> =
  S extends unknown ? (`${S}` extends `${C}${string}` ? S : never) : never;
```

The five `HTTP_*_STATUSES` arrays are removed: nothing reads them at runtime. Adding a code means touching `HTTP_STATUS` and the reason-phrase map; the compiler flags a missing phrase, and the class types follow automatically.

### Target public API

```ts
HTTP_STATUS                 // frozen; 61 codes
HTTP_REASON_PHRASES         // frozen; satisfies Readonly<Record<HttpStatus, string>>
getReasonPhrase(status: HttpStatus): string
getReasonPhrase(status: number): string | undefined

type HttpStatus
type InformationalHttpStatus | SuccessHttpStatus | RedirectionHttpStatus
   | ClientErrorHttpStatus | ServerErrorHttpStatus   // derived
type ErrorHttpStatus = ClientErrorHttpStatus | ServerErrorHttpStatus

isHttpStatus(value: unknown): value is HttpStatus
is<Class>Status(status: number): boolean            // + isErrorStatus
isKnown<Class>Status(value: unknown): value is <Class>HttpStatus   // + isKnownErrorStatus
```

Removed: `HTTP_STATUS_DEFAULT_MESSAGES`, `getHttpStatusDefaultMessage`, the five `HTTP_*_STATUSES` arrays, `HTTP_STATUS.UNUSED`, `HTTP_STATUS.IM_A_TEAPOT`, `HTTP_STATUS.PAYLOAD_TOO_LARGE`, `HTTP_STATUS.UNPROCESSABLE_ENTITY`.

### Decisions (to confirm at checkpoint 1)

1. **RFC 9110 is the reference.** Names and phrases follow it: `CONTENT_TOO_LARGE` / "Content Too Large" (413), `UNPROCESSABLE_CONTENT` / "Unprocessable Content" (422). **No deprecated aliases**: the package is private with no external consumers, so an alias would only be debt. The 10 call sites of `HTTP_STATUS.UNPROCESSABLE_ENTITY` are migrated. The wire error code `ERROR_CODES.UNPROCESSABLE_ENTITY` and the class `UnprocessableEntityHttpError` in `@enardo/errors` are **not** renamed: the first is part of the API contract, the second is a separate naming decision for that package.
2. **Reserved codes are not exported**: 306 and 418 are removed. Neither has a consumer.
3. **305 stays**, marked `@deprecated` in JSDoc, so editors strike it through.
4. **The class arrays are removed**, not derived (see *Single source of truth*).
5. **`@enardo/http` stops re-exporting the package**; `@cambusa/web` depends on `@enardo/http-status` directly. The package exists separately so that code that is not an HTTP client can depend on the codes; a second import path muddies its ownership and has already diverged once.
6. **The api-server error handler maps an unregistered error code to 500.** `normalizeStatusCode` switches to `isKnownErrorStatus`, because `sendErrorResponse` needs an `HttpStatus`. An `HttpError` carrying 499 used to be sent as 499; it will be sent as 500. `http-client` keeps classifying by range, as RFC 9110 requires of a client: its behavior does not change.
7. **Issue 10 goes to a separate branch** (`chore/repo/package-tooling`, own spec), after this one is merged. It touches every package, belongs to the `repo` scope, and type-aware linting will surface findings across the whole monorepo: mixing it in here would bury this change in unrelated diffs.

## Scope

### `@enardo/http-status`

1. `src/http-status.ts`: registry per decisions 1–3, frozen with `Object.freeze`; derived class types and `ErrorHttpStatus`; `HTTP_REASON_PHRASES` and `getReasonPhrase` with overloads; the two families of guards. The module may be split by concern (`registry`, `reason-phrases`, `guards`) if it reads better; `index.ts` keeps explicit named exports.
2. JSDoc on every export: the class/membership distinction on the guards, RFC 9110 section references on the non-obvious codes.
3. `__tests__/`: rewritten from the test cases below (the API changes, so the existing tests change with it).
4. `README.md`: purpose, API, the two guard families with an example of when to use which, RFC 9110 naming policy, what is deliberately left out.
5. `CLAUDE.md`: invariants and rules for future work on the package (see *Package CLAUDE.md*).

### Consumers

| Package | Change |
| --- | --- |
| `@enardo/http` | remove the re-export block from `src/index.ts`; `http-client.ts` uses `isErrorStatus` and `HTTP_STATUS.UNPROCESSABLE_CONTENT` |
| `@enardo/errors` | `UnprocessableEntityHttpError` uses `HTTP_STATUS.UNPROCESSABLE_CONTENT` |
| `@cambusa/error-codes` | imports `ErrorHttpStatus` instead of defining it; rename the constant |
| `@cambusa/api-contracts` | rename the constant in `failure-responses.ts` |
| `@cambusa/api-server` | `normalizeStatusCode` uses `isKnownErrorStatus` (decision 6); `sendErrorResponse` uses `Extract<AllowedStatuses, ErrorHttpStatus>` instead of `Exclude<AllowedStatuses, SuccessHttpStatus>`; drop the value import of types (`import type`) in the error handler |
| `@cambusa/web` | add `@enardo/http-status: workspace:*`; import `HTTP_STATUS` from it in `lib/api/http.ts` and `features/shopping/shopping.api.ts` |

## Out of scope

- Issue 10 (decision 7).
- Renaming `UnprocessableEntityHttpError` or any wire error code.
- Adding codes not in the current registry (e.g. 104, still provisional at IANA).
- Parsing status lines or headers.

## Test plan

Test-first: this is a bug fix and the public API of an `@enardo/*` package. The `test-author` subagent writes these tests from this spec before the implementation; they must fail against the current code for the right reason. Type-level cases use vitest `expectTypeOf` and `@ts-expect-error`, enforced by `typecheck` (tests are in the tsconfig `include`).

### Registry

1. `HTTP_STATUS` maps the expected names to codes, including `CONTENT_TOO_LARGE: 413` and `UNPROCESSABLE_CONTENT: 422`.
2. `HTTP_STATUS` has no `UNUSED`, `IM_A_TEAPOT`, `PAYLOAD_TOO_LARGE` or `UNPROCESSABLE_ENTITY` key, and 306 and 418 are not among its values.
3. Every value is an integer in 100–599, and values are unique.
4. `HTTP_STATUS` and `HTTP_REASON_PHRASES` are frozen: assigning a property throws.
5. The keys of `HTTP_REASON_PHRASES` are exactly the values of `HTTP_STATUS`, no more, no less.
6. Phrases follow RFC 9110: 413 → "Content Too Large", 422 → "Unprocessable Content", 200 → "OK", 404 → "Not Found".

### `getReasonPhrase`

7. Returns the phrase of every registered code.
8. Returns `undefined` for 499, 306, 418, 999, 0 and 200.5.

### `isHttpStatus`

9. `true` for every value of `HTTP_STATUS`.
10. `false` for 499, 306, 418, 0, 99, 600, 200.5, `NaN`, `Infinity`, `"200"`, `null`, `undefined`, `{}`.

### Class guards

11. For each class `c` (1–5): `true` at `c00` and `c99`; `false` at `c00 - 1` and `c99 + 1`.
12. `true` for unregistered codes inside the class: 199, 299, 399, 499, 599.
13. `false` for 200.5, `NaN`, `Infinity`, `-Infinity`.
14. `isErrorStatus`: `true` at 400, 499, 500, 599; `false` at 399 and 600.
15. Regression for the bug: `isClientErrorStatus(499)` is `true`, and this does not make 499 a known code (`isKnownClientErrorStatus(499)` is `false`).

### Known guards

16. For each class, `true` for every registered code of that class.
17. `false` for unregistered codes inside the class (199, 299, 399, 499, 599).
18. `false` for registered codes of other classes.
19. `false` for non-numbers (`"404"`, `null`, `undefined`).
20. `isKnownErrorStatus` is `true` exactly for registered 4xx and 5xx codes.
21. Partition: every value of `HTTP_STATUS` satisfies exactly one of the five `isKnown<Class>Status` guards.

### Types

22. `ClientErrorHttpStatus` accepts 404 and rejects 200 and 499 (`@ts-expect-error`); the same shape for each class type.
23. The union of the five class types equals `HttpStatus`; `ErrorHttpStatus` equals `ClientErrorHttpStatus | ServerErrorHttpStatus`.
24. `isKnownClientErrorStatus` narrows an `unknown` to `ClientErrorHttpStatus` (and likewise for each known guard); `isHttpStatus` narrows an `unknown` to `HttpStatus`.
25. Class guards carry no type predicate: after `if (isClientErrorStatus(n))`, `n` is still `number`.
26. `getReasonPhrase(HTTP_STATUS.OK)` is `string`; `getReasonPhrase(n)` with `n: number` is `string | undefined`.

### Consumers

Wiring, tested after the fact: the existing tests of `@enardo/http` and `@enardo/errors` stay green unchanged, and every consumer typechecks. `@cambusa/api-server` has no test suite; decision 6 is covered by `typecheck` plus a manual check that `pnpm cambusa:dev` still starts.

## Plan

Each step ends with `pnpm verify` green and one commit.

1. **Spec** (this file).
2. **Single import path**: `@cambusa/web` depends on `@enardo/http-status` and imports from it; `@enardo/http` drops the re-export. Independent of the API change, green on its own.
3. **Tests**: `test-author` writes the suite above; run it to confirm it fails for the expected reasons (missing exports, 499, 306, frozen objects). Not committed alone, since a red state is never committed.
4. **New API and migration**: implement the package to make step 3 green, migrate every consumer in the same commit (the renames and removals break dependents' typecheck otherwise). One logical change: the new contract and its adoption.
5. **Documentation**: JSDoc review, `README.md`, package `CLAUDE.md`.
6. **Review**: `reviewer` subagent on the full diff against this spec; fix findings.
7. **Checkpoint 2**, then integrate (`status: done`, `--no-ff` merge) and open the spec for issue 10.

## Package CLAUDE.md

Written in step 5, it codifies the invariants of *Design* for future work:

- leaf package: no runtime dependencies and no `@enardo/*` imports (`@enardo/errors` depends on it: an import back is a cycle);
- `HTTP_STATUS` is the single source of truth; class types are derived, never listed;
- class guards vs known guards, and the rule on type predicates;
- `as const` frozen objects, never TS `enum`;
- RFC 9110 names and phrases, reserved codes not exported, deprecated codes marked `@deprecated`;
- required tests when adding a code or a guard (boundaries, type-level narrowing, partition);
- JSDoc and README updated with every public API change; no other package re-exports this one.

## Risks

| Risk | Mitigation |
| --- | --- |
| Removing the re-export breaks a consumer not found by the search | `pnpm verify` typechecks every dependent of `@enardo/http` |
| Behavior change in the error handler (decision 6) | stated here; only affects an `HttpError` carrying an unregistered 4xx/5xx, which cambusa does not produce |
| Template-literal type derivation slows the checker or widens to `number` | 61 members, one level of distribution; test 23 pins the exact unions |
| `Object.freeze` loses literal types | `Object.freeze` returns `Readonly<T>` of an `as const` literal; tests 22–26 would fail at typecheck |

## Implementation notes

Decided during implementation and review, after the spec was approved:

1. **510 is marked `@deprecated` too.** The IANA registry lists it as "Not Extended (OBSOLETED)" (RFC 2774 moved to Historic), so decision 3's rule for deprecated codes applies to it as well as to 305.
2. **RFC 9110 is the source only where it defines the code.** 17 registered codes (102, 103, 207, 208, 226, 423–425, 428, 429, 431, 451, 506–508, 510, 511) come from other RFCs; their names and phrases follow the IANA registry. JSDoc, README and package CLAUDE.md say so.
3. **Test case 1 pins the whole registry**, all 61 names and codes, instead of a sample: with `HTTP_REASON_PHRASES` keyed through `HTTP_STATUS.X`, renaming an unlisted key in both places would otherwise pass every test.
4. **The module is split** into `registry.ts`, `reason-phrases.ts` and `guards.ts`, one test file each, plus `types.test.ts`.
