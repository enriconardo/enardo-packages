/**
 * Hashes a password to store, and checks a password against a stored hash.
 *
 * An implementation may read only a prefix of a password: it then says how
 * long in its documentation, and a caller that accepts longer passwords caps
 * them.
 */
export interface IPasswordHasher {
  /** Resolves to a string to store in place of `password`. */
  hash(password: string): Promise<string>;
  /**
   * Resolves `true` when `password` is the one `hashedPassword` was made from,
   * and `false` for a password that differs from it within the length the
   * implementation reads.
   */
  compare(password: string, hashedPassword: string): Promise<boolean>;
}
