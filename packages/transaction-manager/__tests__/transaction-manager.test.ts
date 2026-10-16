import { describe, expect, expectTypeOf, it } from "vitest";
import type { ITransaction } from "~/transaction";
import type { ITransactionManager } from "~/transaction-manager";

/** A context carrying what a driver needs, as a database implementation would declare it. */
interface SessionTransaction extends ITransaction {
  readonly session: string;
}

describe("ITransactionManager", () => {
  it("hands work the context type the manager is declared with", async () => {
    const manager: ITransactionManager<SessionTransaction> = {
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

  it("hands work a plain ITransaction when no context type is declared", () => {
    type Work = Parameters<ITransactionManager["runInTransaction"]>[0];

    expectTypeOf<Parameters<Work>[0]>().toEqualTypeOf<ITransaction>();
  });
});
