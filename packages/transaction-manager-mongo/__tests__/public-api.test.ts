import type {
  Transaction,
  TransactionManager,
} from "@enardo/transaction-manager";
import { describe, expect, expectTypeOf, it } from "vitest";
import * as entryPoint from "~/index";
import type { MongoTransaction, MongoTransactionManager } from "~/index";
// @ts-expect-error renamed to MongoTransaction
import type { IMongoTransaction } from "~/index";

describe("entry point", () => {
  it("exports MongoTransactionManager at runtime, and nothing else", () => {
    expect(Object.keys(entryPoint)).toEqual(["MongoTransactionManager"]);
  });

  it("makes MongoTransaction extend Transaction", () => {
    expectTypeOf<MongoTransaction>().toExtend<Transaction>();
    expectTypeOf<MongoTransaction>().toHaveProperty("session");
  });

  it("makes MongoTransactionManager assignable to TransactionManager<MongoTransaction>", () => {
    expectTypeOf<MongoTransactionManager>().toExtend<
      TransactionManager<MongoTransaction>
    >();
  });

  it("does not export IMongoTransaction", () => {
    // Enforced by `typecheck` through the `@ts-expect-error` on the import:
    // a name the module does not export resolves to `any`.
    expectTypeOf<IMongoTransaction>().toBeAny();
  });
});
