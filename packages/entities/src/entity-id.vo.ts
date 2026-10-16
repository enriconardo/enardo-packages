import { InvalidEntityIdError } from "~/errors";

/**
 * Strongly-typed value object representing a domain entity identifier.
 *
 * The value is validated on construction (non-empty, non-blank) and the
 * instance is immediately frozen, making it safe to share across boundaries.
 */
export class EntityId {
  // Avoid structural typing issues by adding a private brand property
  private readonly _brand = "EntityId";

  private readonly _value: string;

  private static normalize(value: string): string {
    return value;
  }

  private validate(): void {
    if (this._value.trim().length === 0) {
      throw new InvalidEntityIdError(this._value, "empty");
    }
  }

  /**
   * @param value Raw identifier string.
   * @throws {InvalidEntityIdError} When `value` is empty or contains only whitespace.
   */
  private constructor(value: string) {
    this._value = EntityId.normalize(value);
    this.validate();
    Object.freeze(this);
  }

  static create(value: string): EntityId {
    return new EntityId(value);
  }

  /** The raw identifier string. */
  get value(): string {
    return this._value;
  }

  /**
   * Returns `true` when both objects wrap the same identifier string.
   *
   * @param other The EntityId to compare against.
   */
  equals(other: EntityId): boolean {
    if (!other) return false;
    return this._value === other._value;
  }

  /**
   * Returns the raw identifier string, making the value object transparently
   * usable wherever a `string` is expected (e.g. template literals, logging).
   */
  toString(): string {
    return this._value;
  }

  /**
   * Returns the raw identifier string so that `JSON.stringify` serialises the
   * value object as a plain string rather than a nested object.
   */
  toJSON(): string {
    return this._value;
  }
}
