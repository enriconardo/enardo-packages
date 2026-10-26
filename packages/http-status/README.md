# @enardo/http-status

HTTP status codes and pure helpers over them, shared by the `@enardo/*` packages and the projects built on them. The package has no dependencies, so anything can depend on it: HTTP clients, API contracts and servers.

RFC 9110 is the reference for classes, and for names and reason phrases of the codes it defines; the other codes follow the [IANA registry](https://www.iana.org/assignments/http-status-codes/http-status-codes.xhtml).

## Exports

| Export | Meaning |
| --- | --- |
| `HTTP_STATUS` | The registered codes, keyed by reason phrase in SCREAMING_SNAKE_CASE (`HTTP_STATUS.NOT_FOUND` is `404`). Frozen, literal-typed. |
| `HttpStatus` | The closed union of the registered codes. |
| `InformationalHttpStatus`, `SuccessHttpStatus`, `RedirectionHttpStatus`, `ClientErrorHttpStatus`, `ServerErrorHttpStatus` | The registered codes of each class, derived from `HttpStatus` by first digit. |
| `ErrorHttpStatus` | `ClientErrorHttpStatus \| ServerErrorHttpStatus`. |
| `HTTP_REASON_PHRASES` | The reason phrase of every registered code. Frozen. |
| `getReasonPhrase(status)` | The reason phrase: `string` for an `HttpStatus`, `string \| undefined` for any other number. |
| `isHttpStatus(value)` | Whether `value` is a registered code. Narrows `unknown` to `HttpStatus`. |
| `is<Class>Status(status)` | Class guards; see below. |
| `isKnown<Class>Status(value)` | Known guards; see below. |

`<Class>` is one of `Informational`, `Success`, `Redirection`, `ClientError`, `ServerError`, `Error` (4xx and 5xx).

## Class guards and known guards

The package answers two different questions:

| Question | Guards | Input | Result |
| --- | --- | --- | --- |
| Which class is this code in? | `isClientErrorStatus`, … `isErrorStatus` | `number` | `boolean`, for any integer in the class range |
| Is this a registered code of that class? | `isKnownClientErrorStatus`, … `isKnownErrorStatus` | `unknown` | narrows to the class type |

RFC 9110 §15 requires a client to understand the class of any code, even one it does not know, and to treat it as the x00 of its class. That is what class guards are for: `isClientErrorStatus(499)` is `true`. They do not narrow the type, because a range check cannot prove that 499 is a member of `ClientErrorHttpStatus`.

When you need the closed type, to index `HTTP_REASON_PHRASES`, to fill a typed response or to switch exhaustively, use the known guard: `isKnownClientErrorStatus(499)` is `false`.

```ts
import {
  HTTP_REASON_PHRASES,
  HTTP_STATUS,
  isClientErrorStatus,
  isKnownErrorStatus,
} from "@enardo/http-status";

// A client: classify whatever the server sent, 499 included.
if (isClientErrorStatus(res.status)) {
  // The server says the client seems to have erred (RFC 9110 §15.5).
}

// A server: only send codes the response types know about.
const status = isKnownErrorStatus(code) ? code : HTTP_STATUS.INTERNAL_SERVER_ERROR;
HTTP_REASON_PHRASES[status]; // string, guaranteed
```

## Registry policy

- Names and phrases follow RFC 9110 where it defines the code, the IANA registry otherwise: `CONTENT_TOO_LARGE` (413) and `UNPROCESSABLE_CONTENT` (422), not the older "Payload Too Large" and "Unprocessable Entity". There are no aliases.
- Codes RFC 9110 reserves as "(Unused)" are not exported: 306 and 418.
- Deprecated or obsoleted codes stay, marked `@deprecated`: `USE_PROXY` (305), `NOT_EXTENDED` (510).
- Provisional IANA codes (such as 104) are not included.

## Contributing

Run these inside `packages/http-status`:

```sh
pnpm format && pnpm lint && pnpm typecheck && pnpm test
```

The tests check the types with `expectTypeOf` and `@ts-expect-error`, so `pnpm typecheck` is the command that catches a guard that narrows too far. Rules for changing the package are in [CLAUDE.md](./CLAUDE.md).
