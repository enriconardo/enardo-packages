# @enardo/cqrs

Minimal CQRS primitives: `Command`, `Query` and their handlers. A handler lists
the failure codes it expects; `execute()` returns those as a failure and
rethrows everything else.

## A command handler

```ts
import {
  Command,
  CommandHandler,
  type CommandHandlerOptions,
  type CommandResponse,
} from "@enardo/cqrs";

const codes = ["EMAIL_TAKEN", "EMAIL_INVALID"] as const;

type RegisterResponse = CommandResponse<{ id: string }, (typeof codes)[number]>;

interface RegisterUserOptions extends CommandHandlerOptions {
  createUnitOfWork: () => UnitOfWork;
}

class RegisterUserHandler extends CommandHandler<
  RegisterUserCommand,
  RegisterResponse,
  RegisterUserOptions
> {
  protected readonly expectedCodes = codes;

  protected async handle(command: RegisterUserCommand) {
    return this.options.createUnitOfWork().execute(async () => {
      // throws an error with code "EMAIL_TAKEN": the unit of work rolls back
      return { id: await register(command) };
    });
  }
}
```

A handler with no expected failure writes `expectedCodes = []`, with a
`CommandResponse<Payload>` (its code type defaults to `never`).

`handle()` returns the payload and throws its failures, so a unit of work rolls
back and a conflict at commit is covered. Queries work the same way
(`QueryHandler`, `QueryResponse`, `QueryFailureCode`).

## Rules

- Only an error that `isBaseErrorLike` (`@enardo/errors`) recognizes, with a
  code in `expectedCodes`, becomes `{ success: false, error: code }`. The
  failure carries the code only: no `details`, no exception.
- Any other error is rethrown as it is: a code missing from the list, a native
  error, a non-error, an error without the brand (such as one built on
  `@enardo/errors` 1.0.0, or a native error with a `code`).
- The list is typed by the codes of the response type (`CommandFailureCode<TResponse>`, the union of its failure codes). Declare it `as const`;
  derive the response type from it, as above, so the two cannot drift. A code in
  a hand-written type but missing from the list is rethrown.

## The app's side

```ts
const response = await handler.execute(command);
if (!response.success) {
  switch (response.error) {
    case "EMAIL_TAKEN":
      return conflict();
    case "EMAIL_INVALID":
      return badRequest();
    default: {
      const x: never = response;
      return x;
    }
  }
}
```

What `execute()` rethrows goes to the app's error handling: an allowlist of
codes with everything else an unexpected failure, for an HTTP route and for an
in-process caller such as an event subscriber alike.

## Logger

`options.logger` takes an object with `debug(message, metadata?)` and an
optional `child()`. `execute()` logs at `debug` only; a rethrown error is the
caller's to log.

## Migrating from 1.x

- Every handler declares `expectedCodes` (TS2515 until it does), listing the
  codes its callers handle as failures today. An error whose code is not listed
  now rejects `execute()`, at every caller.
- A subscriber of a synchronous event bus that rejects stops the next
  subscribers and rolls back the publisher's transaction, which 1.x let commit.
- `error` holds only a listed code, never a message or `"INTERNAL_ERROR"`.
  `exception` and `mapErrorToString` are gone.
- `CommandFailureResponse` and `QueryFailureResponse` take the code type as a required parameter (TS2314 without it). `failureResponse` takes a code. A response type lists its codes in its second
  parameter.
- `Logger` has no `error`: an object literal with it is TS2353.
- An error built on `@enardo/errors` 1.0.0 has no brand, and is rethrown.
