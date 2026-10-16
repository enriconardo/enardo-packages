import { randomUUID } from "node:crypto";
import type { ClientSession, MongoClient, TransactionOptions } from "mongodb";
import type {
  ITransaction,
  ITransactionManager,
} from "@enardo/transaction-manager";

/** A transaction carrying the session that every write must pass to the driver. */
export interface IMongoTransaction extends ITransaction {
  readonly session: ClientSession;
}

export interface MongoTransactionManagerOptions {
  /** Read concern, write concern and read preference of every transaction. */
  readonly transactionOptions?: TransactionOptions | undefined;
}

/**
 * Runs work in a MongoDB multi-document transaction, which needs a replica set
 * or a sharded cluster.
 *
 * The driver's withTransaction commits once work resolves, aborts and rethrows
 * when it rejects, and calls work again after a transient error, such as a
 * write conflict with another transaction. Every call gets the same id, so the
 * attempts of one transaction can be told apart from other transactions.
 */
export class MongoTransactionManager implements ITransactionManager<IMongoTransaction> {
  constructor(
    private readonly client: MongoClient,
    private readonly options: MongoTransactionManagerOptions = {},
  ) {}

  async runInTransaction<T>(
    work: (transaction: IMongoTransaction) => Promise<T>,
  ): Promise<T> {
    const id = randomUUID();

    return this.client.withSession((session) =>
      session.withTransaction(
        () => work({ id, session }),
        this.options.transactionOptions,
      ),
    );
  }
}
