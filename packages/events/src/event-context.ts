/**
 * Contextual data passed alongside an event during dispatch.
 * Enables transactional consistency by carrying the database session.
 */
export interface EventContext {
  /** Opaque transaction session (e.g. MongoDB ClientSession) */
  session?: unknown;
  /** Additional metadata keyed by string */
  [key: string]: unknown;
}
