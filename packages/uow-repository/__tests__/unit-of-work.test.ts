import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type {
  ITransaction,
  ITransactionManager,
} from "@enardo/transaction-manager";
import { UnitOfWorkAlreadyUsedError } from "~/errors";
import {
  UnitOfWork,
  type FlushUnit,
  type IUnitOfWork,
  type UnitOfWorkParticipant,
} from "~/unit-of-work";

describe("UnitOfWork", () => {
  it("implements IUnitOfWork, the contract application code depends on", () => {
    expectTypeOf<UnitOfWork>().toExtend<IUnitOfWork>();
  });

  it("returns the work result without opening a transaction when nothing is pending", async () => {
    const transaction = createTransaction();
    const manager = createManager(transaction);
    const unitOfWork = new UnitOfWork(manager);

    await expect(unitOfWork.execute(async () => "done")).resolves.toBe("done");

    expect(manager.callCount).toBe(0);
  });

  it("passes the transaction context to every flush unit", async () => {
    const transaction: SessionTransaction = {
      id: "transaction-1",
      sessionId: "session-1",
    };
    const unitOfWork = new UnitOfWork<SessionTransaction>(
      createManager(transaction),
    );
    let receivedContext: SessionTransaction | undefined;
    unitOfWork.register({
      planFlush: () => [
        {
          kind: "insert",
          async run(flushContext) {
            receivedContext = flushContext;
          },
        },
      ],
      hasPendingChanges: () => true,
      clear: () => undefined,
    });

    await unitOfWork.execute(async () => undefined);

    expect(receivedContext).toBe(transaction);
  });

  it("runs every flush unit inside one transaction, then clears the participants", async () => {
    const events: string[] = [];
    const transaction = createTransaction();
    const transactionManager: ITransactionManager = {
      async runInTransaction<TResult>(
        work: (context: ITransaction) => Promise<TResult>,
      ): Promise<TResult> {
        events.push("begin");
        const result = await work(transaction);
        events.push("commit");
        return result;
      },
    };
    const unitOfWork = new UnitOfWork(transactionManager);
    unitOfWork.register({
      planFlush: () => {
        events.push("plan");
        return [
          createFlushUnit("first", events),
          createFlushUnit("second", events),
        ];
      },
      hasPendingChanges: () => true,
      clear: () => events.push("clear"),
    });

    await unitOfWork.execute(async () => undefined);

    expect(events).toEqual([
      "plan",
      "begin",
      "run:first",
      "run:second",
      "commit",
      "clear",
    ]);
  });

  it("clears the participants when there is nothing to write", async () => {
    const unitOfWork = new UnitOfWork(createManager(createTransaction()));
    const participant = createParticipant(false);
    const clear = vi.spyOn(participant, "clear");
    unitOfWork.register(participant);

    await unitOfWork.execute(async () => undefined);

    expect(clear).toHaveBeenCalledOnce();
  });

  it("clears the participants without opening a transaction when the work fails", async () => {
    const transaction = createTransaction();
    const manager = createManager(transaction);
    const unitOfWork = new UnitOfWork(manager);
    const participant = createParticipant(true);
    const clear = vi.spyOn(participant, "clear");
    unitOfWork.register(participant);
    const failure = new Error("cannot persist product");

    await expect(
      unitOfWork.execute(async () => Promise.reject(failure)),
    ).rejects.toBe(failure);

    expect(manager.callCount).toBe(0);
    expect(clear).toHaveBeenCalledOnce();
  });

  it("propagates a flush error and clears the participants", async () => {
    const transaction = createTransaction();
    const unitOfWork = new UnitOfWork(createManager(transaction));
    const flushFailure = new Error("cannot persist product");
    const clear = vi.fn();
    unitOfWork.register({
      planFlush: () => [
        {
          kind: "insert",
          run: async () => Promise.reject(flushFailure),
        },
      ],
      hasPendingChanges: () => true,
      clear,
    });

    await expect(unitOfWork.execute(async () => undefined)).rejects.toBe(
      flushFailure,
    );

    expect(clear).toHaveBeenCalledOnce();
  });

  it("propagates a commit failure and clears the participants", async () => {
    const events: string[] = [];
    const transaction = createTransaction();
    const transactionFailure = new Error("commit unavailable");
    const manager: ITransactionManager = {
      async runInTransaction(work) {
        await work(transaction);
        events.push("rollback");
        throw transactionFailure;
      },
    };
    const unitOfWork = new UnitOfWork(manager);
    unitOfWork.register({
      planFlush: () => [createFlushUnit("product", events)],
      hasPendingChanges: () => true,
      clear: () => events.push("clear"),
    });

    await expect(unitOfWork.execute(async () => undefined)).rejects.toBe(
      transactionFailure,
    );

    expect(events).toEqual(["run:product", "rollback", "clear"]);
  });

  describe("single use", () => {
    it("rejects a second execute call after a successful one", async () => {
      const unitOfWork = new UnitOfWork(createManager(createTransaction()));
      await unitOfWork.execute(async () => undefined);

      await expect(unitOfWork.execute(async () => undefined)).rejects.toThrow(
        UnitOfWorkAlreadyUsedError,
      );
    });

    it("rejects a second execute call after a failed one", async () => {
      const unitOfWork = new UnitOfWork(createManager(createTransaction()));
      await expect(
        unitOfWork.execute(async () => Promise.reject(new Error("failed"))),
      ).rejects.toThrow("failed");

      await expect(unitOfWork.execute(async () => undefined)).rejects.toThrow(
        UnitOfWorkAlreadyUsedError,
      );
    });

    it("rejects a nested execute call", async () => {
      const unitOfWork = new UnitOfWork(createManager(createTransaction()));

      await expect(
        unitOfWork.execute(async () =>
          unitOfWork.execute(async () => undefined),
        ),
      ).rejects.toThrow(UnitOfWorkAlreadyUsedError);
    });

    it("rejects a concurrent execute call without disturbing the running one", async () => {
      const unitOfWork = new UnitOfWork(createManager(createTransaction()));
      let releaseFirst!: () => void;
      const first = unitOfWork.execute(
        () =>
          new Promise<string>(
            (resolve) => (releaseFirst = () => resolve("first")),
          ),
      );

      await expect(unitOfWork.execute(async () => undefined)).rejects.toThrow(
        UnitOfWorkAlreadyUsedError,
      );

      releaseFirst();
      await expect(first).resolves.toBe("first");
    });

    it("does not run the work of a rejected call", async () => {
      const unitOfWork = new UnitOfWork(createManager(createTransaction()));
      await unitOfWork.execute(async () => undefined);
      const work = vi.fn(async () => undefined);

      await expect(unitOfWork.execute(work)).rejects.toThrow(
        UnitOfWorkAlreadyUsedError,
      );
      expect(work).not.toHaveBeenCalled();
    });
  });

  describe("hasPendingChanges", () => {
    it("is false without participants", () => {
      const unitOfWork = new UnitOfWork(createManager(createTransaction()));

      expect(unitOfWork.hasPendingChanges()).toBe(false);
    });

    it("is false while every participant reports itself unchanged", () => {
      const unitOfWork = new UnitOfWork(createManager(createTransaction()));
      unitOfWork.register(createParticipant(false));
      unitOfWork.register(createParticipant(false));

      expect(unitOfWork.hasPendingChanges()).toBe(false);
    });

    it("is true as soon as one participant holds a change", () => {
      const unitOfWork = new UnitOfWork(createManager(createTransaction()));
      unitOfWork.register(createParticipant(false));
      unitOfWork.register(createParticipant(true));

      expect(unitOfWork.hasPendingChanges()).toBe(true);
    });

    it("stops polling once a participant reports a change", () => {
      const unitOfWork = new UnitOfWork(createManager(createTransaction()));
      const later = createParticipant(true);
      const laterSpy = vi.spyOn(later, "hasPendingChanges");
      unitOfWork.register(createParticipant(true));
      unitOfWork.register(later);

      expect(unitOfWork.hasPendingChanges()).toBe(true);
      expect(laterSpy).not.toHaveBeenCalled();
    });

    it("answers without planning a flush", () => {
      const unitOfWork = new UnitOfWork(createManager(createTransaction()));
      const participant = createParticipant(true);
      const planFlush = vi.spyOn(participant, "planFlush");
      unitOfWork.register(participant);

      expect(unitOfWork.hasPendingChanges()).toBe(true);
      expect(planFlush).not.toHaveBeenCalled();
    });
  });
});

function createParticipant(pending: boolean): UnitOfWorkParticipant {
  return {
    planFlush: () => [],
    hasPendingChanges: () => pending,
    clear: () => undefined,
  };
}

interface SessionTransaction extends ITransaction {
  readonly sessionId: string;
}

function createTransaction(): ITransaction {
  return {
    id: "transaction-1",
  };
}

function createManager<TContext extends ITransaction>(
  transaction: TContext,
): TestTransactionManager<TContext> {
  return new TestTransactionManager(transaction);
}

class TestTransactionManager<
  TContext extends ITransaction,
> implements ITransactionManager<TContext> {
  callCount = 0;

  constructor(private readonly transaction: TContext) {}

  async runInTransaction<TResult>(
    work: (transaction: TContext) => Promise<TResult>,
  ): Promise<TResult> {
    this.callCount += 1;
    return work(this.transaction);
  }
}

function createFlushUnit(name: string, events: string[]): FlushUnit {
  return {
    kind: "update",
    async run() {
      events.push(`run:${name}`);
    },
  };
}
