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
   * `work` may run more than once, when the driver retries after a transient
   * error: it must be safe to repeat.
   *
   * The promise resolves only after the commit succeeded. A rejection does not
   * prove that nothing was committed: a commit whose outcome is unknown may
   * have been applied, so a caller that runs the work again must make it
   * idempotent.
   *
   * A nested call, from inside `work`, is left to the implementation: it may
   * open an independent transaction, which neither sees nor rolls back with
   * the outer one. Code that writes inside a transaction receives the
   * transaction as a parameter instead of calling `runInTransaction` again.
   *
   * @typeParam T - The return type of the transactional work.
   * @param work - Async callback that receives the active transaction.
   */
  runInTransaction<T>(work: (transaction: TContext) => Promise<T>): Promise<T>;
}
