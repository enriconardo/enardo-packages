# 0003. A type guard never claims more than its check proves

- Status: accepted
- Date: 2026-09-24
- Spec: `git show c337d77:docs/specs/2026-09-24-harden-http-status.md` (removed from the tree)

## Context

A type guard, `(x: A): x is B`, is a promise the compiler takes on trust: after `if (guard(x))` it treats `x` as `B`, whatever the body actually checked. When the check proves less than `B`, the narrowing is wrong, and the bug shows up at runtime, far from the guard, in code the compiler declared safe.

The case that surfaced it: `@enardo/http-status` offered `isClientErrorStatus(status): status is ClientErrorHttpStatus`, which checked only `400 <= status < 500`, while `ClientErrorHttpStatus` is the closed union of registered codes. `isClientErrorStatus(499)` was `true`, so the compiler believed a reason phrase existed for 499 that was `undefined` at runtime.

The same pattern exists elsewhere: `isIterable(input: unknown): input is HeadersInputIterable` in `@enardo/http` checks only for `Symbol.iterator`, yet narrows to an iterable of header pairs; a `Set<number>` passes.

In shared packages the cost is multiplied: a guard that lies misleads every consumer.

## Decision

1. **In shared packages, a type guard narrows only to what its runtime check proves, relative to its parameter's declared type.** When the check cannot prove the whole target type (for example, the element type of an iterable, which would require consuming it), either narrow to what is proven (`input is Iterable<unknown>`, then validate the elements while iterating), or type the parameter so that the check suffices (if the parameter is a union, a check that tells its members apart is a sound narrowing).
2. **Where one question hides two, write two guards.** `@enardo/http-status` is the first application:
   - class guards (`is<Class>Status(status: number): boolean`) classify any integer in range, as RFC 9110 §15 requires of a client handling unknown codes, and carry no type predicate;
   - known guards (`isKnown<Class>Status(value: unknown): value is <Class>HttpStatus`) are exactly `isHttpStatus(value) && <class guard>(value)`, and are the only ones that narrow to the closed unions.
3. The rule applies to new and changed guards; an existing guard that breaks it (such as `isIterable`) is fixed when its file is next touched, not in a sweep.

## Consequences

- Narrowing can be trusted: code inside `if (guard(x))` is as safe as the compiler says.
- A guard's name and signature say whether it narrows; choosing one is a conscious act.
- Some guards narrow less than before and push validation to where the data is used.

## Alternatives considered

- **A rule for `@enardo/http-status` only**: the problem is not specific to status codes but to every `x is T`.
- **Range guards that narrow to an open type** (`ClientErrorHttpStatus | (number & {})`): keeps one family, but the narrowing becomes meaningless.
- **Range guards that also require membership**: breaks RFC-compliant clients, which must handle unknown codes by class.
- **Fix every existing guard now**: a sweep for a latent issue; fixing on next touch is enough.
