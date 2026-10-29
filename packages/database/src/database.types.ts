/**
 * The lifecycle of a database connection.
 *
 * Implement this interface to provide a database connection layer
 * regardless of the underlying storage engine. How calls made while another
 * is in progress behave is each implementation's to document.
 */
export interface IDatabase {
  /**
   * Establish a connection to the database.
   *
   * Resolves when the database can be used, and rejects with an error its
   * implementation documents.
   */
  connect(): Promise<void>;

  /**
   * Close the connection and release resources.
   *
   * Resolves at once when there is nothing to release.
   */
  disconnect(): Promise<void>;

  /**
   * Check whether the database is connected.
   *
   * @returns `true` between a {@link IDatabase.connect} that resolved and the
   * close of the connection. It checks no server: it does not tell that the
   * server is reachable.
   */
  isConnected(): boolean;
}
