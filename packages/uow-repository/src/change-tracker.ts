/** State of an entity tracked during one unit of work. */
export type EntityState = "new" | "clean" | "removed";

/**
 * Combines identity tracking, lifecycle state, and what was read when the
 * entity was loaded: the snapshot of its records (restricted to the fields the
 * mapper returns, when `toRecords` maps the loaded entity) and the stored version. Both
 * are undefined for an entity that was never loaded.
 */
export interface TrackedEntity<TId, TEntity, TRecords, TVersion> {
  readonly id: TId;
  entity: TEntity;
  state: EntityState;
  snapshot: TRecords | undefined;
  version: TVersion | undefined;
}

/** Stores one canonical entity instance and its persistence lifecycle per identity. */
export class ChangeTracker<TId, TEntity, TRecords, TVersion> {
  private readonly entities = new Map<
    string,
    TrackedEntity<TId, TEntity, TRecords, TVersion>
  >();

  get(
    key: string,
  ): TrackedEntity<TId, TEntity, TRecords, TVersion> | undefined {
    return this.entities.get(key);
  }

  /** Registers a freshly loaded entity as clean, or returns the entity already tracked under this identity. */
  track(
    key: string,
    id: TId,
    entity: TEntity,
    snapshot: TRecords,
    version: TVersion,
  ): TrackedEntity<TId, TEntity, TRecords, TVersion> {
    const tracked = this.entities.get(key);
    if (tracked !== undefined) return tracked;

    const newTracked = {
      id,
      entity,
      state: "clean" as const,
      snapshot,
      version,
    };
    this.entities.set(key, newTracked);
    return newTracked;
  }

  untrack(key: string): void {
    this.entities.delete(key);
  }

  /** @throws {Error} The identity is already tracked as new, clean or removed. */
  add(key: string, id: TId, entity: TEntity): void {
    const tracked = this.entities.get(key);

    if (tracked === undefined) {
      this.entities.set(key, {
        id,
        entity,
        state: "new",
        snapshot: undefined,
        version: undefined,
      });
      return;
    }

    throw new Error(`An entity with identity "${key}" is already tracked.`);
  }

  remove(key: string, id: TId, entity: TEntity): void {
    const tracked = this.entities.get(key);

    if (tracked === undefined) {
      this.entities.set(key, {
        id,
        entity,
        state: "removed",
        snapshot: undefined,
        version: undefined,
      });
      return;
    }

    if (tracked.state === "new") {
      this.untrack(key);
      return;
    }

    tracked.state = "removed";
  }

  entries(): IterableIterator<
    [string, TrackedEntity<TId, TEntity, TRecords, TVersion>]
  > {
    return this.entities.entries();
  }

  clear(): void {
    this.entities.clear();
  }
}
