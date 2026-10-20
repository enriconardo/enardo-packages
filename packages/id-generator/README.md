# @enardo/id-generator

The contract for generating ids. The package holds one interface: implementations live in their own packages, so that code which creates entities doesn't depend on a database library.

## Exports

| Type | Meaning |
| --- | --- |
| `IdGenerator` | Returns a new id with `generate()` |

A caller depends on `IdGenerator` only, and gets an implementation from its composition root:

```ts
import type { IdGenerator } from "@enardo/id-generator";

function createProduct(idGenerator: IdGenerator, name: string) {
  return { id: idGenerator.generate(), name };
}
```

## Contract

- `generate` returns a new id at each call, which no other call returns.
- The id's format is the implementation's. A caller that relies on a format, for instance to store ids as another type, depends on the implementation, not on this contract.

## Contributing

Run these inside `packages/id-generator`:

```sh
pnpm format && pnpm lint && pnpm typecheck
```

The package has no tests: an interface has no runtime, and each implementation checks it with `implements` when it typechecks.
