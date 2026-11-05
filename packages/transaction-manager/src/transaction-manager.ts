import type { Transaction } from "./transaction";

/**
 * Orchestrates transactional boundaries.
 *
 * Implementations wrap the provided `work` callback in a database
 * transaction, committing on success and rolling back on failure.
 *
 * `TContext` is the transaction an implementation hands to `work`, so that
 * code writing inside the transaction receives what its driver needs, such as
 * a session, without a cast.
 */
export interface TransactionManager<
  TContext extends Transaction = Transaction,
> {
  /**
   * Executes `work` inside a transaction and returns its result.
   *
   * @typeParam T - The return type of the transactional work.
   * @param work - Async callback that receives the active transaction.
   */
  runInTransaction<T>(work: (transaction: TContext) => Promise<T>): Promise<T>;
}
