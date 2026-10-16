---
status: done
type: fix
packages: ["@enardo/logger"]
branch: fix/logger/proto-key-in-metadata
---

# A `__proto__` key vanishes from log metadata

## Report

`JSON.parse` turns a `"__proto__"` key into an own property, so a request body or any other parsed input can carry one. Logged as metadata, that field disappears. The review of `fix/logger/winston-metadata-merge` found it.

Probed on `master` (`9df9f69`), logging `JSON.parse('{"__proto__":{"isAdmin":true},"a":1}')` through `createLogger("console", { format, timestamp: false })`:

| Where | `json` | `pretty` |
| --- | --- | --- |
| the call's metadata | `{"a":1,…}` | `{"a":1}` |
| nested, `{ body: <it> }` | `"body":{"a":1}` | the same |
| in an array, `{ items: [<it>] }` | `"items":[{"a":1}]` | the same |
| `defaultMetadata` | `{"a":1,…}` | the same |
| `child({ metadata: <it> })` | `{"a":1,"context":"C",…}` | the same |

In every case the `__proto__` field is gone. `Object.prototype` is not polluted (`({}).isAdmin` stays `undefined`). `JSON.stringify` of the same object keeps the key: `{"__proto__":{"isAdmin":true},"a":1}`.

A `__proto__` key in client input is typically a prototype-pollution attempt. That is exactly what the logs should show.

## Root cause

`convertFields` in `src/serialize/to-loggable.ts` copies each field with `fields[key] = converted`. On a fresh object, assigning to `"__proto__"` goes through `Object.prototype`'s `__proto__` setter. That replaces the prototype of `fields` instead of creating a field. The spread that follows copies only own properties, so the value is lost.

Probed in Node 24, the other two places that copy fields keep an own `__proto__` key:
- the adapter's spread, `{ ...bound, ...fields, level, message }`;
- the format step's `info[key] = …`, whose keys come from `Object.keys`, so the assignment writes an own data property.

## Fix

`convertFields` defines each field as an own, enumerable, writable, configurable data property (`Object.defineProperty`), instead of assigning it. Nothing else changes.

## Test plan

Test-first, because this is a bug fix. The `test-author` subagent writes the tests from this spec, in the foreground, and the regression cases are seen failing before the fix.

Each input is built with `JSON.parse('{"__proto__":{"isAdmin":true},"a":1}')`, the way untrusted input arrives. "Keeps the key" means that `Object.hasOwn(result, "__proto__")` is true, the field's value is `{ isAdmin: true }`, `a` is kept, and the result's prototype is still `Object.prototype`.

In `__tests__/serialize/to-loggable.test.ts`:

1. **Regression**: `toLoggable(<input>)` keeps the key.
2. **Regression**: nested (`{ body: <input> }`) and in an array (`{ items: [<input>] }`), the inner object keeps the key.
3. **Regression**: an `Error` with an own enumerable `__proto__` field, set with `Object.defineProperty`, keeps it next to `name`, `message` and `stack`.

In `__tests__/winston/winston.adapter.test.ts`, with its harness (`json` format):

4. **Regression**: `error("msg", <input>)` writes a line whose parsed object has an own `__proto__` equal to `{ isAdmin: true }`, and `a: 1`. The same holds for `<input>` given as `bound`, and as a child's metadata.

In `__tests__/winston/console-format.test.ts`:

5. **Regression**: in `pretty`, the line for `{ body: <input> }` contains `"__proto__":{"isAdmin":true}`.

Existing behavior:

6. After the cases above, `Object.prototype` has no `isAdmin` property.

**Manual check**: the *Report* probe re-run against the rebuilt `dist/`. Expected: every row shows `"__proto__":{"isAdmin":true}`.

## Plan

1. **Spec** (this file).
2. **Tests and fix.**
   - The `test-author` writes cases 1–6, in the foreground.
   - Cases 1–5 are seen failing; case 6 passes.
   - Then the fix, with `pnpm verify` green.
   - One commit with the tests and the fix.
3. **Manual check.**
4. **Review**, checkpoint 2, integration.
