import { describe, expect, it, vi } from "vitest";
import type { ITransaction } from "@enardo/transaction-manager";
import { ConcurrencyConflictError } from "~/errors";
import { Repository } from "~/repository";
import { retryOnConflict } from "~/retry-on-conflict";
import { UnitOfWork } from "~/unit-of-work";
import type { AggregateWrite, DataStore, VersionedRecords } from "~/data-store";
import type { Mapper } from "~/mapper";
import type { RecordKeys } from "~/record-set";

describe("retryOnConflict", () => {
  it("returns the result of a first attempt that succeeds", async () => {
    const run = vi.fn(async () => "done");

    await expect(retryOnConflict(run)).resolves.toBe("done");

    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith(1);
  });

  it("runs again after a conflict, numbering the attempts", async () => {
    const run = vi
      .fn<(attempt: number) => Promise<string>>()
      .mockRejectedValueOnce(new ConcurrencyConflictError("p-1", 1))
      .mockResolvedValueOnce("done");

    await expect(retryOnConflict(run)).resolves.toBe("done");

    expect(run.mock.calls).toEqual([[1], [2]]);
  });

  it("rethrows the last conflict once the attempts run out", async () => {
    const last = new ConcurrencyConflictError("p-1", 2);
    const run = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new ConcurrencyConflictError("p-1", 1))
      .mockRejectedValueOnce(last);

    await expect(retryOnConflict(run, { attempts: 2 })).rejects.toBe(last);

    expect(run).toHaveBeenCalledTimes(2);
  });

  it("makes three attempts by default", async () => {
    const run = vi.fn(async () =>
      Promise.reject(new ConcurrencyConflictError("p-1", 1)),
    );

    await expect(retryOnConflict(run)).rejects.toThrow(
      ConcurrencyConflictError,
    );

    expect(run).toHaveBeenCalledTimes(3);
  });

  it("rethrows any other error without running again", async () => {
    const failure = new Error("store unavailable");
    const run = vi.fn(async () => Promise.reject(failure));

    await expect(retryOnConflict(run)).rejects.toBe(failure);

    expect(run).toHaveBeenCalledOnce();
  });

  it.each([0, -1, 1.5, Number.NaN])(
    "rejects %s attempts without running",
    async (attempts) => {
      const run = vi.fn(async () => undefined);

      await expect(retryOnConflict(run, { attempts })).rejects.toThrow(
        RangeError,
      );

      expect(run).not.toHaveBeenCalled();
    },
  );

  it("retries a use case that lost a race, from a fresh read", async () => {
    const store = new CounterStore();
    const transactionManager = {
      async runInTransaction<T>(work: (tx: ITransaction) => Promise<T>) {
        return work({ id: "tx" });
      },
    };
    let raced = false;

    await retryOnConflict(async () => {
      const counters = new Repository(store, counterMapper);
      const unitOfWork = new UnitOfWork(transactionManager);
      unitOfWork.register(counters);

      await unitOfWork.execute(async () => {
        const counter = await counters.findById("c-1");
        counter!.value += 1;

        if (!raced) {
          // Another use case commits in between the read and this commit.
          raced = true;
          store.row = { value: store.row.value + 10, version: 2 };
        }
      });
    });

    // The retry read 10 and added 1; the first attempt's 0 + 1 was never written.
    expect(store.row).toEqual({ value: 11, version: 3 });
  });
});

interface Counter {
  id: string;
  value: number;
}

interface CounterRecords {
  counters: [{ _id: string; value: number }];
}

const counterMapper: Mapper<Counter, CounterRecords, string> = {
  toDomain: ({ counters: [record] }) => ({
    id: record._id,
    value: record.value,
  }),
  toRecords: (counter) => ({
    counters: [{ _id: counter.id, value: counter.value }],
  }),
  identity: (counter) => counter.id,
};

/** Holds one counter and checks versions like a real store. */
class CounterStore implements DataStore<CounterRecords, string, ITransaction> {
  readonly recordKeys: RecordKeys<CounterRecords> = {
    counters: (record) => record._id,
  };
  row = { value: 0, version: 1 };

  async findById(
    id: string,
  ): Promise<VersionedRecords<CounterRecords, number>> {
    return {
      records: { counters: [{ _id: id, value: this.row.value }] },
      version: this.row.version,
    };
  }

  async findAll(): Promise<VersionedRecords<CounterRecords, number>[]> {
    return [];
  }

  async apply({
    id,
    expectedVersion,
    changes,
  }: AggregateWrite<CounterRecords, string, number>): Promise<void> {
    if (expectedVersion !== this.row.version) {
      throw new ConcurrencyConflictError(id, expectedVersion);
    }
    const update = changes.counters.updated[0]!;
    this.row = {
      value: update.set.value ?? this.row.value,
      version: expectedVersion + 1,
    };
  }

  async delete(): Promise<void> {
    throw new Error("not used by these tests");
  }
}
