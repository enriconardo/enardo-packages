import bcrypt from "bcrypt";
import type { IPasswordHasher } from "@enardo/password-hasher";

const DEFAULT_SALT_ROUNDS = 12;

/**
 * Implements `IPasswordHasher` with bcrypt, which reads only the first 72
 * bytes of a password, counted in UTF-8: two passwords that share them match
 * the same hash.
 */
export class BcryptPasswordHasher implements IPasswordHasher {
  private readonly saltRounds: number;

  /**
   * @param saltRounds bcrypt's cost: each round more doubles the time `hash`
   * takes, and `compare` against the hashes it makes. Defaults to 12.
   */
  constructor(saltRounds: number = DEFAULT_SALT_ROUNDS) {
    this.saltRounds = saltRounds;
  }

  async hash(password: string): Promise<string> {
    return bcrypt.hash(password, this.saltRounds);
  }

  async compare(password: string, hashedPassword: string): Promise<boolean> {
    return bcrypt.compare(password, hashedPassword);
  }
}
