# @enardo/http-status

Registry of HTTP status codes (RFC 9110, IANA) and pure helpers over it. The public contract is in [README.md](./README.md); this file holds the rules for changing the package.

## Layout

```
src/registry.ts        HTTP_STATUS, HttpStatus, the derived class types
src/reason-phrases.ts  HTTP_REASON_PHRASES, getReasonPhrase
src/guards.ts          isHttpStatus, class guards, known guards
__tests__/             one file per module, plus types.test.ts (type-level)
tsconfig.browser.json  src/ alone, as a browser sees it: DOM libs, no Node types (runtime-browser.json)
tsconfig.node.json     src/ alone, as Node sees it: Node types, no DOM libs (runtime-node.json)
eslint.config.js       runtimeNeutral of @enardo/eslint-config
vitest.config.ts       the test projects: node (every file), browser (all but *.node.test.ts, browserProject())
```

## Invariants

- **Leaf package.** No runtime dependencies, no `@enardo/*` imports. `@enardo/http-client` depends on this package, so importing it back creates a cycle.
- **`HTTP_STATUS` is the single source of truth.** Class types are derived from `HttpStatus` by first digit, never listed by hand. No array, set or map may repeat the codes, except `HTTP_REASON_PHRASES`, which the compiler checks against `HttpStatus` in both directions: a missing phrase in `src/` (`satisfies`), a phrase for an unregistered code in `types.test.ts` (exact keys).
- **A type predicate never claims more than its runtime check proves.**
  - Class guards (`is<Class>Status(status: number): boolean`) check an integer range, accept unregistered codes and carry no type predicate.
  - Known guards (`isKnown<Class>Status(value: unknown): value is <Class>HttpStatus`) are exactly `isHttpStatus(value) && <class guard>(value)`. They are the only guards that narrow.
  - A new guard picks one of the two families; it does not mix them.
- **Constants are frozen `as const` objects**, never a TS `enum`. Each export is typed `Readonly<typeof LITERAL>` over a local `as const` literal, with plain keys: `isolatedDeclarations`, in the runtime presets, rejects an inferred export, computed keys (TS9038) and the type of a `satisfies` expression, so `satisfies` goes on the identifier.
- **`src/` runs in browsers and on Node**, and so does every test but `*.node.test.ts` files (none today), as `@enardo/http-client`'s `CLAUDE.md` describes (*Checks*).
- **Nothing else re-exports this package.** Consumers depend on it directly, so the codes have a single import path.

## Registry

- Names are the reason phrase in SCREAMING_SNAKE_CASE, and phrases are copied verbatim: from RFC 9110 where it defines the code, otherwise from the IANA registry. No aliases: when the RFC renames a code, rename it and migrate its call sites.
- Codes RFC 9110 reserves as "(Unused)" are not exported (306, 418). Deprecated or obsoleted codes stay, with `@deprecated` and the source (RFC section or IANA note) in JSDoc: 305, 510.
- Only codes in the IANA registry, not provisional ones.
- Adding a code means changing `HTTP_STATUS` and `HTTP_REASON_PHRASES`, nothing else. If a third place needs changing, the single-source invariant is broken.

## Tests

- Test-first: the tests define the contract of a shared package.
- A class guard is tested at its boundaries (`c00`, `c99`, `c00 - 1`, `c99 + 1`), with an unregistered code inside the class, and with non-integers, `NaN` and `±Infinity`.
- A known guard is tested for every registered code of its class, for unregistered codes inside the class, for codes of other classes and for non-numbers.
- Every guard and type gets type-level tests in `__tests__/types.test.ts`: `.guards` or narrowing checks, and `@ts-expect-error` on values the type must reject. `pnpm typecheck` runs them.
- `registry.test.ts` pins the whole registry, names included, so a rename is a deliberate test change.
- `guards.test.ts` keeps the partition check: every registered code satisfies exactly one known class guard.

## Public API changes

- JSDoc on every export, citing the RFC 9110 section for anything non-obvious.
- Update the README tables and the policy section in the same commit.
- Renaming or removing an export means migrating every consumer in this repo in the same commit, so the branch never goes red. `pnpm verify` covers every dependent here.
- The projects' consumers live in their own repos, which `pnpm verify` does not see: a rename or a removal is a new major version, and each project migrates when it moves to it.
