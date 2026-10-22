# @enardo/env

Strict readers of environment variables, over `process.env` or `import.meta.env`. A monorepo's server and its Vite client read one root `.env` through one interface: the same readers, bound to the source the caller passes.

Loading the `.env` file is the platform's job, not this package's (below).

## Exports

| Export | Meaning |
| --- | --- |
| `createEnv(source)` | Returns an `EnvReader` bound to `source`. |
| `EnvReader` | `string`, `number`, `bool`, `requireString`, `requireNumber`, `requireBool`. |
| `EnvSource` | `Readonly<Record<string, unknown>>`: what `createEnv` takes. |
| `EnvMissingError` | A required variable is unset. Code `ENV_MISSING`, `details: { key }`. |
| `EnvMalformedError` | A variable is not of the type expected. Code `ENV_MALFORMED`, `details: { key, expected }`, `expected` being `"string"`, `"number"` or `"boolean"`. |

Both errors extend `BaseError` of `@enardo/errors`.

## Usage

```ts
import { createEnv } from "@enardo/env";

const env = createEnv(process.env); // or import.meta.env

const port = env.number("PORT") ?? 3000;
const databaseUrl = env.requireString("DATABASE_URL");
const debug = env.bool("DEBUG") ?? false;
```

- `string`, `number` and `bool` return the value, or `undefined` when the variable is unset. There is no default parameter: write `?? default`.
- `requireString`, `requireNumber` and `requireBool` return the value, or throw `EnvMissingError` when the variable is unset.
- A variable that is set but malformed throws `EnvMalformedError`, in both variants: a reader never falls back to a default on a bad value.

## Rules

- **Unset** is a key that is not an own key of the source (inherited keys, such as `toString`, are not read), or whose value is `undefined` or `""`.
- **`string`** returns the value as it is, `" "` included. A value that is not a string is malformed.
- **`number`** takes decimal notation only: an optional sign, digits with an optional fraction, an optional exponent (`3000`, `-1.5`, `.5`, `5.`, `1e3`), and a finite result. No whitespace, `0x`, `0b`, `0o`, `_`, `Infinity` or `NaN`. A finite number is taken as it is (Vite's `define` of `import.meta.env.*` can set one).
- **`bool`** takes `true`, `1`, `yes` and `false`, `0`, `no`, in any case and with no whitespace. A boolean is taken as it is (Vite's `DEV`, `PROD` and `SSR`).
- **The source is read at each call**, never copied: what is assigned to `process.env` after `createEnv` is seen. A read that throws (a getter, a Proxy trap) propagates as it is.
- **An error never holds the value**, in its message, `details` or `toJSON()`: it can be a secret.
- A source needs an index signature. `process.env` and `ImportMetaEnv` have one; an interface without it is refused by the compiler.

## One `.env` for server and client

Keep one `.env` at the monorepo's root.

- **Node**: load it before reading, with `process.loadEnvFile(<root>/.env)`. Values already in the environment win over the file; a missing file throws an `Error` with `code: "ENOENT"`.
- **Vite**: set `envDir` to the root, and read `createEnv(import.meta.env)`.

Vite exposes only the variables prefixed with `VITE_` to the client bundle, so **the prefix is the boundary of secrets**: a variable that must stay on the server is never prefixed.
