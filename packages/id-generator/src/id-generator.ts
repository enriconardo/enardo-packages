/**
 * Generates the ids of new entities.
 *
 * The id's format is the implementation's: a caller that relies on a format
 * depends on the implementation, not on this contract.
 */
export interface IdGenerator {
  /** Returns a new id, which no other call returns. */
  generate(): string;
}
