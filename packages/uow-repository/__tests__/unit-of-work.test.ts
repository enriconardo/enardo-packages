import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type {
  Transaction,
  TransactionManager,
} from "@enardo/transaction-manager";
import {
  TransactionalUnitOfWork,
  type FlushUnit,
  type UnitOfWork,
  type UnitOfWorkParticipant,
} from "~/unit-of-work";
import { TrackingRepository } from "~/repository";
import type { DataStore } from "~/data-store";
import type { Mapper } from "~/mapper";
import type { RecordKeys } from "~/record-set";
import { isBaseErrorLike } from "@enardo/errors";
import { expectNativeError, reasonOf } from "./support/native-errors";

const USED_UNIT_MESSAGE =
  "This unit of work has already been used; create a new one, with new repositories, for each execute call.";

describe("TransactionalUnitOfWork", () => {
  it("implements UnitOfWork, the contract application code depends on", () => {
    expectTypeOf<TransactionalUnitOfWork>().toExtend<UnitOfWork>();
  });

  it("returns the work result without opening a transaction when nothing is pending", async () => {
    const transaction = createTransaction();
    const manager = createManager(transaction);
    const unitOfWork = new TransactionalUnitOfWork(manager);

    await expect(unitOfWork.execute(async () => "done")).resolves.toBe("done");

    expect(manager.callCount).toBe(0);
  });

  it("passes the transaction context to every flush unit", async () => {
    const transaction: SessionTransaction = {
      id: "transaction-1",
      sessionId: "session-1",
    };
    const unitOfWork = new TransactionalUnitOfWork<SessionTransaction>(
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
    const transactionManager: TransactionManager = {
      async runInTransaction<TResult>(
        work: (context: Transaction) => Promise<TResult>,
      ): Promise<TResult> {
        events.push("begin");
        const result = await work(transaction);
        events.push("commit");
        return result;
      },
    };
    const unitOfWork = new TransactionalUnitOfWork(transactionManager);
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
    const unitOfWork = new TransactionalUnitOfWork(
      createManager(createTransaction()),
    );
    const participant = createParticipant(false);
    const clear = vi.spyOn(participant, "clear");
    unitOfWork.register(participant);

    await unitOfWork.execute(async () => undefined);

    expect(clear).toHaveBeenCalledOnce();
  });

  it("clears the participants without opening a transaction when the work fails", async () => {
    const transaction = createTransaction();
    const manager = createManager(transaction);
    const unitOfWork = new TransactionalUnitOfWork(manager);
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
    const unitOfWork = new TransactionalUnitOfWork(createManager(transaction));
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
    const manager: TransactionManager = {
      async runInTransaction(work) {
        await work(transaction);
        events.push("rollback");
        throw transactionFailure;
      },
    };
    const unitOfWork = new TransactionalUnitOfWork(manager);
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
    it("rejects a second execute call after a successful one with a native Error", async () => {
      const unitOfWork = new TransactionalUnitOfWork(
        createManager(createTransaction()),
      );
      await unitOfWork.execute(async () => undefined);

      const error = await reasonOf(unitOfWork.execute(async () => undefined));

      expectNativeError(error, Error, USED_UNIT_MESSAGE);
    });

    it("rejects a second execute call after a failed one with a native Error", async () => {
      const unitOfWork = new TransactionalUnitOfWork(
        createManager(createTransaction()),
      );
      await expect(
        unitOfWork.execute(async () => Promise.reject(new Error("failed"))),
      ).rejects.toThrow("failed");

      const error = await reasonOf(unitOfWork.execute(async () => undefined));

      expectNativeError(error, Error, USED_UNIT_MESSAGE);
    });

    it("rejects a nested execute call with a native Error", async () => {
      const unitOfWork = new TransactionalUnitOfWork(
        createManager(createTransaction()),
      );

      const error = await reasonOf(
        unitOfWork.execute(async () =>
          unitOfWork.execute(async () => undefined),
        ),
      );

      expectNativeError(error, Error, USED_UNIT_MESSAGE);
    });

    it("rejects a concurrent execute call with a native Error, without disturbing the running one", async () => {
      const unitOfWork = new TransactionalUnitOfWork(
        createManager(createTransaction()),
      );
      let releaseFirst!: () => void;
      const first = unitOfWork.execute(
        () =>
          new Promise<string>(
            (resolve) => (releaseFirst = () => resolve("first")),
          ),
      );

      const error = await reasonOf(unitOfWork.execute(async () => undefined));

      expectNativeError(error, Error, USED_UNIT_MESSAGE);
      releaseFirst();
      await expect(first).resolves.toBe("first");
    });

    it("rejects a call on a used unit with a native Error, without running its work", async () => {
      const unitOfWork = new TransactionalUnitOfWork(
        createManager(createTransaction()),
      );
      await unitOfWork.execute(async () => undefined);
      const work = vi.fn(async () => undefined);

      const error = await reasonOf(unitOfWork.execute(work));

      expectNativeError(error, Error, USED_UNIT_MESSAGE);
      expect(work).not.toHaveBeenCalled();
    });
  });

  describe("hasPendingChanges", () => {
    it("is false without participants", () => {
      const unitOfWork = new TransactionalUnitOfWork(
        createManager(createTransaction()),
      );

      expect(unitOfWork.hasPendingChanges()).toBe(false);
    });

    it("is false while every participant reports itself unchanged", () => {
      const unitOfWork = new TransactionalUnitOfWork(
        createManager(createTransaction()),
      );
      unitOfWork.register(createParticipant(false));
      unitOfWork.register(createParticipant(false));

      expect(unitOfWork.hasPendingChanges()).toBe(false);
    });

    it("is true as soon as one participant holds a change", () => {
      const unitOfWork = new TransactionalUnitOfWork(
        createManager(createTransaction()),
      );
      unitOfWork.register(createParticipant(false));
      unitOfWork.register(createParticipant(true));

      expect(unitOfWork.hasPendingChanges()).toBe(true);
    });

    it("stops polling once a participant reports a change", () => {
      const unitOfWork = new TransactionalUnitOfWork(
        createManager(createTransaction()),
      );
      const later = createParticipant(true);
      const laterSpy = vi.spyOn(later, "hasPendingChanges");
      unitOfWork.register(createParticipant(true));
      unitOfWork.register(later);

      expect(unitOfWork.hasPendingChanges()).toBe(true);
      expect(laterSpy).not.toHaveBeenCalled();
    });

    it("answers without planning a flush", () => {
      const unitOfWork = new TransactionalUnitOfWork(
        createManager(createTransaction()),
      );
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

interface SessionTransaction extends Transaction {
  readonly sessionId: string;
}

function createTransaction(): Transaction {
  return {
    id: "transaction-1",
  };
}

function createManager<TContext extends Transaction>(
  transaction: TContext,
): TestTransactionManager<TContext> {
  return new TestTransactionManager(transaction);
}

class TestTransactionManager<
  TContext extends Transaction,
> implements TransactionManager<TContext> {
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

describe("TransactionalUnitOfWork domain events", () => {
  it("hands the events of a new aggregate to onEvents once, in queue order, with the transaction's context", async () => {
    const transaction: SessionTransaction = {
      id: "transaction-1",
      sessionId: "session-1",
    };
    const onEvents =
      vi.fn<
        (
          events: readonly AccountEvent[],
          context: SessionTransaction,
        ) => Promise<void>
      >();
    const unitOfWork = new TransactionalUnitOfWork<
      SessionTransaction,
      AccountEvent
    >(createManager(transaction), { onEvents });
    const { repository } = createAccountRepository<SessionTransaction>();
    unitOfWork.register(repository);
    const account = newAccount("a-1", "Ada");
    account.queue.push(
      accountEvent("opened", "a-1"),
      accountEvent("credited", "a-1"),
    );

    await unitOfWork.execute(async () => repository.add(account));

    expect(onEvents).toHaveBeenCalledExactlyOnceWith(
      [accountEvent("opened", "a-1"), accountEvent("credited", "a-1")],
      transaction,
    );
    expect(onEvents.mock.calls[0]?.[1]).toBe(transaction);
  });

  it("pulls the events before the transaction, and awaits onEvents inside it, after the writes and before the commit", async () => {
    const log: string[] = [];
    const unitOfWork = new TransactionalUnitOfWork<Transaction, AccountEvent>(
      createRecordingManager(log),
      {
        async onEvents(events) {
          log.push(`onEvents:start:${events.map(({ type }) => type).join()}`);
          await Promise.resolve();
          await Promise.resolve();
          log.push("onEvents:end");
        },
      },
    );
    const { repository } = createAccountRepository(log);
    unitOfWork.register(repository);
    const account = newAccount("a-1", "Ada");
    account.queue.push(accountEvent("opened", "a-1"));

    await unitOfWork.execute(async () => repository.add(account));

    expect(log).toEqual([
      "pull:a-1",
      "begin",
      "apply:a-1",
      "onEvents:start:opened",
      "onEvents:end",
      "commit",
    ]);
  });

  it("opens a transaction for events alone: a loaded aggregate with an event and no change of state", async () => {
    const log: string[] = [];
    const onEvents = vi.fn((events: readonly AccountEvent[]) => {
      log.push(`onEvents:${events.map(({ type }) => type).join()}`);
    });
    const unitOfWork = new TransactionalUnitOfWork<Transaction, AccountEvent>(
      createRecordingManager(log),
      { onEvents },
    );
    const { repository, apply, deleteRecords } = createAccountRepository(log, {
      "a-1": storedAccount("a-1", "Ada"),
    });
    unitOfWork.register(repository);

    await unitOfWork.execute(async () => {
      const account = await repository.findById("a-1");
      account!.queue.push(accountEvent("viewed", "a-1"));
    });

    expect(log).toEqual(["pull:a-1", "begin", "onEvents:viewed", "commit"]);
    expect(onEvents).toHaveBeenCalledExactlyOnceWith(
      [accountEvent("viewed", "a-1")],
      createTransaction(),
    );
    expect(apply).not.toHaveBeenCalled();
    expect(deleteRecords).not.toHaveBeenCalled();
  });

  it("hands over the events of every participant in registration order, then tracking order, then queue order", async () => {
    const log: string[] = [];
    const onEvents = vi.fn<(events: readonly AccountEvent[]) => void>();
    const unitOfWork = new TransactionalUnitOfWork<Transaction, AccountEvent>(
      createRecordingManager(log),
      { onEvents },
    );
    const first = createAccountRepository(log, {
      "a-2": storedAccount("a-2", "Grace"),
    });
    const second = createAccountRepository(log, {
      "b-1": storedAccount("b-1", "Edsger"),
    });
    unitOfWork.register(first.repository);
    unitOfWork.register(second.repository);

    await unitOfWork.execute(async () => {
      // The second repository is used first, and each one's aggregates raise
      // their events in another order than they were tracked.
      const loadedSecond = await second.repository.findById("b-1");
      const addedSecond = newAccount("b-2", "Barbara");
      await second.repository.add(addedSecond);
      const loadedFirst = await first.repository.findById("a-2");
      const addedFirst = newAccount("a-1", "Ada");
      await first.repository.add(addedFirst);
      await first.repository.remove(loadedFirst!);

      addedFirst.queue.push(accountEvent("opened", "a-1"));
      addedSecond.queue.push(accountEvent("opened", "b-2"));
      loadedFirst!.queue.push(accountEvent("closed", "a-2"));
      loadedSecond!.queue.push(accountEvent("viewed", "b-1"));
      addedFirst.queue.push(accountEvent("credited", "a-1"));
      loadedSecond!.queue.push(accountEvent("renamed", "b-1"));
    });

    expect(onEvents).toHaveBeenCalledExactlyOnceWith(
      [
        accountEvent("closed", "a-2"),
        accountEvent("opened", "a-1"),
        accountEvent("credited", "a-1"),
        accountEvent("viewed", "b-1"),
        accountEvent("renamed", "b-1"),
        accountEvent("opened", "b-2"),
      ],
      createTransaction(),
    );
  });

  it("collects the events of a participant that implements pullEvents, next to one that does not", async () => {
    const onEvents = vi.fn<(events: readonly string[]) => void>();
    const unitOfWork = new TransactionalUnitOfWork<Transaction, string>(
      createManager(createTransaction()),
      { onEvents },
    );
    const log: string[] = [];
    unitOfWork.register({
      planFlush: () => [createFlushUnit("plain", log)],
      hasPendingChanges: () => true,
      clear: () => undefined,
    });
    const pullEvents = vi.fn(() => ["first", "second"]);
    unitOfWork.register({
      planFlush: () => [],
      hasPendingChanges: () => false,
      pullEvents,
      clear: () => undefined,
    });

    await unitOfWork.execute(async () => undefined);

    expect(pullEvents).toHaveBeenCalledOnce();
    expect(onEvents).toHaveBeenCalledExactlyOnceWith(
      ["first", "second"],
      createTransaction(),
    );
    expect(log).toEqual(["run:plain"]);
  });

  it("hands the same events to every attempt of a retried transaction, pulling each aggregate's events once", async () => {
    const log: string[] = [];
    const onEvents = vi.fn<(events: readonly AccountEvent[]) => void>();
    const unitOfWork = new TransactionalUnitOfWork<Transaction, AccountEvent>(
      createRecordingManager(log, 2),
      { onEvents },
    );
    const { repository, pullEvents } = createAccountRepository(log, {
      "a-2": storedAccount("a-2", "Grace"),
    });
    unitOfWork.register(repository);

    await unitOfWork.execute(async () => {
      const added = newAccount("a-1", "Ada");
      added.queue.push(accountEvent("opened", "a-1"));
      await repository.add(added);
      const loaded = await repository.findById("a-2");
      loaded!.queue.push(accountEvent("viewed", "a-2"));
    });

    const events = [
      accountEvent("opened", "a-1"),
      accountEvent("viewed", "a-2"),
    ];
    expect(onEvents).toHaveBeenCalledTimes(2);
    expect(onEvents).toHaveBeenNthCalledWith(1, events, createTransaction());
    expect(onEvents).toHaveBeenNthCalledWith(2, events, createTransaction());
    expect(pullEvents).toHaveBeenCalledTimes(2);
    expect(pullEvents.mock.calls.map(([account]) => account.id)).toEqual([
      "a-1",
      "a-2",
    ]);
    expect(log).toEqual([
      "pull:a-1",
      "pull:a-2",
      "begin",
      "apply:a-1",
      "commit",
      "begin",
      "apply:a-1",
      "commit",
    ]);
  });

  it("rejects execute with the error of onEvents, after rolling the transaction back, and clears the repositories", async () => {
    const log: string[] = [];
    const failure = new Error("the outbox is unavailable");
    const unitOfWork = new TransactionalUnitOfWork<Transaction, AccountEvent>(
      createRecordingManager(log),
      { onEvents: async () => Promise.reject(failure) },
    );
    const first = createAccountRepository(log);
    const second = createAccountRepository(log);
    const clearFirst = vi.spyOn(first.repository, "clear");
    const clearSecond = vi.spyOn(second.repository, "clear");
    unitOfWork.register(first.repository);
    unitOfWork.register(second.repository);
    const account = newAccount("a-1", "Ada");
    account.queue.push(accountEvent("opened", "a-1"));

    await expect(
      unitOfWork.execute(async () => first.repository.add(account)),
    ).rejects.toBe(failure);

    expect(log).toEqual(["pull:a-1", "begin", "apply:a-1", "rollback"]);
    expect(clearFirst).toHaveBeenCalledOnce();
    expect(clearSecond).toHaveBeenCalledOnce();
  });

  it.each([
    ["no options", undefined],
    ["options without onEvents", {}],
  ])(
    "rejects with a native Error naming onEvents, before the transaction, when events are collected with %s",
    async (_label, options) => {
      const log: string[] = [];
      const manager = createRecordingManager(log);
      const unitOfWork = new TransactionalUnitOfWork<Transaction, AccountEvent>(
        manager,
        options,
      );
      const { repository, apply } = createAccountRepository(log);
      unitOfWork.register(repository);
      const account = newAccount("a-1", "Ada");
      account.queue.push(accountEvent("opened", "a-1"));

      const error = await unitOfWork
        .execute(async () => repository.add(account))
        .then(
          () => undefined,
          (rejection: unknown) => rejection,
        );

      expect(error).toBeInstanceOf(Error);
      const native = error as Error;
      expect(native.constructor, "the error's constructor").toBe(Error);
      expect(native.name, "the error's name").toBe("Error");
      expect(native.message).toMatch(/onEvents/);
      expect("code" in native, "a code property").toBe(false);
      expect(isBaseErrorLike(error), "isBaseErrorLike").toBe(false);
      expect(log).not.toContain("begin");
      expect(apply).not.toHaveBeenCalled();
    },
  );

  it("does not call onEvents when no event is collected, and writes as before", async () => {
    const log: string[] = [];
    const onEvents = vi.fn<(events: readonly AccountEvent[]) => void>();
    const unitOfWork = new TransactionalUnitOfWork<Transaction, AccountEvent>(
      createRecordingManager(log),
      { onEvents },
    );
    const withEvents = createAccountRepository(log, {
      "a-2": storedAccount("a-2", "Grace"),
    });
    const withoutEvents = createAccountRepositoryWithoutEvents(log);
    unitOfWork.register(withEvents.repository);
    unitOfWork.register(withoutEvents.repository);
    unitOfWork.register({
      planFlush: () => [createFlushUnit("plain", log)],
      hasPendingChanges: () => true,
      clear: () => undefined,
    });

    await unitOfWork.execute(async () => {
      await withEvents.repository.add(newAccount("a-1", "Ada"));
      const loaded = await withEvents.repository.findById("a-2");
      loaded!.owner = "Grace Hopper";
      const unpulled = newAccount("b-1", "Edsger");
      // Without the pullEvents option, a queue is not read.
      unpulled.queue.push(accountEvent("opened", "b-1"));
      await withoutEvents.repository.add(unpulled);
    });

    expect(onEvents).not.toHaveBeenCalled();
    expect(log).toEqual([
      "pull:a-1",
      "pull:a-2",
      "begin",
      "apply:a-1",
      "apply:a-2",
      "apply:b-1",
      "run:plain",
      "commit",
    ]);
  });

  it("commits writes with no event and no onEvents, without an error", async () => {
    const log: string[] = [];
    const unitOfWork = new TransactionalUnitOfWork<Transaction, AccountEvent>(
      createRecordingManager(log),
    );
    const { repository } = createAccountRepository(log);
    unitOfWork.register(repository);

    await expect(
      unitOfWork.execute(async () => {
        await repository.add(newAccount("a-1", "Ada"));
        return "done";
      }),
    ).resolves.toBe("done");

    expect(log).toEqual(["pull:a-1", "begin", "apply:a-1", "commit"]);
  });

  it("calls a synchronous onEvents and completes the commit", async () => {
    const log: string[] = [];
    const received: AccountEvent[] = [];
    const unitOfWork = new TransactionalUnitOfWork<Transaction, AccountEvent>(
      createRecordingManager(log),
      {
        onEvents(events): void {
          received.push(...events);
          log.push("onEvents");
        },
      },
    );
    const { repository } = createAccountRepository(log);
    unitOfWork.register(repository);
    const account = newAccount("a-1", "Ada");
    account.queue.push(accountEvent("opened", "a-1"));

    await expect(
      unitOfWork.execute(async () => {
        await repository.add(account);
        return "done";
      }),
    ).resolves.toBe("done");

    expect(received).toEqual([accountEvent("opened", "a-1")]);
    expect(log).toEqual([
      "pull:a-1",
      "begin",
      "apply:a-1",
      "onEvents",
      "commit",
    ]);
  });

  it("reports no pending change for a loaded, unchanged aggregate with a queued event, leaving its queue as it is", async () => {
    const unitOfWork = new TransactionalUnitOfWork<Transaction, AccountEvent>(
      createManager(createTransaction()),
      { onEvents: () => undefined },
    );
    const { repository, pullEvents } = createAccountRepository([], {
      "a-1": storedAccount("a-1", "Ada"),
    });
    unitOfWork.register(repository);

    const account = await repository.findById("a-1");
    account!.queue.push(accountEvent("viewed", "a-1"));

    expect(unitOfWork.hasPendingChanges()).toBe(false);
    expect(account!.queue).toEqual([accountEvent("viewed", "a-1")]);
    expect(pullEvents).not.toHaveBeenCalled();
  });

  describe("types", () => {
    interface OtherEvent {
      kind: "other";
    }

    it("infers the unit of work's TEvent from onEvents, and types its context", () => {
      const unitOfWork = new TransactionalUnitOfWork(
        createManager<SessionTransaction>({ id: "t-1", sessionId: "s-1" }),
        {
          onEvents(events: readonly AccountEvent[], context) {
            expectTypeOf(context).toEqualTypeOf<SessionTransaction>();
            expectTypeOf(events).toEqualTypeOf<readonly AccountEvent[]>();
          },
        },
      );

      expectTypeOf(unitOfWork).toEqualTypeOf<
        TransactionalUnitOfWork<SessionTransaction, AccountEvent>
      >();
    });

    it("infers the repository's TEvent from pullEvents", () => {
      const { repository } = createAccountRepository();

      expectTypeOf(repository).toEqualTypeOf<
        TrackingRepository<
          Account,
          AccountRecords,
          string,
          Transaction,
          number,
          string,
          AccountEvent
        >
      >();
      expectTypeOf(repository).toExtend<
        UnitOfWorkParticipant<Transaction, AccountEvent>
      >();
    });

    it("registers a repository whose events the unit of work's TEvent includes, or one with no events", () => {
      const unitOfWork = new TransactionalUnitOfWork<
        Transaction,
        AccountEvent | OtherEvent
      >(createManager(createTransaction()), { onEvents: () => undefined });

      unitOfWork.register(createAccountRepository().repository);
      unitOfWork.register(createAccountRepositoryWithoutEvents().repository);
      unitOfWork.register(createParticipant(false));
    });

    it("refuses to register a repository whose events the unit of work's TEvent does not include", () => {
      const other = new TransactionalUnitOfWork<Transaction, OtherEvent>(
        createManager(createTransaction()),
        { onEvents: () => undefined },
      );
      // @ts-expect-error AccountEvent is not an OtherEvent
      other.register(createAccountRepository().repository);

      // The Mongo form: TContext given by hand, TEvent left at never.
      const withoutEvents = new TransactionalUnitOfWork<Transaction>(
        createManager(createTransaction()),
        { onEvents: () => undefined },
      );
      // @ts-expect-error TEvent is never
      withoutEvents.register(createAccountRepository().repository);
    });

    it("types onEvents in the options", () => {
      new TransactionalUnitOfWork<Transaction, AccountEvent>(
        createManager(createTransaction()),
        {
          // @ts-expect-error the events are AccountEvents, not OtherEvents
          onEvents: (events: readonly OtherEvent[]) => {
            void events;
          },
        },
      );
    });
  });
});

/** Records the transaction's lifecycle; runs `work` `attempts` times, as a retry would. */
function createRecordingManager(
  log: string[],
  attempts = 1,
): TransactionManager {
  const transaction = createTransaction();
  return {
    async runInTransaction<TResult>(
      work: (context: Transaction) => Promise<TResult>,
    ): Promise<TResult> {
      let result!: TResult;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        log.push("begin");
        try {
          result = await work(transaction);
        } catch (error) {
          log.push("rollback");
          throw error;
        }
        log.push("commit");
      }
      return result;
    },
  };
}

interface AccountEvent {
  type: string;
  accountId: string;
}

/** An aggregate that queues the domain events it raises, outside its records. */
interface Account {
  id: string;
  owner: string;
  queue: AccountEvent[];
}

interface AccountRecord {
  accountId: string;
  owner: string;
}

interface AccountRecords {
  accounts: [AccountRecord];
}

const accountMapper: Mapper<Account, AccountRecords, string> = {
  toDomain({ accounts: [record] }) {
    return { id: record.accountId, owner: record.owner, queue: [] };
  },
  toRecords(account) {
    return { accounts: [{ accountId: account.id, owner: account.owner }] };
  },
  identity(account) {
    return account.id;
  },
};

const accountKeys: RecordKeys<AccountRecords> = {
  accounts: (record) => record.accountId,
};

function accountEvent(type: string, accountId: string): AccountEvent {
  return { type, accountId };
}

function newAccount(id: string, owner: string): Account {
  return { id, owner, queue: [] };
}

function storedAccount(id: string, owner: string): AccountRecords {
  return { accounts: [{ accountId: id, owner }] };
}

/** An account repository without the pullEvents option, over the same store. */
function createAccountRepositoryWithoutEvents(
  log: string[] = [],
  stored: Readonly<Record<string, AccountRecords>> = {},
) {
  const { dataStore } = accountStore<Transaction>(log, stored);
  return { repository: new TrackingRepository(dataStore, accountMapper) };
}

/**
 * Wires an account repository that pulls each aggregate's queue, over an
 * in-memory store holding `stored` at version 3, logging its calls to `log`.
 */
function createAccountRepository<TContext extends Transaction = Transaction>(
  log: string[] = [],
  stored: Readonly<Record<string, AccountRecords>> = {},
) {
  const { dataStore, apply, deleteRecords } = accountStore<TContext>(
    log,
    stored,
  );
  const pullEvents = vi.fn((account: Account): readonly AccountEvent[] => {
    log.push(`pull:${account.id}`);
    return account.queue.splice(0);
  });
  const repository = new TrackingRepository(dataStore, accountMapper, {
    pullEvents,
  });

  return { repository, apply, deleteRecords, pullEvents };
}

function accountStore<TContext extends Transaction>(
  log: string[],
  stored: Readonly<Record<string, AccountRecords>>,
) {
  type Store = DataStore<AccountRecords, string, TContext>;
  const apply = vi.fn<Store["apply"]>(async (write) => {
    log.push(`apply:${write.id}`);
  });
  const deleteRecords = vi.fn<Store["delete"]>(async (id) => {
    log.push(`delete:${id}`);
  });
  const dataStore: Store = {
    recordKeys: accountKeys,
    findById: async (id) => {
      const records = stored[id];
      return records === undefined
        ? null
        : { records: structuredClone(records), version: 3 };
    },
    findAll: async () =>
      Object.values(stored).map((records) => ({
        records: structuredClone(records),
        version: 3,
      })),
    apply,
    delete: deleteRecords,
  };

  return { dataStore, apply, deleteRecords };
}
