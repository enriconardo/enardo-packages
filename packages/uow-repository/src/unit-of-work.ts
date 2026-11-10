import type {
  Transaction,
  TransactionManager,
} from "@enardo/transaction-manager";

/** A persistence write, planned before its transaction starts. */
export interface FlushUnit<TContext extends Transaction = Transaction> {
  readonly kind: "insert" | "update" | "replace" | "delete";
  run(context: TContext): Promise<void>;
}

/** Buffers persistence changes for the lifetime of a unit of work. */
export interface UnitOfWorkParticipant<
  TContext extends Transaction = Transaction,
  TEvent = never,
> {
  planFlush(): readonly FlushUnit<TContext>[];
  /** Reports whether planFlush would yield anything, without building it. */
  hasPendingChanges(): boolean;
  /**
   * Takes the domain events of the aggregates the participant tracks,
   * emptying their queues. Optional: a participant with no events omits it.
   */
  pullEvents?(): readonly TEvent[];
  clear(): void;
}

/** Options of a {@link TransactionalUnitOfWork}. */
export interface TransactionalUnitOfWorkOptions<
  TContext extends Transaction = Transaction,
  TEvent = never,
> {
  /**
   * Receives the events collected at commit, inside the transaction, after
   * the writes. Called once per attempt of the transaction.
   */
  onEvents?: (
    events: readonly TEvent[],
    context: TContext,
  ) => void | Promise<void>;
}

/**
 * The unit of work as application code sees it: without the transaction
 * context type, which only persistence adapters need.
 */
export interface UnitOfWork {
  /** Runs `work`, then writes the changes of every participant in one transaction. */
  execute<TResult>(work: () => Promise<TResult>): Promise<TResult>;
  /**
   * Reports whether committing now would write anything. Domain events are
   * not counted: only the store writes the repositories plan.
   */
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
export class TransactionalUnitOfWork<
  TContext extends Transaction = Transaction,
  TEvent = never,
> implements UnitOfWork {
  private used = false;
  private readonly participants = new Set<
    UnitOfWorkParticipant<TContext, TEvent>
  >();

  constructor(
    private readonly transactionManager: TransactionManager<TContext>,
    private readonly options: TransactionalUnitOfWorkOptions<
      TContext,
      TEvent
    > = {},
  ) {}

  #clearParticipants(): void {
    for (const participant of this.participants) {
      participant.clear();
    }
  }

  /**
   * Collects the writes, then the events, of every participant in
   * registration order, before the transaction starts: a retried transaction
   * runs the same writes and hands over the same events.
   */
  #plan(): { units: FlushUnit<TContext>[]; events: TEvent[] } {
    const units: FlushUnit<TContext>[] = [];
    const events: TEvent[] = [];

    for (const participant of this.participants) {
      units.push(...participant.planFlush());
    }

    for (const participant of this.participants) {
      events.push(...(participant.pullEvents?.() ?? []));
    }

    return { units, events };
  }

  async #commit(): Promise<void> {
    const { units, events } = this.#plan();

    if (units.length === 0 && events.length === 0) return;

    const { onEvents } = this.options;

    if (events.length > 0 && onEvents === undefined) {
      throw new Error(
        "The repositories collected domain events, but the unit of work has no `onEvents` option to receive them; pass `onEvents` to the TransactionalUnitOfWork constructor.",
      );
    }

    await this.transactionManager.runInTransaction(async (ctx) => {
      for (const unit of units) {
        await unit.run(ctx);
      }

      if (events.length > 0 && onEvents !== undefined) {
        await onEvents(events, ctx);
      }
    });
  }

  /**
   * Reports whether committing now would write anything, so that callers can
   * warn about unsaved work without planning a flush.
   *
   * Counts only the store writes the repositories plan, not domain events:
   * reading an aggregate's queue empties it. A commit with events and no
   * write still opens a transaction.
   */
  hasPendingChanges(): boolean {
    for (const participant of this.participants) {
      if (participant.hasPendingChanges()) {
        return true;
      }
    }

    return false;
  }

  register(participant: UnitOfWorkParticipant<TContext, TEvent>): void {
    this.participants.add(participant);
  }

  /**
   * Runs `work`, then writes the changes of every participant in one
   * transaction.
   *
   * @throws {Error} execute() was already called on this
   *   instance, including a call that is still running.
   */
  async execute<TResult>(work: () => Promise<TResult>): Promise<TResult> {
    if (this.used) {
      throw new Error(
        "This unit of work has already been used; create a new one, with new repositories, for each execute call.",
      );
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
