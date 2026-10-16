/**
 * Generic database interface defining the connection lifecycle.
 *
 * Implement this interface to provide a database connection layer
 * regardless of the underlying storage engine.
 */
export interface IDatabase {
  /**
   * Establish a connection to the database.
   * Implementations may also perform initialization tasks
   * such as schema validation or index management.
   */
  connect(): Promise<void>;

  /**
   * Gracefully close the database connection and release resources.
   */
  disconnect(): Promise<void>;

  /**
   * Check whether the database is currently connected.
   *
   * @returns `true` if a connection has been established and is still active.
   */
  isConnected(): boolean;
}
