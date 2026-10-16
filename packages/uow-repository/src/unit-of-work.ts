import type {
  ITransaction,
  ITransactionManager,
} from "@enardo/transaction-manager";
import { UnitOfWorkAlreadyUsedError } from "./errors";

/** A persistence write, planned before its transaction starts. */
export interface FlushUnit<TContext extends ITransaction = ITransaction> {
  readonly kind: "insert" | "update" | "replace" | "delete";
  run(context: TContext): Promise<void>;
}

/** Buffers persistence changes for the lifetime of a unit of work. */
export interface UnitOfWorkParticipant<
  TContext extends ITransaction = ITransaction,
> {
  planFlush(): readonly FlushUnit<TContext>[];
  /** Reports whether planFlush would yield anything, without building it. */
  hasPendingChanges(): boolean;
  clear(): void;
}

/**
 * The unit of work as application code sees it: without the transaction
 * context type, which only persistence adapters need.
 */
export interface IUnitOfWork {
  /** Runs `work`, then writes the changes of every participant in one transaction. */
  execute<TResult>(work: () => Promise<TResult>): Promise<TResult>;
  /** Reports whether committing now would write anything. */
  hasPendingChanges(): boolean;
}

/**
 * Runs one asynchronous operation within one transaction, then discards what
 * its participants tracked.
 *
 * An instance is single-use: once execute() has been called, whatever the
 * outcome, every participant is cleared and the entities it returned are
 * detached. Reusing the instance would silently drop edits made to those
 * entities, so a second call throws instead.
 */
export class UnitOfWork<
  TContext extends ITransaction = ITransaction,
> implements IUnitOfWork {
  private used = false;
  private readonly participants = new Set<UnitOfWorkParticipant<TContext>>();

  constructor(
    private readonly transactionManager: ITransactionManager<TContext>,
  ) {}

  #clearParticipants(): void {
    for (const participant of this.participants) {
      participant.clear();
    }
  }

  #plan(): FlushUnit<TContext>[] {
    const units: FlushUnit<TContext>[] = [];

    for (const participant of this.participants) {
      units.push(...participant.planFlush());
    }

    return units;
  }

  async #commit(): Promise<void> {
    const units = this.#plan();

    if (units.length === 0) return;

    await this.transactionManager.runInTransaction(async (ctx) => {
      for (const unit of units) {
        await unit.run(ctx);
      }
    });
  }

  /**
   * Reports whether committing now would write anything, so that callers can
   * warn about unsaved work without planning a flush.
   */
  hasPendingChanges(): boolean {
    for (const participant of this.participants) {
      if (participant.hasPendingChanges()) {
        return true;
      }
    }

    return false;
  }

  register(participant: UnitOfWorkParticipant<TContext>): void {
    this.participants.add(participant);
  }

  /**
   * Runs `work`, then writes the changes of every participant in one
   * transaction.
   *
   * @throws {UnitOfWorkAlreadyUsedError} execute() was already called on this
   *   instance, including a call that is still running.
   */
  async execute<TResult>(work: () => Promise<TResult>): Promise<TResult> {
    if (this.used) {
      throw new UnitOfWorkAlreadyUsedError();
    }

    this.used = true;

    try {
      const result = await work();
      await this.#commit();
      return result;
    } finally {
      // After a failure nothing tracked can be trusted; after a commit the
      // snapshots are stale. Either way the instance is done.
      this.#clearParticipants();
    }
  }
}
