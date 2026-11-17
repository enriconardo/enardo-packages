/** What an entity's id must offer: any value object with an `equals`. */
export interface Equatable<T> {
  equals(other: T): boolean;
}
