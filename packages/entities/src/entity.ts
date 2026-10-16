import type { EntityId } from "./entity-id.vo.js";
import { deepFreeze } from "./utils/index.js";

export interface EntityCommonAttributes {
  id: EntityId;
}

/**
 * Abstract base class for all domain entities.
 *
 * An entity is identified by an {@link EntityId} and compared by identity
 * rather than structural equality.  Its internal attributes are deeply frozen
 * on construction to enforce immutability.
 *
 * @template TAttributes Shape of the persisted/normalized entity attributes. Must extend {@link EntityCommonAttributes}.
 */
export abstract class Entity<TAttributes extends EntityCommonAttributes> {
  /**
   * @internal
   */
  _attributes: TAttributes;

  /**
   * @param attributes Initial attribute snapshot in normalized internal shape
   *   ({@link TAttributes}). The value is deeply frozen immediately to prevent
   *   unintended mutation from the outside.
   */
  protected constructor(attributes: TAttributes) {
    this._attributes = deepFreeze(attributes);
  }

  /** The entity's unique identifier. */
  get id(): EntityId {
    return this._attributes.id;
  }

  /**
   * Compares this entity to another value by type and identifier.
   *
   * Two entities are considered equal when they belong to the exact same
   * concrete class **and** share the same {@link EntityId}.
   *
   * @param other Any value to compare against.
   * @returns `true` only when `other` is the same object reference, or is an
   *    instance of the same concrete class with an equal identifier.
   */
  equals(other: unknown): boolean {
    if (this === other) {
      return true;
    }

    if (other === null || other === undefined) {
      return false;
    }

    if (!(other instanceof Entity)) {
      return false;
    }

    if (other.constructor !== this.constructor) {
      return false;
    }

    return this.id.equals(other.id);
  }
}
