# 0018. Where a refused value comes from decides between a `BaseError` and a native error

- Status: accepted; its `ENTITY_*` row has no subject since `@enardo/entities` 3.0.0 (ADR 0020)
- Date: 2026-11-05
- Spec: none; from the evaluation of the backlog items on ADR 0012 point 6 (2026-11-05)

## Context

ADR 0012 point 6 gives a `BaseError` to a condition a caller may handle by `code`, and a native error to misuse and misconfiguration, "which a caller fixes in its code". Three items of the backlog asked that question of the errors the review of misuse errors had not judged, and its wording did not settle them:

- An environment variable is a misconfiguration, yet it is not fixed in the caller's code.
- Any error can be caught, so "may handle" alone excludes nothing. `@enardo/entities`' README catches `EntityAlreadyMarkedForRemovalError`, and only logs it.
- `EntityId.create` looks like misuse, and `cambusa` calls it on the parameters of a request, as it does the value objects whose codes it maps to a 422.

The practice draws the same line. t3-env throws a plain `Error` on a bad variable; envalid exits on Node and throws a `TypeError` elsewhere. Node throws `TypeError` and `RangeError` on a bad argument. Khorikov (C#, DDD) returns the failures a caller expects and knows how to deal with, and throws `InvalidOperationException` on a violated precondition.

## Decision

1. **The test of point 6 is where the refused value comes from.** A value that comes from outside the program on each request, message or operation gives a condition the caller may handle: a `BaseError` with a `code`. A value fixed at composition or at deploy, or a state only a bug can reach, gives a native error: the program has to change, or its configuration, and no branch on a `code` helps.
2. **A class can answer differently for each reason.** The test applies to the condition, not the class.
3. **A package that cannot tell where a value comes from treats it as coming from outside.** A value a caller passes on each call may be data, even when one project reads it from its configuration.
4. **A native error carries no `code` by default.** A `code` is public API (ADR 0012 point 4), and none is added before a caller needs it. Adding one later is a minor. Node shows the two are compatible: its `TypeError`s carry `ERR_*` codes.

Applied to the errors the review had left open:

| Error | Where the value comes from | Verdict |
| --- | --- | --- |
| `ENV_MISSING`, `ENV_MALFORMED` | the deploy | native |
| `ENTITY_NOT_MUTABLE`, `ENTITY_ALREADY_MARKED_FOR_REMOVAL` | the same instance in memory: `_isMarkedForRemoval` is never restored, and `isMarkedForRemoval()` lets a caller check first | native |
| `INVALID_ENTITY_ID` | the caller's input | `BaseError` |
| `InvalidEmailMessageError`, `type` | a bug: the compiler refuses it | native |
| `InvalidEmailMessageError`, `missing` | the composition: no `from`, and a sender without a default | native |
| `InvalidEmailMessageError`, `empty` and `address` | each message, `from` included (point 3) | `BaseError` |

## Consequences

- ADR 0012 point 6 stands, with this test for its words. The rule of the root `CLAUDE.md` and of `@enardo/errors`' README still holds.
- The verdicts that change an error are branches of their own, in the backlog, each a new major of its package.
- `InvalidEmailMessageError` keeps `from` in `address`, even where it comes from a variable, as `cambusa`'s does. That refusal stays on each send, as it does today.
- `INVALID_ENTITY_ID` covers a blank id from any source. An app that maps it to a response reports a blank id from its own data as the client's fault. Stored ids that the app generates do not reach it.
- If a project restores `_isMarkedForRemoval` from storage, a second removal can come from a request, and the verdict on `ENTITY_*` is judged again.

## Alternatives considered

- **Keep point 6's wording, and judge each error apart.** The items would each have argued "misconfiguration" and "may handle" again, as the spec of `fix/email-nodemailer/native-misuse-errors` did for `defaultFrom`.
- **A native error for every value that breaks a rule of the type, `INVALID_ENTITY_ID` included.** The blank id would then be misuse only if every app validated it first. `cambusa`'s contract takes `z.string().min(1)`, which lets a space through, and a `code` lets an app map what slips past.
- **Native classes with a `code`, as Node's.** No project reads these codes, and each would be public API to keep.
- **One verdict per class for `InvalidEmailMessageError`, either way.** All native loses a refused recipient, which is data a caller handles. All `BaseError` keeps a `code` on a value the compiler refuses.
