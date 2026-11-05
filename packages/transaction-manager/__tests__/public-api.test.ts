import { describe, expect, expectTypeOf, it } from "vitest";
import * as entryPoint from "~/index";
import type { Transaction, TransactionManager } from "~/index";
// @ts-expect-error renamed to Transaction
import type { ITransaction } from "~/index";
// @ts-expect-error renamed to TransactionManager
import type { ITransactionManager } from "~/index";

describe("entry point", () => {
  it("exports types only", () => {
    expect(Object.keys(entryPoint)).toEqual([]);
  });

  it("exports Transaction and TransactionManager", () => {
    expectTypeOf<Transaction>().toHaveProperty("id");
    expectTypeOf<TransactionManager>().toHaveProperty("runInTransaction");
  });

  it("does not export the old names", () => {
    // Enforced by `typecheck` through the `@ts-expect-error` on the imports:
    // a name the module does not export resolves to `any`.
    expectTypeOf<ITransaction>().toBeAny();
    expectTypeOf<ITransactionManager>().toBeAny();
  });
});
