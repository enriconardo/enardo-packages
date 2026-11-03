/**
 * Hashes a password to store, and checks a password against a stored hash.
 *
 * Domain code depends on this interface alone, with `import type`, and gets
 * the hasher from its composition root.
 */
export interface PasswordHasher {
  /**
   * Resolves to a string to store in place of `password`, normalized to NFC.
   *
   * @throws {InvalidPasswordError} `PASSWORD_TOO_LONG` over 1024 UTF-16 code
   * units, `PASSWORD_MALFORMED` for a lone surrogate.
   */
  hash(password: string): Promise<string>;
  /**
   * Resolves `true` when `password`, normalized to NFC, is the one
   * `hashedPassword` was made from, on the parameters that string holds.
   * Resolves `false` for any other, and for a password `hash` would refuse.
   *
   * @throws {TypeError} `hashedPassword` is unreadable, whatever the password:
   * another algorithm or a corrupt row is a fault to fix, not a wrong password.
   */
  compare(password: string, hashedPassword: string): Promise<boolean>;
  /**
   * Whether the memory, the passes or the parallelism of `hashedPassword`
   * differ from this hasher's, up or down: lowering a cost is also a decision
   * to apply.
   *
   * @throws {TypeError} `hashedPassword` is unreadable.
   */
  needsRehash(hashedPassword: string): boolean;
}
