/**
 * Hashes a password to store, and checks a password against a stored hash.
 *
 * An implementation may read two different strings as the same password, for
 * instance when it reads only a prefix: it then says when in its
 * documentation, and a caller that accepts such passwords caps or refuses
 * them.
 */
export interface IPasswordHasher {
  /** Resolves to a string to store in place of `password`. */
  hash(password: string): Promise<string>;
  /**
   * Resolves `true` when `password` is the one `hashedPassword` was made from,
   * and `false` for a password the implementation reads as a different one.
   */
  compare(password: string, hashedPassword: string): Promise<boolean>;
}
