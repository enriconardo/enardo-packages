# 0002. Strict compiler flags and type-aware linting

- Status: accepted
- Date: 2026-09-24
- Spec: docs/specs/2026-09-24-package-tooling.md

## Context

The compiler ran with `strict` only, and ESLint without type information, so whole classes of bugs went unchecked. Enabling type-aware rules on the monorepo found, among ~185 findings, unhandled promise rejections that left web forms stuck while offline, and an HTTP query encoder that could send `[object Object]`. Each candidate compiler flag was measured before choosing: three cost nothing, `verbatimModuleSyntax` needed ~205 autofixable `import type`, `noUncheckedIndexedAccess` 32 manual fixes, `exactOptionalPropertyTypes` ~81 invasive changes.

## Decision

1. **Compiler**: `strict`, `isolatedModules`, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`. Not `exactOptionalPropertyTypes` (cost high, value low here) nor `noPropertyAccessFromIndexSignature` (style).
2. **ESLint**: typescript-eslint `recommendedTypeChecked` + `stylisticTypeChecked`, with `projectService`. Deliberate relaxations, each commented in the preset:
   - `prefer-nullish-coalescing` ignores strings: `value.trim() || undefined` relies on `""` falling through.
   - `require-await` is off: `async` without `await` keeps errors as rejections, which callers of a Promise-returning interface expect.
   - in tests, `no-unsafe-assignment` and `unbound-method` are off: asymmetric matchers are typed `any`, `expect(mock.method)` is unbound by design.
3. **Findings are fixed, not suppressed.** In production code an unchecked index gets a real check (with a domain error when it encodes a broken contract), not `!`; tests may use `!` on an index they just populated. A floating promise is marked `void` only when the called function handles its own errors; otherwise the handling is added.
4. **`lint` depends on `^build`** in turbo, like `typecheck`: type-aware rules read the declarations of upstream packages.
5. **Autofix is not trusted blindly**: `no-unnecessary-type-assertion` removes casts that steer generic inference and breaks the build. After any lint autofix, `typecheck` runs before anything is committed; inference-steering casts become explicit type arguments.

## Consequences

- Bugs of the "promise nobody awaits" and "`undefined` read from an index" kinds are caught at lint/compile time.
- A full uncached lint goes from about 18 s to 61 s; `pnpm verify` lints only affected packages, with turbo's cache.
- Code carries a little more ceremony: `void` on fire-and-forget calls, explicit type arguments where inference is weak, `import type`.
- Relaxing a rule is a preset change with a reason, visible in review, not a scattered `eslint-disable`.

## Alternatives considered

- **Type-aware lint in tests excluded entirely**: would hide real issues in test helpers; only the two rules that clash with vitest idioms are off.
- **`require-await` on, fixing by dropping `async`**: changes error semantics from rejection to synchronous throw at every call site.
- **`exactOptionalPropertyTypes` now**: deferred; can be revisited with a temporary-override rollout (ADR 0001).
