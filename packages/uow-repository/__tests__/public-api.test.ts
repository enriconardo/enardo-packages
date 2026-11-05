import type { Transaction } from "@enardo/transaction-manager";
import { describe, expect, expectTypeOf, it } from "vitest";
import * as entryPoint from "~/index";
import type {
  Repository,
  TrackingRepository,
  TransactionalUnitOfWork,
  UnitOfWork,
} from "~/index";
// @ts-expect-error renamed to Repository
import type { IRepository } from "~/index";
// @ts-expect-error renamed to UnitOfWork
import type { IUnitOfWork } from "~/index";

interface Item {
  id: string;
}
interface ItemRecords {
  items: { id: string }[];
}

describe("entry point", () => {
  it("exports the classes under their qualified names", () => {
    expect(entryPoint).toHaveProperty("TrackingRepository");
    expect(entryPoint).toHaveProperty("TransactionalUnitOfWork");
  });

  it("has no runtime key named after a contract", () => {
    // An `export { TrackingRepository as Repository }` would leave one.
    expect(entryPoint).not.toHaveProperty("Repository");
    expect(entryPoint).not.toHaveProperty("UnitOfWork");
  });

  it("makes TransactionalUnitOfWork assignable to UnitOfWork", () => {
    expectTypeOf<TransactionalUnitOfWork>().toExtend<UnitOfWork>();
    expectTypeOf<TransactionalUnitOfWork<Transaction>>().toExtend<UnitOfWork>();
  });

  it("makes TrackingRepository assignable to Repository", () => {
    expectTypeOf<
      TrackingRepository<Item, ItemRecords, string, Transaction>
    >().toExtend<Repository<Item, string>>();
  });

  it("does not export the old names", () => {
    // Enforced by `typecheck` through the `@ts-expect-error` on the imports:
    // a name the module does not export resolves to `any`.
    expectTypeOf<IRepository>().toBeAny();
    expectTypeOf<IUnitOfWork>().toBeAny();
  });
});
