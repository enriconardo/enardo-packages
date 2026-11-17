import { InvalidEntityIdError } from "~/errors";
import type { Equatable } from "./equatable";

// The brand is a symbol the module does not export, not a `private` property:
// a `private` brand is emitted in the declarations without its type, and every
// consumer of `dist/` would lose the distinction between `Id<"User">` and
// `Id<"Product">`.
declare const idBrand: unique symbol;

/**
 * Typed identifier value object. `B` brands the id at the type level only, so
 * a `UserId` (`Id<"User">`) cannot stand for a `ProductId`.
 *
 * The value is validated on construction (non-empty, non-blank) and the
 * instance is frozen.
 */
export class Id<B extends string> implements Equatable<Id<B>> {
  declare readonly [idBrand]: B;

  readonly #value: string;

  /**
   * @param value Raw identifier string, kept as given.
   * @throws {InvalidEntityIdError} When `value` is empty or only whitespace.
   */
  private constructor(value: string) {
    if (value.trim().length === 0) {
      throw new InvalidEntityIdError(value, "empty");
    }
    this.#value = value;
    Object.freeze(this);
  }

  /** Creates an id; `B` is inferred from the target type. */
  static create<B extends string>(value: string): Id<B> {
    return new Id<B>(value);
  }

  /** The raw identifier string. */
  get value(): string {
    return this.#value;
  }

  /**
   * Returns `true` when both ids wrap the same string. It reads the public
   * `value`, so an id from another copy of the package compares by value.
   */
  equals(other: Id<B>): boolean {
    return this.value === other?.value;
  }

  /** The raw string, so the id works where a `string` is expected. */
  toString(): string {
    return this.#value;
  }

  /** The raw string, so `JSON.stringify` writes a plain string. */
  toJSON(): string {
    return this.#value;
  }
}
