import type { Equatable } from "./equatable";

/**
 * Base of every domain entity: an identity and a state of attributes.
 *
 * The state lives in ECMAScript private fields, so nothing outside reaches it.
 * `attributes` is a shallow frozen snapshot: nested values are shared with the
 * caller and stay the domain's to keep immutable.
 */
export abstract class Entity<
  TId extends Equatable<TId>,
  TAttributes extends object,
> {
  readonly #id: TId;
  #attributes: Readonly<TAttributes>;

  /**
   * @param id - The identity, fixed for the entity's lifetime.
   * @param attributes - The initial state, stored as a frozen shallow copy.
   */
  protected constructor(id: TId, attributes: TAttributes) {
    this.#id = id;
    this.#attributes = Object.freeze({ ...attributes });
  }

  /** The identity given at construction; it never changes. */
  get id(): TId {
    return this.#id;
  }

  /**
   * The current state: a shallow frozen snapshot. Nested values are shared with
   * the caller. The reference is stable until a mutation changes a value.
   */
  get attributes(): Readonly<TAttributes> {
    return this.#attributes;
  }

  /**
   * Same reference, or same concrete class with an equal id. Reads the public
   * getters only, so an entity from another copy of the package compares
   * instead of throwing.
   */
  equals(other: unknown): boolean {
    if (this === other) return true;
    if (other === null || typeof other !== "object") return false;
    if (other.constructor !== this.constructor) return false;
    const otherId = (other as Entity<TId, TAttributes>).id;
    return this.id.equals(otherId);
  }

  /** Sets one attribute; a shorthand for `setAttributes` with a single key. */
  protected setAttribute<K extends keyof TAttributes>(
    key: K,
    value: TAttributes[K],
  ): void {
    this.setAttributes({ [key]: value } as Pick<TAttributes, K>);
  }

  /**
   * Sets several attributes. Compares each own key of `values` (symbols
   * included) with `Object.is`; when none differs it keeps the same snapshot,
   * otherwise it stores a new frozen shallow copy. Every mutation goes through
   * here, so it is the one method a subclass overrides to see them all.
   */
  protected setAttributes<K extends keyof TAttributes>(
    values: Pick<TAttributes, K>,
  ): void {
    const keys = Reflect.ownKeys(values) as K[];
    const current = this.#attributes;
    const changed = keys.some((key) => !Object.is(current[key], values[key]));
    if (!changed) return;
    this.#attributes = Object.freeze({ ...current, ...values });
  }
}
