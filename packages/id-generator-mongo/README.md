# @enardo/id-generator-mongo

The MongoDB implementation of [`@enardo/id-generator`](../id-generator/README.md)'s `IdGenerator`.

```ts
import { ObjectIdGenerator } from "@enardo/id-generator-mongo";

const idGenerator = new ObjectIdGenerator();

idGenerator.generate(); // "6ad75f3c94ff8490f95a3d85"
```

> Published to the `@enardo` registry. `mongodb` `^7.5.0` and `@enardo/id-generator` `^2.0.0` are peer dependencies: install them beside the package.

## Exports

| Export | Meaning |
| --- | --- |
| `ObjectIdGenerator` | Implements `IdGenerator` |

## Ids

Each id is the hex string of a new `ObjectId`: 24 lowercase hex characters, which `new ObjectId(id)` turns back into that `ObjectId`.

## Contributing

Run these inside `packages/id-generator-mongo`:

```sh
pnpm format && pnpm lint && pnpm typecheck && pnpm test
```
