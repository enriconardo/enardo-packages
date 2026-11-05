import { describe, expect, expectTypeOf, it } from "vitest";
import type { Transaction } from "~/transaction";
import type { TransactionManager } from "~/transaction-manager";

/** A context carrying what a driver needs, as a database implementation would declare it. */
interface SessionTransaction extends Transaction {
  readonly session: string;
}

describe("TransactionManager", () => {
  it("hands work the context type the manager is declared with", async () => {
    const manager: TransactionManager<SessionTransaction> = {
      async runInTransaction(work) {
        return work({ id: "tx-1", session: "session-1" });
      },
    };

    const session = await manager.runInTransaction(async (transaction) => {
      expectTypeOf(transaction).toEqualTypeOf<SessionTransaction>();
      return transaction.session;
    });

    expect(session).toBe("session-1");
  });

  it("hands work a plain Transaction when no context type is declared", () => {
    type Work = Parameters<TransactionManager["runInTransaction"]>[0];

    expectTypeOf<Parameters<Work>[0]>().toEqualTypeOf<Transaction>();
  });
});
